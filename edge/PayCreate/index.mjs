import { config as loadEnv } from 'dotenv';
loadEnv();

import crypto from 'node:crypto';
import { json, options } from '../lib/http.mjs';
import { writeJson, paths } from '../lib/store.mjs';
import { hmacIndex, deriveAddress } from '../lib/derive-btc.mjs';
import { reserveStock } from '../lib/db.mjs';

const USD_PER_BTC = Number(process.env.USD_PER_BTC || process.env.USD_PER_BTC_DEV || 65000);
const MIN_SATS    = Number(process.env.MIN_SATS || 50000);
const XPUB        = (process.env.XPUB || '').trim();
const HMAC_SECRET = (process.env.HMAC_SECRET || '').trim();
const DEBUG_ERR   = process.env.DEBUG_PAYCREATE === '1';

function usdToSats(usd) {
  const sats = Math.round((Number(usd || 0) / USD_PER_BTC) * 1e8);
  return Math.max(MIN_SATS, sats);
}

function normalizeItems(lines) {
  const acc = {};
  for (const l of (Array.isArray(lines) ? lines : [])) {
    const sku = String(l.sku || l.id || '').trim();
    const qty = Number(l.qty || l.quantity || 0);
    if (!sku || qty <= 0) continue;
    acc[sku] = (acc[sku] || 0) + qty;
  }
  return acc;
}

export default async function (context, req) {
  if (req.method === 'OPTIONS') return options(context.res);
  if (req.method !== 'POST')    return json(context.res, { error: 'method_not_allowed' }, 405);

  try {
    const body = req.body ?? {};

    const amountUsdIn  = Number(body.amountUsd ?? 0);
    const amountSatsIn = Number((body.amountSats ?? '').toString().trim());
    const items        = normalizeItems(body.lines); // { sku: qty, ... }

    let amountSats = Number.isFinite(amountSatsIn) && amountSatsIn > 0
      ? amountSatsIn
      : usdToSats(amountUsdIn);

    if (!Number.isFinite(amountSats) || amountSats <= 0) {
      return json(context.res, { error: 'invalid_amount' }, 400);
    }
    if (amountSats < MIN_SATS) amountSats = MIN_SATS;

    if (!(XPUB && HMAC_SECRET)) {
      return json(
        context.res,
        { error: 'xpub_required', detail: DEBUG_ERR ? 'no_xpub_or_hmac' : undefined },
        500
      );
    }

    if (Object.keys(items).length > 0) {
      const r = await reserveStock(items);
      if (!r.ok) {
        return json(context.res, {
          error: r.error || 'reserve_failed',
          sku: r.sku, need: r.need, have: r.have
        }, 409);
      }
    }

    const token = crypto.randomUUID();

    let address;
    try {
      const idx = hmacIndex(HMAC_SECRET, token);
      address = deriveAddress(XPUB, idx);
    } catch (e) {
      return json(
        context.res,
        { error: 'xpub_derive_failed', detail: DEBUG_ERR ? String(e?.message || e) : undefined },
        500
      );
    }

    const invoice = {
      token,
      address,
      source: 'xpub',
      amountSats: Number(amountSats),
      amountUsd: Number.isFinite(amountUsdIn) ? amountUsdIn : null,
      items,
      committed: false,
      createdAt: new Date().toISOString()
    };

    await writeJson(paths.paymentFile(token), invoice);

    return json(context.res, {
      token, address, amountSats: Number(amountSats), source: 'xpub'
    }, 200);
  } catch (e) {
    return json(
      context.res,
      { error: 'create_failed', detail: DEBUG_ERR ? String(e?.message || e) : undefined },
      500
    );
  }
}

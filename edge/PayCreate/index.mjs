import { config as loadEnv } from 'dotenv';
loadEnv();

import crypto from 'node:crypto';
import { json, options } from '../lib/http.mjs';
import { writeJson, paths } from '../lib/store.mjs';
import { hmacIndex, deriveAddress } from '../lib/derive-btc.mjs';
import { reserveStock, getProducts } from '../lib/db.mjs';

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

    const items = normalizeItems(body.lines);
    const entries = Object.entries(items);
    if (!entries.length || entries.length > 50 || entries.some(([sku,qty]) => !/^[a-zA-Z0-9_-]{1,64}$/.test(sku) || !Number.isSafeInteger(qty) || qty < 1 || qty > 100)) {
      return json(context.res, { error: 'invalid_cart' }, 400);
    }
    const catalog = new Map((await getProducts()).map(p => [p.id,p]));
    let cents = 0;
    for (const [sku,qty] of entries) {
      const product = catalog.get(sku);
      if (!product || !Number.isFinite(product.price) || product.price <= 0) return json(context.res,{error:'invalid_product'},400);
      cents += Math.round(product.price*100)*qty;
    }
    if (!Number.isSafeInteger(cents) || cents <= 0 || !Number.isFinite(USD_PER_BTC) || USD_PER_BTC <= 0) return json(context.res,{error:'invalid_price'},500);
    const amountUsdIn = cents/100;
    const amountSats = usdToSats(amountUsdIn);
    if (!(XPUB && HMAC_SECRET)) {
      return json(
        context.res,
        { error: 'xpub_required', detail: DEBUG_ERR ? 'no_xpub_or_hmac' : undefined },
        500
      );
    }

    {
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
      await import('../lib/db.mjs').then(m => m.releaseStock(items));
      return json(context.res,{ error:'xpub_derive_failed' },500);
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

    try { await writeJson(paths.paymentFile(token), invoice); }
    catch (error) { await import('../lib/db.mjs').then(m => m.releaseStock(items)); throw error; }

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

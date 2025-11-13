import { config as loadEnv } from 'dotenv';
loadEnv();

import { json, options } from '../lib/http.mjs';
import { readJson, writeJson, paths } from '../lib/store.mjs';
import { commitStock } from '../lib/db.mjs';

const API1 = process.env.BLOCKSTREAM_API || 'https://blockstream.info/api';
const API2 = process.env.ESPLORA_FALLBACK || 'https://mempool.space/api';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getJson(url, { timeout = 8000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`http_${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function withRetry(fn, { tries = 3, delay = 300 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) { last = e; await sleep(delay); }
  }
  throw last;
}

async function readAddressStats(base, address) {
  const addr = await withRetry(() => getJson(`${base}/address/${address}`, { timeout: 8000 }));
  const chain   = Number(addr.chain_stats?.funded_txo_sum || 0);
  const mempool = Number(addr.mempool_stats?.funded_txo_sum || 0);
  return { receivedTotal: chain + mempool, chain };
}

async function tryProviders(context, address) {
  const errors = [];
  for (const base of [API1, API2]) {
    try {
      context.log(`[PayStatus] Trying provider: ${base}`);
      const stats = await readAddressStats(base, address);
      context.log(`[PayStatus] Success at ${base}`);
      return { ok: true, base, ...stats };
    } catch (e) {
      const msg = e?.message || String(e);
      context.log.warn(`[PayStatus] Failed ${base}: ${msg}`);
      errors.push(`${base}: ${msg}`);
    }
  }
  return { ok: false, errors };
}

export default async function (context, req) {
  if (req.method === 'OPTIONS') return options(context.res);
  if (req.method !== 'GET')     return json(context.res, { error: 'method_not_allowed' }, 405);

  const token = String(req.query?.token || '').trim();
  const amountSatsQ = req.query?.amountSats;
  const debug = req.query?.debug === '1' || req.query?.debug === 'true';

  if (!token) return json(context.res, { error: 'missing_token' }, 400);

  let invoice;
  try {
    invoice = await readJson(paths.paymentFile(token));
  } catch {
    return json(context.res, { error: 'not_found' }, 404);
  }

  const address = invoice?.address?.trim();

  const qNum   = Number(amountSatsQ);
  const invNum = Number(invoice?.amountSats);
  let need = 0;
  if (Number.isFinite(qNum) && qNum > 0) need = qNum;
  else if (Number.isFinite(invNum) && invNum > 0) need = invNum;

  if (debug) {
    return json(context.res, {
      debug: true,
      token,
      address,
      queryAmountRaw: amountSatsQ,
      invoiceAmountRaw: invoice?.amountSats,
      parsedQuery: qNum,
      parsedInvoice: invNum,
      need
    }, 200);
  }

  if (!address || !Number.isFinite(need) || need <= 0) {
    return json(context.res, {
      error: 'bad_invoice',
      hint: 'call with ?debug=1 to inspect amounts'
    }, 400);
  }

  const res = await tryProviders(context, address);
  if (!res.ok) {
    return json(context.res, {
      paid: false,
      confs: 0,
      address,
      error: 'esplora_failed',
      detail: res.errors.join(' | ')
    }, 502);
  }

  const paid = res.receivedTotal >= need;

  let confs = 0;
  if (paid) {
    try {
      const txs = await withRetry(() => getJson(`${res.base}/address/${address}/txs`, { timeout: 8000 }));
      const tip = await withRetry(() => getJson(`${res.base}/blocks/tip/height`, { timeout: 5000 }));
      const heights = Array.isArray(txs)
        ? txs.filter(t => t?.status?.confirmed).map(t => t.status.block_height)
        : [];
      if (heights.length && Number.isFinite(Number(tip))) {
        const minH = Math.min(...heights);
        confs = Math.max(0, Number(tip) - minH + 1);
      }
    } catch (e) {
      context.log.warn('[PayStatus] Failed to fetch confirmations:', e?.message || e);
    }

    if (!invoice.committed) {
      const items = invoice.items || {};
      try {
        await commitStock(items);
        invoice.committed = true;
        await writeJson(paths.paymentFile(token), { ...invoice });
      } catch (e) {
        context.log.warn('[PayStatus] commitStock failed:', e?.message || e);
      }
    }
  }

  return json(context.res, { paid, confs, address }, 200);
}

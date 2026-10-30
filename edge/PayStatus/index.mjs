import { config as loadEnv } from 'dotenv';
loadEnv();

import { json, options } from '../lib/http.mjs';
import { readJson, writeJson, paths, withFileLock } from '../lib/store.mjs';
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
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) return json(context.res,{error:'invalid_token'},400);

  if (!token) return json(context.res, { error: 'missing_token' }, 400);

  let invoice;
  try {
    invoice = await readJson(paths.paymentFile(token));
  } catch {
    return json(context.res, { error: 'not_found' }, 404);
  }

  const address = typeof invoice?.address === 'string' ? invoice.address.trim() : '';

  const need = Number(invoice?.amountSats);
  if (!address || !Number.isSafeInteger(need) || need <= 0) {
    return json(context.res, {
      error: 'bad_invoice',
      detail: 'invalid invoice'
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

  const required = Math.max(1, Number(process.env.MIN_CONFIRMATIONS || 1));
  if (!Number.isSafeInteger(required) || required > 100) return json(context.res,{error:'invalid_confirmation_config'},500);
  let confirmedSats = 0;
  let confs = 0;
  try {
    const txs = await withRetry(() => getJson(`${res.base}/address/${address}/txs`));
    const tip = Number(await withRetry(() => getJson(`${res.base}/blocks/tip/height`)));
    if (!Array.isArray(txs) || !Number.isSafeInteger(tip)) throw new Error('invalid_chain_data');
    for (const tx of txs) {
      if (!tx?.status?.confirmed || !Number.isSafeInteger(Number(tx.status.block_height))) continue;
      const txConfs = tip - Number(tx.status.block_height) + 1;
      if (txConfs < 1) continue;
      const received = (Array.isArray(tx.vout) ? tx.vout : []).filter(v => v.scriptpubkey_address === address)
        .reduce((sum,v) => sum + Number(v.value || 0), 0);
      if (!Number.isSafeInteger(received) || received < 0) throw new Error('invalid_tx_value');
      if (received > 0) {
        confs = confs ? Math.min(confs, txConfs) : txConfs;
        if (txConfs >= required) confirmedSats += received;
      }
    }
    if (!Number.isSafeInteger(confirmedSats)) throw new Error('invalid_total');
  } catch (e) {
    context.log.warn('[PayStatus] Verification unavailable:', e?.message || e);
    return json(context.res,{paid:false,confs:0,error:'verification_unavailable'},502);
  }
  const paid = confirmedSats >= need;
  if (paid && !invoice.committed) {
    try {
      await withFileLock(paths.paymentFile(token) + '.lock', async () => {
        const latest = await readJson(paths.paymentFile(token));
        if (!latest || latest.amountSats !== invoice.amountSats || latest.address !== address) throw new Error('invoice_changed');
        if (!latest.committed) {
          const result = await commitStock(latest.items || {});
          if (!result?.ok) throw new Error('stock_commit_failed');
          await writeJson(paths.paymentFile(token), { ...latest, committed: true });
        }
      });
    } catch (e) {
      context.log.warn('[PayStatus] Invoice commit failed:', e?.message || e);
      return json(context.res,{paid:false,confs,error:'commit_pending'},503);
    }
  }
  return json(context.res,{paid,confs,address},200);
}

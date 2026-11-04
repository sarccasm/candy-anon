// Read-only Esplora watcher. Fail closed on pagination, mempool limits and tip changes.
import { inspectBitcoinPayments } from './btc-reconciliation.mjs';

const TXID = /^[0-9a-f]{64}$/i;
const HASH = TXID;
const ADDRESS = /^[a-zA-Z0-9]{14,90}$/;

export async function fetchCompleteEsploraHistory({
  address, baseUrl, fetchImpl = fetch, maxPages = 40, timeoutMs = 8000, signal
}) {
  if (!ADDRESS.test(address || '') || typeof baseUrl !== 'string' || !/^https:\/\//.test(baseUrl))
    throw new Error('invalid_source');
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000)
    throw new Error('invalid_limits');
  const root = baseUrl.replace(/\/$/, '');
  async function get(route) {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(`${root}${route}`, {signal:signal?AbortSignal.any([signal,ctrl.signal]):ctrl.signal});
      if (!res.ok) throw new Error('provider_unavailable');
      return await res.json().catch(() => { throw new Error('invalid_response'); });
    } finally { clearTimeout(timeout); }
  }
  async function getTipHash() {
    const ctrl=new AbortController();
    const timeout=setTimeout(()=>ctrl.abort(),timeoutMs);
    try {
      const response=await fetchImpl(`${root}/blocks/tip/hash`,{signal:signal?AbortSignal.any([signal,ctrl.signal]):ctrl.signal});
      if(!response.ok)throw new Error('provider_unavailable');
      return (await response.text()).trim();
    } finally {clearTimeout(timeout);}
  }
  const tipBefore = await getTipHash();
  if (typeof tipBefore !== 'string' || !HASH.test(tipBefore)) throw new Error('invalid_tip');
  const stats = await get(`/address/${address}`);
  const count = stats?.chain_stats?.tx_count;
  if (!Number.isSafeInteger(count) || count < 0 || count > maxPages * 25)
    throw new Error('history_exceeds_limit');
  const mempool = await get(`/address/${address}/txs/mempool`);
  if (!Array.isArray(mempool) || mempool.length >= 50) throw new Error('mempool_may_be_truncated');
  const chain = [];
  const seen = new Set(mempool.map(tx => tx.txid));
  if (seen.size !== mempool.length || [...seen].some(id => !TXID.test(id)))
    throw new Error('duplicate_or_invalid_txid');
  let cursor = '';
  for (let pageIndex = 0; chain.length < count; pageIndex++) {
    if (pageIndex >= maxPages) throw new Error('history_exceeds_limit');
    const page = await get(`/address/${address}/txs/chain${cursor ? '/' + cursor : ''}`);
    if (!Array.isArray(page) || page.length === 0 || page.length > 25) throw new Error('invalid_page');
    for (const tx of page) {
      if (!TXID.test(tx?.txid || '') || seen.has(tx.txid) || tx.status?.confirmed !== true)
        throw new Error('duplicate_or_invalid_transaction');
      seen.add(tx.txid);
      chain.push(tx);
    }
    cursor = page.at(-1).txid;
    if (chain.length > count) throw new Error('history_changed');
    if (page.length < 25 && chain.length < count) throw new Error('incomplete_history');
  }
  const tipAfter = await getTipHash();
  if (tipAfter !== tipBefore) throw new Error('tip_changed_retry');
  const statsAfter = await get(`/address/${address}`);
  if (statsAfter?.chain_stats?.tx_count !== count) throw new Error('history_changed');
  return { transactions:[...mempool,...chain], completeHistory:true, tipHash:tipAfter };
}

export async function observeBitcoinInvoice({ address, expectedSats, requiredConfirmations = 2,
  expired = false, baseUrl, fetchImpl = fetch, maxPages = 40, timeoutMs = 8000, signal }) {
  // Check tip HEIGHT under the same no-reorg window used to fetch transaction history.
  // This is observation only. A second verification is required before any settlement.
  const root = baseUrl?.replace(/\/$/, '');
  const history = await fetchCompleteEsploraHistory({address,baseUrl,fetchImpl,maxPages,timeoutMs,signal});
  async function getText(route) {
    const ctrl=new AbortController();
    const timeout=setTimeout(()=>ctrl.abort(),timeoutMs);
    try {
      const response=await fetchImpl(`${root}${route}`,{signal:signal?AbortSignal.any([signal,ctrl.signal]):ctrl.signal});
      if(!response.ok)throw Error('provider_unavailable');
      return await response.text();
    } finally {clearTimeout(timeout);}
  }
  const height = Number(await getText('/blocks/tip/height'));
  if (!Number.isSafeInteger(height) || height < 0) throw new Error('invalid_tip_height');
  if ((await getText('/blocks/tip/hash')).trim() !== history.tipHash) throw new Error('tip_changed_retry');
  return inspectBitcoinPayments({address,expectedSats,requiredConfirmations,expired,
    transactions:history.transactions,completeHistory:true,tipHeight:height});
}

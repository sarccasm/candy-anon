import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchCompleteEsploraHistory, observeBitcoinInvoice } from '../edge/lib/esplora-watcher.mjs';

const address = 'bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
const hash = 'f'.repeat(64);
const tx = (index) => ({
  txid: index.toString(16).padStart(64,'0'), status:{confirmed:true,block_height:100},
  vout:[{scriptpubkey_address:address,value:1000}]
});
function fake({ confirmed = [], mempool = [], tipChanged = false, count = confirmed.length } = {}) {
  let hashes = 0;
  return async (url) => {
    const u = new URL(url); const p=u.pathname;
    let value;
    if (p.endsWith('/blocks/tip/hash')) { hashes++; value = tipChanged && hashes > 1 ? 'e'.repeat(64) : hash; }
    else if (p.endsWith('/blocks/tip/height')) value = '101';
    else if (p.endsWith('/txs/mempool')) value = mempool;
    else if (p.endsWith('/txs/chain')) value = confirmed.slice(0,25);
    else if (p.includes('/txs/chain/')) {
      const cursor = p.split('/').at(-1);
      const idx = confirmed.findIndex(t => t.txid === cursor);
      value = idx < 0 ? [] : confirmed.slice(idx + 1, idx + 26);
    }
    else if (p.endsWith('/address/' + address)) value = {chain_stats:{tx_count:count}};
    else throw Error('unknown mock route: '+p);
    return {ok:true, json: async()=>value, text:async()=>String(value)};
  };
}
const source={address,baseUrl:'https://mock.example/api'};

test('loads multiple complete chain pages and classifies paid',async()=>{
  const confirmed=Array.from({length:27},(_,i)=>tx(i+1));
  const result=await fetchCompleteEsploraHistory({...source,fetchImpl:fake({confirmed})});
  assert.equal(result.completeHistory,true);
  assert.equal(result.transactions.length,27);
  const payment=await observeBitcoinInvoice({...source,expectedSats:25000,fetchImpl:fake({confirmed})});
  assert.equal(payment.status,'PAID');
});
test('rejects inconsistent counts, capped mempool, and changing tip',async()=>{
  await assert.rejects(()=>fetchCompleteEsploraHistory({...source,fetchImpl:fake({confirmed:[tx(1)],count:27})}),/invalid_page|incomplete_history/);
  await assert.rejects(()=>fetchCompleteEsploraHistory({...source,fetchImpl:fake({mempool:Array.from({length:50},(_,i)=>({...tx(i+1),status:{confirmed:false}}))})}),/mempool_may_be_truncated/);
  await assert.rejects(()=>fetchCompleteEsploraHistory({...source,fetchImpl:fake({tipChanged:true})}),/tip_changed_retry/);
});
test('never invents completeness after provider outage',async()=>{
  await assert.rejects(()=>fetchCompleteEsploraHistory({...source,fetchImpl:async()=>({ok:false})}),/provider_unavailable/);
  await assert.rejects(()=>fetchCompleteEsploraHistory({...source,fetchImpl:fake({confirmed:Array.from({length:26},(_,i)=>tx(i+1)),count:26}),maxPages:1}),/history_exceeds_limit/);
});

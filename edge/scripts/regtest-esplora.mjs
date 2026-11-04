import https from 'node:https';
import {readFile} from 'node:fs/promises';
import {root,rpc} from './local-config.mjs';

// Local-only protocol adapters. Both read the SAME regtest node: they exercise
// the production two-source protocol but do not prove provider independence.
const info=await rpc('getblockchaininfo');if(info.chain!=='regtest')throw Error('regtest_required');
const tls={key:await readFile(new URL('.local/localhost.key',root)),cert:await readFile(new URL('.local/localhost.crt',root))};
async function transactions(address) {
 const entries=await rpc('listtransactions',['*',10000,0,true],'watch');
 if(entries.length>=10000)throw Error('local_history_limit');
 const result=[];
 for(const txid of new Set(entries.map(entry=>entry.txid))){
  const walletTx=await rpc('gettransaction',[txid,true],'watch');
  if(walletTx.confirmations<0)continue;
  const raw=await rpc('getrawtransaction',[txid,true]);
  if(!raw.vout.some(out=>out.scriptPubKey.address===address))continue;
  const status={confirmed:walletTx.confirmations>0};
  if(status.confirmed){const block=await rpc('getblockheader',[walletTx.blockhash]);status.block_height=block.height;status.block_hash=walletTx.blockhash;}
  result.push({txid,vout:raw.vout.map(out=>({scriptpubkey_address:out.scriptPubKey.address,value:Math.round(out.value*1e8)})),status});
 }
 return result.sort((a,b)=>(b.status.block_height||0)-(a.status.block_height||0)||a.txid.localeCompare(b.txid));
}
const handler=async(req,res)=>{
 try {
  const path=new URL(req.url,'https://localhost').pathname;
  let body,isText=false;
  if(path==='/api/blocks/tip/hash'){body=await rpc('getbestblockhash');isText=true;}
  else if(path==='/api/blocks/tip/height'){body=String(await rpc('getblockcount'));isText=true;}
  else {
   const match=path.match(/^\/api\/address\/([a-zA-Z0-9]{14,90})(?:\/(txs\/mempool|txs\/chain)(?:\/([0-9a-f]{64}))?)?$/);
   if(!match){res.writeHead(404);res.end();return;}
   const [,address,route,cursor]=match;
   const all=await transactions(address),chain=all.filter(tx=>tx.status.confirmed);
   if(route==='txs/mempool')body=all.filter(tx=>!tx.status.confirmed);
   else if(route==='txs/chain')body=chain.slice(cursor?chain.findIndex(tx=>tx.txid===cursor)+1:0).slice(0,25);
   else body={chain_stats:{tx_count:chain.length}};
  }
  res.writeHead(200,{'content-type':isText?'text/plain':'application/json','cache-control':'no-store'});
  res.end(isText?body:JSON.stringify(body));
 } catch {res.writeHead(503);res.end('local_regtest_unavailable');}
};
const servers=[19101,19102].map(port=>https.createServer(tls,handler).listen(port,'127.0.0.1'));
console.log('Local regtest HTTPS adapters listening on loopback.');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const server of servers)server.close();setTimeout(()=>process.exit(0),200).unref();});

import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {root,rpc} from '../edge/scripts/local-config.mjs';
const settings=JSON.parse(await readFile(new URL('.local/settings.json',root)));
if(settings.NETWORK!=='regtest')throw Error('local_regtest_settings_required');
if((await rpc('getblockchaininfo')).chain!=='regtest')throw Error('regtest_node_required');
const endpoint='http://127.0.0.1:5173/api/dash/checkout';
async function request(body){
 const response=await fetch(endpoint,{method:body?'POST':'GET',headers:{'x-admin-key':settings.ADMIN_KEY,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify({...body,requestId:randomUUID()})}:{}),signal:AbortSignal.timeout(15000)});
 const result=await response.json();
 if(!response.ok)throw Error('local_checkout:'+String(result.error||response.status));
 return result.checkout;
}
async function refresh(enable=false){
 let policy=await request();
 policy=await request({action:'update_quote',version:policy.version,usdPerBtc:Number(settings.USD_PER_BTC)});
 if(enable&&!policy.enabled)policy=await request({action:'set_enabled',version:policy.version,enabled:true});
 console.log(JSON.stringify({environment:'local-regtest',enabled:policy.enabled,syntheticUsdPerBtc:policy.usdPerBtc,quoteFresh:policy.quoteFresh}));
}
await refresh(true);
if(process.argv.includes('--watch'))setInterval(()=>refresh().catch(error=>console.error(error.message)),5*60*1000);

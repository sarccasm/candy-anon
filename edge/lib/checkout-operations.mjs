import {createHash} from 'node:crypto';
import {validToken} from './encrypted-fulfillment.mjs';
import {readCheckoutPolicy,policySummary} from './checkout-policy.mjs';
export async function updateCheckoutPolicy({client,body,actorKey,now=Date.now()}) {
 const {action,version,requestId}=body || {};
 if(!['set_enabled','update_quote'].includes(action)||!Number.isSafeInteger(version)||version<0||!validToken(requestId))throw Error('invalid_action');
 if(action==='set_enabled'&&typeof body.enabled!=='boolean')throw Error('invalid_enabled');
 if(action==='update_quote'&&(!Number.isFinite(body.usdPerBtc)||body.usdPerBtc<=0||body.usdPerBtc>1e9))throw Error('invalid_quote');
 const key='ops-policy-audit:'+requestId;
 const digest=createHash('sha256').update(JSON.stringify({action,enabled:body.enabled,usdPerBtc:body.usdPerBtc})).digest('hex');
 try {
  const prior=await client.getEntity('invoices',key);
  if(prior.digest!==digest)throw Error('idempotency_conflict');
  return policySummary(await readCheckoutPolicy(client),now);
 }catch(error){if(error.statusCode!==404)throw error;}
 const policy=await readCheckoutPolicy(client);
 if(policy.revision!==version)throw Error('operation_conflict');
 const {etag,timestamp,...fields}=policy;
 const next={...fields,revision:version+1,
  ...(action==='set_enabled'?{enabled:body.enabled}:{usdPerBtc:body.usdPerBtc,quoteUpdatedAt:new Date(now).toISOString()})};
 if(next.enabled&&(!Number.isFinite(Date.parse(next.quoteUpdatedAt))||now<Date.parse(next.quoteUpdatedAt)||now-Date.parse(next.quoteUpdatedAt)>next.quoteMaxAgeSeconds*1000))throw Error('btc_quote_expired');
 try {
  await client.submitTransaction([
   ['update',next,'Replace',{etag}],
   ['create',{partitionKey:'invoices',rowKey:key,digest,action,at:new Date(now).toISOString(),
    actor:createHash('sha256').update('admin-key:'+actorKey).digest('hex').slice(0,16)}]
  ]);
 }catch(error){if([409,412].includes(error.statusCode))throw Error('operation_conflict');throw error;}
 return policySummary(next,now);
}

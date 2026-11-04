import {authorizeLocalRequest} from './local-request-auth.mjs';
import {okAuth,json,options} from './http.mjs';
export function adminEndpoint(methods,handler) {
 return async(context,req)=>{
  context.res ??= {};
  if(!authorizeLocalRequest(context,req))return;
  const origin=process.env.ALLOWED_ORIGIN || process.env.ALLOW_ORIGIN || 'https://admin.mycandy.app';
  const respond=(body,status=200)=>json(context.res,body,status,{origin,'Cache-Control':'no-store'});
  if(req.method==='OPTIONS')return options(context.res,{origin});
  if(!okAuth(req))return respond({error:'unauthorized'},401);
  if(!methods.includes(req.method))return respond({error:'method_not_allowed'},405);
  try {
   if(req.body&&Buffer.byteLength(JSON.stringify(req.body))>16384)return respond({error:'request_too_large'},413);
   const result=await handler(req);
   return respond(result);
  }catch(error){
   const bad=/^invalid_|^receipt_required$/.test(error.message);
   const conflict=['operation_conflict','idempotency_conflict','review_open','review_not_open','payment_requires_review',
    'handoff_already_prepared','handoff_not_ready','encrypted_details_missing','btc_quote_expired'].includes(error.message);
   const status=bad?400:conflict?409:error.message==='not_found'?404:503;
   return respond({error:status===503?'operations_unavailable':error.message},status);
  }
 };
}

import {authorizeLocalRequest} from '../lib/local-request-auth.mjs';
import 'dotenv/config';
import { json, options } from '../lib/http.mjs';
import { invoiceStoreFromEnvironment } from '../lib/azure-invoices.mjs';
import { azureEscrowFromEnvironment } from '../lib/azure-encrypted-escrow.mjs';
import { reconcileInvoice } from '../lib/payment-processing.mjs';
import { validToken } from '../lib/encrypted-fulfillment.mjs';

// Compatibility endpoint: idempotently confirms a durable task, never a carrier handoff.
export default async function(context,req) {
  context.res ??= {};
  if(!authorizeLocalRequest(context,req))return;
  if(req.method==='OPTIONS')return options(context.res);
  if(req.method!=='POST')return json(context.res,{error:'method_not_allowed'},405);
  const {token,data}=req.body || {};
  if(!validToken(token))return json(context.res,{error:'bad_token'},400);
  if(data!==undefined)return json(context.res,{error:'use_encrypted_escrow'},400);
  try {
    const result=await reconcileInvoice({store:await invoiceStoreFromEnvironment(),
      escrow:await azureEscrowFromEnvironment(),token});
    if(result.body.paid!==true)return json(context.res,result.body,result.code);
    if(!['PENDING','HANDOFF_READY','FULFILLED'].includes(result.body.fulfillmentStatus))
      return json(context.res,{error:'manual_review_required'},409);
    // Payment and fulfillment task are already persisted; retries also return success.
    return json(context.res,{ok:true,status:'FULFILLMENT_PENDING'},200);
  } catch {
    return json(context.res,{error:'fulfillment_unavailable'},503);
  }
}

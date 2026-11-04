import {authorizeLocalRequest} from '../lib/local-request-auth.mjs';
import 'dotenv/config';
import { json, options } from '../lib/http.mjs';
import { invoiceStoreFromEnvironment } from '../lib/azure-invoices.mjs';
import { azureEscrowFromEnvironment } from '../lib/azure-encrypted-escrow.mjs';
import { reconcileInvoice } from '../lib/payment-processing.mjs';
import { validToken } from '../lib/encrypted-fulfillment.mjs';

export default async function (context, req) {
  context.res ??= {};
  if(!authorizeLocalRequest(context,req))return;
  if(req.method==='OPTIONS')return options(context.res);
  if(req.method!=='GET')return json(context.res,{error:'method_not_allowed'},405);
  const token=String(req.query?.token || '').trim();
  if(!validToken(token))return json(context.res,{error:'invalid_token'},400);
  try {
    const result=await reconcileInvoice({store:await invoiceStoreFromEnvironment(),
      escrow:await azureEscrowFromEnvironment(),token});
    return json(context.res,result.body,result.code);
  } catch {
    return json(context.res,{paid:false,error:'payment_service_unavailable'},503);
  }
}

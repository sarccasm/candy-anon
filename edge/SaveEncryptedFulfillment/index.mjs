import {authorizeLocalRequest} from '../lib/local-request-auth.mjs';
import { json, options } from '../lib/http.mjs';
import { invoiceStoreFromEnvironment } from '../lib/azure-invoices.mjs';
import { validToken, validCiphertext } from '../lib/encrypted-fulfillment.mjs';
import { azureEscrowFromEnvironment } from '../lib/azure-encrypted-escrow.mjs';

// Accept encrypted delivery details BEFORE payment, never plaintext. The random
// invoice token acts as a bearer secret; deploy rate-limits and durable storage.
export default async function (context, req) {
  context.res ??= {};
  if(!authorizeLocalRequest(context,req))return;
  if (req.method === 'OPTIONS') return options(context.res);
  if (req.method !== 'POST') return json(context.res,{error:'method_not_allowed'},405);
  const {token,data} = req.body || {};
  if (!validToken(token) || !validCiphertext(data)) return json(context.res,{error:'invalid_payload'},400);
  let invoice;
  try { invoice = await (await invoiceStoreFromEnvironment()).read(token); }
  catch { return json(context.res,{error:'invoice_store_unavailable'},503); }
  if (!invoice || invoice.token !== token) return json(context.res,{error:'not_found'},404);
  if (invoice.committed) return json(context.res,{error:'already_settled'},409);
  const created = Date.parse(invoice.createdAt);
  if (!Number.isFinite(created) || Date.now() > created + 1200000)
    return json(context.res,{error:'invoice_expired'},409);
  try {
    const escrow = await azureEscrowFromEnvironment();
    const result = await escrow.save(token,data);
    return json(context.res,{ok:true,created:result.created},200);
  } catch(error) {
    if(error.message==='encrypted_payload_conflict') return json(context.res,{error:'conflict'},409);
    context.log?.error?.('encrypted_escrow_failed');
    return json(context.res,{error:'storage_unavailable'},503);
  }
}

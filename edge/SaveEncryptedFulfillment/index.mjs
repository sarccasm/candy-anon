import { json, options } from '../lib/http.mjs';
import { readJson, paths } from '../lib/store.mjs';
import { validToken, validCiphertext, saveEncryptedFulfillment } from '../lib/encrypted-fulfillment.mjs';

// Accept encrypted delivery details BEFORE payment, never plaintext. The random
// invoice token acts as a bearer secret; deploy rate-limits and durable storage.
export default async function (context, req) {
  if (req.method === 'OPTIONS') return options(context.res);
  if (req.method !== 'POST') return json(context.res,{error:'method_not_allowed'},405);
  const {token,data} = req.body || {};
  if (!validToken(token) || !validCiphertext(data)) return json(context.res,{error:'invalid_payload'},400);
  const invoice = await readJson(paths.paymentFile(token));
  if (!invoice || invoice.token !== token) return json(context.res,{error:'not_found'},404);
  if (invoice.committed) return json(context.res,{error:'already_settled'},409);
  try {
    const result = await saveEncryptedFulfillment(token,data);
    return json(context.res,{ok:true,created:result.created},200);
  } catch(error) {
    if(error.message==='encrypted_payload_conflict') return json(context.res,{error:'conflict'},409);
    context.log?.error?.('encrypted_escrow_failed');
    return json(context.res,{error:'storage_unavailable'},503);
  }
}

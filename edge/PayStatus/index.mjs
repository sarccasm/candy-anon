import { config as loadEnv } from 'dotenv';
loadEnv();

import { json, options } from '../lib/http.mjs';
import { invoiceStoreFromEnvironment } from '../lib/azure-invoices.mjs';
import { observeBitcoinInvoice } from '../lib/esplora-watcher.mjs';

// Legacy file-backed payment endpoint. Kept fail-closed pending durable invoice
// and inventory migration. Never trust an incomplete Esplora page for settlement.
const providers = [process.env.BLOCKSTREAM_API || 'https://blockstream.info/api',
  process.env.ESPLORA_FALLBACK || 'https://mempool.space/api'];

export default async function (context, req) {
  if (req.method === 'OPTIONS') return options(context.res);
  if (req.method !== 'GET') return json(context.res,{error:'method_not_allowed'},405);
  const token=String(req.query?.token||'').trim();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token))
    return json(context.res,{error:'invalid_token'},400);
  let invoice;
  try { invoice=await (await invoiceStoreFromEnvironment()).read(token); }
  catch { return json(context.res,{error:'invoice_store_unavailable'},503); }
  if(!invoice)return json(context.res,{error:'not_found'},404);
  if(typeof invoice.address!=='string'||!Number.isSafeInteger(invoice.amountSats)||invoice.amountSats<=0)
    return json(context.res,{error:'bad_invoice'},500);
  const required=Number(process.env.MIN_CONFIRMATIONS || 2);
  if(!Number.isSafeInteger(required)||required<1||required>100)
    return json(context.res,{error:'invalid_confirmation_config'},500);
  let observation;
  for(const baseUrl of providers) {
    try {
      observation=await observeBitcoinInvoice({address:invoice.address,expectedSats:invoice.amountSats,
        requiredConfirmations:required,baseUrl,expired:false});
      break;
    } catch (error) {
      context.log?.warn?.('BTC provider failed verification');
    }
  }
  if(!observation)return json(context.res,{paid:false,error:'verification_unavailable'},503);
  if(observation.status!=='PAID')
    return json(context.res,{paid:false,status:observation.status,confs:observation.confirmations},200);
  const expired=Number.isFinite(Date.parse(invoice.createdAt)) &&
    Date.now()>Date.parse(invoice.createdAt)+20*60_000;
  if(expired&&!invoice.committed)
    return json(context.res,{paid:false,status:'LATE_PAYMENT',error:'manual_review_required'},409);
  // A verified on-chain payment is NOT an inventory settlement.
  // Only a durable, atomic inventory+invoice transaction may mark committed.
  if (invoice.committed !== true)
    return json(context.res,{paid:false,status:'SETTLEMENT_PENDING',
      error:'durable_settlement_required'},503);
  return json(context.res,{paid:true,status:'PAID',confs:observation.confirmations},200);
}

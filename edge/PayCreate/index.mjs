import {authorizeLocalRequest} from '../lib/local-request-auth.mjs';
import {readCheckoutPolicy,assertCheckoutOpen} from '../lib/checkout-policy.mjs';
import {availableStock} from '../lib/stock-reservations.mjs';
import { config as loadEnv } from 'dotenv';
loadEnv();

import crypto from 'node:crypto';
import { json, options } from '../lib/http.mjs';
import { invoiceStoreFromEnvironment } from '../lib/azure-invoices.mjs';
import { deriveAddress } from '../lib/derive-btc.mjs';
import { getCatalogProducts as getProducts } from '../lib/catalog.mjs';
import { calculateInvoiceSats } from '../lib/btc-pricing.mjs';
import { calculateLineCents } from '../lib/cart-pricing.mjs';

const MIN_SATS    = Number(process.env.MIN_SATS || 50000);
const XPUB        = (process.env.XPUB || '').trim();
const DEBUG_ERR   = process.env.DEBUG_PAYCREATE === '1';

function normalizeItems(lines) {
  const acc = Object.create(null);
  if (!Array.isArray(lines) || lines.length > 50) return null;
  for (const l of lines) {
    if (!l || typeof l !== 'object' || Array.isArray(l)) return null;
    const sku = String(l.sku || l.id || '').trim();
    const qty = Number(l.qty ?? l.quantity ?? 0);
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(sku) || !Number.isSafeInteger(qty) || qty < 1 || qty > 100) return null;
    const total = (acc[sku] || 0) + qty;
    if (!Number.isSafeInteger(total) || total > 100) return null;
    acc[sku] = total;
  }
  return acc;
}

export default async function (context, req) {
  context.res ??= {};
  if(!authorizeLocalRequest(context,req))return;
  if (req.method === 'OPTIONS') return options(context.res);
  if (req.method !== 'POST')    return json(context.res, { error: 'method_not_allowed' }, 405);

  try {
    const body = req.body ?? {};
    if(Buffer.byteLength(JSON.stringify(body))>16384)return json(context.res,{error:'request_too_large'},413);
    const inventoryStore=await invoiceStoreFromEnvironment();
    const policy=await readCheckoutPolicy(inventoryStore.client);
    assertCheckoutOpen(policy);
    const USD_PER_BTC=policy.usdPerBtc;

    const items = normalizeItems(body.lines);
    const entries = items ? Object.entries(items) : [];
    if (!entries.length || entries.length > 50 || entries.some(([sku,qty]) => !/^[a-zA-Z0-9_-]{1,64}$/.test(sku) || !Number.isSafeInteger(qty) || qty < 1 || qty > 100)) {
      return json(context.res, { error: 'invalid_cart' }, 400);
    }
    const catalog = new Map((await getProducts()).map(p => [p.id,p]));
    let cents = 0;
    for (const [sku,qty] of entries) {
      const product = catalog.get(sku);
      if (!product) return json(context.res,{error:'invalid_product'},400);
      let lineCents;
      try { lineCents=calculateLineCents(product.price,qty); }
      catch { return json(context.res,{error:'invalid_product_price'},500); }
      if (!Number.isSafeInteger(cents+lineCents))
        return json(context.res,{error:'invalid_cart_total'},400);
      cents += lineCents;
    }
    if (body.quotedTotalCents !== undefined && body.quotedTotalCents !== cents)
      return json(context.res,{error:'catalog_price_changed'},409);
    if (!Number.isSafeInteger(cents) || cents <= 0 || !Number.isFinite(USD_PER_BTC) || USD_PER_BTC <= 0 ||
        !Number.isSafeInteger(MIN_SATS) || MIN_SATS <= 0) return json(context.res,{error:'invalid_price'},500);
    const amountUsdIn = cents/100;
    let amountSats;
    try { amountSats=calculateInvoiceSats(amountUsdIn,USD_PER_BTC,MIN_SATS); }
    catch(error) { return json(context.res,{error:error.message==='below_minimum_btc_amount'?'below_minimum_btc_amount':'invalid_btc_amount'},error.message==='below_minimum_btc_amount'?409:500); }
    if (!XPUB) {
      return json(
        context.res,
        { error: 'xpub_required', detail: DEBUG_ERR ? 'no_xpub' : undefined },
        500
      );
    }

    for(const [sku,qty] of entries){
      let current;
      try { current=await inventoryStore.client.getEntity('invoices','stock:'+sku); }
      catch { return json(context.res,{error:'inventory_unavailable'},503); }
      if(availableStock(current)<qty)
        return json(context.res,{error:'out_of_stock',sku},409);
    }

    const token = crypto.randomUUID();

    const addressIndex = await inventoryStore.allocateBitcoinIndex();
    let address;
    try {
      // Branch 0 belongs to legacy HMAC invoices; never reuse it for new invoices.
      address = deriveAddress(XPUB, addressIndex, 1);
    } catch (e) {
      return json(context.res,{ error:'xpub_derive_failed' },500);
    }

    const invoice = {
      token,
      address,
      source: 'xpub',
      pricing:{usdPerBtc:policy.usdPerBtc,quotedAt:policy.quoteUpdatedAt},
      addressAllocationVersion: 1,
      addressBranch: 1,
      addressIndex,
      amountSats: Number(amountSats),
      amountUsd: Number.isFinite(amountUsdIn) ? amountUsdIn : null,
      items,
      committed: false,
      createdAt: new Date().toISOString()
    };

    await inventoryStore.createWithUniqueAddress(invoice,{reserveStock:true,policy});

    return json(context.res, {
      token, address, amountSats: Number(amountSats), source: 'xpub'
    }, 200);
  } catch (e) {
    const code=e.message==='checkout_rate_limited'?429:
      ['out_of_stock','checkout_disabled','btc_quote_expired'].includes(e.message)?409:
      [409,412].includes(e.statusCode)?409:503;
    return json(
      context.res,
      { error: code===503?'create_failed':([409,412].includes(e.statusCode)?'checkout_changed_retry':e.message), detail: DEBUG_ERR ? String(e?.message || e) : undefined },
      code
    );
  }
}

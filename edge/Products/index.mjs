import {authorizeLocalRequest} from '../lib/local-request-auth.mjs';
import {availableStock} from '../lib/stock-reservations.mjs';
import { json, options } from "../lib/http.mjs";
import { getCatalogProducts as getProducts } from "../lib/catalog.mjs";
import { invoiceStoreFromEnvironment } from "../lib/azure-invoices.mjs";

export default async function (context, req) {
  context.res ??= {};
  if(!authorizeLocalRequest(context,req))return;
  if (req.method === "OPTIONS") return options(context.res);
  if (req.method !== "GET") return json(context.res, { error: "method_not_allowed" }, 405);
  try {
    const store=await invoiceStoreFromEnvironment();
    const products=await Promise.all((await getProducts()).map(async p=>{
      const row=await store.client.getEntity('invoices','stock:'+p.id);
      return {...p,stock:availableStock(row)};
    }));
    return json(context.res, { products }, 200);
  } catch {
    return json(context.res, { error: "read_failed" }, 500);
  }
}

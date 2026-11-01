import { json, options } from "../lib/http.mjs";
import { getProducts } from "../lib/db.mjs";
import { invoiceStoreFromEnvironment } from "../lib/azure-invoices.mjs";

export default async function (context, req) {
  if (req.method === "OPTIONS") return options(context.res);
  if (req.method !== "GET") return json(context.res, { error: "method_not_allowed" }, 405);
  try {
    const store=await invoiceStoreFromEnvironment();
    const products=await Promise.all((await getProducts()).map(async p=>{
      const row=await store.client.getEntity('invoices','stock:'+p.id);
      if(!Number.isSafeInteger(row.quantity)||row.quantity<0)throw Error('bad_stock');
      return {...p,stock:row.quantity};
    }));
    return json(context.res, { products }, 200);
  } catch {
    return json(context.res, { error: "read_failed" }, 500);
  }
}

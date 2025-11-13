import { json, options } from "../lib/http.mjs";
import { getProducts } from "../lib/db.mjs";

export default async function (context, req) {
  if (req.method === "OPTIONS") return options(context.res);
  if (req.method !== "GET") return json(context.res, { error: "method_not_allowed" }, 405);
  try {
    const products = await getProducts();
    return json(context.res, { products }, 200);
  } catch {
    return json(context.res, { error: "read_failed" }, 500);
  }
}

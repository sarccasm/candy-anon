import {authorizeLocalRequest} from '../lib/local-request-auth.mjs';
import { catalogFromEnvironment } from '../lib/catalog.mjs';
import { okAuth, json as respond, options as preflight } from '../lib/http.mjs';
const origin = process.env.ALLOWED_ORIGIN || process.env.ALLOW_ORIGIN || 'https://admin.mycandy.app';
const json = (res, body, status) => respond(res, body, status, {origin});
const options = res => preflight(res, {origin});

export default async function (context, req) {
  context.res ??= {};
  if(!authorizeLocalRequest(context,req))return;
  if (req.method === 'OPTIONS') return options(context.res);
  if (req.method !== 'POST') return json(context.res,{error:'method_not_allowed'},405);
  if (!okAuth(req)) return json(context.res,{error:'unauthorized'},401);
  try {
    const body = req.body;
    if (!body || typeof body.id !== 'string' || typeof body.price !== 'number' ||
        typeof body.name !== 'string' || !Array.isArray(body.tags) || typeof body.version !== 'string')
      return json(context.res,{error:'invalid_product'},400);
    const product = await (await catalogFromEnvironment()).updateProduct(body);
    return json(context.res,{ok:true,product});
  } catch (error) {
    const code = error.message === 'catalog_conflict' ? 409 : error.message === 'product_not_found' ? 404
      : ['invalid_catalog','invalid_product_price','catalog_too_large'].includes(error.message) ? 400 : 503;
    return json(context.res,{error:code === 503 ? 'catalog_unavailable' : error.message},code);
  }
}

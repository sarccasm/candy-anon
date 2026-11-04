import {authorizeLocalRequest} from '../lib/local-request-auth.mjs';
import {invoiceStoreFromEnvironment} from '../lib/azure-invoices.mjs';
import {listAdminOrders} from '../lib/admin-orders.mjs';
import {okAuth,json,options} from '../lib/http.mjs';

export function createAdminOrdersHandler({getStore=invoiceStoreFromEnvironment}={}) {
  return async function(context,req) {
  context.res ??= {};
  if(!authorizeLocalRequest(context,req))return;
    const origin=process.env.ALLOWED_ORIGIN || process.env.ALLOW_ORIGIN || 'https://admin.mycandy.app';
    const respond=(body,status=200)=>json(context.res,body,status,{origin,'Cache-Control':'no-store'});
    if(req.method==='OPTIONS')return options(context.res,{origin});
    if(!okAuth(req))return respond({error:'unauthorized'},401);
    if(req.method!=='GET')return respond({error:'method_not_allowed'},405);
    try {
      const result=await listAdminOrders({client:(await getStore()).client,
        filter:req.query?.filter || 'all',cursor:req.query?.cursor,secret:process.env.ADMIN_KEY});
      return respond(result);
    } catch(error) {
      const invalid=['invalid_cursor','invalid_filter'].includes(error.message);
      return respond({error:invalid?error.message:'orders_unavailable'},invalid?400:503);
    }
  };
}
export default createAdminOrdersHandler();

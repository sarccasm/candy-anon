import {adminEndpoint} from '../lib/admin-endpoint.mjs';
import {invoiceStoreFromEnvironment} from '../lib/azure-invoices.mjs';
import {updateCheckoutPolicy} from '../lib/checkout-operations.mjs';
// Compatibility route now changes the real durable admission policy.
export default adminEndpoint(['POST'],async req=>{
 if(typeof req.body?.published!=='boolean')throw Error('invalid_published');
 if(!Number.isSafeInteger(req.body.version)||typeof req.body.requestId!=='string')throw Error('invalid_action');
 const checkout=await updateCheckoutPolicy({client:(await invoiceStoreFromEnvironment()).client,
  body:{...req.body,action:'set_enabled',enabled:req.body.published},actorKey:process.env.ADMIN_KEY});
 return {ok:true,checkout};
});

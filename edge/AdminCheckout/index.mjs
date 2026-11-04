import {adminEndpoint} from '../lib/admin-endpoint.mjs';
import {invoiceStoreFromEnvironment} from '../lib/azure-invoices.mjs';
import {readCheckoutPolicy,policySummary} from '../lib/checkout-policy.mjs';
import {updateCheckoutPolicy} from '../lib/checkout-operations.mjs';
export default adminEndpoint(['GET','POST'],async req=>{
 const {client}=await invoiceStoreFromEnvironment();
 return {checkout:req.method==='GET'?policySummary(await readCheckoutPolicy(client)):
  await updateCheckoutPolicy({client,body:req.body,actorKey:process.env.ADMIN_KEY})};
});

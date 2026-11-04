import {adminEndpoint} from '../lib/admin-endpoint.mjs';
import {invoiceStoreFromEnvironment} from '../lib/azure-invoices.mjs';
import {resolveOrder,orderDetails,orderAudit} from '../lib/admin-operations.mjs';
export default adminEndpoint(['GET'],async req=>{
 const store=await invoiceStoreFromEnvironment();
 const invoice=await resolveOrder(store,req.params?.reference);
 return {order:orderDetails(invoice),audit:await orderAudit(store,req.params.reference)};
});

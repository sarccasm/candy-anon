import {adminEndpoint} from '../lib/admin-endpoint.mjs';
import {invoiceStoreFromEnvironment} from '../lib/azure-invoices.mjs';
import {orderDetails,orderAudit,orderReference} from '../lib/admin-operations.mjs';
import {validToken} from '../lib/encrypted-fulfillment.mjs';
export default adminEndpoint(['POST'],async req=>{
 if(!validToken(req.body?.token))throw Error('invalid_token');
 const store=await invoiceStoreFromEnvironment(),invoice=await store.read(req.body.token);
 if(!invoice)throw Error('not_found');
 return {order:orderDetails(invoice),audit:await orderAudit(store,orderReference(invoice.token))};
});

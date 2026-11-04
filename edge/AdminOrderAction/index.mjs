import {adminEndpoint} from '../lib/admin-endpoint.mjs';
import {invoiceStoreFromEnvironment} from '../lib/azure-invoices.mjs';
import {azureEscrowFromEnvironment} from '../lib/azure-encrypted-escrow.mjs';
import {performOrderAction} from '../lib/admin-operations.mjs';
export default adminEndpoint(['POST'],async req=>performOrderAction({
 store:await invoiceStoreFromEnvironment(),escrow:await azureEscrowFromEnvironment(),
 reference:req.params?.reference,body:req.body,actorKey:process.env.ADMIN_KEY
}));

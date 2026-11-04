import {adminEndpoint} from '../lib/admin-endpoint.mjs';
import {invoiceStoreFromEnvironment} from '../lib/azure-invoices.mjs';
import {azureEscrowFromEnvironment} from '../lib/azure-encrypted-escrow.mjs';
import {readCheckoutPolicy,policySummary} from '../lib/checkout-policy.mjs';
export default adminEndpoint(['GET'],async()=>{
 const {client}=await invoiceStoreFromEnvironment();
 const policy=await readCheckoutPolicy(client);
 const escrow=await azureEscrowFromEnvironment();
 const access=await escrow.container.getAccessPolicy();
 let lastRunAt=null;
 try {lastRunAt=(await client.getEntity('invoices','worker:payment-scan:v1')).lastRunAt || null;}
 catch(error){if(error.statusCode!==404)throw error;}
 const workerFresh=!!lastRunAt&&Number.isFinite(Date.parse(lastRunAt))&&Date.now()-Date.parse(lastRunAt)<5*60_000;
 const escrowPrivate=!access.blobPublicAccess;
 return {ready:workerFresh&&escrowPrivate,workerFresh,escrowPrivate,lastRunAt,checkout:policySummary(policy)};
});

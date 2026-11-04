import {assertStorageMutationAllowed} from '../../scripts/lib/operation-policy.mjs';
import 'dotenv/config';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {invoiceStoreFromEnvironment} from '../lib/azure-invoices.mjs';

export async function initializeCheckout({client,usdPerBtc,actorKey,apply=false,now=Date.now()}) {
 if(!Number.isFinite(usdPerBtc)||usdPerBtc<=0||usdPerBtc>1e9)throw Error('invalid_quote');
 const policy={partitionKey:'invoices',rowKey:'checkout:policy',enabled:false,revision:0,
  usdPerBtc,quoteUpdatedAt:new Date(now).toISOString(),quoteMaxAgeSeconds:900,maxInvoicesPerMinute:30};
 if(!apply)return {dryRun:true,policy};
 if(typeof actorKey!=='string'||actorKey.length<24)throw Error('admin_key_required');
 await client.submitTransaction([
  ['create',policy],
  ['create',{partitionKey:'invoices',rowKey:'ops-policy-audit:bootstrap:'+randomUUID(),action:'initialize_disabled',
   at:new Date(now).toISOString(),actor:createHash('sha256').update('admin-key:'+actorKey).digest('hex').slice(0,16)}]
 ]);
 return {dryRun:false,enabled:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try {
  if(process.argv.slice(2).some(arg=>arg!=='--apply'))throw Error('invalid_arguments');
  const apply=process.argv.includes('--apply');
  if(apply)await assertStorageMutationAllowed(process.env.AZURE_STORAGE_CONNECTION_STRING);
  const result=await initializeCheckout({client:apply?(await invoiceStoreFromEnvironment()).client:null,
   usdPerBtc:Number(process.env.USD_PER_BTC),actorKey:process.env.ADMIN_KEY,apply});
  console.log(JSON.stringify(result,null,2));
 }catch(error){
  console.error('checkout_initialization_failed:',error.statusCode===409?'already_exists_use_admin_controls':
   ['invalid_quote','admin_key_required','invalid_arguments'].includes(error.message)?error.message:'configuration_or_storage_unavailable');
  process.exitCode=1;
 }
}

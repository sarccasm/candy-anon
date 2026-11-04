import {assertStorageMutationAllowed} from '../../scripts/lib/operation-policy.mjs';
import 'dotenv/config';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {root} from './local-config.mjs';
import {migrateDataset} from '../lib/dataset-migration.mjs';
import {invoiceStoreFromEnvironment} from '../lib/azure-invoices.mjs';
const args=process.argv.slice(2);
async function run(){
 if(args.some(arg=>arg!=='--apply'))throw Error('invalid_arguments');
 const files=['state.json','inventory.json',...(await readdir(new URL('../data/payments/',import.meta.url))).filter(name=>name.endsWith('.json')).map(name=>'payments/'+name)];
 const snapshot={};for(const name of files)snapshot[name]=await readFile(new URL('../data/'+name,import.meta.url),'utf8');
 const state=JSON.parse(snapshot['state.json']),inventory=JSON.parse(snapshot['inventory.json']);
 const invoices=files.filter(name=>name.startsWith('payments/')).map(name=>JSON.parse(snapshot[name]));
 let evidence;try {evidence=JSON.parse(await readFile(new URL('.local/legacy-reconciliation.json',root)));}catch{}
 const apply=args.includes('--apply');
 if(apply)await assertStorageMutationAllowed(process.env.AZURE_STORAGE_CONNECTION_STRING);
 let backup;
 if(apply){
  const folder=new URL('.local/migration-backups/'+randomUUID()+'/',root);await mkdir(folder,{recursive:true,mode:0o700});
  const key=randomBytes(32),iv=randomBytes(12),plain=Buffer.from(JSON.stringify(snapshot)),cipher=createCipheriv('aes-256-gcm',key,iv);
  const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]),tag=cipher.getAuthTag();
  await writeFile(new URL('key.bin',folder),key,{mode:0o600});
  await writeFile(new URL('snapshot.bin',folder),Buffer.concat([iv,tag,encrypted]),{mode:0o600});
  const stored=await readFile(new URL('snapshot.bin',folder)),storedKey=await readFile(new URL('key.bin',folder));
  const decipher=createDecipheriv('aes-256-gcm',storedKey,stored.subarray(0,12));decipher.setAuthTag(stored.subarray(12,28));
  if(!Buffer.concat([decipher.update(stored.subarray(28)),decipher.final()]).equals(plain))throw Error('backup_verification_failed');
  backup={directory:folder.pathname,encrypted:true,roundTripVerified:true};
 }
 const result=await migrateDataset({client:apply?(await invoiceStoreFromEnvironment()).client:null,state,inventory,invoices,evidence,apply});
 await mkdir(new URL('.local/',root),{recursive:true,mode:0o700});
 await writeFile(new URL('.local/dataset-migration-result.json',root),JSON.stringify({...result,backup},null,2),{mode:0o600});
 console.log(JSON.stringify({...result,backup},null,2));
}
run().catch(error=>{
 const safe=['catalog_stock_mismatch','settlement_journal_requires_separate_migration','legacy_invoice_requires_separate_migration',
  'fresh_legacy_verification_required','checkout_must_be_stopped','migration_exceeds_atomic_batch_limit','backup_verification_failed','invalid_arguments'];
 console.error('dataset_migration_not_completed:',safe.includes(error.message)?error.message:error.statusCode===409?'target_already_contains_data':'configuration_or_storage_error');
 process.exitCode=1;
});

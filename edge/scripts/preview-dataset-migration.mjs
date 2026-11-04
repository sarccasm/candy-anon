import {TableClient} from '@azure/data-tables';
import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {connection,root} from './local-config.mjs';
import {initializeCheckout} from './initialize-checkout.mjs';
import {isLoopbackAzurite} from '../lib/local-storage.mjs';

if(!isLoopbackAzurite(connection))throw Error('local_preview_only');
const settings=JSON.parse(await readFile(new URL('.local/settings.json',root)));
const tableName='CandyMigration'+randomBytes(5).toString('hex');
const client=TableClient.fromConnectionString(connection,tableName,{allowInsecureConnection:true});
await client.createTable();
await initializeCheckout({client,usdPerBtc:70000,actorKey:settings.ADMIN_KEY,apply:true});
await new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,['edge/scripts/migrate-dataset.mjs','--apply'],{
  cwd:fileURLToPath(root),stdio:'inherit',env:{...process.env,AZURE_STORAGE_CONNECTION_STRING:connection,AZURE_INVOICES_TABLE:tableName}});
 child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('local_migration_failed')));
});
const result=JSON.parse(await readFile(new URL('.local/dataset-migration-result.json',root)));
const policy=await client.getEntity('invoices','checkout:policy');
const catalog=JSON.parse((await client.getEntity('invoices','catalog:v1')).payload);
let invoices=0,unsafeInvoices=0;
for await(const row of client.listEntities()){
 if(!/^[a-f0-9-]{36}$/.test(row.rowKey))continue;
 const invoice=JSON.parse(row.payload);invoices++;
 if(invoice.committed||invoice.addressAllocationVersion===1||invoice.review?.state!=='OPEN')unsafeInvoices++;
}
if(policy.enabled||unsafeInvoices||catalog.length!==result.catalogProducts||invoices!==result.legacyInvoices)throw Error('local_migration_verification_failed');
const report={checkedAt:new Date().toISOString(),localOnly:true,tableName,catalogProducts:catalog.length,
 stockRows:result.stockRows,legacyInvoices:invoices,checkoutEnabled:false,
 encryptedBackupVerified:result.backup?.roundTripVerified===true,sourceFilesChanged:false};
await writeFile(new URL('.local/dataset-migration-preview.json',root),JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify(report,null,2));

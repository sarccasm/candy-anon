import {execFileSync} from 'node:child_process';
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {root} from './local-config.mjs';
import {validToken} from '../lib/encrypted-fulfillment.mjs';
import {reconcileLegacyInvoice,legacyProviders} from '../lib/legacy-reconciliation.mjs';

async function run(){
 const args=process.argv.slice(2);
 if(args.some(arg=>arg!=='--network'))throw Error('invalid_arguments');
 const network=args.includes('--network');
 const files=await readdir(new URL('../data/payments/',import.meta.url));
 const invoices=[];
 for(const file of files.filter(file=>file.endsWith('.json'))){
  const invoice=JSON.parse(await readFile(new URL('../data/payments/'+file,import.meta.url)));
  invoices.push(invoice);
 }
 const byAddress=new Map();let historicalBlobs=0;
 function add(invoice){
  if(typeof invoice?.address!=='string'||!validToken(invoice.token))return;
  if(!byAddress.has(invoice.address))byAddress.set(invoice.address,new Set());
  byAddress.get(invoice.address).add(invoice.token);
 }
 for(const invoice of invoices)add(invoice);
 const listing=execFileSync('git',['rev-list','--objects','--all','--','edge/data/payments'],
  {cwd:fileURLToPath(root),encoding:'utf8',maxBuffer:8*1024*1024});
 const ids=[...new Set(listing.split('\n').filter(line=>/ edge\/data\/payments\/.*\.json$/.test(line)).map(line=>line.split(' ')[0]))];
 if(ids.length){
  const batch=execFileSync('git',['cat-file','--batch'],{cwd:fileURLToPath(root),input:ids.join('\n')+'\n',maxBuffer:64*1024*1024});
  let offset=0;
  while(offset<batch.length){
   const end=batch.indexOf(10,offset);if(end<0)break;
   const [,type,sizeText]=batch.subarray(offset,end).toString().split(' '),size=Number(sizeText);
   if(!Number.isSafeInteger(size)||size<0)throw Error('history_parse_failed');
   const content=batch.subarray(end+1,end+1+size);offset=end+1+size+1;
   if(type!=='blob')continue;
   historicalBlobs++;try {add(JSON.parse(content.toString()));}catch{}
  }
 }
 // Constrain all outgoing requests to the two explicitly approved providers.
 const fetchImpl=(url,options={})=>{
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||!legacyProviders.some(base=>parsed.origin===new URL(base).origin))throw Error('provider_not_allowed');
  return fetch(url,{...options,redirect:'error'});
 };
 const {observeBitcoinInvoice}=await import('../lib/esplora-watcher.mjs');
 const results=[];
 for(const invoice of invoices)results.push(await reconcileLegacyInvoice({invoice,network,
  historicalInvoiceCount:byAddress.get(invoice.address)?.size || 1,
  observe:options=>observeBitcoinInvoice({...options,fetchImpl})}));
 const report={checkedAt:new Date().toISOString(),networkUsed:network,readOnly:true,historicalPaymentBlobs:historicalBlobs,
  results,automaticMigrationApproved:false,
  note:'No observed funds is a point-in-time statement, not permission to delete an invoice or reuse its address.'};
 await mkdir(new URL('.local/',root),{recursive:true,mode:0o700});
 await writeFile(new URL('.local/legacy-reconciliation.json',root),JSON.stringify(report,null,2),{mode:0o600});
 console.log(JSON.stringify(report,null,2));
}
run().catch(()=>{console.error('legacy_reconciliation_failed: source_or_verification_error');process.exitCode=1;});

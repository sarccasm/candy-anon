import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {root} from './local-config.mjs';
import {validateProducts} from '../lib/catalog.mjs';
import {planInventoryMigration} from '../lib/inventory-migration.mjs';
import {validToken} from '../lib/encrypted-fulfillment.mjs';

const report={dryRun:true,source:'edge/data',catalogProducts:0,stockRows:0,legacyInvoiceFiles:0,
 committedLegacyInvoices:0,malformedInvoiceFiles:0,repeatedAddresses:0,blockers:[]};
let products=[],stock=[];
try {products=validateProducts(JSON.parse(await readFile(new URL('../data/state.json',import.meta.url))).products);report.catalogProducts=products.length;}
catch{report.blockers.push('catalog_invalid_or_missing');}
try {stock=planInventoryMigration(JSON.parse(await readFile(new URL('../data/inventory.json',import.meta.url))));report.stockRows=stock.length;}
catch{report.blockers.push('inventory_invalid_or_missing');}
if(products.some(product=>!stock.some(row=>row.rowKey==='stock:'+product.id)))report.blockers.push('catalog_stock_mismatch');
const addresses=new Set();
let files=[];
try {files=await readdir(new URL('../data/payments/',import.meta.url));}catch(error){if(error.code!=='ENOENT')throw error;}
for(const file of files.filter(file=>file.endsWith('.json'))){
 report.legacyInvoiceFiles++;
 try {
  const token=file.slice(0,-5);if(!validToken(token))throw Error();
  const invoice=JSON.parse(await readFile(new URL('../data/payments/'+file,import.meta.url)));
  if(!invoice || invoice.token!==token || typeof invoice.address!=='string')throw Error();
  if(invoice.committed===true)report.committedLegacyInvoices++;
  if(addresses.has(invoice.address))report.repeatedAddresses++;
  addresses.add(invoice.address);
 }catch{report.malformedInvoiceFiles++;}
}
if(report.legacyInvoiceFiles)report.blockers.push('all_legacy_invoices_require_reconciliation_before_live_migration');
report.readyForLiveMigration=report.blockers.length===0;
await mkdir(new URL('.local/',root),{recursive:true,mode:0o700});
await writeFile(new URL('.local/legacy-migration-plan.json',root),JSON.stringify(report,null,2),{mode:0o600});
console.log(JSON.stringify(report,null,2));

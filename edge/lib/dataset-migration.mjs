import {createHash} from 'node:crypto';
import {validateProducts} from './catalog.mjs';
import {planInventoryMigration} from './inventory-migration.mjs';
import {readCheckoutPolicy} from './checkout-policy.mjs';
import {validLegacyInvoice,legacyReference,legacyInvoiceDigest,legacyProviders} from './legacy-reconciliation.mjs';

export async function migrateDataset({client,state,inventory,invoices,evidence,apply=false,now=Date.now()}) {
 const products=validateProducts(state?.products),stocks=planInventoryMigration(inventory);
 if(!products.length||products.some(product=>!stocks.some(row=>row.rowKey==='stock:'+product.id)))throw Error('catalog_stock_mismatch');
 if(Object.keys(inventory.__settled || {}).length)throw Error('settlement_journal_requires_separate_migration');
 if(!Array.isArray(invoices)||invoices.some(invoice=>!validLegacyInvoice(invoice)||invoice.committed===true)||new Set(invoices.map(invoice=>invoice.token)).size!==invoices.length||invoices.some(invoice=>
  !Number.isFinite(Date.parse(invoice.createdAt))||!invoice.items||typeof invoice.items!=='object'||Array.isArray(invoice.items)||
  !Object.keys(invoice.items).length||Object.keys(invoice.items).length>50||Object.entries(invoice.items).some(([sku,qty])=>
   !products.some(product=>product.id===sku)||!Number.isSafeInteger(qty)||qty<1||qty>100)))
  throw Error('legacy_invoice_requires_separate_migration');
 const digest=createHash('sha256').update(JSON.stringify({products,stocks,invoices})).digest('hex');
 const evidenceFresh=evidence?.networkUsed===true&&evidence.readOnly===true&&Number.isFinite(Date.parse(evidence.checkedAt))&&
  now>=Date.parse(evidence.checkedAt)&&now-Date.parse(evidence.checkedAt)<=60*60_000;
 const legacyReady=evidenceFresh&&invoices.every(invoice=>{
  const result=evidence.results?.find(result=>result.reference===legacyReference(invoice.token));
  return result?.sourceDigest===legacyInvoiceDigest(invoice)&&result.status==='NO_FUNDS_OBSERVED'&&
   result.providers?.length===2&&new Set(result.providers.map(provider=>provider.source)).size===2&&
   result.providers.every(provider=>legacyProviders.includes(provider.source)&&provider.verified===true&&provider.receivedSats===0&&provider.eligibleSats===0);
 });
 const plan={dryRun:!apply,digest,catalogProducts:products.length,stockRows:stocks.length,legacyInvoices:invoices.length,
  freshLegacyEvidence:!!legacyReady,checkoutMustRemainDisabled:true};
 if(!apply)return plan;
 const markerKey='migration:dataset:'+digest;
 try {const marker=await client.getEntity('invoices',markerKey);if(marker.digest!==digest||marker.completed!==true)throw Error('invalid_migration_marker');return {...plan,replayed:true};}
 catch(error){if(error.statusCode!==404)throw error;}
 if(invoices.length&&!legacyReady)throw Error('fresh_legacy_verification_required');
 const policy=await readCheckoutPolicy(client);if(policy.enabled)throw Error('checkout_must_be_stopped');
 const {etag,timestamp,...policyFields}=policy;
 const rows=[{partitionKey:'invoices',rowKey:'catalog:v1',payload:JSON.stringify(products)},
  ...stocks.map(row=>({...row,reserved:0}))];
 for(const invoice of invoices){
  const reference=legacyReference(invoice.token);
  const clean={token:invoice.token,address:invoice.address,source:'legacy_file',amountSats:invoice.amountSats,
   amountUsd:Number.isFinite(invoice.amountUsd)?invoice.amountUsd:null,createdAt:invoice.createdAt,items:invoice.items,
   committed:false,paymentStatus:'INVOICE_REVIEW',legacy:true,
   review:{state:'OPEN',category:'PAYMENT_CHECK',updatedAt:new Date(now).toISOString()},
   migration:{sourceDigest:legacyInvoiceDigest(invoice),verificationAt:evidence.checkedAt}};
  rows.push({partitionKey:'invoices',rowKey:invoice.token,payload:JSON.stringify(clean),version:1},
   {partitionKey:'invoices',rowKey:'order:'+reference,token:invoice.token});
 }
 rows.push({partitionKey:'invoices',rowKey:markerKey,digest,completed:true,at:new Date(now).toISOString(),legacyInvoices:invoices.length});
 if(rows.length+1>100)throw Error('migration_exceeds_atomic_batch_limit');
 await client.submitTransaction([['update',policyFields,'Replace',{etag}],...rows.map(row=>['create',row])]);
 return {...plan,replayed:false,createdRows:rows.length};
}

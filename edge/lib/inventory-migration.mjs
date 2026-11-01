// Administrative, dry-run-by-default migration of technical SKU stock.
// Only use after stopping checkout and reconciling all outstanding legacy invoices.
export function planInventoryMigration(legacy, existingRows = new Map()) {
  if(!legacy || typeof legacy!=='object' || Array.isArray(legacy))throw Error('invalid_inventory');
  const rows=[];
  for(const [sku,quantity] of Object.entries(legacy)){
    if(sku==='__settled')continue;
    if(!/^[a-zA-Z0-9_-]{1,64}$/.test(sku)||
      !Number.isSafeInteger(quantity)||quantity<0)throw Error('invalid_stock');
    if(existingRows.has(sku))throw Error('existing_stock_requires_review');
    rows.push({partitionKey:'invoices',rowKey:'stock:'+sku,quantity});
  }
  if(!rows.length)throw Error('empty_inventory');
  return rows;
}
export async function migrateInventory({client,legacy,apply=false,approval=false}) {
  if(!client?.getEntity||!client?.createEntity)throw Error('invalid_client');
  const existing=new Map();
  for(const sku of Object.keys(legacy||{})){
    if(sku==='__settled')continue;
    try { await client.getEntity('invoices','stock:'+sku);existing.set(sku,true); }
    catch(e){if(e.statusCode!==404)throw e;}
  }
  const rows=planInventoryMigration(legacy,existing);
  if(!apply)return {dryRun:true,planned:rows.length,rows};
  if(!approval)throw Error('approval_required');
  // Create-only. Partial failure must be reconciled manually, never blindly retried.
  let created=0;
  for(const row of rows){await client.createEntity(row);created++;}
  return {dryRun:false,created};
}

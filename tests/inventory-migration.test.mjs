import test from 'node:test';
import assert from 'node:assert/strict';
import {planInventoryMigration,migrateInventory} from '../edge/lib/inventory-migration.mjs';
function client(){const data=new Map();return {
 data,
 async getEntity(_,id){if(!data.has(id))throw {statusCode:404};return data.get(id);},
 async createEntity(row){if(data.has(row.rowKey))throw {statusCode:409};data.set(row.rowKey,row);}
};}
test('migration defaults to dry run and requires explicit approval',async()=>{
 const c=client(),legacy={c1:10,c2:0,__settled:{x:true}};
 const preview=await migrateInventory({client:c,legacy});
 assert.equal(preview.dryRun,true);
 assert.equal(preview.planned,2);
 assert.equal(c.data.size,0);
 await assert.rejects(()=>migrateInventory({client:c,legacy,apply:true}),/approval_required/);
 assert.equal(c.data.size,0);
 const applied=await migrateInventory({client:c,legacy,apply:true,approval:true});
 assert.equal(applied.created,2);
 assert.equal((await c.getEntity('invoices','stock:c1')).quantity,10);
 await assert.rejects(()=>migrateInventory({client:c,legacy,apply:true,approval:true}),/existing_stock_requires_review/);
});
test('rejects malformed counts, unsafe SKUs, and duplicate stock',()=>{
 assert.throws(()=>planInventoryMigration({c1:-1}),/invalid_stock/);
 assert.throws(()=>planInventoryMigration({'../../etc':2}),/invalid_stock/);
 assert.throws(()=>planInventoryMigration({c1:3},new Map([['c1',true]])),/existing_stock_requires_review/);
});

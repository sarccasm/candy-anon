import test from 'node:test';
import assert from 'node:assert/strict';
import { AzureCatalog, validateProducts } from '../edge/lib/catalog.mjs';
import { migrateCatalog } from '../edge/scripts/migrate-catalog.mjs';

const products=[{id:'c1',name:'Candy',price:3.5,tags:['mint'],color:'bgmint'}];
function fixture(){
  const rows=new Map();let seq=0;
  const fail=statusCode=>Object.assign(Error('storage_error'),{statusCode});
  const client={
    async createEntity(row){if(rows.has(row.rowKey))throw fail(409);rows.set(row.rowKey,{...row,etag:String(++seq)});},
    async getEntity(_,key){if(!rows.has(key))throw fail(404);return {...rows.get(key)};},
    async updateEntity(row,mode,options){assert.equal(mode,'Replace');if(rows.get(row.rowKey)?.etag!==options.etag)throw fail(412);rows.set(row.rowKey,{...row,etag:String(++seq)});}
  };
  return {client,rows,catalog:new AzureCatalog(client)};
}
test('catalog edits survive new instances and preserve separate inventory',async()=>{
 const {catalog,client,rows}=fixture();
 await catalog.create(products);
 await client.createEntity({partitionKey:'invoices',rowKey:'stock:c1',quantity:7});
 const {version}=await catalog.read();
 await catalog.updateProduct({id:'c1',name:'New candy',price:4.25,tags:['fruit'],version});
 const latest=await new AzureCatalog(client).read();
 assert.deepEqual(latest.products[0],{...products[0],name:'New candy',price:4.25,tags:['fruit']});
 assert.equal(rows.get('stock:c1').quantity,7);
 await assert.rejects(()=>catalog.updateProduct({id:'c1',price:1,version}),/catalog_conflict/);
 assert.equal((await catalog.read()).products[0].price,4.25);
});
test('ETag races cannot overwrite another editor',async()=>{
 const {catalog,client}=fixture();await catalog.create(products);
 const {version}=await catalog.read();const update=client.updateEntity;
 client.updateEntity=async(row,mode,options)=>{
   await update({...row,payload:JSON.stringify([{...products[0],price:8}])},mode,options);
   return update(row,mode,options);
 };
 await assert.rejects(()=>catalog.updateProduct({id:'c1',price:1,version}),/catalog_conflict/);
 assert.equal((await catalog.read()).products[0].price,8);
});
test('catalog rejects duplicate SKUs, bad metadata, zero and sub-cent prices',()=>{
 for(const value of [[...products,...products],[{...products[0],id:'../bad'}],
  [{...products[0],price:0}],[{...products[0],price:0.001}],
  [{...products[0],name:''}],[{...products[0],tags:[{}]}]])assert.throws(()=>validateProducts(value));
});
test('migration is dry-run by default, create-only, and never changes source state',async()=>{
 const {catalog}=fixture();const state={products:structuredClone(products)};
 assert.deepEqual(await migrateCatalog({state,catalog}),{dryRun:true,products:1});
 await assert.rejects(()=>catalog.read());
 await migrateCatalog({state,catalog,apply:true});
 await assert.rejects(()=>migrateCatalog({state:{products:[{...products[0],price:1}]},catalog,apply:true}));
 assert.equal((await catalog.read()).products[0].price,3.5);
 assert.deepEqual(state.products,products);
});
test('unavailable catalog never falls back to a local or demo catalog',async()=>{
 const {catalog,client}=fixture();
 await assert.rejects(()=>catalog.read());
 client.getEntity=async()=>{throw Error('offline');};
 await assert.rejects(()=>catalog.read(),/offline/);
});

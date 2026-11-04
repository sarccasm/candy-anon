import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function browser(fetch){
 const storage=new Map();
 const context=vm.createContext({fetch,console,
  document:{addEventListener(){},querySelector(){return null;},querySelectorAll(){return[];}},
  localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)}});
 const source=(await readFile(new URL('../main.js',import.meta.url),'utf8')).replace(/^import .*;\n/,'');
 vm.runInContext(source+'\nglobalThis.app={fetchStock,loadCart,createPaymentViaApi,escapeHtml,getCart:()=>cart,getProducts:()=>CANDIES};',context);
 return {app:context.app,storage};
}
const product={id:'new-sku',name:'Server candy',price:7.25,tags:['mint'],stock:3,color:'bgmint'};
test('storefront loads server products and replaces stale cart names and prices',async()=>{
 const {app,storage}=await browser(async()=>({ok:true,json:async()=>({products:[product]})}));
 storage.set('mc_cart',JSON.stringify([{id:product.id,name:'Old name',priceUsd:1,qty:2}]));
 assert.equal(await app.fetchStock(),true);app.loadCart();
 assert.equal(app.getProducts()[0].name,'Server candy');
 assert.equal(app.getCart()[0].priceUsd,7.25);
 assert.equal(app.getCart()[0].name,'Server candy');
});
test('changed prices refresh the displayed cart and require a new checkout attempt',async()=>{
 let calls=0;let submitted;
 const {app,storage}=await browser(async(url,options)=>{
  if(url==='/api/pay/create'){
   submitted=JSON.parse(options.body);
   return {ok:false,status:409,json:async()=>({error:'catalog_price_changed'})};
  }
  return {ok:true,json:async()=>({products:[{...product,price:++calls===1?7.25:8}]})};
 });
 storage.set('mc_cart',JSON.stringify([{id:product.id,qty:2}]));
 await app.fetchStock();app.loadCart();
 await assert.rejects(()=>app.createPaymentViaApi(),/catalog_price_changed/);
 assert.equal(submitted.quotedTotalCents,1450);
 assert.equal(app.getCart()[0].priceUsd,8);
});
test('catalog outage preserves stored cart and does not invent demo products',async()=>{
 const {app,storage}=await browser(async()=>{throw Error('offline');});
 storage.set('mc_cart','saved cart');
 assert.equal(await app.fetchStock(),false);
 assert.equal(app.getProducts().length,0);
 assert.equal(storage.get('mc_cart'),'saved cart');
 assert.equal(app.escapeHtml('<img src=x onerror="bad">'),'&lt;img src=x onerror=&quot;bad&quot;&gt;');
});

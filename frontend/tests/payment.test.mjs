import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

async function browser(fetch){
 const session=new Map([['mc_pending_invoice','saved invoice']]);
 const elements=new Map(['#payStatus','#result'].map(key=>[key,{textContent:'',classList:{remove(){}}}]));
 const context=vm.createContext({fetch,console,clearInterval(){},
  document:{addEventListener(){},querySelector:key=>elements.get(key)||null,querySelectorAll(){return[];}},
  localStorage:{setItem(){}},sessionStorage:{removeItem:key=>session.delete(key)}});
 const source=(await readFile(new URL('../main.js',import.meta.url),'utf8')).replace(/^import .*;\n/,'');
 vm.runInContext(source+`\npayToken='12345678-1234-4234-8234-123456789abc';payAmountSats=50000;
 cart=[{id:'c1',name:'Candy',priceUsd:3.5,qty:1}];globalThis.app={pollOnce,getCart:()=>cart};`,context);
 return {app:context.app,session,elements};
}
test('paid response completes browser UI without a shipment request',async()=>{
 const calls=[];
 const {app,session,elements}=await browser(async url=>{
  calls.push(url);return {ok:true,json:async()=>({paid:true,status:'PAID',fulfillmentStatus:'PENDING'})};
 });
 await app.pollOnce();await app.pollOnce();
 assert.equal(calls.length,1);assert.match(calls[0],/pay\/status/);
 assert.equal(session.has('mc_pending_invoice'),false);
 assert.equal(app.getCart().length,0);
 assert.match(elements.get('#result').textContent,/awaiting shipment/);
});
test('legacy payment review retains invoice and cart instead of claiming an order is ready',async()=>{
 const {app,session,elements}=await browser(async()=>({ok:true,json:async()=>({paid:true,fulfillmentStatus:'MANUAL_REVIEW'})}));
 await app.pollOnce();assert.equal(session.has('mc_pending_invoice'),true);
 assert.equal(app.getCart().length,1);assert.match(elements.get('#payStatus').textContent,/support review/);
});
test('transient outage leaves the invoice resumable and polling can recover',async()=>{
 let calls=0;
 const {app,session}=await browser(async()=>{
  if(++calls===1)throw Error('offline');
  return {ok:true,json:async()=>({paid:true,fulfillmentStatus:'PENDING'})};
 });
 await app.pollOnce();assert.equal(session.has('mc_pending_invoice'),true);
 await app.pollOnce();assert.equal(session.has('mc_pending_invoice'),false);
});

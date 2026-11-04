import test from 'node:test';
import assert from 'node:assert/strict';
import {createOrdersController} from '../admin-orders.js';
const order=(reference,date='2026-11-04T10:00:00Z')=>({reference,createdAt:date});

test('orders accumulate across pages without duplicates and refresh discards stale results',async()=>{
 let calls=0;
 const controller=createOrdersController({onChange(){},request:async()=>++calls===1
  ?{orders:[order('first')],nextCursor:'next'}:{orders:[order('first'),order('second')],nextCursor:null}});
 await controller.load();await controller.load();
 assert.deepEqual(controller.snapshot().orders.map(row=>row.reference),['first','second']);
 await controller.load();assert.equal(calls,2);
 await controller.refresh();assert.equal(calls,3);
});
test('a filter change wins over an older request completing later',async()=>{
 let resolveOld;
 const controller=createOrdersController({onChange(){},request:async({filter})=>filter==='all'
  ?new Promise(resolve=>{resolveOld=resolve;}):{orders:[order('review')],nextCursor:null}});
 const old=controller.load();
 await controller.setFilter('review');resolveOld({orders:[order('old')],nextCursor:'old-cursor'});await old;
 assert.equal(controller.snapshot().filter,'review');assert.equal(controller.snapshot().orders[0].reference,'review');
 assert.equal(controller.snapshot().nextCursor,null);
});
test('a filtered empty page can load more, and outages remain visible without faking an empty success',async()=>{
 let calls=0;
 const controller=createOrdersController({onChange(){},request:async()=>{
  if(++calls===1)return {orders:[],nextCursor:'next'};
  throw Error('orders_unavailable');
 }});
 await controller.setFilter('review');assert.equal(controller.snapshot().nextCursor,'next');
 await controller.load();assert.match(controller.snapshot().error,/Не вдалося/);
 assert.equal(controller.snapshot().nextCursor,'next');assert.equal(controller.snapshot().loading,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {AzureInvoiceStore} from '../edge/lib/azure-invoices.mjs';
import {listAdminOrders} from '../edge/lib/admin-orders.mjs';
const require=createRequire(new URL('../edge/package.json',import.meta.url));
const {TableClient}=require('@azure/data-tables');
const connection=process.env.AZURITE_TABLE_CONNECTION_STRING;

test('real Azure admin pagination returns all orders without exposing invoice tokens', {skip:!connection},async()=>{
 const table='T'+randomUUID().replaceAll('-','').slice(0,22);
 const client=TableClient.fromConnectionString(connection,table,{allowInsecureConnection:true});
 await client.createTable();
 try {
  const store=new AzureInvoiceStore(client),tokens=[];
  for(let i=0;i<55;i++){
   const token=randomUUID();tokens.push(token);
   await store.create({token,address:'bc1private',amountSats:50000,items:{c1:1},
    addressAllocationVersion:1,createdAt:new Date().toISOString(),paymentStatus:i%2?'PARTIALLY_PAID':'PENDING',committed:false});
  }
  await client.createEntity({partitionKey:'invoices',rowKey:'catalog:v1',payload:'[]'});
  const secret='test-only-admin-orders-key-0123456789';
  const first=await listAdminOrders({client,secret});assert.ok(first.orders.length>0&&first.orders.length<=50);assert.ok(first.nextCursor);
  const second=await listAdminOrders({client,secret,cursor:first.nextCursor});assert.equal(second.orders.length,55-first.orders.length);
  assert.equal(second.nextCursor,null);
  assert.equal(new Set([...first.orders,...second.orders].map(order=>order.reference)).size,55);
  const serialized=JSON.stringify([first,second]);
  for(const token of tokens)assert.equal(serialized.includes(token),false);
  assert.equal(serialized.includes('bc1private'),false);
  const review=await listAdminOrders({client,secret,filter:'review'});
  assert.equal(review.orders.every(order=>order.needsReview),true);assert.ok(review.orders.length);
 } finally {await client.deleteTable();}
});

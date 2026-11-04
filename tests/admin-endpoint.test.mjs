import test from 'node:test';
import assert from 'node:assert/strict';
process.env.ADMIN_KEY='test-admin-endpoint-key-012345678901';
process.env.ALLOWED_ORIGIN='https://admin.example.test';
const {adminEndpoint}=await import('../edge/lib/admin-endpoint.mjs');
const headers={'x-admin-key':process.env.ADMIN_KEY};
test('all new operation routes authenticate before any storage or payment call',async()=>{
 for(const name of ['AdminOrder','AdminOrderLookup','AdminOrderAction','AdminCheckout','AdminHealth','AdminPublish']){
  const {default:handler}=await import('../edge/'+name+'/index.mjs');
  const context={};await handler(context,{method:'POST',query:{key:process.env.ADMIN_KEY},body:{}});
  assert.equal(context.res.status,401,name);assert.equal(context.res.headers['Cache-Control'],'no-store');
 }
});
test('operation endpoints reject unsupported methods and large bodies before running handlers',async()=>{
 let calls=0;const handler=adminEndpoint(['POST'],async()=>{calls++;return {ok:true};});
 const context={};await handler(context,{method:'GET',headers});assert.equal(context.res.status,405);
 await handler(context,{method:'POST',headers,body:{data:'x'.repeat(17000)}});assert.equal(context.res.status,413);assert.equal(calls,0);
});
test('operation endpoints expose only allowlisted errors and configured CORS',async()=>{
 const context={};await adminEndpoint(['POST'],async()=>{throw Error('PRIVATE storage credentials');})(context,{method:'POST',headers});
 assert.equal(context.res.status,503);assert.equal(context.res.body.includes('PRIVATE'),false);
 await adminEndpoint(['POST'],async()=>{throw Error('operation_conflict');})(context,{method:'POST',headers});
 assert.equal(context.res.status,409);
 await adminEndpoint(['POST'],async()=>({ok:true}))(context,{method:'OPTIONS'});
 assert.equal(context.res.status,204);assert.equal(context.res.headers['Access-Control-Allow-Origin'],process.env.ALLOWED_ORIGIN);
});

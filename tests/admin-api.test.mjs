import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

process.env.ADMIN_KEY='test-only-admin-key-0123456789';
process.env.ALLOWED_ORIGIN='https://admin.example.test';
const root=await mkdtemp(join(tmpdir(),'candy-admin-'));
process.env.DATA_DIR=root;
const {default:update}=await import('../edge/AdminUpdateProduct/index.mjs');
const {default:publish}=await import('../edge/AdminPublish/index.mjs');
const {default:snapshot}=await import('../edge/AdminSnapshot/index.mjs');
const headers={'x-admin-key':process.env.ADMIN_KEY};

test('all host-anonymous admin endpoints still require the application key',async()=>{
 for(const handler of [update,publish,snapshot]){
  for(const candidate of [undefined,'wrong-key']){
   const context={res:{}};
   await handler(context,{method:'POST',headers:{'x-admin-key':candidate},body:{}});
   assert.equal(context.res.status,401);
  }
 }
});
test('admin preflight allows the configured admin origin and key header',async()=>{
 for(const handler of [update,publish,snapshot]){
  const context={res:{}};await handler(context,{method:'OPTIONS'});
  assert.equal(context.res.status,204);
  assert.equal(context.res.headers['Access-Control-Allow-Origin'],process.env.ALLOWED_ORIGIN);
  assert.match(context.res.headers['Access-Control-Allow-Headers'],/x-admin-key/);
 }
});
test('product update reads Functions req.body and rejects incomplete edits before storage',async()=>{
 const context={res:{}};
 await update(context,{method:'POST',headers,body:{id:'c1',price:2},json(){throw Error('wrong_request_API');}});
 assert.equal(context.res.status,400);
});
test('publish cannot silently report success without a durable policy version and action ID',async()=>{
 try {
  const context={res:{}};
  await publish(context,{method:'POST',headers,body:{published:true}});
  assert.equal(context.res.status,400);
  await assert.rejects(()=>readFile(join(root,'state.json')));
  await publish(context,{method:'POST',headers,body:{published:'false'}});
  assert.equal(context.res.status,400);
 } finally {await rm(root,{recursive:true,force:true});}
});

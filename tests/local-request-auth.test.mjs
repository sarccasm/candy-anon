import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizeLocalRequest} from '../edge/lib/local-request-auth.mjs';
test('regtest API gate requires the server-only key and fails closed when it is missing',()=>{
 const before={network:process.env.NETWORK,required:process.env.REQUIRE_LOCAL_API_KEY,key:process.env.LOCAL_API_KEY};
 try {
  process.env.NETWORK='regtest';process.env.REQUIRE_LOCAL_API_KEY='true';process.env.LOCAL_API_KEY='test-local-server-key-01234567890123456789';
  const context={};assert.equal(authorizeLocalRequest(context,{method:'GET',headers:{}}),false);assert.equal(context.res.status,403);
  assert.equal(authorizeLocalRequest({}, {method:'POST',headers:{'x-local-api-key':process.env.LOCAL_API_KEY}}),true);
  delete process.env.LOCAL_API_KEY;assert.equal(authorizeLocalRequest({}, {method:'POST',headers:{'x-local-api-key':'wrong'}}),false);
  assert.equal(authorizeLocalRequest({}, {method:'OPTIONS'}),true);
 }finally{
  for(const [name,value] of [['NETWORK',before.network],['REQUIRE_LOCAL_API_KEY',before.required],['LOCAL_API_KEY',before.key]])
   if(value===undefined)delete process.env[name];else process.env[name]=value;
 }
});

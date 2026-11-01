import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentStatusForClient} from '../edge/lib/payment-status-response.mjs';

test('committed payment losing confirmations requires manual reorg review',()=>{
 for(const status of ['PENDING','CONFIRMING','PARTIALLY_PAID']){
  const response=paymentStatusForClient({committed:true},{status,confirmations:0});
  assert.equal(response.code,409);
  assert.equal(response.body.paid,false);
  assert.equal(response.body.status,'REORG_REVIEW');
 }
});
test('uncommitted payments retain ordinary pending response',()=>{
 const result=paymentStatusForClient({committed:false},{status:'CONFIRMING',confirmations:1});
 assert.deepEqual(result,{code:200,body:{paid:false,status:'CONFIRMING',confs:1}});
});

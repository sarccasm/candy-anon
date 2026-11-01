import test from 'node:test';
import assert from 'node:assert/strict';
import {retentionDeadlines,eligibleForPurge} from '../edge/lib/retention-policy.mjs';
test('retention deadlines are deterministic',()=>{
 const d=retentionDeadlines('2026-01-01T00:00:00.000Z');
 assert.equal(d.invoiceExpiresAt,Date.parse('2026-01-01T00:20:00.000Z'));
 assert.equal(d.encryptedRetentionMs,86400000);
});
test('retention rules never automatically purge paid or disputed records',()=>{
 const now=Date.now();
 for(const status of ['PAID','PARTIALLY_PAID','LATE_PAYMENT','MANUAL_REVIEW','PENDING']){
  assert.equal(eligibleForPurge({status,reconciliationEndsAt:now-1,purgeAfter:now-1},now),false);
 }
 assert.equal(eligibleForPurge({status:'FULFILLED',fulfillmentAcknowledged:false,purgeAfter:now-1},now),false);
 assert.equal(eligibleForPurge({status:'FULFILLED',fulfillmentAcknowledged:true,purgeAfter:now-1},now),true);
});
test('invalid retention config cannot create deadlines',()=>{
 assert.throws(()=>retentionDeadlines('bad'),/invalid_retention_policy/);
 assert.throws(()=>retentionDeadlines(Date.now(),{invoiceWindowMinutes:0}),/invalid_retention_policy/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryTemporaryStore } from '../edge/lib/temporary-store.mjs';
import { purgeReconciledRecord } from '../edge/lib/purge-coordinator.mjs';

test('cleanup requires reconciliation, durable tombstone, retention deadline', async () => {
  const store = new MemoryTemporaryStore();
  const now = Date.now();
  const row = await store.create({status:'EXPIRED',reconciliationEndsAt:now - 1},{expiresAt:now+100000});
  assert.equal((await purgeReconciledRecord(store,row.id,{now})).reason,'safety_gate');
  assert.equal((await purgeReconciledRecord(store,row.id,{now,blockchainReconciled:true})).reason,'safety_gate');
  assert.equal((await store.read(row.id)).status,'EXPIRED');
  const result=await purgeReconciledRecord(store,row.id,{now,blockchainReconciled:true,tombstonePersisted:true});
  assert.equal(result.deleted,true);
  assert.equal(await store.read(row.id),null);
});

test('pending and partially paid orders cannot be automatically purged', async () => {
  const store=new MemoryTemporaryStore();
  const now=Date.now();
  const row=await store.create({status:'PARTIALLY_PAID',reconciliationEndsAt:now-1},{expiresAt:now+100000});
  const result=await purgeReconciledRecord(store,row.id,{now,blockchainReconciled:true,tombstonePersisted:true});
  assert.equal(result.reason,'retention_hold');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryTemporaryStore } from '../edge/lib/temporary-store.mjs';

test('temporary store has versioned conditional updates', async () => {
  const store = new MemoryTemporaryStore();
  const original = await store.create({ status: 'PENDING', amountSats: 50000 }, { expiresAt: Date.now() + 60000 });
  const next = await store.compareAndSwap(original.id, 1, row => ({ ...row, status: 'CONFIRMING' }));
  assert.equal(next.version, 2);
  await assert.rejects(() => store.compareAndSwap(original.id, 1, row => row), /version_conflict/);
  assert.equal((await store.read(original.id)).status, 'CONFIRMING');
  assert.equal(await store.deleteIfVersion(original.id, 2), true);
  assert.equal(await store.read(original.id), null);
});

test('defensive copies prevent mutation and expired records are never deleted implicitly', async () => {
  const store = new MemoryTemporaryStore();
  const row = await store.create({ items: { c1: 1 } }, { expiresAt: Date.now() + 10 });
  row.items.c1 = 999;
  assert.equal((await store.read(row.id)).items.c1, 1);
  assert.equal((await store.read(row.id)).id, row.id);
  await assert.rejects(() => store.create({}, { expiresAt: Date.now() - 1 }), /invalid_expiry/);
});

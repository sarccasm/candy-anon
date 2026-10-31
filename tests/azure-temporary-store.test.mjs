import test from 'node:test';
import assert from 'node:assert/strict';
import { AzureTemporaryStore } from '../edge/lib/azure-temporary-store.mjs';

function fakeClient() {
  const records = new Map();
  let revision = 0;
  return {
    async createEntity(e) {
      if (records.has(e.rowKey)) throw { statusCode: 409 };
      records.set(e.rowKey, { ...e, etag: String(++revision) });
    },
    async getEntity(_, id) {
      if (!records.has(id)) throw { statusCode: 404 };
      return { ...records.get(id) };
    },
    async updateEntity(e, mode, options) {
      const old = records.get(e.rowKey);
      if (!old || old.etag !== options.etag) throw { statusCode: 412 };
      assert.equal(mode, 'Replace');
      records.set(e.rowKey, { ...e, etag: String(++revision) });
    },
    async deleteEntity(_, id, options) {
      const old = records.get(id);
      if (!old || old.etag !== options.etag) throw { statusCode: 412 };
      records.delete(id);
    }
  };
}

test('Azure adapter performs versioned create/read/update/delete', async () => {
  const store = new AzureTemporaryStore(fakeClient());
  const row = await store.create({ status: 'PENDING', amountSats: 50000 }, { expiresAt: Date.now() + 60000 });
  const read = await store.read(row.id);
  assert.equal(read.status, 'PENDING');
  const updated = await store.compareAndSwap(row.id, 1, old => ({ ...old, status: 'CONFIRMING' }));
  assert.equal(updated.version, 2);
  await assert.rejects(() => store.compareAndSwap(row.id, 1, x => x), /version_conflict/);
  assert.equal(await store.deleteIfVersion(row.id, 2), true);
  assert.equal(await store.read(row.id), null);
});

test('Azure adapter detects etag races rather than overwriting', async () => {
  const client = fakeClient();
  const store = new AzureTemporaryStore(client);
  const row = await store.create({ status: 'PENDING' }, { expiresAt: Date.now() + 60000 });
  await assert.rejects(async () => {
    await store.compareAndSwap(row.id, 1, prior => {
      // Mimic a concurrent writer by changing the eTag between read and write.
      client.updateEntity({partitionKey:'orders',rowKey:row.id,expiresAt:row.expiresAt,version:2,payload:'{}'},'Replace',{etag:prior.etag});
      return { ...prior, status:'PAID' };
    });
  }, /version_conflict/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AzureInvoiceStore } from '../edge/lib/azure-invoices.mjs';

function fixture() {
  const rows = new Map();
  let version = 0;
  const conflict = statusCode => Object.assign(new Error('conflict'), {statusCode});
  const save = row => rows.set(row.rowKey, {...row, etag:String(++version)});
  const client = {
    async getEntity(_, key) {
      if (!rows.has(key)) throw conflict(404);
      return {...rows.get(key)};
    },
    async createEntity(row) {
      if (rows.has(row.rowKey)) throw conflict(409);
      save(row);
    },
    async updateEntity(row, _, options) {
      if (rows.get(row.rowKey)?.etag !== options.etag) throw conflict(412);
      save(row);
    },
    async submitTransaction(actions) {
      for (const [operation, row] of actions) {
        assert.equal(operation, 'create');
        if (rows.has(row.rowKey)) throw conflict(409);
      }
      for (const [,row] of actions) save(row);
    }
  };
  return {rows, client, store:new AzureInvoiceStore(client)};
}

test('concurrent function instances allocate distinct durable indices', async () => {
  const {client} = fixture();
  const indices = await Promise.all(Array.from({length:8}, () =>
    new AzureInvoiceStore(client).allocateBitcoinIndex()));
  assert.equal(new Set(indices).size, 8);
  assert.equal(await new AzureInvoiceStore(client).allocateBitcoinIndex(), 8);
});

test('allocated indices are burned on failure and exhaustion never wraps', async () => {
  const {store, client} = fixture();
  assert.equal(await store.allocateBitcoinIndex(), 0);
  assert.equal(await store.allocateBitcoinIndex(), 1);
  const counter = await client.getEntity('invoices', 'btc-address-counter-v1');
  await client.updateEntity({...counter,nextIndex:0x80000000}, 'Replace', {etag:counter.etag});
  await assert.rejects(() => store.allocateBitcoinIndex(), /space_exhausted/);
});

test('address claims prevent another invoice from counting an old deposit', async () => {
  const {store, rows} = fixture();
  const invoice = {token:randomUUID(), address:'bc1example', amountSats:50000,
    addressAllocationVersion:1, addressBranch:1, addressIndex:0};
  await store.createWithUniqueAddress(invoice);
  const other = {...invoice, token:randomUUID()};
  await assert.rejects(() => store.createWithUniqueAddress(other));
  assert.equal(await store.read(other.token), null);
  assert.equal(rows.size, 2);
  // Claims survive removal of an invoice; they are not subject to invoice TTL.
  rows.delete(invoice.token);
  await assert.rejects(() => store.createWithUniqueAddress(other));
});

test('invoice conflict does not leave a partial address claim', async () => {
  const {store, rows} = fixture();
  const invoice = {token:randomUUID(), address:'first', amountSats:50000,addressAllocationVersion:1};
  await store.createWithUniqueAddress(invoice);
  await assert.rejects(() => store.createWithUniqueAddress({...invoice,address:'second'}));
  assert.equal(rows.size, 2);
  await store.createWithUniqueAddress({...invoice,token:randomUUID(),address:'second'});
});

test('storage outages propagate without allocating an unsafe fallback', async () => {
  const {store, client} = fixture();
  client.getEntity = async () => { throw Error('storage_unavailable'); };
  await assert.rejects(() => store.allocateBitcoinIndex(), /storage_unavailable/);
});

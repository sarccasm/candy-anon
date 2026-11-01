import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('admin access fails closed without configured secret', async () => {
  delete process.env.ADMIN_KEY;
  const { okAuth } = await import('../edge/lib/http.mjs?test=no-key');
  assert.equal(okAuth({ headers: { 'x-admin-key': 'dev123' } }), false);
  assert.equal(okAuth({ query: { key: 'dev123' } }), false);
});

test('server controls payment amounts and status lookup', async () => {
  const pay = await readFile(new URL('../edge/PayCreate/index.mjs', import.meta.url), 'utf8');
  const status = await readFile(new URL('../edge/PayStatus/index.mjs', import.meta.url), 'utf8');
  assert.match(pay, /const catalog = new Map/);
  assert.doesNotMatch(pay, /body\.amountSats|body\.amountUsd/);
  assert.match(status, /observeBitcoinInvoice/);
  assert.match(status, /invoice\.amountSats/);
  assert.match(status, /verification_unavailable/);
  assert.doesNotMatch(status, /req\.query\?\.amountSats/);
});

test('shipment only persists encrypted address block and requires confirmed invoice', async () => {
  const src = await readFile(new URL('../edge/CreateShipment/index.mjs', import.meta.url), 'utf8');
  assert.match(src, /invoice\.committed !== true/);
  assert.doesNotMatch(src, /openpgp\.decrypt|pii\s*:/);
  assert.match(src, /\.enc\.asc/);
});

test('tracker does not store IP addresses', async () => {
  const src = await readFile(new URL('../edge/Track/index.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /x-forwarded-for|remoteAddress/);
});

test('stock commits require an invoice token and cannot double deduct', async () => {
  const { mkdtemp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'candy-stock-'));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = root;
  try {
    await writeFile(join(root, 'inventory.json'), JSON.stringify({ c1: 4 }));
    const { commitStock } = await import('../edge/lib/db.mjs?stock-test');
    const token = '11111111-1111-4111-8111-111111111111';
    assert.deepEqual(await commitStock({ c1: 2 }, token), { ok: true });
    assert.equal((await commitStock({ c1: 2 }, token)).alreadyCommitted, true);
    const inventory = JSON.parse(await readFile(join(root, 'inventory.json'), 'utf8'));
    assert.equal(inventory.c1, 2);
    assert.equal((await commitStock({ c1: 3 }, '22222222-2222-4222-8222-222222222222')).ok, false);
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

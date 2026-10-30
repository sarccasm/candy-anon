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
  assert.match(status, /const need = Number\(invoice\?\.amountSats\)/);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { deriveAddress } from '../edge/lib/derive-btc.mjs';

const require = createRequire(new URL('../edge/package.json', import.meta.url));
const { BIP32Factory } = require('bip32');
const bip32 = BIP32Factory(require('tiny-secp256k1'));
// Synthetic test-only seed, never funded.
const root = bip32.fromSeed(Buffer.alloc(32, 1));
const xpub = root.neutered().toBase58();

test('new invoice branch never derives the legacy branch address', () => {
  assert.notEqual(deriveAddress(xpub, 0, 1), deriveAddress(xpub, 0, 0));
  assert.notEqual(deriveAddress(xpub, 0, 1), deriveAddress(xpub, 1, 1));
  assert.equal(deriveAddress(xpub, 0), deriveAddress(xpub, 0, 0));
});

test('derivation rejects hardened, fractional and invalid branch indices', () => {
  for (const index of [-1, 1.5, NaN, 0x80000000])
    assert.throws(() => deriveAddress(xpub, index, 1), /invalid_derivation_path/);
  assert.throws(() => deriveAddress(xpub, 0, 2), /invalid_derivation_path/);
});

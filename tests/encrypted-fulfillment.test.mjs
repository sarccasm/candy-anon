import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const token='12345678-1234-4234-8234-123456789abc';
const data='-----BEGIN PGP MESSAGE-----\n\n'+('a'.repeat(100))+'\n-----END PGP MESSAGE-----';
test('ciphertext escrow persists without plaintext and rejects replacement', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'candy-escrow-'));
  // Must set DATA_DIR before module import because paths are initialized once.
  process.env.DATA_DIR=dir;
  try {
    const {saveEncryptedFulfillment,hasEncryptedFulfillment}=await import('../edge/lib/encrypted-fulfillment.mjs');
    assert.deepEqual(await saveEncryptedFulfillment(token,data),{created:true});
    assert.deepEqual(await saveEncryptedFulfillment(token,data),{created:false});
    assert.equal(await hasEncryptedFulfillment(token),true);
    await assert.rejects(()=>saveEncryptedFulfillment(token,data+'x'),/invalid_encrypted_payload|encrypted_payload_conflict/);
    const saved=await readFile(join(dir,'shipments',token+'.enc.asc'),'utf8');
    assert.equal(saved,data);
  } finally { delete process.env.DATA_DIR; await rm(dir,{recursive:true,force:true}); }
});

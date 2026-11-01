import test from 'node:test';
import assert from 'node:assert/strict';
import * as openpgp from 'openpgp';
import { readFile } from 'node:fs/promises';
import { importRecipientKey, encryptDelivery, validateDeliveryDetails } from '../pgp.js';

test('PGP encrypts shipping information; decrypts with recipient private key', async () => {
  const { privateKey, publicKey } = await openpgp.generateKey({
    type:'ecc', curve:'curve25519',
    userIDs:[{name:'Test recipient'}], passphrase:''
  });
  const recipient = await openpgp.readKey({armoredKey:publicKey});
  const details = {name:'Test Customer',address:'123 Example Lane',phone:'5551234'};
  const armored = await encryptDelivery(details,recipient);
  assert.match(armored,/BEGIN PGP MESSAGE/);
  assert.doesNotMatch(armored,/Test Customer|Example Lane|5551234/);
  const {data}=await openpgp.decrypt({
    message: await openpgp.readMessage({armoredMessage:armored}),
    decryptionKeys:await openpgp.readPrivateKey({armoredKey:privateKey})
  });
  assert.deepEqual(JSON.parse(data),details);
});

test('rejects invalid recipients and invalid inputs',async()=>{
  await assert.rejects(()=>importRecipientKey('not a key'),/invalid_public_key/);
  assert.throws(()=>validateDeliveryDetails({name:'',address:'x',phone:''}),/invalid_delivery_details/);
  await assert.rejects(()=>encryptDelivery({name:'Test',address:'1234',phone:'555'},null),/missing_recipient_key/);
});

test('published recipient key matches pinned fingerprint',async()=>{
  const armored=await readFile(new URL('../public/pubkey.asc',import.meta.url),'utf8');
  const recipient=await importRecipientKey(armored);
  assert.match(recipient.getFingerprint(),/^[0-9a-f]{40}$/);
});

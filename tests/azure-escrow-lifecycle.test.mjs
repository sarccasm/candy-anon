import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableEncryptedEscrow } from '../edge/lib/azure-encrypted-escrow.mjs';
import { assessEscrowRetention, purgeEscrowIfEligible } from '../edge/lib/escrow-retention.mjs';
const token='12345678-1234-4234-8234-123456789abc';
const armor='-----BEGIN PGP MESSAGE-----\n\n'+('x'.repeat(90))+'\n-----END PGP MESSAGE-----';
function fakeContainer() {
  const blobs=new Map();
  return {getBlockBlobClient(name) {return {
    async uploadData(bytes,options) {
      if(options.conditions.ifNoneMatch!=='*')throw Error('non-exclusive-write');
      if(blobs.has(name))throw {statusCode:412};
      const digest=options.metadata.sha256;
      blobs.set(name,{data:Buffer.from(bytes),etag:'1',checksum:digest});
    },
    async getProperties() {
      const record=blobs.get(name);if(!record)throw {statusCode:404};
      return {etag:record.etag,metadata:{sha256:record.checksum}};
    },
    async exists(){return blobs.has(name);},
    async download() {
      if(!blobs.has(name))throw {statusCode:404};
      return {readableStreamBody:(async function*(){yield blobs.get(name).data;})()};
    },
    async delete(options) {
      const record=blobs.get(name);if(record.etag!==options.conditions.ifMatch)throw {statusCode:412};
      blobs.delete(name);
    }
  };}};
}
test('Azure ciphertext survives new adapter instances and prevents accidental overwrite',async()=>{
  const container=fakeContainer();
  const a=new DurableEncryptedEscrow(container);
  assert.deepEqual(await a.save(token,armor),{created:true});
  const afterRestart=new DurableEncryptedEscrow(container);
  assert.equal(await afterRestart.read(token),armor);
  assert.deepEqual(await afterRestart.save(token,armor),{created:false});
  await assert.rejects(()=>afterRestart.save(token,armor.replace('x','y')),/encrypted_payload_conflict/);
  assert.equal(await a.deleteAfterAcknowledgment(token),false);
  assert.equal(await a.exists(token),true);
});
test('TTL blocks unpaid, unacknowledged, or unreconciled escrow',async()=>{
  const ready={paymentStatus:'PAID',fulfillmentAcknowledged:true,carrierAcknowledged:true,
    blockchainReconciled:true,settlementJournalPersisted:true,purgeAfter:100};
  for (const change of [{paymentStatus:'PARTIALLY_PAID'},{carrierAcknowledged:false},
    {blockchainReconciled:false},{purgeAfter:201}]) {
      assert.equal(assessEscrowRetention({...ready,...change},200).eligible,false);
  }
  const container=fakeContainer(),escrow=new DurableEncryptedEscrow(container);
  await escrow.save(token,armor);
  const store={read:async()=>ready};
  const result=await purgeEscrowIfEligible({store,escrow,id:token,now:200});
  assert.equal(result.deleted,true);assert.equal(await escrow.exists(token),false);
});

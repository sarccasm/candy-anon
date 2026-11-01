import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableEncryptedEscrow } from '../edge/lib/azure-encrypted-escrow.mjs';
import { inspectBitcoinPayments } from '../edge/lib/btc-reconciliation.mjs';
import { assessEscrowRetention } from '../edge/lib/escrow-retention.mjs';

const token='12345678-1234-4234-8234-123456789abc';
const address='bc1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq';
const encrypted='-----BEGIN PGP MESSAGE-----\n\n'+('m'.repeat(100))+'\n-----END PGP MESSAGE-----';
const tx=(id,sats,height)=>({txid:id.repeat(64),vout:[{scriptpubkey_address:address,value:sats}],
  status:{confirmed:true,block_height:height}});
const blobs=new Map();
const container={getBlockBlobClient(key){return {
  async uploadData(data,opts){
    if(blobs.has(key))throw {statusCode:412};
    blobs.set(key,{data:Buffer.from(data),sha:opts.metadata.sha256,etag:'1'});
  },
  async getProperties(){const b=blobs.get(key);if(!b)throw {statusCode:404};
    return {etag:b.etag,metadata:{sha256:b.sha}};},
  async exists(){return blobs.has(key)},
  async download(){if(!blobs.has(key))throw {statusCode:404};return {
    readableStreamBody:(async function*(){yield blobs.get(key).data})()
  }},
  async delete({conditions}){if(blobs.get(key)?.etag!==conditions.ifMatch)throw {statusCode:412};blobs.delete(key)}
}}};

test('simulated BTC -> persistent PGP escrow -> fulfillment acknowledgement -> TTL cleanup',async()=>{
  const escrow=new DurableEncryptedEscrow(container);
  await escrow.save(token,encrypted);
  const before=inspectBitcoinPayments({address,expectedSats:50000,transactions:[tx('a',25000,100)],
    tipHeight:101,requiredConfirmations:2,completeHistory:true});
  assert.equal(before.status,'PARTIALLY_PAID');
  assert.equal(assessEscrowRetention({paymentStatus:before.status,carrierAcknowledged:false},1000).eligible,false);
  const after=inspectBitcoinPayments({address,expectedSats:50000,
    transactions:[tx('a',25000,100),tx('b',25000,100)],tipHeight:101,requiredConfirmations:2,
    completeHistory:true});
  assert.equal(after.status,'PAID');
  const restarted=new DurableEncryptedEscrow(container);
  assert.equal(await restarted.read(token),encrypted);
  const fulfilled={paymentStatus:after.status,fulfillmentAcknowledged:true,carrierAcknowledged:true,
    blockchainReconciled:true,settlementJournalPersisted:true,purgeAfter:1500};
  assert.equal(assessEscrowRetention(fulfilled,1499).eligible,false);
  assert.equal(assessEscrowRetention(fulfilled,1500).eligible,true);
  assert.equal(await restarted.deleteAfterAcknowledgment(token,{carrierAcknowledged:true,retentionElapsed:true}),true);
  assert.equal(await restarted.exists(token),false);
});

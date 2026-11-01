import { invoiceStoreFromEnvironment } from '../lib/azure-invoices.mjs';
import { azureEscrowFromEnvironment } from '../lib/azure-encrypted-escrow.mjs';
import { assessEscrowRetention } from '../lib/escrow-retention.mjs';
import { validToken } from '../lib/encrypted-fulfillment.mjs';

// Runs hourly, but never deletes unless explicitly enabled. No PII in logs.
export default async function (context) {
  const enabled=process.env.ENABLE_ESCROW_PURGE==='true';
  const max=Number(process.env.ESCROW_PURGE_BATCH_SIZE||50);
  if(!Number.isSafeInteger(max)||max<1||max>500)throw Error('invalid_purge_batch_size');
  const escrow=await azureEscrowFromEnvironment();
  const invoices=await invoiceStoreFromEnvironment();
  let scanned=0,eligible=0,deleted=0;
  for await (const blob of escrow.container.listBlobsFlat()) {
    if(scanned>=max)break;
    if(!blob.name.endsWith('.asc'))continue;
    const token=blob.name.slice(0,-4);
    if(!validToken(token))continue;
    scanned++;
    const record=await invoices.read(token);
    if(!record)continue; // Missing invoice is NOT proof the encrypted blob may be deleted.
    const decision=assessEscrowRetention(record,Date.now());
    if(!decision.eligible)continue;
    eligible++;
    if(!enabled)continue;
    // Conditional delete prevents a newer blob from being erased on a stale read.
    const result=await escrow.deleteAfterAcknowledgment(token,{
      carrierAcknowledged:true,retentionElapsed:true
    });
    if(result)deleted++;
  }
  context.log?.('escrow_cleanup_summary',{scanned,eligible,deleted,dryRun:!enabled});
}

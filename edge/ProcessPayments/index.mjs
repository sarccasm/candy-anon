import { invoiceStoreFromEnvironment } from '../lib/azure-invoices.mjs';
import { azureEscrowFromEnvironment } from '../lib/azure-encrypted-escrow.mjs';
import { processPaymentBatch } from '../lib/payment-worker.mjs';

export default async function(context) {
  const summary=await processPaymentBatch({store:await invoiceStoreFromEnvironment(),
    escrow:await azureEscrowFromEnvironment(),batchSize:Number(process.env.PAYMENT_SCAN_BATCH_SIZE || 3)});
  // Counts only; invoice bearer tokens, addresses and ciphertext must not enter logs.
  if(summary.retry||summary.review)context.log?.warn?.('payment_scan_attention',summary);
  else context.log?.('payment_scan_summary',summary);
}

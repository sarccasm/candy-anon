import { reconcileInvoice } from './payment-processing.mjs';

export async function processPaymentBatch({store,escrow,batchSize=3,reconcile=reconcileInvoice, ...verification}) {
  if(!Number.isSafeInteger(batchSize)||batchSize<1||batchSize>100)throw Error('invalid_payment_batch_size');
  const cursor=await store.readPaymentScanCursor();
  const page=await store.readInvoicePage(cursor.lastKey,batchSize,cursor.continuationToken);
  const summary={checked:0,paid:0,review:0,retry:0};
  for(const token of page.tokens) {
    try {
      const result=await reconcile({...verification,store,escrow,token});
      summary.checked++;
      if(result.body.paid===true)summary.paid++;
      else if(result.code===409)summary.review++;
      else if(result.code>=500)summary.retry++;
    } catch { summary.retry++; }
  }
  // A crash repeats this page. Settlement and its embedded task are idempotent.
  // Failed invoices are revisited on the next complete scan, never deleted.
  await store.savePaymentScanCursor(cursor,page.nextKey,page.nextContinuationToken);
  return summary;
}

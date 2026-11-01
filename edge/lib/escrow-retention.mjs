// Non-destructive retention planner. Requires durable authorization before any deletion.
export function assessEscrowRetention(record, now=Date.now()) {
  if(!record || !Number.isFinite(now))throw new Error('invalid_record');
  if(record.paymentStatus==='PARTIALLY_PAID' || record.paymentStatus==='CONFIRMING' ||
     record.paymentStatus==='LATE_PAYMENT' || record.paymentStatus==='MANUAL_REVIEW')
    return {eligible:false,reason:'unsettled_payment'};
  if(record.fulfillmentAcknowledged!==true || record.carrierAcknowledged!==true)
    return {eligible:false,reason:'no_carrier_acknowledgement'};
  if(record.settlementJournalPersisted!==true || record.blockchainReconciled!==true)
    return {eligible:false,reason:'unreconciled'};
  if(!Number.isFinite(record.purgeAfter) || now<record.purgeAfter)
    return {eligible:false,reason:'retention_hold'};
  return {eligible:true,reason:'retention_elapsed'};
}

// Worker integration must read a fresh durable record and obtain a lease before deletion.
// Never accept these authorizations from a browser/API request.
export async function purgeEscrowIfEligible({store,escrow,id,now=Date.now()}) {
  const record=await store.read(id);
  if(!record)return {deleted:false,reason:'not_found'};
  const decision=assessEscrowRetention(record,now);
  if(!decision.eligible)return {deleted:false,reason:decision.reason};
  // Reconcile/acknowledge in an authoritative backend before calling this method.
  const deleted=await escrow.deleteAfterAcknowledgment(id,{
    carrierAcknowledged:true, retentionElapsed:true
  });
  return {deleted,reason:deleted?'purged':'concurrent_change'};
}

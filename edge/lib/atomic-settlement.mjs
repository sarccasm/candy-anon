// All rows share one Azure Table partition so a settlement is atomic.
// Provision stock rows with { partitionKey:'invoices', rowKey:'stock:<sku>', quantity:number }
// through an authenticated, audited inventory migration before enabling checkout.
export async function settleInvoiceAtomically(store, token, observation) {
  if (!store?.client?.submitTransaction) throw Error('transaction_not_supported');
  if (observation?.status !== 'PAID' || !Number.isSafeInteger(observation.eligibleSats))
    throw Error('payment_unverified');
  const invoice=await store.read(token);
  if (!invoice) throw Error('invoice_not_found');
  if (invoice.committed===true) return {ok:true,alreadyCommitted:true};
  if (observation.eligibleSats < invoice.amountSats) throw Error('payment_underfunded');
  if (!Number.isFinite(Date.parse(invoice.createdAt)) ||
      Date.now()>Date.parse(invoice.createdAt)+20*60_000) throw Error('late_payment_manual_review');
  const entries=Object.entries(invoice.items||{});
  if(!entries.length||entries.length>50||entries.some(([sku,qty])=>!(/^[a-zA-Z0-9_-]{1,64}$/.test(sku))||
    !Number.isSafeInteger(qty)||qty<=0)) throw Error('invalid_items');
  // A single Table batch allows at most 100 operations; enforce a tighter invoice limit.
  const actions=[];
  for(const [sku,qty] of entries){
    let stock;
    try { stock=await store.client.getEntity('invoices','stock:'+sku); }
    catch(e){if(e.statusCode===404)throw Error('inventory_not_provisioned');throw e;}
    if(!Number.isSafeInteger(stock.quantity)||stock.quantity<qty)throw Error('out_of_stock');
    actions.push(['update',{partitionKey:'invoices',rowKey:'stock:'+sku,quantity:stock.quantity-qty},
      'Replace',{etag:stock.etag}]);
  }
  const clean={...invoice,committed:true,committedAt:new Date().toISOString(),
    settledSats:observation.eligibleSats};
  delete clean._etag;delete clean._version;
  if(actions.length>=100)throw Error('transaction_too_large');
  actions.push(['update',{partitionKey:'invoices',rowKey:token,payload:JSON.stringify(clean),
    version:invoice._version+1},'Replace',{etag:invoice._etag}]);
  try { await store.client.submitTransaction(actions); }
  catch(e) {
    if([409,412].includes(e.statusCode)){
      const latest=await store.read(token);
      if(latest?.committed)return {ok:true,alreadyCommitted:true};
      throw Error('settlement_conflict_retry');
    }
    throw e;
  }
  return {ok:true,alreadyCommitted:false};
}

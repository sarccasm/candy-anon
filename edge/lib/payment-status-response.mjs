// Keep settled inventory untouched on a possible chain reorganization.
// Operations must investigate and manually reconcile payment and fulfillment.
export function paymentStatusForClient(invoice, observation) {
  if (!invoice || !observation || typeof observation.status !== 'string')
    throw new Error('invalid_payment_observation');
  if (observation.status !== 'PAID' && invoice.committed === true)
    return {code:409,body:{paid:false,status:'REORG_REVIEW',error:'manual_review_required'}};
  return {code:200,body:{paid:false,status:observation.status,confs:observation.confirmations}};
}

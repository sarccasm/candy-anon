export const CHECKOUT_POLICY_KEY='checkout:policy';
export async function readCheckoutPolicy(client) {
  const row=await client.getEntity('invoices',CHECKOUT_POLICY_KEY);
  if(typeof row.enabled!=='boolean'||!Number.isSafeInteger(row.revision)||row.revision<0||
    !Number.isFinite(row.usdPerBtc)||row.usdPerBtc<=0||!Number.isFinite(Date.parse(row.quoteUpdatedAt))||
    !Number.isSafeInteger(row.quoteMaxAgeSeconds)||row.quoteMaxAgeSeconds<60||row.quoteMaxAgeSeconds>3600||
    !Number.isSafeInteger(row.maxInvoicesPerMinute)||row.maxInvoicesPerMinute<1||row.maxInvoicesPerMinute>120||
    (row.rateCount!==undefined&&(!Number.isSafeInteger(row.rateCount)||row.rateCount<0))||
    (row.rateWindow!==undefined&&(!Number.isSafeInteger(row.rateWindow)||row.rateWindow<0)))throw Error('invalid_checkout_policy');
  return row;
}
export function assertCheckoutOpen(policy,now=Date.now()) {
  if(policy.enabled!==true)throw Error('checkout_disabled');
  const age=now-Date.parse(policy.quoteUpdatedAt);
  if(age<0||age>policy.quoteMaxAgeSeconds*1000)throw Error('btc_quote_expired');
  const window=Math.floor(now/60000);
  if(policy.rateWindow===window&&policy.rateCount>=policy.maxInvoicesPerMinute)throw Error('checkout_rate_limited');
}
export function checkoutAdmissionAction(policy,now=Date.now()) {
  assertCheckoutOpen(policy,now);
  const {etag,timestamp,...fields}=policy;
  const rateWindow=Math.floor(now/60000);
  return ['update',{...fields,rateWindow,rateCount:policy.rateWindow===rateWindow?(policy.rateCount || 0)+1:1},'Replace',{etag}];
}
export function policySummary(policy,now=Date.now()) {
  return {enabled:policy.enabled,version:policy.revision,usdPerBtc:policy.usdPerBtc,quoteUpdatedAt:policy.quoteUpdatedAt,
    quoteFresh:now>=Date.parse(policy.quoteUpdatedAt)&&now-Date.parse(policy.quoteUpdatedAt)<=policy.quoteMaxAgeSeconds*1000,
    quoteMaxAgeSeconds:policy.quoteMaxAgeSeconds,maxInvoicesPerMinute:policy.maxInvoicesPerMinute};
}

export function calculateInvoiceSats(usd, usdPerBtc, minSats) {
  if (![usd, usdPerBtc, minSats].every(Number.isFinite) || usd <= 0 ||
      usdPerBtc <= 0 || !Number.isSafeInteger(minSats) || minSats <= 0)
    throw new Error('invalid_btc_pricing');
  const sats=Math.round(usd / usdPerBtc * 100_000_000);
  if(sats<minSats)throw new Error('below_minimum_btc_amount');
  const result=sats;
  if (!Number.isSafeInteger(result) || result <= 0 || result > 2_100_000_000_000_000)
    throw new Error('invalid_btc_amount');
  return result;
}

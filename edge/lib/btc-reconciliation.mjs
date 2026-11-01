// Read-only BTC reconciliation logic. No stock settlement or deletion.
export function inspectBitcoinPayments({ address, expectedSats, transactions, tipHeight, requiredConfirmations = 2, expired = false, completeHistory = false }) {
  if (typeof address !== 'string' || !/^[a-zA-Z0-9]{14,90}$/.test(address) ||
      !Number.isSafeInteger(expectedSats) || expectedSats <= 0 ||
      !Number.isSafeInteger(tipHeight) || tipHeight < 0 ||
      !Number.isSafeInteger(requiredConfirmations) || requiredConfirmations < 1 ||
      !Array.isArray(transactions) || !completeHistory) throw new Error('unverifiable_payment_history');
  const seen = new Set();
  let confirmed = 0, unconfirmed = 0, eligible = 0, minConfs = Infinity;
  for (const tx of transactions) {
    if (typeof tx?.txid !== 'string' || !/^[0-9a-f]{64}$/i.test(tx.txid) || seen.has(tx.txid))
      throw new Error('invalid_or_duplicate_transaction');
    seen.add(tx.txid);
    if (!Array.isArray(tx.vout)) throw new Error('invalid_outputs');
    const sats = tx.vout.filter(out => out?.scriptpubkey_address === address).reduce((sum, out) => {
      if (!Number.isSafeInteger(out.value) || out.value < 0) throw new Error('invalid_output_amount');
      return sum + out.value;
    }, 0);
    if (!Number.isSafeInteger(sats)) throw new Error('amount_overflow');
    if (tx.status?.confirmed === true) {
      const height = tx.status.block_height;
      if (!Number.isSafeInteger(height) || height <= 0 || height > tipHeight) throw new Error('invalid_block_height');
      const confirmations = tipHeight - height + 1;
      confirmed += sats;
      if (confirmations >= requiredConfirmations) eligible += sats;
      if (sats > 0) minConfs = Math.min(minConfs, confirmations);
    } else if (tx.status?.confirmed === false) {
      unconfirmed += sats;
    } else throw new Error('invalid_transaction_status');
  }
  if (![confirmed, unconfirmed, eligible].every(Number.isSafeInteger)) throw new Error('amount_overflow');
  const receivedSats = confirmed + unconfirmed;
  if (!Number.isSafeInteger(receivedSats)) throw new Error('amount_overflow');
  const status = expired
    ? receivedSats > 0 ? 'LATE_PAYMENT' : 'EXPIRED'
    : eligible >= expectedSats ? 'PAID'
    : receivedSats >= expectedSats ? 'CONFIRMING'
    : receivedSats > 0 ? 'PARTIALLY_PAID' : 'PENDING';
  return Object.freeze({ status, confirmedSats: confirmed, unconfirmedSats: unconfirmed,
    eligibleSats: eligible, receivedSats, confirmations: Number.isFinite(minConfs) ? minConfs : 0 });
}

// Fail closed: Esplora's first 25 transactions may be incomplete; never claim
// settlement unless a separately verified paginator supplies completeHistory=true.
export async function fetchFirstEsploraPage({ address, baseUrl, fetchImpl = fetch }) {
  if (typeof baseUrl !== 'string' || !/^https:\/\//.test(baseUrl)) throw new Error('invalid_provider_url');
  if (typeof address !== 'string' || !/^[a-zA-Z0-9]{14,90}$/.test(address)) throw new Error('invalid_address');
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/address/${address}/txs`);
  if (!response.ok) throw new Error('provider_unavailable');
  const transactions = await response.json();
  if (!Array.isArray(transactions)) throw new Error('invalid_provider_response');
  return { transactions, completeHistory: false };
}

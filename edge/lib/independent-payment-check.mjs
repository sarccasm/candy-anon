// Both independent Esplora observations must agree before reporting paid.
export function verifyIndependentPayment(primary, secondary, expectedSats) {
  if (!Number.isSafeInteger(expectedSats) || expectedSats <= 0)
    throw Error('invalid_expected_amount');
  if (!primary || !secondary ||
      primary.status !== 'PAID' || secondary.status !== 'PAID' ||
      !Number.isSafeInteger(primary.eligibleSats) ||
      !Number.isSafeInteger(secondary.eligibleSats) ||
      primary.eligibleSats < expectedSats || secondary.eligibleSats < expectedSats)
    return false;
  return true;
}

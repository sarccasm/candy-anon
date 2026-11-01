import * as openpgp from 'openpgp';

// Encrypt on the client. No plaintext PII is sent to our API.
// Pin recipient key to prevent silent replacement of the published PGP key.
export const RECIPIENT_FINGERPRINT = '03a747dccaeac2110ebefddfc23141930637370d';
export function validateDeliveryDetails(details) {
  const { name, address, phone } = details || {};
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60
      || typeof address !== 'string' || address.trim().length < 4 || address.trim().length > 300
      || typeof phone !== 'string' || phone.trim().length < 3 || phone.trim().length > 40)
    throw new Error('invalid_delivery_details');
  return { name:name.trim(), address:address.trim(), phone:phone.trim() };
}

export async function importRecipientKey(armored) {
  if (typeof armored !== 'string' || armored.length > 65536) throw new Error('invalid_public_key');
  const normalized = armored.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim() + '\n';
  if (!normalized.startsWith('-----BEGIN PGP PUBLIC KEY BLOCK-----') ||
      !normalized.includes('-----END PGP PUBLIC KEY BLOCK-----')) throw new Error('invalid_public_key');
  try {
    const key = await openpgp.readKey({ armoredKey: normalized });
    if (key.getFingerprint().toLowerCase() !== RECIPIENT_FINGERPRINT) throw new Error('recipient_key_mismatch');
    await key.getEncryptionKey(); // Reject signing-only or unusable public keys.
    return key;
  } catch (error) {
    if (error?.message === 'recipient_key_mismatch') throw error;
    throw new Error('invalid_public_key');
  }
}

export async function encryptDelivery(details, recipientKey) {
  const validated = validateDeliveryDetails(details);
  if (!recipientKey) throw new Error('missing_recipient_key');
  const message = await openpgp.createMessage({ text: JSON.stringify(validated) });
  const ciphertext = await openpgp.encrypt({ message, encryptionKeys:recipientKey });
  if (typeof ciphertext !== 'string' ||
      !ciphertext.startsWith('-----BEGIN PGP MESSAGE-----') ||
      !ciphertext.includes('-----END PGP MESSAGE-----')) throw new Error('encryption_failed');
  return ciphertext;
}

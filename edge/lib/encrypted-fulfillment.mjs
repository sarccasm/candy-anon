import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { paths } from './store.mjs';

export const validToken = token => typeof token === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token);
export const validCiphertext = data => typeof data === 'string' &&
  data.length >= 80 && data.length <= 32768 &&
  /^-----BEGIN PGP MESSAGE-----\r?\n[\s\S]+\r?\n-----END PGP MESSAGE-----\s*$/.test(data);

export async function saveEncryptedFulfillment(token, ciphertext) {
  if (!validToken(token) || !validCiphertext(ciphertext)) throw new Error('invalid_encrypted_payload');
  const file = join(paths.shipmentDir(), token + '.enc.asc');
  await mkdir(dirname(file), {recursive:true});
  try {
    await writeFile(file, ciphertext, {encoding:'utf8',flag:'wx',mode:0o600});
    return {created:true};
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = await readFile(file,'utf8');
    if (existing !== ciphertext) throw new Error('encrypted_payload_conflict');
    return {created:false};
  }
}

export async function hasEncryptedFulfillment(token) {
  if (!validToken(token)) return false;
  try {
    const ciphertext = await readFile(join(paths.shipmentDir(),token+'.enc.asc'),'utf8');
    return validCiphertext(ciphertext);
  } catch(error) {
    if(error.code==='ENOENT') return false;
    throw error;
  }
}

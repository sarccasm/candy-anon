import { deriveAddress } from './lib/derive-btc.mjs';
const xpub = process.argv[2];
const idx = Number(process.argv[3] ?? 0);
console.log(deriveAddress(xpub, idx));

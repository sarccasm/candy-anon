import BIP32Factory from 'bip32';
import * as ecc from 'tiny-secp256k1';
import * as bitcoin from 'bitcoinjs-lib';
import bs58check from 'bs58check';
import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';

const bip32 = BIP32Factory(ecc);
const NET = process.env.NETWORK === 'testnet' ? bitcoin.networks.testnet : bitcoin.networks.bitcoin;

const VERS = {
  mainnet: { xpub: 0x0488b21e, ypub: 0x049d7cb2, zpub: 0x04b24746 },
  testnet: { tpub: 0x043587cf, upub: 0x044a5262, vpub: 0x045f1cf6 }
};

function clean(x) { return String(x || '').trim().replace(/\s+/g, ''); }

function decode58(xkey) {
  const s = clean(xkey);
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(s)) throw new Error('xpub_bad_chars');
  const u8 = bs58check.decode(s);
  return Buffer.isBuffer(u8) ? u8 : Buffer.from(u8);
}

function versionOf(xkey) {
  const buf = decode58(xkey);
  return buf.readUInt32BE(0);
}

function toNeutralXpub(xkey) {
  const isTestnet = NET === bitcoin.networks.testnet;
  const target = isTestnet ? VERS.testnet.tpub : VERS.mainnet.xpub;
  const buf = decode58(xkey);
  buf.writeUInt32BE(target, 0);
  return bs58check.encode(buf);
}

function scriptTypeOf(xkey) {
  const v = versionOf(xkey);
  if (v === VERS.mainnet.zpub || v === VERS.testnet.vpub) return 'p2wpkh';
  if (v === VERS.mainnet.ypub || v === VERS.testnet.upub) return 'p2sh-p2wpkh';
  return 'p2pkh';
}

export function hmacIndex(secret, token) {
  const mod = Math.max(1000, Number(process.env.XPUB_INDEX_MOD || 100000));
  const mac = crypto.createHmac('sha256', Buffer.from(String(secret), 'utf8')).update(String(token)).digest();
  return (mac.readUInt32BE(0) & 0x7fffffff) % mod;
}

export function deriveAddress(xkey, index) {
  const neutral = toNeutralXpub(xkey);
  const node = bip32.fromBase58(neutral, NET).derive(0).derive(index);
  const type = scriptTypeOf(xkey);
  const pubkey = Buffer.isBuffer(node.publicKey) ? node.publicKey : Buffer.from(node.publicKey);

  if (type === 'p2wpkh') {
    const { address } = bitcoin.payments.p2wpkh({ pubkey, network: NET });
    if (!address) throw new Error('derive_failed');
    return address;
  }
  if (type === 'p2sh-p2wpkh') {
    const redeem = bitcoin.payments.p2wpkh({ pubkey, network: NET });
    const { address } = bitcoin.payments.p2sh({ redeem, network: NET });
    if (!address) throw new Error('derive_failed');
    return address;
  }
  const { address } = bitcoin.payments.p2pkh({ pubkey, network: NET });
  if (!address) throw new Error('derive_failed');
  return address;
}

export function bip21(address, amountSats, label = 'My Candy') {
  const amountBtc = (Number(amountSats || 0) / 1e8).toFixed(8).replace(/0+$/,'').replace(/\.$/,'');
  const qs = new URLSearchParams({ amount: amountBtc, label });
  return `bitcoin:${address}?${qs.toString()}`;
}

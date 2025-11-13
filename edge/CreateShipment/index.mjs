import { config as loadEnv } from 'dotenv';
loadEnv();

import fs from 'fs/promises';
import path from 'path';
import * as openpgp from 'openpgp';
import { readJson, paths } from '../lib/store.mjs';

const OUT_DIR = path.resolve(process.cwd(), 'data', 'shipments');
const ORIGIN = process.env.ALLOW_ORIGIN || process.env.ALLOWED_ORIGIN || 'https://mycandy.app';
const MAX_ARMOR_LEN = Number(process.env.MAX_ARMOR_LEN || 32768);
const REQUIRE_INVOICE = (process.env.REQUIRE_INVOICE || '1') === '1';
const SHIPMENT_TTL_MIN = Number(process.env.SHIPMENT_TTL_MIN || 60);

const json = (context, code, body) => {
  context.res = {
    status: code,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': ORIGIN,
      'access-control-allow-methods': 'POST,OPTIONS',
      'access-control-allow-headers': 'content-type'
    },
    body: JSON.stringify(body)
  };
};

const ensureOut = async () => { await fs.mkdir(OUT_DIR, { recursive: true }); };
const isUuidV4 = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
const PGP_RE = /^-----BEGIN PGP (MESSAGE|PUBLIC KEY BLOCK|SIGNED MESSAGE)-----\r?\n\r?\n[\s\S]+?\r?\n-----END PGP (?:MESSAGE|PUBLIC KEY BLOCK|SIGNED MESSAGE)-----\s*$/;
const minutesAgo = (iso) => { const t = new Date(iso).getTime(); return Number.isFinite(t) ? (Date.now() - t) / 60000 : Infinity; };

let cachedDecKey = null;
async function getDecryptionKey() {
  if (cachedDecKey) return cachedDecKey;
  const keyPath = process.env.PGP_PRIVATE_KEY_PATH;
  if (!keyPath) throw new Error('PGP_PRIVATE_KEY_PATH_missing');
  const armored = await fs.readFile(keyPath, 'utf8');
  const priv = await openpgp.readPrivateKey({ armoredKey: armored });
  const passphrase = process.env.PGP_KEY_PASSPHRASE || '';
  const decKey = passphrase ? await openpgp.decryptKey({ privateKey: priv, passphrase }) : priv;
  cachedDecKey = decKey;
  return decKey;
}

async function decryptArmoredText(armored) {
  const decryptionKeys = await getDecryptionKey();
  const message = await openpgp.readMessage({ armoredMessage: armored });
  const { data } = await openpgp.decrypt({ message, decryptionKeys });
  return String(data ?? '');
}

export default async function (context, req) {
  if (req.method === 'OPTIONS') return json(context, 204, {});
  if (req.method !== 'POST')   return json(context, 405, { error: 'method_not_allowed' });

  try {
    const { data, token } = req.body || {};
    if (!data || !token) return json(context, 400, { error: 'missing_fields' });
    if (!isUuidV4(token)) return json(context, 400, { error: 'bad_token' });

    const armored = String(data).trim();
    if (!PGP_RE.test(armored)) return json(context, 400, { error: 'pgp_required', detail: 'Provide PGP armored block with a blank line after BEGIN' });
    if (armored.length > MAX_ARMOR_LEN) return json(context, 413, { error: 'payload_too_large' });

    let invoice = null;
    if (REQUIRE_INVOICE) {
      try { invoice = await readJson(paths.paymentFile(token)); }
      catch { return json(context, 404, { error: 'invoice_not_found' }); }
      const age = minutesAgo(invoice?.createdAt);
      if (!Number.isFinite(age) || age > SHIPMENT_TTL_MIN) return json(context, 400, { error: 'invoice_expired' });
    }

    let clearText = '';
    try {
      clearText = await decryptArmoredText(armored);
    } catch {
      return json(context, 400, { error: 'pgp_decrypt_failed' });
    }

    let pii = null;
    try { pii = JSON.parse(clearText); } catch { pii = { text: clearText }; }

    await ensureOut();

    const encFile = path.join(OUT_DIR, `${token}.enc.asc`);
    await fs.writeFile(encFile, armored, 'utf8');

    const out = {
      token,
      amountSats: invoice ? Number(invoice.amountSats) || null : null,
      address: invoice ? invoice.address || null : null,
      createdAt: new Date().toISOString(),
      pii
    };
    const jsonFile = path.join(OUT_DIR, `${token}.json`);
    await fs.writeFile(jsonFile, JSON.stringify(out, null, 2), 'utf8');

    return json(context, 200, { ok: true });
  } catch (e) {
    context.log?.error?.('create-shipment error', e?.message || String(e));
    return json(context, 500, { error: 'internal_error' });
  }
}

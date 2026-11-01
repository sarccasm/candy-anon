import { config as loadEnv } from 'dotenv';
loadEnv();

import fs from 'fs/promises';
import path from 'path';

import { readJson, paths, withFileLock } from '../lib/store.mjs';

const OUT_DIR = path.resolve(process.cwd(), 'data', 'shipments');
const ORIGIN = process.env.ALLOW_ORIGIN || process.env.ALLOWED_ORIGIN || 'https://mycandy.app';
const MAX_ARMOR_LEN = Number(process.env.MAX_ARMOR_LEN || 32768);



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
const PGP_RE = /^-----BEGIN PGP MESSAGE-----[\s\S]+-----END PGP MESSAGE-----\s*$/;

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
    {
      try { invoice = await readJson(paths.paymentFile(token)); }
      catch { return json(context, 404, { error: 'invoice_not_found' }); }
      if (!invoice) return json(context, 404, {error:'invoice_not_found'});

    }

    if (!invoice || invoice.committed !== true) return json(context,403,{error:'payment_not_confirmed'});
    await ensureOut();
    let duplicate = false;
    await withFileLock(paths.shipmentFile(token) + '.lock', async () => {
      const existing = await readJson(paths.shipmentFile(token));
      if (existing) { duplicate = true; return; }
      const encFile = path.join(OUT_DIR, `${token}.enc.asc`);
      await fs.writeFile(encFile, armored, { encoding:'utf8', flag:'wx', mode:0o600 });
      const out = { token, createdAt: new Date().toISOString(), encryptedFile: `${token}.enc.asc` };
      await fs.writeFile(paths.shipmentFile(token), JSON.stringify(out, null, 2), { encoding:'utf8', flag:'wx', mode:0o600 });
    });
    if (duplicate) return json(context,409,{error:'shipment_already_created'});

    return json(context, 200, { ok: true });
  } catch (e) {
    context.log?.error?.('create-shipment error', e?.message || String(e));
    return json(context, 500, { error: 'internal_error' });
  }
}

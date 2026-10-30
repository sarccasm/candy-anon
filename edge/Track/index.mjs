import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const LOG_PATH   = resolve(__dirname, '..', 'data', 'analytics.jsonl');

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST,OPTIONS',
  'access-control-allow-headers': 'content-type'
};

export default async function (context, req) {
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS }; return;
  }

  try {
    const body = (req.body && req.body[0]) || req.body || await (async()=>{ try{ return await req.json(); }catch{ return {}; } })();
    if (!body?.sid || !body?.ts) {
      context.res = { status: 400, headers: { ...CORS, 'content-type':'application/json' }, body: JSON.stringify({ ok:false }) };
      return;
    }
    const row = {
      ts: Number(body.ts), sid: String(body.sid).slice(0,64), kind: body.kind || 'pv',
      page: (body.page||'').slice(0,256), ref: (body.ref||'').slice(0,256),
      dur_ms: Number(body.dur_ms||0)
    };
    await mkdir(dirname(LOG_PATH), { recursive: true });
    await appendFile(LOG_PATH, JSON.stringify(row) + '\n', 'utf8');
    context.res = { status: 204, headers: CORS };
  } catch (e) {
    context.log.error(e);
    context.res = { status: 500, headers: { ...CORS, 'content-type':'application/json' }, body: JSON.stringify({ ok:false }) };
  }
}

import {authorizeLocalRequest} from '../lib/local-request-auth.mjs';
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
  context.res ??= {};
  if(!authorizeLocalRequest(context,req))return;
  if (req.method === 'OPTIONS') {
    context.res = { status: 204, headers: CORS }; return;
  }

  if(process.env.ENABLE_ANALYTICS!=='true'){context.res={status:204,headers:CORS};return;}
  try {
    const body = (req.body && req.body[0]) || req.body || await (async()=>{ try{ return await req.json(); }catch{ return {}; } })();
    if (Buffer.byteLength(JSON.stringify(body))>2048 || typeof body?.sid!=='string' || !/^[a-zA-Z0-9_-]{16,64}$/.test(body.sid) ||
        !Number.isSafeInteger(body.ts) || Math.abs(Date.now()-body.ts)>300000 ||
        !['pv','end'].includes(body.kind) || !['/','/catalog','/checkout'].includes(body.page)) {
      context.res = { status: 400, headers: { ...CORS, 'content-type':'application/json' }, body: JSON.stringify({ ok:false }) };
      return;
    }
    const row = {
      ts: Number(body.ts), sid: String(body.sid).slice(0,64), kind: body.kind || 'pv',
      page: body.page,
      dur_ms: Number(body.dur_ms||0)
    };
    await mkdir(dirname(LOG_PATH), { recursive: true });
    await appendFile(LOG_PATH, JSON.stringify(row) + '\n', 'utf8');
    context.res = { status: 204, headers: CORS };
  } catch (e) {
    context.log?.error?.('analytics_write_failed');
    context.res = { status: 500, headers: { ...CORS, 'content-type':'application/json' }, body: JSON.stringify({ ok:false }) };
  }
}

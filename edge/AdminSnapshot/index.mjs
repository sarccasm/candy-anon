import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readState } from '../lib/store.mjs';
import { okAuth, json, options } from '../lib/http.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const LOG_PATH   = resolve(__dirname, '..', 'data', 'analytics.jsonl');

const ORIGIN = process.env.ALLOWED_ORIGIN || 'https://admin.mycandy.app';
const TAIL_BYTES = Number(process.env.SNAPSHOT_TAIL_BYTES || 2_000_000);

async function readTailJsonl(p) {
  try {
    const buf = await readFile(p);
    const slice = buf.byteLength > TAIL_BYTES ? buf.subarray(buf.byteLength - TAIL_BYTES) : buf;
    return String(slice);
  } catch {
    return '';
  }
}

export default async function (context, req) {
  if (req.method === 'OPTIONS') return options(context.res);

  try {
    if (!okAuth(req)) return json(context.res, { error: 'unauthorized' }, 401, { origin: ORIGIN });

    const st = await readState();

    const hours = Math.max(1, Math.min(72, Number(req.query?.hours || 24)));
    const now = Date.now();
    const fromTs = now - hours * 60 * 60 * 1000;

    let lines = await readTailJsonl(LOG_PATH);
    const rows = lines
      .split('\n')
      .filter(Boolean)
      .map(x => { try { return JSON.parse(x); } catch { return null; } })
      .filter(Boolean)
      .filter(r => r.ts >= fromTs && r.ts <= now);

    const sids = new Set(rows.map(r => r.sid));
    const users = sids.size;
    const hits  = rows.filter(r => r.kind === 'pv').length;

    const bySid = new Map();
    for (const r of rows) {
      const obj = bySid.get(r.sid) || { firstTs: r.ts, lastTs: r.ts, endDur: 0 };
      if (r.ts < obj.firstTs) obj.firstTs = r.ts;
      if (r.ts > obj.lastTs)  obj.lastTs  = r.ts;
      if (r.kind === 'end' && r.dur_ms) obj.endDur = Math.max(obj.endDur, r.dur_ms);
      bySid.set(r.sid, obj);
    }
    let totalDurMs = 0;
    bySid.forEach(v => {
      const est = v.endDur || Math.min(30 * 60 * 1000, v.lastTs - v.firstTs);
      totalDurMs += Math.max(0, est);
    });
    const avgSessionMs = users ? Math.round(totalDurMs / users) : 0;
    const pagesPerSession = users ? (hits / users) : 0;

    const bins = Array.from({ length: 24 }, () => ({ users: new Set(), hits: 0, dur: 0 }));
    const hourOf = t => {
      const diff = Math.floor((now - t) / (60 * 60 * 1000));
      return 23 - Math.min(23, Math.max(0, diff));
    };
    for (const r of rows) {
      const h = hourOf(r.ts);
      if (h < 0 || h > 23) continue;
      if (r.kind === 'pv') bins[h].hits++;
      bins[h].users.add(r.sid);
      if (r.kind === 'end' && r.dur_ms) bins[h].dur += r.dur_ms;
    }
    const series = {
      users: bins.map(b => b.users.size),
      hits:  bins.map(b => b.hits),
      avg:   bins.map(b => { const u = b.users.size; return u ? Math.round(b.dur / (u * 1000)) : 0; }),
      pps:   bins.map((b, i) => { const u = b.users.size || 1; return +(bins[i].hits / u).toFixed(2); })
    };

    const toClock = ms => {
      const t = Math.round(ms / 1000);
      const h = String(Math.floor(t / 3600)).padStart(2, '0');
      const m = String(Math.floor((t % 3600) / 60)).padStart(2, '0');
      const s = String(t % 60).padStart(2, '0');
      return `${h}:${m}:${s}`;
    };

    return json(context.res, {
      user: st.user || 'M1000',
      products: st.products || [],
      analytics: {
        window_h: hours,
        users,
        hits,
        avg_session: toClock(avgSessionMs),
        pages_per_session: +pagesPerSession.toFixed(2),
        series
      },
      hosting: {
        server_ip: process.env.SERVER_IP || st.hosting?.server_ip || '',
        domain:    process.env.PUBLIC_DOMAIN || st.hosting?.domain || ''
      },
      access: st.access || { published: false, note: 'Draft' }
    }, 200, { origin: ORIGIN });

  } catch (e) {
    context.log?.error?.(e);
    return json(context.res, { error: 'snapshot_failed' }, 500, { origin: ORIGIN });
  }
}

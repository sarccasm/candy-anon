import { readState, writeState } from '../lib/store.mjs';
import { okAuth, json, options } from '../lib/http.mjs';

const ORIGIN = process.env.ALLOWED_ORIGIN || 'https://admin.mycandy.app';

function j(res, body, code = 200) {
  return json(res, body, code, { origin: ORIGIN });
}

function isPrice(n) {
  return Number.isFinite(n) && n >= 0 && n <= 1e6;
}

export default async function (context, req) {
  if (req.method === 'OPTIONS') return options(context.res, { origin: ORIGIN });

  try {
    if (!okAuth(req)) return j(context.res, { ok: false, error: 'unauthorized' }, 401);

    let body = {};
    try { body = await req.json(); } catch {}

    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    const price = Number(body?.price);

    if (!id) return j(context.res, { ok: false, error: 'bad_id' }, 400);
    if (!isPrice(price)) return j(context.res, { ok: false, error: 'bad_price' }, 400);

    const rounded = Math.round(price * 100) / 100;

    const st = await readState();
    const list = Array.isArray(st.products) ? st.products : [];
    const i = list.findIndex(p => p.id === id);
    if (i === -1) return j(context.res, { ok: false, error: 'not_found' }, 404);

    const prev = list[i].price;
    list[i].price = rounded;
    await writeState({ ...st, products: list });

    return j(context.res, { ok: true, id, prev, next: rounded }, 200);
  } catch (e) {
    context.log?.error?.('update_failed', e);
    return j(context.res, { ok: false, error: 'update_failed' }, 500);
  }
}

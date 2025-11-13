import { readState, writeState } from '../lib/store.mjs';
import { okAuth, json, options } from '../lib/http.mjs';

export default async function (context, req) {
  if (req.method === 'OPTIONS') return options(context.res);

  try {
    if (!okAuth(req)) return json(context.res, { ok: false, error: 'unauthorized' }, 401);

    const body = await (async () => {
      try { return await req.json(); } catch { return {}; }
    })();

    const published = body?.published === true;

    const st = await readState();
    st.access = {
      published,
      note: published ? `Live since ${new Date().toISOString().slice(0, 10)}` : 'Draft'
    };
    await writeState(st);

    return json(context.res, { ok: true }, 200);
  } catch (e) {
    context.log?.error?.(e);
    return json(context.res, { ok: false, error: 'publish_failed' }, 500);
  }
}

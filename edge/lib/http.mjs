import { timingSafeEqual } from 'node:crypto';
const ORIGIN = process.env.ALLOW_ORIGIN || '*';
const ADMIN_KEY = process.env.ADMIN_KEY || '';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': ORIGIN,
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-key',
  'Access-Control-Max-Age': '600'
};

function apply(res, status = 200, body = '', headers = {}) {
  res.status = status;
  res.headers = { ...CORS_HEADERS, 'Cache-Control':'no-store', ...headers };
  res.body = body;
  return res;
}

export function options(res, {origin} = {}) { return apply(res, 204, '', origin ? {'Access-Control-Allow-Origin':origin} : {}); }
export function json(res, obj, status = 200, {origin, ...extra} = {}) { return apply(res, status, JSON.stringify(obj), { 'content-type': 'application/json', ...(origin ? {'Access-Control-Allow-Origin':origin} : {}), ...extra }); }
export function text(res, str, status = 200, extra = {}) { return apply(res, status, String(str), { 'content-type': 'text/plain; charset=utf-8', ...extra }); }

export const ok = (res) => json(res, { ok: true }, 200);
export const badRequest = (res, msg = 'bad_request') => json(res, { error: msg }, 400);
export const notAllowed = (res) => json(res, { error: 'method_not_allowed' }, 405);
export const unauthorized = (res, msg = 'unauthorized') => json(res, { error: msg }, 401);

export function okAuth(req) {
  const h = req.headers || {};
  const k = h['x-admin-key'] || h['X-Admin-Key'] || h['x-Admin-Key'];
  if (ADMIN_KEY.length < 24 || typeof k !== 'string') return false;
  const a = Buffer.from(k), b = Buffer.from(ADMIN_KEY);
  return a.length === b.length && timingSafeEqual(a, b);
}

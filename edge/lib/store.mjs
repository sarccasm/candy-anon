import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, '..', 'data');
const PAY_DIR = path.join(DATA_DIR, 'payments');
const SHIP_DIR = path.join(DATA_DIR, 'shipments');
const DASH_DIR = path.join(DATA_DIR, 'dash');

async function ensureDir(p) { await fs.mkdir(p, { recursive: true }); }
export async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

export const paths = {
  dataDir: () => DATA_DIR,
  paymentDir: () => PAY_DIR,
  shipmentDir: () => SHIP_DIR,
  dashDir: () => DASH_DIR,
  paymentFile: (token) => path.join(PAY_DIR, `${token}.json`),
  shipmentFile: (token) => path.join(SHIP_DIR, `${token}.json`),
  stateFile: () => path.join(DATA_DIR, 'state.json'),
  snapshotFile: () => path.join(DATA_DIR, 'snapshot.json'),
  genericFile: (rel) => path.join(DATA_DIR, rel)
};

export async function readJson(file) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return null; } }
export async function writeJson(file, obj) { await ensureDir(path.dirname(file)); const tmp = file + '.tmp'; await fs.writeFile(tmp, JSON.stringify(obj, null, 2), 'utf8'); await fs.rename(tmp, file); }
export async function readText(file) { try { return await fs.readFile(file, 'utf8'); } catch { return null; } }
export async function writeText(file, str) { await ensureDir(path.dirname(file)); const tmp = file + '.tmp'; await fs.writeFile(tmp, String(str ?? ''), 'utf8'); await fs.rename(tmp, file); }
export async function ensureDataLayout() { await Promise.all([ensureDir(DATA_DIR), ensureDir(PAY_DIR), ensureDir(SHIP_DIR), ensureDir(DASH_DIR)]); }

export async function withFileLock(lockPath, fn) {
  await ensureDir(path.dirname(lockPath));
  const fd = await fs.open(lockPath, 'wx').catch(err => { if (err.code === 'EEXIST') return null; throw err; });
  if (!fd) throw new Error('lock_busy');
  try { return await fn(); }
  finally { await fd.close().catch(()=>{}); await fs.rm(lockPath).catch(()=>{}); }
}
export const lockPaths = {
  inventoryLock: () => path.join(DATA_DIR, 'inventory.lock')
};

const DEFAULT_STATE = {
  products: [],
  analytics: { users: 0, hits: 0, avg_session: '00:00:00', pages_per_session: 0, series: { users: [], hits: [], avg: [], pps: [] } },
  access: { published: false },
  hosting: { server_ip: '', domain: '' },
  user: 'admin'
};

export async function readState() { await ensureDataLayout(); const f = paths.stateFile(); const st = await readJson(f); return st && typeof st === 'object' ? st : { ...DEFAULT_STATE }; }
export async function writeState(state) { await ensureDataLayout(); const f = paths.stateFile(); const next = { ...DEFAULT_STATE, ...(state || {}) }; await writeJson(f, next); return next; }
export async function getProducts() { const st = await readState(); return Array.isArray(st.products) ? st.products : []; }
export async function upsertProduct(partial) { const st = await readState(); const list = Array.isArray(st.products) ? st.products : []; const id = String(partial?.id || '').trim(); if (!id) return list; const i = list.findIndex(p => p.id === id); if (i >= 0) { list[i] = { ...list[i], name: partial.name ?? list[i].name ?? '', price: Number(partial.price ?? list[i].price ?? 0), tags: Array.isArray(partial.tags) ? partial.tags : (Array.isArray(list[i].tags) ? list[i].tags : []), color: partial.color ?? list[i].color ?? '' }; } else { list.push({ id, name: partial.name ?? '', price: Number(partial.price || 0), tags: Array.isArray(partial.tags) ? partial.tags : [], color: partial.color || '' }); } st.products = list; await writeState(st); return list; }
export async function updateProductPrice(id, price) { const st = await readState(); const list = Array.isArray(st.products) ? st.products : []; const i = list.findIndex(p => p.id === id); if (i < 0) throw new Error('product_not_found'); list[i].price = Number(price || 0); st.products = list; await writeState(st); return list[i]; }
export async function setPublished(published) { const st = await readState(); st.access = { ...st.access, published: !!published }; await writeState(st); return st.access.published; }
export async function snapshot() { await ensureDataLayout(); const f = paths.snapshotFile(); if (!(await exists(f))) { const st = await readState(); await writeJson(f, { ...st, ts: Date.now() }); } return readJson(f); }

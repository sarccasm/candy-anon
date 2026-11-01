import { readJson, writeJson, paths, ensureDataLayout, exists, withFileLock, lockPaths } from './store.mjs';
import path from 'node:path';

const DEFAULT_STATE = {
  products: [],
  analytics: { users: 0, hits: 0, avg_session: '00:00:00', pages_per_session: 0, series: { users: [], hits: [], avg: [], pps: [] } },
  access: { published: false },
  hosting: { server_ip: '', domain: '' },
  user: 'admin'
};

function inventoryFilePath() {
  const statePath = paths.stateFile();
  const dir = path.dirname(statePath);
  return path.join(dir, 'inventory.json');
}

async function readState() {
  await ensureDataLayout();
  const file = paths.stateFile();
  const st = await readJson(file);
  return st && typeof st === 'object' ? st : { ...DEFAULT_STATE };
}

async function writeState(state) {
  await ensureDataLayout();
  const file = paths.stateFile();
  const next = { ...DEFAULT_STATE, ...(state || {}) };
  await writeJson(file, next);
  return next;
}

async function readInventory(seedIds = []) {
  await ensureDataLayout();
  const file = inventoryFilePath();
  let inv = {};
  if (await exists(file)) {
    const raw = await readJson(file);
    if (raw && typeof raw === 'object') inv = raw;
  } else {
    await writeJson(file, inv);
  }
  if (seedIds.length) {
    let changed = false;
    for (const id of seedIds) {
      if (!Object.prototype.hasOwnProperty.call(inv, id)) {
        inv[id] = 500;
        changed = true;
      }
    }
    if (changed) await writeJson(file, inv);
  }
  return inv;
}

async function writeInventory(inv) {
  await ensureDataLayout();
  const file = inventoryFilePath();
  await writeJson(file, inv || {});
  return inv || {};
}

export async function getProducts() {
  const st = await readState();
  const list = Array.isArray(st.products) ? st.products : [];
  const ids = list.map(p => String(p.id || '').trim()).filter(Boolean);
  const inv = await readInventory(ids);
  return list.map(p => ({
    id: p.id,
    name: p.name ?? '',
    price: Number(p.price || 0),
    stock: Number.isFinite(inv[p.id]) ? Number(inv[p.id]) : 0,
    tags: Array.isArray(p.tags) ? p.tags : [],
    color: p.color || ''
  }));
}

export async function upsertProduct(partial) {
  const st = await readState();
  const list = Array.isArray(st.products) ? st.products : [];
  const id = String(partial.id || '').trim();
  if (!id) return list;

  const idx = list.findIndex(p => p.id === id);
  if (idx >= 0) {
    list[idx] = {
      ...list[idx],
      name: partial.name ?? list[idx].name ?? '',
      price: Number(partial.price ?? list[idx].price ?? 0),
      tags: Array.isArray(partial.tags) ? partial.tags : (Array.isArray(list[idx].tags) ? list[idx].tags : []),
      color: partial.color ?? list[idx].color ?? ''
    };
  } else {
    list.push({
      id,
      name: partial.name ?? '',
      price: Number(partial.price || 0),
      tags: Array.isArray(partial.tags) ? partial.tags : [],
      color: partial.color || ''
    });
  }
  st.products = list;
  await writeState(st);

  if (Object.prototype.hasOwnProperty.call(partial, 'stock')) {
    const inv = await readInventory(list.map(p => p.id));
    inv[id] = Math.max(0, Number(partial.stock || 0));
    await writeInventory(inv);
  }

  return list;
}

export async function reserveStock(items) {
  if (!items || typeof items !== 'object') return { ok: true, changed: [] };
  const st = await readState();
  const list = Array.isArray(st.products) ? st.products : [];
  const ids = list.map(p => p.id);
  const file = inventoryFilePath();

  return await withFileLock(lockPaths.inventoryLock(), async () => {
    const inv = (await readJson(file)) || {};
    for (const [sku, qtyRaw] of Object.entries(items)) {
      const qty = Number(qtyRaw || 0);
      if (qty <= 0) continue;
      if (!ids.includes(sku)) return { ok: false, error: 'sku_not_found', sku };
      const stock = Number(inv[sku] ?? 0);
      if (stock < qty) return { ok: false, error: 'out_of_stock', sku, need: qty, have: stock };
    }
    const changed = [];
    for (const [sku, qtyRaw] of Object.entries(items)) {
      const qty = Number(qtyRaw || 0);
      if (qty <= 0) continue;
      inv[sku] = Math.max(0, Number(inv[sku] ?? 0) - qty);
      changed.push({ sku, delta: -qty });
    }
    await writeJson(file, inv);
    return { ok: true, changed };
  });
}

export async function releaseStock(items) {
  if (!items || typeof items !== 'object') return { ok: true, changed: [] };
  const st = await readState();
  const list = Array.isArray(st.products) ? st.products : [];
  const ids = list.map(p => p.id);
  const file = inventoryFilePath();

  return await withFileLock(lockPaths.inventoryLock(), async () => {
    const inv = (await readJson(file)) || {};
    const changed = [];
    for (const [sku, qtyRaw] of Object.entries(items)) {
      const qty = Number(qtyRaw || 0);
      if (qty <= 0) continue;
      if (!ids.includes(sku)) continue;
      inv[sku] = Math.max(0, Number(inv[sku] ?? 0) + qty);
      changed.push({ sku, delta: +qty });
    }
    await writeJson(file, inv);
    return { ok: true, changed };
  });
}

export async function commitStock(items, token) {
  if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/i.test(token)) return {ok:false,error:'bad_token'};
  const entries = Object.entries(items || {});
  if (!entries.length) return { ok: false, error: 'empty_cart' };
  await ensureDataLayout();
  return withFileLock(lockPaths.inventoryLock(), async () => {
    const file = inventoryFilePath();
    const inv = (await readJson(file)) || {};
    const settled = inv.__settled || {};
    if (settled[token]) return {ok:true,alreadyCommitted:true};
    for (const [sku, raw] of entries) {
      const qty = Number(raw);
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(sku) || !Number.isSafeInteger(qty) || qty < 1) return { ok: false, error:'invalid_items' };
      if (!Number.isSafeInteger(inv[sku]) || inv[sku] < qty) return { ok: false, error:'out_of_stock', sku };
    }
    for (const [sku,qty] of entries) inv[sku] -= qty;
    settled[token] = true;
    inv.__settled = settled;
    await writeJson(file,inv);
    return {ok:true};
  });
}

export async function updateProductPrice(id, price) {
  const st = await readState();
  const list = Array.isArray(st.products) ? st.products : [];
  const idx = list.findIndex(p => p.id === id);
  if (idx < 0) throw new Error('product_not_found');
  list[idx].price = Number(price || 0);
  st.products = list;
  await writeState(st);
  return list[idx];
}

export async function setPublished(published) {
  const st = await readState();
  st.access = { ...st.access, published: !!published };
  await writeState(st);
  return st.access.published;
}

export async function snapshot() {
  await ensureDataLayout();
  const file = paths.snapshotFile();
  if (!(await exists(file))) {
    const st = await readState();
    await writeJson(file, { ...st, ts: Date.now() });
  }
  return readJson(file);
}

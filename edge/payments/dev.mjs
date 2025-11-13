import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'invoices.json');

async function load() {
  if (!existsSync(DATA_DIR)) await fs.mkdir(DATA_DIR, { recursive: true });
  if (!existsSync(FILE)) await fs.writeFile(FILE, JSON.stringify({ list: [] }, null, 2), 'utf8');
  const raw = await fs.readFile(FILE, 'utf8');
  try { return JSON.parse(raw); } catch { return { list: [] }; }
}

async function save(data) {
  const tmp = FILE + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tmp, FILE);
}

const DEV_ADDRESS = 'bc1qdevxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
const EXPIRE_MS = 20 * 60 * 1000;

export async function createInvoice({ amountSats }) {
  const data = await load();
  const token = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const inv = {
    token,
    amountSats: Number(amountSats) || 0,
    address: DEV_ADDRESS,
    createdAt: now,
    expiresAt: now + EXPIRE_MS,
    paid: false,
    txid: null
  };
  data.list.push(inv);
  await save(data);
  return { address: inv.address, token: inv.token, expiresAt: inv.expiresAt };
}

export async function getStatus({ token, amountSats }) {
  const data = await load();
  const inv = data.list.find(i => i.token === token);
  if (!inv) return { paid: false, error: 'not_found' };

  if (!inv.paid && Date.now() - inv.createdAt > 15_000) {
    inv.paid = true;
    inv.txid = 'dev-' + crypto.randomBytes(8).toString('hex');
    await save(data);
  }

  const expired = Date.now() > inv.expiresAt;
  const correctAmount = Number(amountSats || inv.amountSats) <= inv.amountSats * 1.05; // трохи флекс
  return { paid: inv.paid && correctAmount && !expired, expired, txid: inv.txid || null };
}

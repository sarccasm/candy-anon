import { randomUUID } from 'node:crypto';

// Azure Table Storage adapter for short-lived TECHNICAL records only.
// Caller provides an initialized @azure/data-tables TableClient.
// No PII, PGP payloads, wallet secrets, or private keys belong here.
const KEY = 'orders';
const idValid = id => typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id);
const conflicts = new Set([409, 412]);
function mapError(error) {
  if (conflicts.has(error?.statusCode)) throw new Error('version_conflict');
  throw error;
}
function decode(entity) {
  if (!entity) return null;
  const { rowKey, expiresAt, version, payload, etag } = entity;
  const parsed = JSON.parse(payload);
  return { ...parsed, id: rowKey, expiresAt: Number(expiresAt), version: Number(version), etag };
}
function encode(record) {
  const { id, expiresAt, version, etag: _etag, ...data } = record;
  return { partitionKey: KEY, rowKey: id, expiresAt, version, payload: JSON.stringify(data) };
}
export class AzureTemporaryStore {
  constructor(client) {
    if (!client?.createEntity || !client?.getEntity || !client?.updateEntity || !client?.deleteEntity) throw new Error('invalid_client');
    this.client = client;
  }
  async create(value, { id = randomUUID(), expiresAt } = {}) {
    if (!idValid(id) || !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error('invalid_record');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_record');
    const record = { ...structuredClone(value), id, expiresAt, version: 1 };
    try { await this.client.createEntity(encode(record)); }
    catch (e) { if (e.statusCode === 409) throw new Error('already_exists'); throw e; }
    return record;
  }
  async read(id) {
    if (!idValid(id)) throw new Error('invalid_id');
    try { return decode(await this.client.getEntity(KEY, id)); }
    catch (e) { if (e.statusCode === 404) return null; throw e; }
  }
  async compareAndSwap(id, expectedVersion, updater) {
    const prior = await this.read(id);
    if (!prior) throw new Error('not_found');
    if (prior.version !== expectedVersion) throw new Error('version_conflict');
    if (typeof updater !== 'function') throw new Error('invalid_updater');
    const candidate = updater(structuredClone(prior));
    if (!candidate || candidate.id !== id || candidate.expiresAt !== prior.expiresAt) throw new Error('invalid_update');
    const next = { ...structuredClone(candidate), version: expectedVersion + 1 };
    try { await this.client.updateEntity(encode(next), 'Replace', { etag: prior.etag }); }
    catch (e) { mapError(e); }
    return next;
  }
  async deleteIfVersion(id, expectedVersion) {
    const prior = await this.read(id);
    if (!prior) return false;
    if (prior.version !== expectedVersion) throw new Error('version_conflict');
    try { await this.client.deleteEntity(KEY, id, { etag: prior.etag }); }
    catch (e) { if (e.statusCode === 404) return false; mapError(e); }
    return true;
  }
}

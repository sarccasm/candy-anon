import { randomUUID } from 'node:crypto';

// Adapter interface: replace with Azure Table Storage conditional writes in production.
// This in-memory adapter is only for deterministic tests and single-process development.
export class MemoryTemporaryStore {
  #records = new Map();

  async create(value, { id = randomUUID(), expiresAt } = {}) {
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error('invalid_expiry');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_record');
    if (this.#records.has(id)) throw new Error('already_exists');
    const record = { ...structuredClone(value), id, expiresAt, version: 1 };
    this.#records.set(id, record);
    return structuredClone(record);
  }

  async read(id) {
    const record = this.#records.get(id);
    return record ? structuredClone(record) : null;
  }

  async compareAndSwap(id, expectedVersion, updater) {
    const current = this.#records.get(id);
    if (!current) throw new Error('not_found');
    if (current.version !== expectedVersion) throw new Error('version_conflict');
    if (typeof updater !== 'function') throw new Error('invalid_updater');
    const updated = updater(structuredClone(current));
    if (!updated || typeof updated !== 'object' || updated.id !== id ||
        updated.expiresAt !== current.expiresAt) throw new Error('invalid_update');
    const next = { ...structuredClone(updated), version: current.version + 1 };
    this.#records.set(id, next);
    return structuredClone(next);
  }

  async deleteIfVersion(id, expectedVersion) {
    const current = this.#records.get(id);
    if (!current) return false;
    if (current.version !== expectedVersion) throw new Error('version_conflict');
    this.#records.delete(id);
    return true;
  }
}

// All persistent adapters MUST implement atomic conditional writes, durable
// idempotency tombstones and auditing of expired payment addresses before deletion.

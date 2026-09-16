'use strict';

/**
 * File-backed object store for large API Console response bodies (S01.03).
 * Root: DATA_DIR/object-storage/ or API_CONSOLE_OBJECT_STORE_DIR.
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function resolveObjectStoreRoot(options = {}) {
  if (options.rootDir) return options.rootDir;
  if (process.env.API_CONSOLE_OBJECT_STORE_DIR) {
    return path.resolve(process.env.API_CONSOLE_OBJECT_STORE_DIR);
  }
  const dataDir = options.dataDir
    || process.env.API_CONSOLE_DATA_DIR
    || path.join(process.cwd(), 'runtime', 'api-console');
  return path.join(path.resolve(dataDir), 'object-storage');
}

function safeBlobId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function createObjectStore(options = {}) {
  const rootDir = resolveObjectStoreRoot(options);
  fs.mkdirSync(rootDir, { recursive: true });

  function blobPaths(id) {
    const safeId = safeBlobId(id);
    return {
      id: safeId,
      bodyPath: path.join(rootDir, `${safeId}.bin`),
      metaPath: path.join(rootDir, `${safeId}.meta.json`),
    };
  }

  /**
   * @param {{ id?: string, contentType?: string, bodyBuffer?: Buffer|string, body?: Buffer|string, meta?: object }} input
   * Also accepts legacy (data, meta) form for callers that pass buffer first.
   */
  function putBlob(input, legacyMeta) {
    let id;
    let contentType;
    let body;
    let meta = {};

    if (Buffer.isBuffer(input) || typeof input === 'string') {
      body = input;
      meta = legacyMeta && typeof legacyMeta === 'object' ? { ...legacyMeta } : {};
      id = meta.id;
      contentType = meta.contentType;
      delete meta.id;
      delete meta.contentType;
    } else {
      const opts = input && typeof input === 'object' ? input : {};
      id = opts.id;
      contentType = opts.contentType;
      body = opts.bodyBuffer != null ? opts.bodyBuffer : opts.body;
      meta = opts.meta && typeof opts.meta === 'object' ? { ...opts.meta } : {};
    }

    const resolvedId = safeBlobId(id || `blob-${randomUUID()}`);
    const { bodyPath, metaPath } = blobPaths(resolvedId);
    const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body == null ? '' : body);
    const createdAt = new Date().toISOString();
    const sidecar = {
      id: resolvedId,
      contentType: contentType || 'application/octet-stream',
      size: buffer.length,
      createdAt,
      meta,
    };
    fs.writeFileSync(bodyPath, buffer);
    fs.writeFileSync(metaPath, `${JSON.stringify(sidecar, null, 2)}\n`, 'utf8');
    return sidecar;
  }

  function getBlob(id) {
    const { bodyPath, metaPath } = blobPaths(id);
    if (!fs.existsSync(bodyPath)) return null;
    let sidecar = {};
    if (fs.existsSync(metaPath)) {
      try {
        sidecar = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch {
        sidecar = {};
      }
    }
    const body = fs.readFileSync(bodyPath);
    return {
      body,
      contentType: sidecar.contentType || 'application/octet-stream',
      meta: {
        id: sidecar.id || safeBlobId(id),
        size: sidecar.size != null ? sidecar.size : body.length,
        createdAt: sidecar.createdAt,
        ...(sidecar.meta && typeof sidecar.meta === 'object' ? sidecar.meta : {}),
      },
    };
  }

  function deleteBlob(id) {
    const { bodyPath, metaPath } = blobPaths(id);
    let removed = false;
    if (fs.existsSync(bodyPath)) {
      fs.unlinkSync(bodyPath);
      removed = true;
    }
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
      removed = true;
    }
    return removed;
  }

  function listBlobEntries() {
    const names = fs.existsSync(rootDir) ? fs.readdirSync(rootDir) : [];
    const byId = new Map();
    for (const name of names) {
      let id;
      let kind;
      if (name.endsWith('.meta.json')) {
        id = name.slice(0, -'.meta.json'.length);
        kind = 'meta';
      } else if (name.endsWith('.bin')) {
        id = name.slice(0, -'.bin'.length);
        kind = 'body';
      } else {
        // Legacy single-file blobs (no extension)
        id = name;
        kind = 'legacy';
      }
      if (!byId.has(id)) byId.set(id, { id, bodyPath: null, metaPath: null, mtimeMs: 0, size: 0 });
      const entry = byId.get(id);
      const full = path.join(rootDir, name);
      const stat = fs.statSync(full);
      if (kind === 'meta') entry.metaPath = full;
      else entry.bodyPath = full;
      entry.mtimeMs = Math.max(entry.mtimeMs, stat.mtimeMs);
      if (kind !== 'meta') entry.size += stat.size;
      else entry.size += stat.size;
    }
    return Array.from(byId.values()).filter(entry => entry.bodyPath || entry.metaPath);
  }

  /**
   * Delete blobs older than maxAgeMs and/or enforce a total size cap (oldest first).
   * @returns {{ deleted: string[], freedBytes: number, remainingBytes: number }}
   */
  function cleanupExpired({ maxAgeMs, maxTotalBytes } = {}) {
    const now = Date.now();
    const entries = listBlobEntries().sort((a, b) => a.mtimeMs - b.mtimeMs);
    const deleted = [];
    let freedBytes = 0;

    const shouldExpire = Number.isFinite(maxAgeMs) && maxAgeMs > 0;
    const shouldCap = Number.isFinite(maxTotalBytes) && maxTotalBytes >= 0;

    for (const entry of entries) {
      if (!shouldExpire) break;
      if (now - entry.mtimeMs <= maxAgeMs) continue;
      const size = entry.size || 0;
      if (entry.bodyPath && fs.existsSync(entry.bodyPath)) fs.unlinkSync(entry.bodyPath);
      if (entry.metaPath && fs.existsSync(entry.metaPath)) fs.unlinkSync(entry.metaPath);
      deleted.push(entry.id);
      freedBytes += size;
      entry._removed = true;
    }

    const remaining = entries.filter(entry => !entry._removed);
    let totalBytes = remaining.reduce((sum, entry) => sum + (entry.size || 0), 0);
    if (shouldCap) {
      for (const entry of remaining) {
        if (totalBytes <= maxTotalBytes) break;
        const size = entry.size || 0;
        if (entry.bodyPath && fs.existsSync(entry.bodyPath)) fs.unlinkSync(entry.bodyPath);
        if (entry.metaPath && fs.existsSync(entry.metaPath)) fs.unlinkSync(entry.metaPath);
        deleted.push(entry.id);
        freedBytes += size;
        totalBytes -= size;
      }
    }

    return { deleted, freedBytes, remainingBytes: Math.max(0, totalBytes) };
  }

  return {
    rootDir,
    putBlob,
    getBlob,
    deleteBlob,
    cleanupExpired,
  };
}

module.exports = {
  createObjectStore,
  resolveObjectStoreRoot,
};

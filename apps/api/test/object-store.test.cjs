'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createObjectStore } = require('../src/modules/api-console/infrastructure/persistence/object-store.cjs');

describe('object-store (S01.03)', () => {
  let tmpDir;
  let store;

  before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'api-console-object-store-'));
    store = createObjectStore({ rootDir: tmpDir });
  });

  after(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('putBlob writes body + sidecar meta and getBlob returns them', () => {
    const put = store.putBlob({
      id: 'body-demo-1',
      contentType: 'application/json',
      bodyBuffer: Buffer.from('{"ok":true,"n":1}', 'utf8'),
      meta: { source: 'test' },
    });
    assert.equal(put.id, 'body-demo-1');
    assert.equal(put.contentType, 'application/json');
    assert.equal(put.size, Buffer.byteLength('{"ok":true,"n":1}'));
    assert.ok(fs.existsSync(path.join(tmpDir, 'body-demo-1.bin')));
    assert.ok(fs.existsSync(path.join(tmpDir, 'body-demo-1.meta.json')));

    const got = store.getBlob('body-demo-1');
    assert.ok(got);
    assert.equal(got.contentType, 'application/json');
    assert.equal(got.body.toString('utf8'), '{"ok":true,"n":1}');
    assert.equal(got.meta.source, 'test');
  });

  it('deleteBlob removes body and meta', () => {
    store.putBlob({ id: 'to-delete', contentType: 'text/plain', bodyBuffer: 'x' });
    assert.equal(store.deleteBlob('to-delete'), true);
    assert.equal(store.getBlob('to-delete'), null);
    assert.equal(store.deleteBlob('to-delete'), false);
  });

  it('cleanupExpired removes old blobs by mtime and enforces size cap', () => {
    const a = store.putBlob({ id: 'old-a', contentType: 'text/plain', bodyBuffer: Buffer.alloc(1000, 0x61) });
    const b = store.putBlob({ id: 'old-b', contentType: 'text/plain', bodyBuffer: Buffer.alloc(1000, 0x62) });
    const c = store.putBlob({ id: 'fresh-c', contentType: 'text/plain', bodyBuffer: Buffer.alloc(100, 0x63) });
    assert.ok(a.id && b.id && c.id);

    const oldTime = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    for (const id of ['old-a', 'old-b']) {
      const bodyPath = path.join(tmpDir, `${id}.bin`);
      const metaPath = path.join(tmpDir, `${id}.meta.json`);
      fs.utimesSync(bodyPath, oldTime, oldTime);
      fs.utimesSync(metaPath, oldTime, oldTime);
    }

    const expired = store.cleanupExpired({ maxAgeMs: 7 * 24 * 60 * 60 * 1000 });
    assert.ok(expired.deleted.includes('old-a'));
    assert.ok(expired.deleted.includes('old-b'));
    assert.equal(store.getBlob('old-a'), null);
    assert.ok(store.getBlob('fresh-c'));

    store.putBlob({ id: 'big-1', contentType: 'application/octet-stream', bodyBuffer: Buffer.alloc(800, 1) });
    store.putBlob({ id: 'big-2', contentType: 'application/octet-stream', bodyBuffer: Buffer.alloc(800, 2) });
    const capped = store.cleanupExpired({ maxTotalBytes: 500 });
    assert.ok(capped.deleted.length >= 1);
    assert.ok(capped.remainingBytes <= 500);
  });

  it('accepts legacy putBlob(buffer, meta) form', () => {
    const put = store.putBlob(Buffer.from('legacy'), { id: 'legacy-1', contentType: 'text/plain' });
    assert.equal(put.id, 'legacy-1');
    const got = store.getBlob('legacy-1');
    assert.equal(got.body.toString('utf8'), 'legacy');
  });
});

#!/usr/bin/env node
'use strict';

/**
 * Zone worker: polls store.executionQueue and completes zone-tagged executions.
 *
 * Usage:
 *   node zone-worker.cjs
 *   API_CONSOLE_DATA_DIR=runtime/api-console npm run zone-worker -w @api-console/api
 *
 * Pair with API_CONSOLE_ZONE_WORKER=true on the API process so executeRequest enqueues work.
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { URL } = require('url');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../../../../../..');
const resolveRepositoryPath = value => (path.isAbsolute(value) ? value : path.join(REPOSITORY_ROOT, value));
const DATA_DIR = resolveRepositoryPath(process.env.API_CONSOLE_DATA_DIR || path.join('runtime', 'api-console'));
const STORE_FILE = process.env.API_CONSOLE_STORE_FILE || path.join(DATA_DIR, 'api-console-store.json');
const POLL_MS = Math.max(500, Number(process.env.API_CONSOLE_ZONE_WORKER_POLL_MS || 1500));
const RUNNER_HOST = process.env.API_CONSOLE_RUNNER_HOST || os.hostname();

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadStore() {
  if (!fs.existsSync(STORE_FILE)) {
    return {
      executions: [],
      executionQueue: [],
      zoneWorkerHeartbeat: null,
    };
  }
  return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
}

function saveStore(store) {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmp, STORE_FILE);
}

function executeTransport(transport) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(String(transport?.url || ''));
    } catch (error) {
      reject(new Error('Invalid transport URL'));
      return;
    }
    const lib = target.protocol === 'https:' ? https : http;
    const started = Date.now();
    const req = lib.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      method: String(transport.method || 'GET').toUpperCase(),
      headers: transport.headers || {},
      timeout: Number(transport.timeoutMs || 15000),
      rejectUnauthorized: transport?.tls?.verifyCertificate !== false,
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          statusCode: res.statusCode,
          statusText: res.statusMessage || '',
          headers: res.headers,
          bodyPreview: body.slice(0, 200000),
          contentType: res.headers['content-type'] || '',
          responseSize: Buffer.byteLength(body),
          durationMs: Date.now() - started,
          resolvedIpAddress: null,
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Zone worker request timed out'));
    });
    if (transport.body != null && transport.body !== '') {
      req.write(typeof transport.body === 'string' ? transport.body : JSON.stringify(transport.body));
    }
    req.end();
  });
}

async function processQueueOnce() {
  const store = loadStore();
  store.zoneWorkerHeartbeat = nowIso();
  if (!Array.isArray(store.executionQueue)) store.executionQueue = [];
  if (!Array.isArray(store.executions)) store.executions = [];

  const pending = store.executionQueue.filter(item => item.status === 'PENDING');
  for (const job of pending) {
    job.status = 'RUNNING';
    job.claimedAt = nowIso();
    job.runnerHost = RUNNER_HOST;
    saveStore(store);
    try {
      const response = await executeTransport(job.transport || {});
      const execution = {
        id: makeId('api-exec'),
        queueJobId: job.id,
        requestId: job.requestId,
        collectionId: job.collectionId,
        environmentId: job.environmentId,
        environmentName: job.environmentName,
        runnerId: job.runnerId,
        networkZone: job.networkZone,
        runnerHost: RUNNER_HOST,
        executedBy: job.executedBy,
        startedAt: job.startedAt || job.createdAt || nowIso(),
        completedAt: nowIso(),
        durationMs: response.durationMs,
        status: 'COMPLETED',
        statusCode: response.statusCode,
        responseSize: response.responseSize,
        responseContentType: response.contentType,
        requestSnapshot: job.requestSnapshot,
        response,
        tlsVerification: job.requestSnapshot?.tls?.verifyCertificate !== false,
        transportResult: response.statusCode && response.statusCode < 400 ? 'SUCCESS' : 'FAILED',
        businessResult: 'NOT_EVALUATED',
        assertionResults: [],
        scriptResults: job.preScriptResults || [],
        correlationId: makeId('api-corr'),
        evidenceType: 'ACTUAL_EXECUTION',
        businessJustification: job.businessJustification,
        zoneWorker: true,
      };
      store.executions.unshift(execution);
      store.executionQueue = store.executionQueue.filter(item => item.id !== job.id);
      store.zoneWorkerHeartbeat = nowIso();
      saveStore(store);
      console.log(`[zone-worker] completed ${job.id} -> ${execution.id} HTTP ${response.statusCode}`);
    } catch (error) {
      job.status = 'FAILED';
      job.errorCategory = 'INTERNAL_EXECUTION_ERROR';
      job.errorMessage = error.message || 'Zone worker execution failed';
      job.failedAt = nowIso();
      store.zoneWorkerHeartbeat = nowIso();
      saveStore(store);
      console.error(`[zone-worker] failed ${job.id}: ${job.errorMessage}`);
    }
  }

  if (!pending.length) saveStore(store);
}

async function main() {
  console.log(`[zone-worker] watching ${STORE_FILE} as ${RUNNER_HOST} (poll ${POLL_MS}ms)`);
  for (;;) {
    try {
      await processQueueOnce();
    } catch (error) {
      console.error('[zone-worker] loop error:', error.message || error);
    }
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  processQueueOnce,
  STORE_FILE,
};

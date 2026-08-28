#!/usr/bin/env node
'use strict';

/**
 * CLI: run an API Console collection suite (E19) or compare a contract baseline (S30.02).
 *
 * Collection run:
 *   node bin/api-console-run.cjs --collection COL_ID --cookie "sid=..." [--junit out.xml] [--json out.json]
 *
 * Contract baseline compare (CI):
 *   node bin/api-console-run.cjs --compare-baseline BASELINE_ID --cookie "sid=..." [--openapi ./spec.json] [--json out.json]
 *   Exit: 0 no breaking, 1 breaking changes, 2 usage/error
 */

const fs = require('fs');
const http = require('http');
const https = require('https');
const { URL } = require('url');

function parseArgs(argv) {
  const args = {
    base: process.env.API_CONSOLE_BASE_URL || 'http://localhost:4100',
    collection: '',
    cookie: process.env.API_CONSOLE_SESSION_COOKIE || '',
    token: process.env.API_CONSOLE_SERVICE_TOKEN || '',
    environmentId: '',
    stopOnFail: true,
    junit: '',
    json: '',
    csrf: process.env.API_CONSOLE_CSRF || '',
    compareBaseline: '',
    openapiFile: '',
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === '--base') { args.base = next; i += 1; }
    else if (key === '--collection') { args.collection = next; i += 1; }
    else if (key === '--cookie') { args.cookie = next; i += 1; }
    else if (key === '--token') { args.token = next; i += 1; }
    else if (key === '--environment') { args.environmentId = next; i += 1; }
    else if (key === '--csrf') { args.csrf = next; i += 1; }
    else if (key === '--junit') { args.junit = next; i += 1; }
    else if (key === '--json') { args.json = next; i += 1; }
    else if (key === '--compare-baseline') { args.compareBaseline = next; i += 1; }
    else if (key === '--openapi') { args.openapiFile = next; i += 1; }
    else if (key === '--no-stop-on-fail') args.stopOnFail = false;
    else if (key === '--help' || key === '-h') args.help = true;
  }
  return args;
}

function requestJson(base, method, pathName, { cookie, token, csrf, body } = {}) {
  const url = new URL(pathName, base);
  const lib = url.protocol === 'https:' ? https : http;
  const payload = body ? JSON.stringify(body) : '';
  return new Promise((resolve, reject) => {
    const req = lib.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method,
      headers: {
        accept: 'application/json',
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        ...(cookie ? { cookie } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(csrf ? { 'x-csrf-token': csrf } : {}),
      },
    }, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(Object.assign(new Error(data?.message || data?.error || `HTTP ${res.statusCode}`), { statusCode: res.statusCode, data }));
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function toJUnit(testRun) {
  const cases = (testRun.results || []).map(result => {
    const name = escapeXml(result.name || result.requestId);
    if (result.status === 'PASSED') return `<testcase classname="collection" name="${name}" time="0"/>`;
    if (result.status === 'SKIPPED') return `<testcase classname="collection" name="${name}" time="0"><skipped/></testcase>`;
    return `<testcase classname="collection" name="${name}" time="0"><failure message="${escapeXml(result.error || result.transportResult || 'FAILED')}"/></testcase>`;
  }).join('\n');
  const summary = testRun.summary || {};
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuite name="api-console-collection" tests="${summary.total || 0}" failures="${summary.failed || 0}" skipped="${summary.skipped || 0}">
${cases}
</testsuite>
`;
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function printUsage() {
  console.error(`Usage:
  Collection run:
    node bin/api-console-run.cjs --collection <id> [--base URL] [--cookie "a=b"] [--token TOKEN] [--environment ENV] [--junit out.xml] [--json out.json] [--no-stop-on-fail]

  Contract baseline compare (CI):
    node bin/api-console-run.cjs --compare-baseline <baselineId> [--openapi ./spec.json] [--base URL] [--cookie "a=b"] [--token TOKEN] [--json out.json]
    Exit: 0=no breaking, 1=breaking, 2=error`);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || (!args.collection && !args.compareBaseline)) {
    printUsage();
    process.exit(args.help ? 0 : 2);
  }
  if (!args.cookie && !args.token) {
    console.error('Provide --cookie or --token (or env API_CONSOLE_SESSION_COOKIE / API_CONSOLE_SERVICE_TOKEN).');
    process.exit(2);
  }

  try {
    if (args.compareBaseline) {
      let openapi;
      if (args.openapiFile) {
        openapi = JSON.parse(fs.readFileSync(args.openapiFile, 'utf8'));
      }
      const result = await requestJson(
        args.base,
        'POST',
        `/api/api-console/contract-baselines/${encodeURIComponent(args.compareBaseline)}/compare`,
        {
          cookie: args.cookie,
          token: args.token,
          csrf: args.csrf,
          body: { data: openapi ? { openapi } : {} },
        }
      );
      if (args.json) fs.writeFileSync(args.json, JSON.stringify(result, null, 2), 'utf8');
      const breaking = Array.isArray(result.breaking) ? result.breaking.length : 0;
      console.log(JSON.stringify({
        baselineId: result.baselineId,
        fingerprint: result.fingerprint,
        currentFingerprint: result.currentFingerprint,
        breakingCount: breaking,
        nonBreakingCount: Array.isArray(result.nonBreaking) ? result.nonBreaking.length : 0,
        breaking: result.breaking,
        nonBreaking: result.nonBreaking,
      }, null, 2));
      process.exit(breaking > 0 ? 1 : 0);
    }

    const testRun = await requestJson(args.base, 'POST', `/api/api-console/collections/${encodeURIComponent(args.collection)}/run`, {
      cookie: args.cookie,
      token: args.token,
      csrf: args.csrf,
      body: {
        options: {
          environmentId: args.environmentId || undefined,
          stopOnFail: args.stopOnFail,
        },
      },
    });
    if (args.json) fs.writeFileSync(args.json, JSON.stringify(testRun, null, 2), 'utf8');
    if (args.junit) fs.writeFileSync(args.junit, toJUnit(testRun), 'utf8');
    const failed = Number(testRun.summary?.failed || 0);
    console.log(JSON.stringify({
      testRunId: testRun.id,
      summary: testRun.summary,
      webhookDelivery: testRun.webhookDelivery || null,
    }, null, 2));
    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error(error.message || error);
    process.exit(2);
  }
}

main();

#!/usr/bin/env node
'use strict';

const {
  loadDotEnv,
  preferredWebPort,
  preferredApiPort,
  isPortFree,
  listeningPids,
  projectOwnedPidsOnPort,
  FOREIGN_DEFAULT_PORTS,
  DEFAULT_WEB_PORT,
  DEFAULT_API_PORT,
  readRuntimePorts,
} = require('./dev-ports.cjs');

loadDotEnv();

async function describe(port, label) {
  const free = await isPortFree(port);
  const all = listeningPids(port);
  const owned = projectOwnedPidsOnPort(port);
  const foreignHint = FOREIGN_DEFAULT_PORTS.has(port) ? ' (often used by other stacks)' : '';
  if (free) {
    console.log(`  ${label} :${port} — free${foreignHint}`);
    return;
  }
  console.log(
    `  ${label} :${port} — BUSY`
    + ` all=[${all.join(',') || '?'}]`
    + ` thisRepo=[${owned.join(',') || 'none'}]`
    + foreignHint,
  );
}

(async () => {
  const web = preferredWebPort();
  const api = preferredApiPort();
  console.log('API Console preferred ports');
  console.log(`  defaults: web=${DEFAULT_WEB_PORT}, api=${DEFAULT_API_PORT}`);
  console.log(`  configured: web=${web}, api=${api}`);
  await describe(web, 'WEB');
  await describe(api, 'API');
  const runtime = readRuntimePorts();
  if (runtime) {
    console.log('Last runtime assignment:', JSON.stringify(runtime));
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});

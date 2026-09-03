#!/usr/bin/env node
'use strict';

/**
 * Stop ONLY API Console listeners owned by this repo.
 * Never blindly kills shared ports used by Integrated Systems (5173, 4000, …).
 */

const { spawnSync } = require('child_process');
const {
  loadDotEnv,
  preferredWebPort,
  preferredApiPort,
  portsOwnedByThisProjectToManage,
  projectOwnedPidsOnPort,
  listeningPids,
  isThisProjectCommand,
  commandLineForPid,
  FOREIGN_DEFAULT_PORTS,
} = require('./dev-ports.cjs');

loadDotEnv();

function killPid(pid) {
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' });
    return result.status === 0;
  }
  try {
    process.kill(pid, 'SIGKILL');
    return true;
  } catch {
    return false;
  }
}

const web = preferredWebPort();
const api = preferredApiPort();
const ports = portsOwnedByThisProjectToManage();

console.log(`API Console port policy: web=${web}, api=${api}`);
console.log(`Stopping only this-repo listeners on: ${ports.join(', ')}`);

const killed = new Set();

for (const port of ports) {
  const all = listeningPids(port);
  if (!all.length) {
    console.log(`  :${port} — free`);
    continue;
  }

  const owned = projectOwnedPidsOnPort(port);
  const foreign = all.filter(pid => !owned.includes(pid));

  if (FOREIGN_DEFAULT_PORTS.has(port) && port !== web && port !== api) {
    console.log(`  :${port} — skipped (foreign default port; in use by PID ${all.join(', ')})`);
    continue;
  }

  if (!owned.length) {
    console.log(
      `  :${port} — in use by other project (PID ${all.join(', ')}); left alone`
      + (foreign.length ? ` [${foreign.map(pid => {
        const cmd = commandLineForPid(pid);
        return isThisProjectCommand(cmd) ? 'ours?' : 'foreign';
      }).join(', ')}]` : ''),
    );
    continue;
  }

  for (const pid of owned) {
    if (killed.has(pid)) continue;
    const ok = killPid(pid);
    killed.add(pid);
    console.log(`  :${port} — ${ok ? 'killed' : 'failed to kill'} this-repo PID ${pid}`);
  }
}

console.log(killed.size ? `Done. Stopped ${killed.size} API Console process(es).` : 'Done. Nothing from this repo was listening.');

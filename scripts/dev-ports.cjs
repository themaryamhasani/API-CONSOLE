'use strict';

/**
 * Port policy for API Console (keeps clear of Integrated Systems & common Vite apps).
 *
 * Reserved elsewhere (do not default here):
 * - 5173 Shell IS, 5174–5190 other Vite MFs
 * - 4000 Gateway, 3001–3016 platform services, 4010+ assessment
 * - 4173 Vite preview default
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const { execSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const PORTS_FILE = path.join(REPO_ROOT, 'runtime', 'api-console', 'dev-ports.json');

const DEFAULT_WEB_PORT = 5280;
const DEFAULT_API_PORT = 5281;
const FALLBACK_TRIES = 25;

/** Ports commonly used by sibling monorepos — never kill blindly. */
const FOREIGN_DEFAULT_PORTS = new Set([
  3000, 3001, 3002, 3003, 3010, 3011, 3012, 3014, 3015, 3016,
  4000, 4001, 4010, 4011, 4021, 4022, 4023,
  5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 5190,
  4173,
]);

function loadDotEnv(filePath = path.join(REPO_ROOT, '.env')) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

function preferredWebPort() {
  const n = Number(process.env.WEB_PORT || DEFAULT_WEB_PORT);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WEB_PORT;
}

function preferredApiPort() {
  const n = Number(process.env.API_CONSOLE_PORT || DEFAULT_API_PORT);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_API_PORT;
}

function isPortFree(port, host = '0.0.0.0') {
  return new Promise(resolve => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findFreePort(preferred, { tries = FALLBACK_TRIES, host = '0.0.0.0' } = {}) {
  const start = Number(preferred);
  if (!Number.isFinite(start) || start <= 0) {
    throw new Error(`Invalid preferred port: ${preferred}`);
  }
  for (let offset = 0; offset < tries; offset += 1) {
    const candidate = start + offset;
    // Skip well-known foreign defaults unless the user explicitly preferred that exact port.
    if (offset > 0 && FOREIGN_DEFAULT_PORTS.has(candidate)) continue;
    if (await isPortFree(candidate, host)) return candidate;
  }
  throw new Error(`No free port found near ${start} (tried ${tries} candidates).`);
}

function listeningPids(port) {
  if (process.platform === 'win32') {
    try {
      const out = execSync('netstat -ano', { encoding: 'utf8' });
      const pids = [];
      for (const line of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue;
        if (!new RegExp(`:${port}\\s+`).test(line) && !line.trim().endsWith(`:${port}`)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts[parts.length - 1]);
        if (Number.isFinite(pid) && pid > 0) pids.push(pid);
      }
      return [...new Set(pids)];
    } catch {
      return [];
    }
  }
  try {
    const out = execSync(`lsof -tiTCP:${port} -sTCP:LISTEN`, { encoding: 'utf8' });
    return [...new Set(out.split(/\s+/).map(Number).filter(pid => Number.isFinite(pid) && pid > 0))];
  } catch {
    return [];
  }
}

function commandLineForPid(pid) {
  if (process.platform === 'win32') {
    try {
      const out = execSync(
        `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"ProcessId = ${pid}\\").CommandLine"`,
        { encoding: 'utf8' },
      );
      return String(out || '').trim();
    } catch {
      return '';
    }
  }
  try {
    return execSync(`ps -p ${pid} -o args=`, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function isThisProjectCommand(commandLine) {
  const cmd = String(commandLine || '').toLowerCase().replace(/\\/g, '/');
  const root = REPO_ROOT.toLowerCase().replace(/\\/g, '/');
  return Boolean(cmd && (cmd.includes(root) || cmd.includes('/api-console/') || cmd.includes('\\api-console\\')));
}

function projectOwnedPidsOnPort(port) {
  return listeningPids(port).filter(pid => isThisProjectCommand(commandLineForPid(pid)));
}

function portsOwnedByThisProjectToManage() {
  const web = preferredWebPort();
  const api = preferredApiPort();
  // Only our configured pair + a small private bump window (auto-fallback ports).
  const managed = new Set([web, api]);
  for (let i = 1; i <= 10; i += 1) {
    managed.add(web + i);
    managed.add(api + i);
  }
  return [...managed].filter(port => {
    if (!Number.isFinite(port) || port <= 0) return false;
    if (port === web || port === api) return true;
    return !FOREIGN_DEFAULT_PORTS.has(port);
  }).sort((a, b) => a - b);
}

function writeRuntimePorts(info) {
  const dir = path.dirname(PORTS_FILE);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PORTS_FILE, `${JSON.stringify(info, null, 2)}\n`, 'utf8');
}

function readRuntimePorts() {
  try {
    if (!fs.existsSync(PORTS_FILE)) return null;
    return JSON.parse(fs.readFileSync(PORTS_FILE, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = {
  REPO_ROOT,
  PORTS_FILE,
  DEFAULT_WEB_PORT,
  DEFAULT_API_PORT,
  FOREIGN_DEFAULT_PORTS,
  loadDotEnv,
  preferredWebPort,
  preferredApiPort,
  isPortFree,
  findFreePort,
  listeningPids,
  projectOwnedPidsOnPort,
  portsOwnedByThisProjectToManage,
  isThisProjectCommand,
  commandLineForPid,
  writeRuntimePorts,
  readRuntimePorts,
};

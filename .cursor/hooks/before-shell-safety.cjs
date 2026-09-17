#!/usr/bin/env node
'use strict';

/**
 * beforeShellExecution safety gate for API Console.
 * Deny or ask on destructive / production-adjacent / IS-enable commands.
 * Reads hook JSON from stdin; writes permission JSON to stdout.
 */

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(chunks.join('')));
    process.stdin.on('error', reject);
  });
}

function reply(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function looksNonLocalDbUrl(cmd) {
  // Explicit non-local hosts in the command string
  if (/DATABASE_URL\s*=\s*['"]?postgres(ql)?:\/\/[^\s'"]+/i.test(cmd)) {
    const m = cmd.match(/DATABASE_URL\s*=\s*['"]?([^'"\s]+)/i);
    if (m) {
      const url = m[1];
      if (!/@(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/i.test(url)) {
        return true;
      }
    }
  }
  return false;
}

function classify(command) {
  const cmd = String(command || '');

  if (/API_CONSOLE_IS_ENABLED\s*=\s*true/i.test(cmd)) {
    return {
      permission: 'deny',
      user_message: 'Blocked: enabling API_CONSOLE_IS_ENABLED is frozen for v1.',
      agent_message: 'IS must stay false. Do not set API_CONSOLE_IS_ENABLED=true.',
    };
  }

  if (/\bgit\s+push\b[^\n]*\s--force\b|\bgit\s+push\b[^\n]*\s-f\b/.test(cmd)) {
    return {
      permission: 'ask',
      user_message: 'Force-push requires explicit approval.',
      agent_message: 'Hook flagged git force-push.',
    };
  }

  if (/\bgit\s+reset\s+--hard\b/.test(cmd)) {
    return {
      permission: 'ask',
      user_message: 'Hard reset is destructive. Approve only if intentional.',
      agent_message: 'Hook flagged git reset --hard.',
    };
  }

  // rm -rf outside obvious workspace-relative paths
  if (/\brm\s+(-[a-zA-Z]*f[a-zA-Z]*|--force).*(\s\/|\s~\/|\s\$HOME)/.test(cmd) || /\brm\s+-rf\s+\//.test(cmd)) {
    return {
      permission: 'deny',
      user_message: 'Blocked: recursive delete outside the project is not allowed.',
      agent_message: 'Hook denied dangerous rm -rf targeting absolute/home paths.',
    };
  }

  const migrateLike =
    /\bprisma\s+migrate\b/.test(cmd) ||
    /\bdb:migrate\b/.test(cmd) ||
    /\bmigrate:pg\b/.test(cmd) ||
    /\bmigrate:db\b/.test(cmd) ||
    /\bdb:bootstrap\b/.test(cmd);

  const composeProd =
    /\bcompose:up\b/.test(cmd) ||
    /\bdocker\s+compose\b[^\n]*--env-file\s+\.env\.production\b/.test(cmd) ||
    /\bdocker\s+compose\b[^\n]*\.env\.production\b/.test(cmd);

  if (migrateLike || composeProd) {
    if (looksNonLocalDbUrl(cmd) || /\.env\.production\b/.test(cmd) || /\bcompose:up\b/.test(cmd)) {
      // prod:local is an explicit local fallback — allow
      if (/\bprod:local\b/.test(cmd)) {
        return { permission: 'allow' };
      }
      return {
        permission: 'ask',
        user_message:
          'This looks like a migrate/compose command that may touch non-local or production-configured infra. Approve only if you intend a local/approved run.',
        agent_message:
          'Hook flagged migrate/compose with production-adjacent signals. Require human approval (deploy is human-gated).',
      };
    }
  }

  return { permission: 'allow' };
}

(async () => {
  try {
    const raw = await readStdin();
    let input = {};
    try {
      input = raw ? JSON.parse(raw) : {};
    } catch {
      reply({
        permission: 'deny',
        user_message: 'Shell safety hook received invalid JSON.',
        agent_message: 'before-shell-safety could not parse stdin JSON (failClosed).',
      });
      process.exit(0);
      return;
    }
    reply(classify(input.command || input.commandLine || ''));
    process.exit(0);
  } catch (err) {
    reply({
      permission: 'deny',
      user_message: 'Shell safety hook failed.',
      agent_message: String(err && err.message ? err.message : err),
    });
    process.exit(0);
  }
})();

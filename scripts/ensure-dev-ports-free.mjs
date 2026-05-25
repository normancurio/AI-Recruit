#!/usr/bin/env node

import { execFileSync } from 'node:child_process';

const DEFAULT_PORTS = {
  ui: 3010,
  api: 3011,
  hmr: 24679,
};

const TARGETS = {
  ui: ['ui', 'hmr'],
  api: ['api'],
  all: ['ui', 'api', 'hmr'],
};

export function getDevPorts(env = process.env, target = 'all') {
  const keys = TARGETS[target] ?? TARGETS.all;
  const values = {
    ui: env.ADMIN_UI_PORT || DEFAULT_PORTS.ui,
    api: env.PORT || DEFAULT_PORTS.api,
    hmr: env.ADMIN_UI_HMR_PORT || DEFAULT_PORTS.hmr,
  };

  return [...new Set(keys.map((key) => Number(values[key])).filter((port) => Number.isInteger(port) && port > 0))];
}

function findListeningPids(port) {
  try {
    const output = execFileSync('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    return output
      .split(/\s+/)
      .map((pid) => Number(pid))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  } catch {
    return [];
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pids, timeoutMs = 1200) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (pids.every((pid) => !isRunning(pid))) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function freePort(port) {
  const pids = findListeningPids(port);
  if (pids.length === 0) return;

  console.log(`[dev-ports] Port ${port} is in use by PID ${pids.join(', ')}. Stopping old process...`);

  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Process already exited.
    }
  }

  await waitForExit(pids);

  for (const pid of pids) {
    if (!isRunning(pid)) continue;

    try {
      process.kill(pid, 'SIGKILL');
      console.log(`[dev-ports] Force stopped PID ${pid} on port ${port}.`);
    } catch {
      // Process already exited.
    }
  }
}

function readTargetArg(argv) {
  if (argv.includes('--ui')) return 'ui';
  if (argv.includes('--api')) return 'api';
  return 'all';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = readTargetArg(process.argv.slice(2));
  const ports = getDevPorts(process.env, target);

  for (const port of ports) {
    await freePort(port);
  }
}

#!/usr/bin/env node
// Docker-only first-boot credential provisioning. A missing AUTH_TOKEN never disables auth:
// generate a cryptographically random token and persist it in the existing /data volume.
// stdout is reserved for the token (the shell entrypoint exports it); notices go to stderr.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dataDir = path.resolve(process.env.DATA_DIR || '/data');
const file = path.join(dataDir, '.jgo-auth-token');

try {
  if (process.env.AUTH_TOKEN) {
    if (process.env.AUTH_TOKEN.length < 16) throw new Error('AUTH_TOKEN must be at least 16 characters');
    process.stdout.write(process.env.AUTH_TOKEN);
    process.exit(0);
  }

  fs.mkdirSync(dataDir, { recursive: true });
  let created = false;
  try {
    // O_EXCL avoids clobbering an existing credential on concurrent starts.
    const fd = fs.openSync(file, 'wx', 0o600);
    created = true;
    try {
      fs.writeSync(fd, crypto.randomBytes(32).toString('hex') + '\n');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }

  const st = fs.lstatSync(file);
  if (!st.isFile() || (st.mode & 0o077) !== 0) {
    throw new Error(`Unsafe token file at ${file}: expected a regular file readable only by its owner`);
  }
  const token = fs.readFileSync(file, 'utf8').trim();
  if (!/^[a-f0-9]{64}$/.test(token)) {
    throw new Error(`Invalid token file at ${file}: do not delete it while an installation is in use`);
  }

  if (created) {
    // Only the initial startup logs the token. Keep Docker logs private.
    process.stderr.write(`[JGO] First-run login token: ${token}\n[JGO] Token saved at ${file} (0600). Keep container logs private.\n`);
  } else {
    process.stderr.write(`[JGO] Using persistent login token from ${file}. To retrieve it: docker compose exec app cat ${file}\n`);
  }
  process.stdout.write(token);
} catch (e) {
  process.stderr.write(`[JGO] Cannot provision login token: ${e.message}\n`);
  process.exit(1);
}

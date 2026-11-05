'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

async function profiles() {
  return (await fs.readdir(os.tmpdir())).filter(name => /^aurora-private-[A-Za-z0-9]{6}$/.test(name));
}

(async () => {
  const before = new Set(await profiles());
  const installedBinary = process.argv[2];
  const binary = installedBinary ? path.resolve(installedBinary) : require('electron');
  const child = spawn(binary, installedBinary ? [] : [__dirname], {
    windowsHide: false, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AURORA_SMOKE_TEST: '1' }
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill(), 60000);
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', resolve);
  }).finally(() => clearTimeout(timer));
  assert.equal(exitCode, 0, stderr || stdout || 'Browser did not exit successfully.');
  assert.match(stdout, /Aurora smoke passed/);
  let remaining = [];
  for (let attempt = 0; attempt < 60; attempt++) {
    remaining = (await profiles()).filter(name => !before.has(name));
    if (!remaining.length) break;
    await delay(250);
  }
  assert.deepEqual(remaining, [], 'Temporary profiles must disappear after the browser exits.');
  console.log(stdout.trim());
  console.log('Aurora exit cleanup passed: no temporary profile remains.');
})().catch(error => { console.error(error); process.exitCode = 1; });

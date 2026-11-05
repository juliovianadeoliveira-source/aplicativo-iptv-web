'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const helper = path.resolve(__dirname, '../desktop/profile-cleanup.cjs');
const { cleanupStaleProfiles } = require(helper);

test('cleanup refuses a directory that is not an Aurora profile', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-unrelated-'));
  const sentinel = path.join(folder, 'keep.txt');
  fs.writeFileSync(sentinel, 'keep');
  try {
    const result = spawnSync(process.execPath, [helper, '2147483647', folder]);
    assert.notEqual(result.status, 0);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});

test('profile survives while its owner runs and is removed after a forced exit', { timeout: 25000 }, async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-private-'));
  const sentinel = path.join(folder, 'session-data.txt');
  fs.writeFileSync(sentinel, 'test session');
  const source = `require(process.argv[2]).startProfileCleanup(process.argv[1]).then(() => {
    console.log('ready'); setInterval(() => {}, 1000);
  }).catch(error => { console.error(error); process.exit(1); });`;
  const parent = spawn(process.execPath, ['-e', source, folder, helper], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Cleanup helper did not become ready.')), 12000);
      parent.stdout.on('data', chunk => {
        output += chunk;
        if (output.includes('ready')) { clearTimeout(timer); resolve(); }
      });
      parent.once('error', error => { clearTimeout(timer); reject(error); });
      parent.once('exit', code => { clearTimeout(timer); reject(new Error('Owner exited early: ' + code)); });
    });
    await delay(300);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'test session');
    const exited = new Promise(resolve => parent.once('close', resolve));
    parent.kill('SIGKILL'); await exited;
    for (let attempt = 0; attempt < 60 && fs.existsSync(folder); attempt++) await delay(200);
    assert.equal(fs.existsSync(folder), false, 'A detached helper must remove the exited owner profile.');
  } finally {
    if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL');
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('startup removes marked stale profiles and preserves profiles owned by a live process', async () => {
  const stale = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-private-'));
  const active = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-private-'));
  const unmarked = fs.mkdtempSync(path.join(os.tmpdir(), 'aurora-private-'));
  for (const [folder, pid] of [[stale, 2147483647], [active, process.pid]]) {
    fs.writeFileSync(path.join(folder, '.aurora-profile-owner.json'), JSON.stringify({ kind: 'aurora-private-profile-v1', pid }));
  }
  try {
    await cleanupStaleProfiles();
    assert.equal(fs.existsSync(stale), false);
    assert.equal(fs.existsSync(active), true);
    assert.equal(fs.existsSync(unmarked), true);
  } finally {
    for (const folder of [stale, active, unmarked]) fs.rmSync(folder, { recursive: true, force: true });
  }
});

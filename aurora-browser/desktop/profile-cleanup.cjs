'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const PROFILE_NAME = /^aurora-private-[A-Za-z0-9]{6}$/;
const MARKER = '.aurora-profile-owner.json';

function profilePath(value) {
  if (typeof value !== 'string') throw new Error('Invalid temporary profile.');
  const resolved = path.resolve(value);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !PROFILE_NAME.test(path.basename(resolved))) {
    throw new Error('Refusing to remove a directory outside Aurora temporary profiles.');
  }
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid profile directory.');
  }
  return resolved;
}

function processAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

async function removeProfile(value) {
  const target = profilePath(value);
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      return;
    } catch (error) {
      if (!['EBUSY', 'EPERM', 'ENOTEMPTY', 'EACCES'].includes(error.code) || attempt === 39) throw error;
      await delay(250);
    }
  }
}

async function cleanupStaleProfiles(current) {
  for (const entry of await fs.promises.readdir(os.tmpdir(), { withFileTypes: true })) {
    if (!entry.isDirectory() || !PROFILE_NAME.test(entry.name)) continue;
    const candidate = path.join(os.tmpdir(), entry.name);
    if (candidate === current) continue;
    try {
      profilePath(candidate);
      const markerPath = path.join(candidate, MARKER);
      const markerStat = await fs.promises.lstat(markerPath);
      if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.size > 4096) continue;
      const owner = JSON.parse(await fs.promises.readFile(markerPath, 'utf8'));
      if (owner.kind !== 'aurora-private-profile-v1' || !Number.isSafeInteger(owner.pid) || owner.pid <= 0) continue;
      if (!processAlive(owner.pid)) await removeProfile(candidate);
    } catch { /* Unknown or busy profiles are left untouched. */ }
  }
}

async function startProfileCleanup(value) {
  const target = profilePath(value);
  await fs.promises.writeFile(path.join(target, MARKER), JSON.stringify({
    kind: 'aurora-private-profile-v1', pid: process.pid
  }), { flag: 'wx' });
  await cleanupStaleProfiles(target);
  let executable = process.execPath;
  let args = [__filename, String(process.pid), target];
  let launcherScript;
  if (process.platform === 'win32') {
    // Let a short-lived launcher own the helper so Electron can finish shutting down.
    const literal = value => "'" + value.replaceAll("'", "''") + "'";
    const commandLine = [process.execPath, ...args].map(value => '"' + value + '"').join(' ');
    executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    launcherScript = `$ErrorActionPreference = 'Stop'
$environment = [string[]]([Environment]::GetEnvironmentVariables('Process').GetEnumerator() | Sort-Object Key | ForEach-Object { $_.Key + '=' + $_.Value })
$startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0; CreateFlags = [uint32]1024; EnvironmentVariables = $environment }
$result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${literal(commandLine)}; CurrentDirectory = ${literal(path.dirname(process.execPath))}; ProcessStartupInformation = $startup }
if ($result.ReturnValue -ne 0) { exit 1 }
`;
    args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'];
  }
  const worker = spawn(executable, args, {
    detached: !launcherScript, windowsHide: true, stdio: launcherScript ? ['pipe', 'ignore', 'ignore'] : 'ignore',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ELECTRON_NO_ATTACH_CONSOLE: '1' }
  });
  let failure;
  worker.once('error', error => { failure = error; });
  if (launcherScript) {
    worker.stdin.once('error', error => { failure = error; });
    worker.stdin.end(launcherScript + '\n');
  }
  worker.unref();
  const readyFile = path.join(target, '.aurora-cleanup-ready');
  for (let attempt = 0; attempt < 100; attempt++) {
    if (failure) throw failure;
    if ((worker.exitCode !== null && worker.exitCode !== 0) || worker.signalCode !== null) throw new Error('Temporary profile cleanup exited before starting.');
    try {
      if (await fs.promises.readFile(readyFile, 'utf8') === String(process.pid)) {
        await fs.promises.unlink(readyFile); return;
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await delay(100);
  }
  worker.kill();
  throw new Error('Temporary profile cleanup did not start.');
}

async function watchParent(pid, target) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid === process.pid) throw new Error('Invalid parent process.');
  profilePath(target);
  await fs.promises.writeFile(path.join(target, '.aurora-cleanup-ready'), String(pid), { flag: 'wx' });
  while (processAlive(pid)) await delay(250);
  await removeProfile(target);
}

if (require.main === module) {
  watchParent(Number(process.argv[2]), process.argv[3]).catch(() => { process.exitCode = 1; });
}
module.exports = { startProfileCleanup, cleanupStaleProfiles };

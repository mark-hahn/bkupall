const { spawn } = require('child_process');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const RESTIC_REPO = '/mnt/media/backup/sys-bkup-restic';
const RESTIC_PASSWORD_FILE = '/root/dev/apps/bkupall/restic-cred.txt';

function runCmd(cmd, args, options = {}) {
  return new Promise((resolve) => {
    const chunks = [];
    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: options.env || process.env,
    });

    proc.stdout.on('data', (d) => {
      process.stdout.write(d);
      chunks.push(d.toString());
    });

    proc.stderr.on('data', (d) => {
      process.stderr.write(d);
      chunks.push(d.toString());
    });

    proc.on('error', (err) => resolve({ code: -1, output: err.message }));
    proc.on('close', (code) => resolve({ code, output: chunks.join('') }));
  });
}

function ts() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Los_Angeles' });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getNextBackupTime() {
  const now = new Date();
  const hours = now.getHours();
  
  if (hours < 7) return '7am';
  if (hours < 13) return '1pm';
  if (hours < 19) return '7pm';
  return '7am (tomorrow)';
}

function isProcessRunning(name) {
  try {
    const pids = execSync(`pgrep -x ${name}`, { encoding: 'utf8' }).trim();
    return pids.length > 1;
  } catch (_) {
    return false;
  }
}

function parseProcEnv(text) {
  const env = {};
  for (const entry of text.split('\0')) {
    if (!entry) continue;
    const idx = entry.indexOf('=');
    if (idx === -1) continue;
    env[entry.slice(0, idx)] = entry.slice(idx + 1);
  }
  return env;
}

function getResticRepoFromArgs(args, env) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];

    if ((arg === '-r' || arg === '--repo' || arg === '--repository') && args[i + 1]) {
      return args[i + 1];
    }

    if (arg.startsWith('--repo=')) {
      return arg.slice('--repo='.length);
    }

    if (arg.startsWith('--repository=')) {
      return arg.slice('--repository='.length);
    }
  }

  return env.RESTIC_REPOSITORY || '';
}

function isResticWriterCommand(args) {
  const writeCommands = new Set([
    'backup',
    'copy',
    'forget',
    'init',
    'key',
    'migrate',
    'prune',
    'rewrite',
    'tag',
  ]);

  if (!args.includes('restic')) {
    return false;
  }

  for (const arg of args) {
    if (writeCommands.has(arg)) {
      return true;
    }
  }

  return false;
}

function getResticWritersOnBackupDisk() {
  const writers = [];

  for (const entry of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;

    const procDir = path.join('/proc', entry);

    try {
      const cmdline = fs.readFileSync(path.join(procDir, 'cmdline'), 'utf8');
      if (!cmdline) continue;

      const args = cmdline.split('\0').filter(Boolean);
      if (!isResticWriterCommand(args)) continue;

      const envText = fs.readFileSync(path.join(procDir, 'environ'), 'utf8');
      const env = parseProcEnv(envText);
      const repo = getResticRepoFromArgs(args, env);

      if (!repo.startsWith('/mnt/media/')) continue;

      writers.push({ pid: entry, repo, cmd: args.join(' ') });
    } catch (_) {
      // Process exited or is unreadable between listing and inspection.
    }
  }

  return writers;
}

async function waitForBackupDiskIdle(log, timeoutMinutes = 120, onDelayCallback = null) {
  const pollMs = 30 * 1000;
  const timeoutMs = timeoutMinutes * 60 * 1000;
  const startTime = Date.now();
  let waited = false;

  while (true) {
    const rsyncRunning = isProcessRunning('rsync');
    const resticWriters = getResticWritersOnBackupDisk();
    const resticRunning = resticWriters.length > 0;

    if (!rsyncRunning && !resticRunning) {
      if (waited) {
        log(`\n---- wait complete: backup disk is idle\n${ts()}`);
      }
      return { status: 'idle' };
    }

    // Check if timeout expired
    if (Date.now() - startTime >= timeoutMs) {
      const running = [];
      if (rsyncRunning) running.push('rsync');
      if (resticRunning) {
        const repos = [...new Set(resticWriters.map((writer) => writer.repo))].join(', ');
        running.push(`restic writing to ${repos}`);
      }
      log(`\n---- timeout expired: ${running.join(' and ')} still running after ${timeoutMinutes} minutes`);
      return { status: 'timeout', util: running.join(' and ') };
    }

    const running = [];
    const utils = [];
    if (rsyncRunning) {
      running.push('rsync');
      utils.push('rsync');
    }
    if (resticRunning) {
      const repos = [...new Set(resticWriters.map((writer) => writer.repo))].join(', ');
      running.push(`restic writing to ${repos}`);
      utils.push('restic');
    }

    if (!waited) {
      log(`====== Backup DELAYED - ${utils.join(' and ')} running ======\n${ts()}`);
      waited = true;
      // Notify about delay via callback if provided
      if (onDelayCallback) {
        await onDelayCallback(utils.join(' and '));
      }
    } else {
      log(`\n---- waiting: ${running.join(' and ')} still running; retrying in 30s`);
    }

    await delay(pollMs);
  }
}

function getResticEnv() {
  const env = {
    ...process.env,
    RESTIC_REPOSITORY: RESTIC_REPO,
    RESTIC_PASSWORD_FILE,
  };

  if (!fs.existsSync(RESTIC_PASSWORD_FILE)) {
    return {
      error: `restic credential file is missing: ${RESTIC_PASSWORD_FILE}`,
    };
  }

  return { env };
}

async function ensureResticRepo(log, lines) {
  const { env, error } = getResticEnv();
  if (error) {
    log(`ERROR: ${error}`);
    return { ok: false, reason: error };
  }

  if (fs.existsSync(path.join(RESTIC_REPO, 'config'))) {
    return { ok: true, env };
  }

  fs.mkdirSync(path.dirname(RESTIC_REPO), { recursive: true });

  log(`\n------ Initializing restic repo ------\n${ts()}`);
  const init = await runCmd('restic', ['init'], { env });
  lines.push(init.output);

  if (init.code !== 0) {
    const reason = `Restic repo init failed (exit code ${init.code})`;
    log(`ERROR: ${reason}`);
    return { ok: false, reason };
  }

  return { ok: true, env };
}

async function runResticBackup(name, sources, extraArgs, env, log, lines) {
  log(`\n------ Backing up ${name} ------\n${ts()}`);
  const result = await runCmd('nice', [
    '-n', '20', 'restic', 'backup',
    ...sources,
    '--one-file-system',
    '--tag', name,
    ...extraArgs,
  ], { env });
  lines.push(result.output);
  return result;
}

async function runBackup(onDelayCallback = null) {
  const lines = [];
  const log = (msg) => { console.log(msg); lines.push(msg); };

  // Check for blocked conditions first
  if (fs.existsSync('/mnt/media/nomount')) {
    const nextBackup = getNextBackupTime();
    log(`====== Backup BLOCKED - media drive not mounted ======\n${ts()}\nNext backup is at ${nextBackup}`);
    return { status: 'blocked', output: lines.join('\n'), reason: 'media drive not mounted', drive: 'media' };
  }

  if (fs.existsSync('/mnt/m-bkup/nomount')) {
    const nextBackup = getNextBackupTime();
    log(`====== Backup BLOCKED - m-bkup drive not mounted ======\n${ts()}\nNext backup is at ${nextBackup}`);
    return { status: 'blocked', output: lines.join('\n'), reason: 'm-bkup drive not mounted', drive: 'm-bkup' };
  }

  // Check if backup disk is idle or needs to wait
  const idleResult = await waitForBackupDiskIdle(log, 120, onDelayCallback);
  
  if (idleResult.status === 'timeout') {
    const nextBackup = getNextBackupTime();
    log(`====== Backup BLOCKED - timeout expired ======\n${ts()}\nNext backup is at ${nextBackup}`);
    return { status: 'timeout', output: lines.join('\n'), util: idleResult.util };
  }

  // Backup is starting
  const startTime = Date.now();
  log(`\n\n======== Backup starting =======\n${ts()}`);

  const errors = [];

  log(`\n------ Backing up media ------\n${ts()}`);
  const media = await runCmd('nice', [
    '-n', '20', 'rsync', '-a', '--stats', '--delete', '--force', '/mnt/media/', '/mnt/m-bkup',
  ]);
  lines.push(media.output);
  if (media.code === 24) {
    log('Note: some media files vanished before transfer (e.g. temp files)');
  } else if (media.code !== 0) {
    const err = `Media backup failed (exit code ${media.code})`;
    log(`ERROR: ${err}`);
    errors.push(err);
  }

  const repo = await ensureResticRepo(log, lines);
  if (!repo.ok) {
    errors.push(repo.reason);
  } else {
    const sys = await runResticBackup('sys', ['/'], [
      '--exclude=/boot',
      '--exclude=/root/archive',
      '--exclude=/swap.img',
      '--exclude=/var/lib/docker',
      '--exclude=/dev',
      '--exclude=/proc',
      '--exclude=/sys',
      '--exclude=/tmp',
      '--exclude=/run',
      '--exclude=/mnt',
      '--exclude=/lost+found',
      '--exclude=/lib/modules',
      '--exclude=/var/lib/emby/transcoding-temp',
      '--exclude=/var/lib/lxcfs',
      '--exclude=/usr/src',
    ], repo.env, log, lines);
    if (sys.code !== 0) {
      const err = `System backup failed (exit code ${sys.code})`;
      log(`ERROR: ${err}`);
      errors.push(err);
    }

    const boot = await runResticBackup('boot', ['/boot'], [], repo.env, log, lines);
    if (boot.code !== 0) {
      const err = `Boot backup failed (exit code ${boot.code})`;
      log(`ERROR: ${err}`);
      errors.push(err);
    }

    const efi = await runResticBackup('boot-efi', ['/boot/efi'], [], repo.env, log, lines);
    if (efi.code !== 0) {
      const err = `EFI backup failed (exit code ${efi.code})`;
      log(`ERROR: ${err}`);
      errors.push(err);
    }
  }

  log(`\n------ Backing up usb ------\n${ts()}`);
  const usb = await runCmd('nice', [
     'rsync', '-a', '--stats', '--delete', '--force', '--exclude', 'files',
     '--exclude', '.proot/ubuntu-24.04/',
    'xobtlu@xobtlu.baron.usbx.me:/home/xobtlu/', '/mnt/media/backup/usb',
  ]);
  lines.push(usb.output);
  if (usb.code === 23) {
    log('Note: some usb files skipped due to permissions (expected on shared server)');
  } else if (usb.code !== 0) {
    const err = `USB backup failed (exit code ${usb.code})`;
    log(`ERROR: ${err}`);
    errors.push(err);
  }

  log(`\n====== Backup finished ======\n${ts()}`);

  const endTime = Date.now();
  const durationMinutes = Math.round((endTime - startTime) / 60000);

  if (errors.length > 0) {
    log(`\n⚠️  ERRORS: ${errors.length} backup(s) failed`);
    return { status: 'error', success: false, output: lines.join('\n'), reason: errors.join('; '), durationMinutes };
  }

  return { status: 'success', success: true, output: lines.join('\n'), durationMinutes };
}

module.exports = { runBackup };
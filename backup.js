const { spawn } = require('child_process');
const { execSync } = require('child_process');
const fs = require('fs');

function runCmd(cmd, args) {
  return new Promise((resolve) => {
    const chunks = [];
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', (d) => { process.stdout.write(d); chunks.push(d.toString()); });
    proc.stderr.on('data', (d) => { process.stderr.write(d); chunks.push(d.toString()); });
    proc.on('close', (code) => resolve({ code, output: chunks.join('') }));
  });
}

function ts() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'America/Los_Angeles' });
}

async function runBackup() {
  const lines = [];
  const log = (msg) => { console.log(msg); lines.push(msg); };

  log(`\n\n======== Backup starting =======\n${ts()}`);

  if (fs.existsSync('/mnt/media/nomount')) {
    log('\n---- canceled: media drive is not mounted');
    log(`\n====== Backup finished ======\n${ts()}`);
    return { success: false, output: lines.join('\n'), reason: 'media drive is not mounted' };
  }

  if (fs.existsSync('/mnt/m-bkup/nomount')) {
    log('\n---- canceled: m-bkup drive is not mounted');
    log(`\n====== Backup finished ======\n${ts()}`);
    return { success: false, output: lines.join('\n'), reason: 'm-bkup drive is not mounted' };
  }

  let rsyncRunning = false;
  try {
    const pids = execSync('pgrep -x rsync', { encoding: 'utf8' }).trim();
    if (pids.length > 1) rsyncRunning = true;
  } catch (_) { /* rsync not running */ }

  if (rsyncRunning) {
    log('\n---- canceled: rsync is running');
    log(`\n====== Backup finished ======\n${ts()}`);
    return { success: false, output: lines.join('\n'), reason: 'rsync is running' };
  }

  log('\nBackup all started successfully.');

  log(`\n------ Backing up media ------\n${ts()}`);
  const media = await runCmd('nice', [
    '-n', '20', 'rsync', '-a', '--stats', '--delete', '--force', '/mnt/media/', '/mnt/m-bkup',
  ]);
  lines.push(media.output);

  log(`\n------ Backing up sys ------\n${ts()}`);
  const sys = await runCmd('nice', [
    '-n', '20', 'rsync', '-a', '--stats', '--delete', '--force', '--one-file-system',
    '--exclude=/root/archive/',
    '--exclude=/dev/',
    '--exclude=/proc/',
    '--exclude=/sys/',
    '--exclude=/tmp/',
    '--exclude=/run/',
    '--exclude=/mnt/',
    '--exclude=/lost+found',
    '--exclude=/lib/modules',
    '--exclude=/var/lib/emby/transcoding-temp',
    '--exclude=/var/lib/lxcfs',
    '--exclude=/usr/src/',
    '/', '/mnt/media/backup/sys-bkup',
  ]);
  lines.push(sys.output);

  log(`\n------ Backing up usb ------\n${ts()}`);
  const usb = await runCmd('nice', [
    'rsync', '-a', '--delete', '--force', '--exclude', 'files',
    'xobtlu@oracle.usbx.me:/home/xobtlu/', '/mnt/media/backup/usb',
  ]);
  lines.push(usb.output);
  if (usb.code === 23) {
    log('Note: some usb files skipped due to permissions (expected on shared server)');
  }

  log(`\n====== Backup finished ======\n${ts()}`);

  return { success: true, output: lines.join('\n') };
}

module.exports = { runBackup };

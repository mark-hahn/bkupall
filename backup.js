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

  const errors = [];

  log(`\n------ Backing up media ------\n${ts()}`);
  const media = await runCmd('nice', [
    '-n', '20', 'rsync', '-a', '--stats', '--delete', '--force', '--inplace', '/mnt/media/', '/mnt/m-bkup',
  ]);
  lines.push(media.output);
  if (media.code !== 0) {
    const err = `Media backup failed (exit code ${media.code})`;
    log(`ERROR: ${err}`);
    errors.push(err);
  }

  log(`\n------ Backing up sys ------\n${ts()}`);
  const sys = await runCmd('nice', [
    '-n', '20', 'rsync', '-a', '--stats', '--delete', '--force', '--one-file-system',
    '--exclude=/root/archive/',
    '--exclude=/swap.img',
    '--exclude=/var/lib/docker/',
    '--exclude=/dev/*',
    '--exclude=/proc/*',
    '--exclude=/sys/*',
    '--exclude=/tmp/*',
    '--exclude=/run/*',
    '--exclude=/mnt/*',
    '--exclude=/lost+found',
    '--exclude=/lib/modules',
    '--exclude=/var/lib/emby/transcoding-temp',
    '--exclude=/var/lib/lxcfs',
    '--exclude=/usr/src/',
    '/', '/mnt/media/backup/sys-bkup',
  ]);
  lines.push(sys.output);
  if (sys.code === 24) {
    log('Note: some sys files vanished before transfer (e.g. temp files)');
  } else if (sys.code !== 0) {
    const err = `System backup failed (exit code ${sys.code})`;
    log(`ERROR: ${err}`);
    errors.push(err);
  }

  log(`\n------ Backing up boot ------\n${ts()}`);
  const boot = await runCmd('nice', [
    '-n', '20', 'rsync', '-a', '--stats', '--delete', '--force', '--one-file-system',
    '/boot/', '/mnt/media/backup/sys-bkup/boot',
  ]);
  lines.push(boot.output);
  if (boot.code !== 0) {
    const err = `Boot backup failed (exit code ${boot.code})`;
    log(`ERROR: ${err}`);
    errors.push(err);
  }

  log(`\n------ Backing up boot/efi ------\n${ts()}`);
  const efi = await runCmd('nice', [
    '-n', '20', 'rsync', '-a', '--stats', '--delete', '--force',
    '/boot/efi/', '/mnt/media/backup/sys-bkup/boot/efi',
  ]);
  lines.push(efi.output);
  if (efi.code !== 0) {
    const err = `EFI backup failed (exit code ${efi.code})`;
    log(`ERROR: ${err}`);
    errors.push(err);
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

  if (errors.length > 0) {
    log(`\n⚠️  ERRORS: ${errors.length} backup(s) failed`);
    return { success: false, output: lines.join('\n'), reason: errors.join('; ') };
  }

  return { success: true, output: lines.join('\n') };
}

module.exports = { runBackup };

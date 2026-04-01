const cron     = require('node-cron');
const { runBackup }            = require('./backup');
const { sendMail }             = require('./mailer');
const { isStopped, shouldSendStopEmail, updateLastStopEmail, readState } = require('./state');

console.log(`bkupall daemon started at ${new Date().toISOString()}`);

async function doBackup() {
  if (isStopped()) {
    console.log('Backup skipped: bkupall is stopped');
    return;
  }

  console.log('Starting scheduled backup...');
  const result = await runBackup();

  const subject = result.success
    ? 'bkupall: Backup completed successfully'
    : `bkupall: Backup canceled - ${result.reason}`;

  await sendMail(subject, result.output);
}

async function checkStopped() {
  if (shouldSendStopEmail()) {
    const state = readState();
    const stoppedAt = state.stoppedAt ? new Date(state.stoppedAt).toISOString() : 'unknown';
    await sendMail(
      'bkupall: Backups are STOPPED',
      `bkupall has been stopped since ${stoppedAt}.\n\nRun "bkupall start" to resume backups.`
    );
    updateLastStopEmail();
  }
}

// Run backup at midnight and every 6 hours: 00:00, 06:00, 12:00, 18:00
cron.schedule('0 0,6,12,18 * * *', doBackup);

// Check stopped status every 2 hours to send reminder emails
cron.schedule('0 */2 * * *', checkStopped);

// Keep process alive
process.on('SIGTERM', () => {
  console.log('bkupall daemon shutting down');
  process.exit(0);
});

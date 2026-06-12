const cron     = require('node-cron');
const { runBackup }            = require('./restic-bkup');
const { sendMail }             = require('./mailer');
const { isStopped, shouldSendStopEmail, updateLastStopEmail, readState } = require('./state');

console.log(`bkupall daemon started at ${new Date().toLocaleString('sv-SE', { timeZone: 'America/Los_Angeles' })}`);

async function doBackup() {
  if (isStopped()) {
    console.log('Backup skipped: bkupall is stopped');
    return;
  }

  console.log('Starting scheduled backup...');
  const result = await runBackup();

  const subject = result.success
    ? 'bkupall: Backup completed successfully'
    : `bkupall: Backup ERROR - ${result.reason}`;

  const summary = result.success
    ? '\n\n✅ Overall result: SUCCESS'
    : `\n\n❌ Overall result: FAILED — ${result.reason}`;

  await sendMail(subject, result.output + summary);
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

// Run backup at 7am, 1pm, and 7pm
cron.schedule('0 7,13,19 * * *', doBackup);

// Check stopped status every 2 hours to send reminder emails
cron.schedule('0 */2 * * *', checkStopped);

// Keep process alive
process.on('SIGTERM', () => {
  console.log('bkupall daemon shutting down');
  process.exit(0);
});

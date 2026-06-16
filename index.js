const cron     = require('node-cron');
const { runBackup }            = require('./restic-bkup');
const { sendMail }             = require('./mailer');
const { isStopped, shouldSendStopEmail, updateLastStopEmail, readState } = require('./state');

console.log(`bkupall daemon started at ${new Date().toLocaleString('sv-SE', { timeZone: 'America/Los_Angeles' })}`);

async function doBackup() {
  if (isStopped()) {
    const timestamp = new Date().toLocaleString('sv-SE', { timeZone: 'America/Los_Angeles' });
    const state = readState();
    const stoppedAt = state.stoppedAt ? new Date(state.stoppedAt).toLocaleString('sv-SE', { timeZone: 'America/Los_Angeles' }) : 'unknown';
    
    const reason = 'backups are stopped';
    const logMessage = `Backup blocked: ${reason}\nStopped at: ${stoppedAt}\nAttempted at: ${timestamp}`;
    console.log(logMessage);
    
    await sendMail(
      `bkupall: Backup BLOCKED - ${reason}`,
      `A scheduled backup was blocked.\n\nReason: ${reason}\nStopped at: ${stoppedAt}\nAttempted at: ${timestamp}\n\nRun "bkupall start" to resume backups.`
    );
    return;
  }

  console.log('Starting scheduled backup...');
  
  let delayEmailSent = false;
  const onDelayCallback = async (util) => {
    if (!delayEmailSent) {
      await sendMail(
        `bkupall: Backup DELAYED - ${util} running`,
        `Backup is delayed because ${util} is running. Waiting up to 120 minutes...`
      );
      delayEmailSent = true;
    }
  };
  
  const result = await runBackup(onDelayCallback);

  // Handle different backup statuses
  if (result.status === 'blocked') {
    await sendMail(
      `bkupall: Backup BLOCKED - ${result.drive} drive not mounted`,
      result.output
    );
    return;
  }

  if (result.status === 'timeout') {
    await sendMail(
      'bkupall: Backup BLOCKED - timeout expired',
      result.output
    );
    return;
  }

  // If we had a delay but backup started successfully
  if (delayEmailSent && (result.status === 'success' || result.status === 'error')) {
    await sendMail('bkupall: Backup started', 'Backup started after waiting for processes to complete.');
  }

  // Normal success/error handling
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

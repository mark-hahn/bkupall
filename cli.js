#!/usr/bin/env node

const { stop, resume, readState } = require('./state');
const { sendMail } = require('./mailer');

const arg = process.argv[2];

async function main() {
  if (!arg) {
    const state = readState();
    console.log(`bkupall status: ${state.status}`);
    if (state.stoppedAt) {
      console.log(`Stopped at: ${new Date(state.stoppedAt).toISOString()}`);
    }
    console.log('\nUsage: bkupall <stop|start|restart|resume>');
    return;
  }

  switch (arg.toLowerCase()) {
    case 'stop': {
      stop();
      console.log('bkupall: backups stopped. Will email every 2 hours until resumed.');
      await sendMail(
        'bkupall: Backups have been STOPPED',
        'bkupall backups have been manually stopped.\n\nRun "bkupall start" to resume.'
      );
      break;
    }

    case 'start':
    case 'restart':
    case 'resume': {
      resume();
      console.log('bkupall: backups resumed.');
      await sendMail(
        'bkupall: Backups RESUMED',
        'bkupall backups have been manually resumed and will run on schedule.'
      );
      break;
    }

    default:
      console.error(`Unknown option: ${arg}`);
      console.error('Usage: bkupall <stop|start|restart|resume>');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

const fs   = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'state.json');

const DEFAULT_STATE = { status: 'running', stoppedAt: null, lastStopEmailAt: null };

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch (_) {
    return { ...DEFAULT_STATE };
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function isStopped() {
  return readState().status === 'stopped';
}

function stop() {
  const state = readState();
  state.status        = 'stopped';
  state.stoppedAt     = Date.now();
  state.lastStopEmailAt = null;
  writeState(state);
}

function resume() {
  const state = readState();
  state.status          = 'running';
  state.stoppedAt       = null;
  state.lastStopEmailAt = null;
  writeState(state);
}

function updateLastStopEmail() {
  const state = readState();
  state.lastStopEmailAt = Date.now();
  writeState(state);
}

function shouldSendStopEmail() {
  const state = readState();
  if (state.status !== 'stopped') return false;
  if (!state.lastStopEmailAt) return true;
  const twoHours = 2 * 60 * 60 * 1000;
  return (Date.now() - state.lastStopEmailAt) >= twoHours;
}

module.exports = { readState, writeState, isStopped, stop, resume, updateLastStopEmail, shouldSendStopEmail };

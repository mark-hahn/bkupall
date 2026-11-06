# bkupall architecture

## Layout

| File | Role |
|---|---|
| `index.js` | pm2 daemon (`bkupall`). Two node-cron jobs: backups `0 7,13,19 * * *`, stop reminders `0 */2 * * *`. Builds and sends the result email. |
| `restic-bkup.js` | One backup run: `runBackup(onDelay, onStart)`. |
| `state.js` / `state.json` | Stop/resume flag plus `stoppedAt` / `lastStopEmailAt` (epoch ms). Read on every tick, so `bkupall stop` takes effect without a restart. |
| `cli.js` | The global `bkupall` command (status / stop / start). |
| `mailer.js` | Mailtrap send. The token is in `/root/dev/apps/mailit/mailtrap-token.txt`. Never throws; it logs `Email sent:` / `Email failed:`. |
| `backup.js` | Old all-rsync version. Nothing loads it. |
| `restore/`, `restore-mlap/` | Bash scripts to list and mount snapshots of the `sys` repo and the laptop repo (`/mnt/media/backup/mlap`, host `mlap3`, tag `automated`). The two `mount` scripts are near-copies; change both together. |
| `restic-debug.md` | How to inspect the repo read-only (`--no-lock`). |

## Backup flow

cron tick → `doBackup`. If stopped, it sends a BLOCKED email. Otherwise `runBackup`:
1. Checks the `nomount` markers on `/mnt/media` and `/mnt/m-bkup` (→ `blocked`).
2. `waitForBackupDiskIdle`: polls every 30 s for `rsync`, or a restic writer whose repo is under `/mnt/media/` (found by scanning `/proc/*/cmdline` and `environ`). After 120 min → `timeout`.
3. rsync `/mnt/media/` → `/mnt/m-bkup`.
4. restic `sys`, `boot`, `boot-efi` into `/mnt/media/backup/sys-bkup-restic`.
5. rsync from the usbx seedbox → `/mnt/media/backup/usb`.
6. One result email with the full output.

The rsyncs and `restic backup` run under `ionice -c3` as well as `nice`. `nice` is CPU only, and at
normal I/O priority they competed with nginx for the USB media disk while a video played.

## Logs

- pm2 writes `backupall.log` in this directory and also `~/.pm2/logs/bkupall-out.log`.
  pm2-logrotate rotates both at local midnight and keeps 3. So `backupall__2026-11-01_...log`
  holds the **previous** day's runs.
- Lines carry no pm2 timestamps (no `log_date_format`). The only times in the log come from
  `ts()`: America/Los_Angeles wall clock, with **no UTC offset**.
- A first stamp around `HH:00:20` instead of `HH:00:00` is normal (seen before and after DST).
  Most likely it is the media disk spinning up on the first `/mnt/media` access.

## Time / DST gotchas

- Schedules use the process's local zone. pm2 sets no `TZ`, so that is `/etc/localtime` =
  America/Los_Angeles. node-cron 3.0.3 matches `getHours()` once per second. No job falls in
  the 01:00–02:59 window, so neither DST change doubles or skips a backup. Only the
  every-2-h reminder loses its 02:00 tick on spring-forward day.
- Durations, the 120-min wait and the 2-h reminder spacing use `Date.now()`, so they are DST-safe.
  `shouldSendStopEmail` allows 5 min of slack below 2 h. The cron ticks are exactly 2 h
  apart, but `lastStopEmailAt` is stamped after the send, so without the slack every
  other reminder is skipped.
- `getNextBackupTime()` uses `getHours()` (process zone). `ts()` hard-codes LA. They agree only
  while the process zone is LA.
- The stop timestamps in `checkStopped` (index.js) and `cli.js` status print UTC (`toISOString`).
  Everything else prints LA local time.
- restic stores snapshot times as RFC3339 with an offset (`-07:00` / `-08:00`). Never sort the
  raw string, because it misorders the repeated 01:00 hour on fall-back day. `restore/list`
  sorts by epoch in Python. Both `mount` scripts sort with `sort_by(.time | epoch)`, using the
  `JQ_EPOCH` jq function defined at the top of each script. Mount directory names still drop
  the offset, so two `01:xx` names on fall-back day don't say which hour they're from.

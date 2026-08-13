# Reading the backups from an LLM session (debugging guide)

This describes how an agent (Claude Code or similar) can **read** the bkupall backups
to debug things: recover a file that was deleted or clobbered, find out *when* a config
changed, or compare the current system against how it looked hours or weeks ago.

Everything here is read-only. See [Rules](#rules-do-not-break-these) before running anything.

## What exists

| Store | Path | Contents | History |
|---|---|---|---|
| **restic repo (this box)** | `/mnt/media/backup/sys-bkup-restic` | `/` (tag `sys`), `/boot` (tag `boot`), `/boot/efi` (tag `boot-efi`) | 3×/day at 07:00, 13:00, 19:00; ~190 snapshots per tag, back to 2026-06-10; 43 GB |
| **restic repo (laptop)** | `/mnt/media/backup/mlap` | `/etc`, `/root`, `/mnt/c/Users/mark` from host `mlap3`, tag `automated` | ~73 snapshots |
| **media mirror** | `/mnt/m-bkup` | rsync mirror of `/mnt/media/` | **no history** — current state only |
| **usb mirror** | `/mnt/media/backup/usb` | rsync mirror of `xobtlu@…usbx.me:/home/xobtlu/` | **no history** — current state only |

Repo password file: `/root/dev/apps/bkupall/restic-cred.txt` (mode 600).

**Not in the `sys` snapshots** (excluded in [restic-bkup.js:308-322](restic-bkup.js#L308-L322)):
`/boot` (separate tag), `/mnt`, `/dev`, `/proc`, `/sys`, `/tmp`, `/run`, `/var/lib/docker`,
`/var/lib/lxcfs`, `/var/lib/emby/transcoding-temp`, `/root/archive`, `/swap.img`,
`/lib/modules`, `/usr/src`, `/lost+found`. Also `--one-file-system`, so nothing on other
mounts. Don't go looking for HA config (`/mnt/media/ha-config`) here — that lives in the
media mirror instead.

## Method 1 — the FUSE mount (preferred, ~25 ms per read)

The repo is normally already mounted read-only at `/mnt/bkupall-bkup`, and every snapshot
is browsable as ordinary directories. This is ~100× faster than the restic CLI for
anything you'll do more than once, and it needs no credentials in your commands.

```bash
mountpoint -q /mnt/bkupall-bkup || /root/dev/apps/bkupall/restore/mount   # mount if needed
```

Layout:

```
/mnt/bkupall-bkup/
  tags/sys/latest/                        # newest sys snapshot  ← use this one
  tags/sys/2026-08-12T20:21:23-07:00/     # one dir per snapshot, ISO local time
  tags/boot/…  tags/boot-efi/…
  ids/<short_id>/                         # same snapshots, keyed by 8-char id
  hosts/server2/…  snapshots/…
```

So the backed-up copy of a file is just a path:

```bash
cat /mnt/bkupall-bkup/tags/sys/latest/etc/fstab
diff /etc/fstab /mnt/bkupall-bkup/tags/sys/latest/etc/fstab
ls /mnt/bkupall-bkup/tags/sys/ | tail -10        # recent restore points
```

The mount reflects new snapshots as they are made — `tags/sys/latest` is genuinely latest.

**Gotcha:** `/mnt/bkupall-root`, `/mnt/bkupall-boot`, `/mnt/bkupall-boot-efi`, and
`/mnt/bkup/sys/<date>/` are *bind mounts* created by `restore/mount` at the time it ran.
They are pinned to whatever snapshot was current then (as of this writing, June 2026) and
do **not** follow `latest`. Never treat them as "the recent backup" — use
`/mnt/bkupall-bkup/tags/sys/latest/`.

The laptop repo mounts the same way via `restore-mlap/mount` at `/mnt/mlap-bkup`
(its snapshots are under `snapshots/` and `tags/automated/`).

## Method 2 — the restic CLI

Use when you need snapshot metadata, diffs, or a repo that isn't mounted.

```bash
export RESTIC_REPOSITORY=/mnt/media/backup/sys-bkup-restic
export RESTIC_PASSWORD_FILE=/root/dev/apps/bkupall/restic-cred.txt
```

**Always pass `--no-lock`.** The daemon writes to this repo three times a day; a read
command that takes a lock can block or be blocked by a backup. `--no-lock` is safe for
every read-only command below.

```bash
restic snapshots --no-lock --latest 3            # 3 newest per tag/path
restic snapshots --no-lock --tag sys --json      # machine-readable, 570 total entries
restic ls   --no-lock --long latest --tag sys /etc/nginx        # listing + mode/size/mtime
restic dump --no-lock latest --tag sys /etc/fstab               # file to stdout
restic dump --no-lock <id> /root/dev/apps/foo > /tmp/foo.tar    # a directory, as tar
restic diff --no-lock <old_id> <new_id>                         # what changed between two
restic find --no-lock --snapshot latest 'restic-bkup.js'        # locate a path by name
restic restore --no-lock <id> --include /etc/nginx --target /tmp/claude-restore
```

Rough costs on this box: `dump`/`ls` ≈ 2 s, `diff` ≈ 12 s, `find` ≈ 12 s per snapshot
scanned. `find` without `--snapshot` walks *every* snapshot — minutes to hours. Don't.

## Recipes

**Recover a file that was deleted or clobbered**

```bash
cp /mnt/bkupall-bkup/tags/sys/latest/path/to/file /tmp/claude-0/…/scratchpad/file
```

Restore into a scratch dir and show the user the diff; don't write over the live file
unless they asked for exactly that.

**Find when a file last changed** — checksum it across recent snapshots (fast via mount):

```bash
for d in $(ls -d /mnt/bkupall-bkup/tags/sys/2026-08-* | tail -20); do
  printf '%s %s\n' "$(basename "$d")" \
    "$(md5sum "$d/etc/nginx/nginx.conf" 2>/dev/null | cut -c1-12 || echo MISSING)"
done
```

The snapshot where the hash flips is the 6-hour window the change landed in; `diff` the
two copies to see it. `MISSING` marks when the file didn't exist yet.

**See everything that changed between two backups**

```bash
restic diff --no-lock $(restic snapshots --no-lock --tag sys --json \
  | python3 -c "import json,sys;s=sorted(json.load(sys.stdin),key=lambda x:x['time']);print(s[-2]['short_id'],s[-1]['short_id'])")
```

Expect noise from `/var/log`, `/var/lib`, and caches — filter to the paths you care about.

**Check whether a backup actually ran** — `backupall.log` in this directory is the current
run, `backupall__<date>.log` are dailies; `pm2 logs bkupall` for the daemon. A backup that
was blocked or delayed says so in the log (`Backup BLOCKED`, `Backup DELAYED`) and emails.

**Handy short ids:** `restic snapshots` prints them; the mount exposes the same ids under
`/mnt/bkupall-bkup/ids/`.

## Rules (do not break these)

- **Read only.** Never run `restic backup`, `forget`, `prune`, `init`, `rewrite`, `tag`,
  `key`, or `migrate` against these repos, and never write into `/mnt/media/backup/…` or
  `/mnt/m-bkup`. Losing history is unrecoverable; a bad `prune` is worse than the bug
  you're chasing. If a repo genuinely needs surgery, stop and ask.
- **Don't unmount.** `/mnt/bkupall-bkup` and its bind mounts are shared; `restore/unmount`
  and `unmount-all` pull them out from under whatever else is using them.
- **Use `--no-lock`** on every restic read, as above.
- **Mind the backup windows** (07:00 / 13:00 / 19:00 local). The daemon waits up to 120
  minutes for `rsync` and for restic writers on `/mnt/media/` to finish, then gives up and
  skips the run. Long, heavy reads during those windows can push it into that timeout.
- **Restore to a scratch path**, then let the user decide about copying over live files.
- Credentials in `restic-cred.txt` stay in the repo path — don't echo the password into
  logs, commit it anywhere, or pass it on a command line.

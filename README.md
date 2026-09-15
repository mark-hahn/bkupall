# bkupall

Scheduled backup daemon with email notifications. Runs under pm2 on hahnca.com.

## What it does

Three times a day, at **07:00, 13:00 and 19:00** (the cron line in `index.js`),
it runs `restic-bkup.js`:

1. `rsync` mirror of `/mnt/media/` → `/mnt/m-bkup` (with `--delete`).
2. `restic backup` of the system into the repository
   `/mnt/media/backup/sys-bkup-restic`, one snapshot per tag:
   - `sys` — `/`, one file system, excluding `/boot`, `/root/archive`,
     `/swap.img`, `/var/lib/docker`, `/dev`, `/proc`, `/sys`, `/tmp`, `/run`,
     `/mnt`, `/lost+found`, `/lib/modules`, `/var/lib/emby/transcoding-temp`,
     `/var/lib/lxcfs`, `/usr/src`
   - `boot` — `/boot`
   - `boot-efi` — `/boot/efi`

   The repository password is `restic-cred.txt` beside this file.
3. `rsync` of `xobtlu@xobtlu.baron.usbx.me:/home/xobtlu/` → `/mnt/media/backup/usb`.

Before starting it waits up to 120 minutes for any running `rsync`, or any
`restic` writing to a repository under `/mnt/media/`, to finish. It refuses to
run at all while `/mnt/media` or `/mnt/m-bkup` is unmounted (the `nomount`
marker files are visible then). Every outcome — success with duration, error,
blocked, delayed — is emailed through Mailtrap.

`backup.js` is the earlier all-rsync implementation, which mirrored `/` to
`/mnt/media/backup/sys-bkup`. Nothing loads it any more; `index.js` uses
`restic-bkup.js`.

## Reading the repository

Read-only. Never run `forget`, `prune`, `unlock` or `repair` by hand — a backup
may be in flight, and those rewrite the repository.

```bash
export RESTIC_REPOSITORY=/mnt/media/backup/sys-bkup-restic
export RESTIC_PASSWORD_FILE=/root/dev/apps/bkupall/restic-cred.txt
restic snapshots --tag sys                            # one line per run
restic ls latest --tag sys /root/dev/apps             # what a snapshot holds
restic restore <id> --target /root/restored --include /etc/fstab
```

`mount | grep restic` lists snapshots already mounted read-only under `/mnt`,
which is often the quickest way to look.

## CLI

```bash
bkupall              # show status
bkupall stop         # stop backups (sends email every 2h while stopped)
bkupall start        # resume backups
bkupall restart      # resume backups
bkupall resume       # resume backups
```

## PM2

```bash
pm2 start ecosystem.config.js   # start daemon
pm2 stop bkupall                 # stop daemon
pm2 logs bkupall                 # view logs
```

## Setup

```bash
cd /root/dev/apps/bkupall
npm install
npm link                         # makes 'bkupall' available globally
pm2 start ecosystem.config.js
pm2 save
```

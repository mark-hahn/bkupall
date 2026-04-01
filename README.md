# bkupall

Scheduled backup daemon with email notifications.

## What it does

Runs the same backup tasks as `/root/scripts/bkupall`:
- Backs up `/mnt/media/` → `/mnt/m-bkup`
- Backs up `/` → `/mnt/media/backup/sys-bkup`
- Backs up `xobtlu@oracle.usbx.me:/home/xobtlu/` → `/mnt/media/backup/usb`

Backups run at **midnight, 06:00, 12:00, and 18:00** daily.

Emails results after every backup using Mailtrap.

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

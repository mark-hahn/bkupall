module.exports = {
  apps: [
    {
      name:        'bkupall',
      script:      '/root/dev/apps/bkupall/index.js',
      cwd:         '/root/dev/apps/bkupall',
      log_file:    '/root/dev/apps/bkupall/backupall.log',
      autorestart: true,
      watch:       false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};

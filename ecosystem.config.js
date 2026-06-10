module.exports = {
  apps: [
    {
      name:        'bkupall',
      script:      '/root/dev/apps/bkupall/index.js',
      cwd:         '/root/dev/apps/bkupall',
      interpreter: '/root/.nvm/versions/node/v22.18.0/bin/node',
      log_file:    '/root/dev/apps/bkupall/backupall.log',
      autorestart: true,
      watch:       false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};

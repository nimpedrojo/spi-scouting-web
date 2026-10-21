#!/bin/sh
# Install this reviewed wrapper at /usr/local/libexec/spi-scouting-deploy.
# Run as ubuntu via a dedicated restrict,command= authorized_keys entry.
# Both installed files must be root-owned and not writable by ubuntu.
exec /usr/bin/env -i \
  HOME=/home/ubuntu USER=ubuntu PATH=/usr/bin:/bin TZ=Europe/Madrid \
  PM2_HOME=/home/ubuntu/.pm2 \
  SSH_ORIGINAL_COMMAND="${SSH_ORIGINAL_COMMAND-}" \
  /usr/bin/flock -n /var/www/spi-scouting-deploy/shared/activation.lock \
  /usr/bin/node /usr/local/libexec/spi-scouting-deploy.cjs

#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get install -y curl ca-certificates gnupg build-essential nginx

# certbot (universe)
apt-get install -y certbot python3-certbot-nginx || apt-get install -y certbot

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

npm install -g pm2
mkdir -p /opt/garbona /var/log/garbona /opt/garbona/logs

node -v
npm -v
pm2 -v
nginx -v
echo "Install vhosts from scripts/nginx-panel.garbona.cc.conf after the app tree is on disk."
echo SETUP_BASE_OK

#!/bin/bash
set -euo pipefail

APP=/opt/garbona
mkdir -p "$APP"
cd "$APP"
tar -xzf /tmp/deploy-garbona.tgz
# ensure .env present (uploaded separately if needed)
if [ ! -f .env ]; then
  echo "MISSING .env" >&2
  exit 1
fi

# force production public hostnames
sed -i 's|^PANEL_PUBLIC_URL=.*|PANEL_PUBLIC_URL=https://garbona.cc|' .env || true
grep -q '^PANEL_PUBLIC_URL=' .env || echo 'PANEL_PUBLIC_URL=https://garbona.cc' >> .env
sed -i 's|^ADMIN_PANEL_URL=.*|ADMIN_PANEL_URL=https://admin.garbona.cc|' .env || true
grep -q '^ADMIN_PANEL_URL=' .env || echo 'ADMIN_PANEL_URL=https://admin.garbona.cc' >> .env
sed -i 's|^MANUALS_DOCS_URL=.*|MANUALS_DOCS_URL="https://docs.garbona.cc/docs/#getting-started"|' .env || true
grep -q '^MANUALS_DOCS_URL=' .env || echo 'MANUALS_DOCS_URL="https://docs.garbona.cc/docs/#getting-started"' >> .env
sed -i 's|^PANEL_AUTH_DISABLED=.*|PANEL_AUTH_DISABLED=0|' .env || true

if command -v nginx >/dev/null 2>&1 && [ -f "$APP/scripts/nginx-panel.garbona.cc.conf" ]; then
  if [ -d /etc/nginx/sites-available ]; then
    cp "$APP/scripts/nginx-panel.garbona.cc.conf" /etc/nginx/sites-available/garbona.cc.conf
    ln -sfn /etc/nginx/sites-available/garbona.cc.conf /etc/nginx/sites-enabled/garbona.cc.conf
  else
    cp "$APP/scripts/nginx-panel.garbona.cc.conf" /etc/nginx/conf.d/garbona.cc.conf
  fi
  nginx -t && systemctl reload nginx || true
fi

npm install --omit=dev
# Chromium for custom template preview screenshots (best-effort)
npx playwright install chromium >/dev/null 2>&1 || true
mkdir -p logs

pm2 delete garbona-bot >/dev/null 2>&1 || true
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root | tail -n 1 | bash || true

pm2 status
echo APP_DEPLOY_OK

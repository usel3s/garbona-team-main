#!/usr/bin/env bash
set -e
echo "=== DATE ==="
date -u
echo
echo "=== PM2 STATUS ==="
pm2 status || true
echo
echo "=== PM2 SHOW garbona-bot ==="
pm2 show garbona-bot || true
echo
echo "=== LAST 500 LINES PM2 LOGS ==="
pm2 logs garbona-bot --lines 500 | sed -n '1,1000p' || true
echo
echo "=== /opt/garbona/logs (last 200 each) ==="
for f in /opt/garbona/logs/*; do
  [ -f "$f" ] || continue
  echo "---- $f ----"
  tail -n 200 "$f" || true
  echo
done
echo "=== NGINX STATUS & TEST ==="
systemctl status nginx --no-pager || true
nginx -t || true
echo "=== NGINX ERRORS (last 200) ==="
tail -n 200 /var/log/nginx/error.log || true
echo
echo "=== PORT LISTEN (3000) ==="
ss -ltnp | grep :3000 || netstat -plnt | grep :3000 || true
echo
echo "=== CURL LOCAL ==="
curl -sS -I http://127.0.0.1:3000/ || true
curl -sS -I http://127.0.0.1:3000/app/ || true
echo
echo "=== CURL PUBLIC IP (direct) ==="
curl -sS -I http://89.125.168.146/ || true
echo
echo "=== DISK & MEMORY ==="
df -h || true
free -m || true
echo
echo "=== END ==="
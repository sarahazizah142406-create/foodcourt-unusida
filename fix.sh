#!/usr/bin/env bash
systemctl stop nginx apache2 2>/dev/null || true
printf ":80 {\n\treverse_proxy localhost:3000\n}\n" > /etc/caddy/Caddyfile
systemctl restart caddy
if systemctl is-active --quiet caddy; then
  echo "SUCCESS: Caddy jalan normal! Buka http://foodcourt-unusida.duckdns.org/customer/"
else
  echo "Status Caddy:"
  journalctl -u caddy --no-pager -n 10
fi

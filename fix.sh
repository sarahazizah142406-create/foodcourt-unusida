#!/usr/bin/env bash
echo ":80 { reverse_proxy localhost:3000 }" > /etc/caddy/Caddyfile
systemctl restart caddy
echo "BERHASIL: Caddy aktif di HTTP port 80. Buka http://foodcourt-unusida.duckdns.org/customer/"

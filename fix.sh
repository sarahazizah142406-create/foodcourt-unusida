#!/usr/bin/env bash
systemctl stop nginx apache2 2>/dev/null || true
cat << 'EOF' > /etc/caddy/Caddyfile
:80, :443 {
	tls internal
	reverse_proxy localhost:3000
}
EOF
systemctl restart caddy
sleep 1
if systemctl is-active --quiet caddy; then
  echo "SUCCESS: Caddy aktif dan jalan!"
else
  echo "Gagal start Caddy. Log error:"
  journalctl -u caddy --no-pager -n 15
fi

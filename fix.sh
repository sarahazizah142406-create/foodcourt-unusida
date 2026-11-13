#!/usr/bin/env bash
systemctl stop nginx apache2 2>/dev/null || true
cat << 'EOF' > /etc/caddy/Caddyfile
foodcourt-unusida.duckdns.org {
	reverse_proxy localhost:3000
}
EOF
systemctl restart caddy
echo "Menunggu pembuatan sertifikat SSL resmi Let's Encrypt / ZeroSSL (5 detik)..."
sleep 5
if systemctl is-active --quiet caddy; then
  echo "BERHASIL: Caddy aktif dengan domain resmi! Buka https://foodcourt-unusida.duckdns.org/customer/"
else
  echo "Gagal start Caddy. Log error:"
  journalctl -u caddy --no-pager -n 15
fi

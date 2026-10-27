#!/usr/bin/env bash
# Setup otomatis FoodCourt di VPS Ubuntu 22.04 / 24.04 (Node.js 20 + pm2 + Caddy untuk HTTPS).
# Cara pakai (sebagai root, di VPS baru):
#   apt update && apt install -y git
#   git clone https://github.com/USERNAME/REPO.git /opt/foodcourt
#   bash /opt/foodcourt/deploy/setup-vps.sh
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Jalankan sebagai root (ketik: sudo -i)"; exit 1; }
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
export DEBIAN_FRONTEND=noninteractive

ask() { # ask NAMA_VAR "Pertanyaan" [bawaan] [rahasia]
  local var="$1" q="$2" def="${3:-}" secret="${4:-}" val=""
  while true; do
    if [ -n "$secret" ]; then read -r -s -p "$q: " val; echo; else read -r -p "$q${def:+ [$def]}: " val; fi
    val="${val:-$def}"
    [ -n "$val" ] && break
    echo "  Tidak boleh kosong."
  done
  printf -v "$var" '%s' "$val"
}

echo "== FoodCourt: setup VPS =="
if [ -f .env ]; then
  echo "File .env sudah ada, dipakai apa adanya (hapus dulu kalau mau diisi ulang)."
  DOMAIN=""
  ask DOMAIN "Domain / subdomain untuk HTTPS (contoh: nama.duckdns.org)"
else
  ask DOMAIN "Domain / subdomain untuk HTTPS (contoh: nama.duckdns.org)"
  ask DB_HOST "Aiven: Host"
  ask DB_PORT "Aiven: Port"
  ask DB_USER "Aiven: User" "avnadmin"
  ask DB_PASSWORD "Aiven: Password (tidak terlihat saat diketik)" "" secret
  ask DB_NAME "Aiven: Nama database" "defaultdb"
  ask MOCK "QRIS mode simulasi untuk demo? (y/n)" "y"
  MUTASIKU_API_KEY=""; MUTASIKU_WALLET_ACCOUNT_ID=""; MUTASIKU_WEBHOOK_SECRET=""
  if [ "$MOCK" = "y" ] || [ "$MOCK" = "Y" ]; then MOCK_VAL="true"; else
    MOCK_VAL="false"
    ask MUTASIKU_API_KEY "Mutasiku: API key" "" secret
    ask MUTASIKU_WALLET_ACCOUNT_ID "Mutasiku: ID akun GoPay Merchant (UUID)"
    read -r -s -p "Mutasiku: Secret webhook (boleh kosong): " MUTASIKU_WEBHOOK_SECRET; echo
  fi
fi

echo "== 1/6 Swap dan paket dasar =="
if ! swapon --show | grep -q .; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
apt-get update -y
apt-get install -y curl git ufw ca-certificates gnupg openssl debian-keyring debian-archive-keyring apt-transport-https

echo "== 2/6 Node.js 20 dan pm2 =="
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2

echo "== 3/6 Menulis .env =="
if [ ! -f .env ]; then
  JWT="$(openssl rand -hex 32)"
  cat > .env <<ENVEOF
PORT=3000
NODE_ENV=production
DB_HOST="$DB_HOST"
DB_PORT=$DB_PORT
DB_USER="$DB_USER"
DB_PASSWORD="$DB_PASSWORD"
DB_NAME="$DB_NAME"
DB_SSL=true
JWT_SECRET=$JWT
CORS_ORIGIN=
MUTASIKU_MOCK=$MOCK_VAL
MUTASIKU_API_KEY="$MUTASIKU_API_KEY"
MUTASIKU_WALLET_ACCOUNT_ID="$MUTASIKU_WALLET_ACCOUNT_ID"
MUTASIKU_WEBHOOK_SECRET="$MUTASIKU_WEBHOOK_SECRET"
MUTASIKU_REDIRECT_URL=https://$DOMAIN/
ENVEOF
  chmod 600 .env
fi

echo "== 4/6 Pasang dependensi dan jalankan aplikasi =="
npm install --omit=dev
pm2 delete foodcourt >/dev/null 2>&1 || true
pm2 start src/server.js --name foodcourt
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "== 5/6 HTTPS otomatis dengan Caddy =="
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y
  apt-get install -y caddy
fi
cat > /etc/caddy/Caddyfile <<CADDYEOF
$DOMAIN {
	reverse_proxy localhost:3000
}
CADDYEOF
systemctl enable caddy >/dev/null 2>&1 || true
systemctl restart caddy

echo "== 6/6 Firewall =="
# Dilewati secara bawaan: di VPS dengan IP bersama, lalu lintas sudah disaring oleh penyedia, dan
# firewall salah setel bisa mengunci SSH. Aktifkan hanya bila perlu: USE_UFW=1 bash deploy/setup-vps.sh
if [ "${USE_UFW:-0}" = "1" ]; then
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
else
  echo "Firewall dilewati (aman untuk VPS IP bersama)."
fi

echo "Menunggu server siap..."
for i in $(seq 1 30); do
  if curl -fsS http://localhost:3000/api/health >/dev/null 2>&1; then OK=1; break; fi
  sleep 2
done
echo
if [ "${OK:-0}" = "1" ]; then
  echo "SELESAI. Server hidup. Buka: https://$DOMAIN/api/health"
  echo "  Pelanggan : https://$DOMAIN/customer/?qr=KODE-MEJA"
  echo "  Kantin    : https://$DOMAIN/kantin/"
  echo "  Dev       : https://$DOMAIN/dev/"
  echo "Kalau https belum bisa dibuka, cek: DNS domain sudah mengarah ke IP VPS ini, lalu: journalctl -u caddy -n 30"
else
  echo "Server belum merespons. Lihat log dengan: pm2 logs foodcourt --lines 50"
  exit 1
fi

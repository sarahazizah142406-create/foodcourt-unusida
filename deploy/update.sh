#!/usr/bin/env bash
# Perbarui aplikasi di VPS setelah kamu git push versi baru:  bash /opt/foodcourt/deploy/update.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
git pull --ff-only
npm install --omit=dev
pm2 restart foodcourt --update-env
pm2 status

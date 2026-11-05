import { pool } from "./db.js";

// Mencatat setiap aksi tulis (POST/PUT/PATCH/DELETE) yang berhasil di panel dev/admin.
// Body request (termasuk password) TIDAK pernah disimpan.
const LABELS = [
  ["POST", /^\/tenants$/, () => "Tambah kantin"],
  ["PATCH", /^\/tenants\/(\d+)$/, (m) => `Ubah kantin #${m[1]}`],
  ["PATCH", /^\/tenants\/(\d+)\/status$/, (m) => `Buka/tutup kantin #${m[1]}`],
  ["PATCH", /^\/tenants\/(\d+)\/kasir$/, (m) => `Ubah akun kasir kantin #${m[1]}`],
  ["DELETE", /^\/tenants\/(\d+)$/, (m) => `Hapus kantin #${m[1]}`],
  ["POST", /^\/tables$/, () => "Tambah meja"],
  ["PATCH", /^\/tables\/(\d+)$/, (m) => `Ubah nomor meja #${m[1]}`],
  ["POST", /^\/tables\/(\d+)\/qr$/, (m) => `Buat ulang QR meja #${m[1]}`],
  ["DELETE", /^\/tables\/(\d+)$/, (m) => `Hapus meja #${m[1]}`],
  ["PUT", /^\/admin$/, () => "Ubah akun / hak akses admin"],
  ["PUT", /^\/password$/, () => "Ganti password sendiri"],
  ["POST", /^\/setoran$/, () => "Catat setoran QRIS ke kantin"]
];

export function auditMiddleware(req, res, next) {
  if (req.method === "GET") return next();
  const path = req.path, method = req.method, userId = req.userId || null, role = req.role || null;
  res.on("finish", () => {
    if (res.statusCode >= 400) return;
    let label = null;
    for (const [m, re, f] of LABELS) {
      if (m !== method) continue;
      const x = re.exec(path);
      if (x) { label = f(x); break; }
    }
    pool.query("INSERT INTO audit_log (user_id, role, aksi) VALUES (?, ?, ?)", [userId, role, (label || `${method} ${path}`).slice(0, 255)]).catch(() => {});
  });
  next();
}

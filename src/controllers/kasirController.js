import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
import { saveImage } from "../config/images.js";
import { fileOf } from "../middleware/upload.js";
import { emitToOrder } from "../sockets/socket.js";
import { HttpError, toInt } from "../utils.js";
import { saveToken, deleteToken } from "../config/push.js";
import { batalkanSubOrder, bersihAlasan } from "./cancelService.js";
import { cleanupStaleOrders } from "../config/cleanup.js";

const STATUS_ORDER = ["diterima", "diproses", "siap", "diambil"];

// POST /api/kasir/login
export async function login(req, res) {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!username || !password) throw new HttpError(400, "Isi username dan password");

  const [rows] = await pool.query(
    `SELECT u.id, u.tenant_id, u.username, u.password, u.role, t.nama_kantin
     FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE u.username = ?`,
    [username]
  );
  const user = rows[0];
  // pesan sama untuk username salah / password salah (tidak membocorkan akun mana yang ada)
  if (!user || !(await bcrypt.compare(password, user.password))) {
    throw new HttpError(401, "Username atau password salah");
  }
  if (user.role !== "kasir") throw new HttpError(403, "Akun ini login lewat halaman Panel Admin");
  if (!user.tenant_id) throw new HttpError(403, "Akun ini belum terhubung ke kantin");

  const token = jwt.sign(
    { userId: user.id, tenantId: user.tenant_id, role: "kasir" },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );
  res.json({ token, tenant_id: user.tenant_id, username: user.username, nama_kantin: user.nama_kantin });
}

// GET /api/kasir/me -> info kantin yang login (nama, status buka/tutup)
export async function getMe(req, res) {
  const [rows] = await pool.query(
    `SELECT id, nama_kantin, foto, status FROM tenants WHERE id = ?`,
    [req.tenantId]
  );
  if (!rows[0]) throw new HttpError(404, "Kantin tidak ditemukan");
  res.json(rows[0]);
}

// PATCH /api/kasir/status -> kasir buka/tutup kantinnya sendiri
export async function setKantinStatus(req, res) {
  const { status } = req.body || {};
  if (!["buka", "tutup"].includes(status)) throw new HttpError(400, "Status tidak valid");
  await pool.query("UPDATE tenants SET status = ? WHERE id = ?", [status, req.tenantId]);
  res.json({ message: status === "buka" ? "Kantin dibuka" : "Kantin ditutup", status });
}

// GET /api/kasir/dashboard
export async function getDashboard(req, res) {
  const [[sum]] = await pool.query(
    `SELECT COALESCE(SUM(status_order <> 'dibatalkan'), 0) AS total_order,
            COALESCE(SUM(status_order = 'diambil'), 0) AS total_selesai,
            COALESCE(SUM(status_order = 'dibatalkan'), 0) AS total_batal,
            COALESCE(SUM(status_order IN ('diterima','diproses')), 0) AS perlu_diproses,
            COALESCE(SUM(status_bayar = 'pending' AND status_order <> 'dibatalkan'), 0) AS belum_bayar,
            COALESCE(SUM(CASE WHEN status_bayar = 'lunas' AND status_order <> 'dibatalkan' THEN subtotal ELSE 0 END), 0) AS total_pemasukan,
            COALESCE(SUM(CASE WHEN status_bayar = 'lunas' AND status_order <> 'dibatalkan' AND metode_bayar = 'qris' THEN subtotal ELSE 0 END), 0) AS pemasukan_qris,
            COALESCE(SUM(CASE WHEN status_bayar = 'lunas' AND status_order <> 'dibatalkan' AND metode_bayar = 'cash' THEN subtotal ELSE 0 END), 0) AS pemasukan_cash
     FROM order_tenants
     WHERE tenant_id = ? AND DATE(created_at) = CURDATE()`,
    [req.tenantId]
  );
  res.json(Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, Number(v)])));
}

// GET /api/kasir/orders -> pesanan HARI INI saja. Pesanan hari sebelumnya otomatis hilang dari tampilan
// (datanya tetap ada untuk laporan), dan pesanan yang "dihapus" kantin ikut disembunyikan.
export async function getOrdersMasuk(req, res) {
  cleanupStaleOrders().catch(() => {});
  const [rows] = await pool.query(
    `SELECT ot.id AS order_tenant_id, ot.nomor_antrian, ot.status_bayar, ot.status_order,
            ot.order_id, ot.metode_bayar, ot.subtotal, ot.catatan, ot.tipe_makan, ot.paid_via, ot.paid_at, ot.created_at,
            ot.alasan_batal, ot.dibatalkan_oleh, tb.nomor_meja
     FROM order_tenants ot
     JOIN orders o ON o.id = ot.order_id
     JOIN tables_fc tb ON tb.id = o.table_id
     WHERE ot.tenant_id = ?
       AND DATE(ot.created_at) = CURDATE()
       AND ot.disembunyikan_kantin = 0
     ORDER BY ot.created_at DESC, ot.id DESC
     LIMIT 300`,
    [req.tenantId]
  );
  let items = [];
  if (rows.length) {
    [items] = await pool.query(
      "SELECT order_tenant_id, nama_menu, qty, harga_satuan FROM order_items WHERE order_tenant_id IN (?)",
      [rows.map((r) => r.order_tenant_id)]
    );
  }
  res.json(rows.map((r) => ({
    ...r,
    items: items.filter((i) => i.order_tenant_id === r.order_tenant_id)
  })));
}

// GET /api/kasir/orders/:orderTenantId/items
export async function getOrderItems(req, res) {
  const [rows] = await pool.query(
    `SELECT oi.qty, oi.harga_satuan, oi.nama_menu
     FROM order_items oi JOIN order_tenants ot ON ot.id = oi.order_tenant_id
     WHERE oi.order_tenant_id = ? AND ot.tenant_id = ?`,
    [req.params.orderTenantId, req.tenantId]
  );
  res.json(rows);
}

// PATCH /api/kasir/orders/:orderTenantId/status
export async function updateStatusOrder(req, res) {
  const id = toInt(req.params.orderTenantId);
  const { status_order } = req.body || {};
  if (Number.isNaN(id)) throw new HttpError(400, "ID tidak valid");
  if (!STATUS_ORDER.includes(status_order)) throw new HttpError(400, "Status tidak valid");

  const [found] = await pool.query(
    "SELECT order_id, status_order FROM order_tenants WHERE id = ? AND tenant_id = ?",
    [id, req.tenantId]
  );
  if (!found[0]) throw new HttpError(404, "Pesanan tidak ditemukan");
  if (found[0].status_order === "dibatalkan") throw new HttpError(409, "Pesanan ini sudah dibatalkan");

  // bersyarat: kalau pelanggan membatalkan di detik yang sama, pembatalan yang menang
  const [upd] = await pool.query(
    "UPDATE order_tenants SET status_order = ? WHERE id = ? AND tenant_id = ? AND status_order <> 'dibatalkan'",
    [status_order, id, req.tenantId]
  );
  if (upd.affectedRows === 0) throw new HttpError(409, "Pesanan ini sudah dibatalkan");
  emitToOrder(found[0].order_id, "status_update", { order_tenant_id: id, status_order });
  res.json({ message: "Status diperbarui" });
}

// POST /api/kasir/orders/:orderTenantId/panggil -> panggil / buzz pelanggan jika pesanan sudah siap diambil
export async function panggilPelanggan(req, res) {
  const id = toInt(req.params.orderTenantId);
  if (Number.isNaN(id)) throw new HttpError(400, "ID tidak valid");
  const [rows] = await pool.query(
    `SELECT ot.id, ot.order_id, ot.nomor_antrian, ot.status_order, t.nama_kantin, tb.nomor_meja
     FROM order_tenants ot
     JOIN orders o ON o.id = ot.order_id
     JOIN tenants t ON t.id = ot.tenant_id
     JOIN tables_fc tb ON tb.id = o.table_id
     WHERE ot.id = ? AND ot.tenant_id = ?`,
    [id, req.tenantId]
  );
  const o = rows[0];
  if (!o) throw new HttpError(404, "Pesanan tidak ditemukan");
  if (o.status_order === "diambil" || o.status_order === "dibatalkan") {
    throw new HttpError(409, "Pesanan sudah selesai atau dibatalkan");
  }
  emitToOrder(o.order_id, "panggil_pelanggan", {
    order_tenant_id: o.id,
    order_id: o.order_id,
    nomor_antrian: o.nomor_antrian,
    nama_kantin: o.nama_kantin,
    nomor_meja: o.nomor_meja
  });
  res.json({ message: `Pelanggan Meja ${o.nomor_meja} (Antrian #${o.nomor_antrian}) berhasil dipanggil` });
}

// PATCH /api/kasir/orders/:orderTenantId/bayar -> konfirmasi pembayaran CASH lunas.
// QRIS tidak bisa dikonfirmasi manual: uangnya masuk ke akun food court dan hanya sah kalau gateway yang menyatakan lunas.
export async function konfirmasiBayar(req, res) {
  const id = toInt(req.params.orderTenantId);
  if (Number.isNaN(id)) throw new HttpError(400, "ID tidak valid");

  const [found] = await pool.query(
    "SELECT order_id, status_bayar, metode_bayar, status_order FROM order_tenants WHERE id = ? AND tenant_id = ?",
    [id, req.tenantId]
  );
  if (!found[0]) throw new HttpError(404, "Pesanan tidak ditemukan");
  if (found[0].status_order === "dibatalkan") throw new HttpError(409, "Pesanan ini sudah dibatalkan");
  if (found[0].metode_bayar === "qris" && found[0].status_bayar !== "lunas") {
    throw new HttpError(409, "Pembayaran QRIS terkonfirmasi otomatis setelah pelanggan membayar, tidak bisa ditandai manual");
  }
  if (found[0].status_bayar === "lunas") return res.json({ message: "Pesanan ini sudah lunas" });

  await pool.query("UPDATE order_tenants SET status_bayar = 'lunas', paid_at = NOW(), paid_via = 'kasir' WHERE id = ? AND tenant_id = ?", [id, req.tenantId]);
  emitToOrder(found[0].order_id, "bayar_update", { order_tenant_id: id, status_bayar: "lunas" });
  res.json({ message: "Pembayaran dikonfirmasi lunas" });
}

// POST /api/kasir/orders/:orderTenantId/batal   body: { alasan }
// Kantin membatalkan pesanan (stok habis, bahan kurang, dll). Alasan WAJIB, dan tampil ke pelanggan.
export async function batalkanOrder(req, res) {
  const id = toInt(req.params.orderTenantId);
  if (Number.isNaN(id)) throw new HttpError(400, "ID tidak valid");
  const alasan = bersihAlasan(req.body?.alasan);
  if (alasan.length < 3) throw new HttpError(400, "Tulis alasan pembatalan (minimal 3 huruf) supaya pelanggan tahu");
  const r = await batalkanSubOrder({ otId: id, tenantId: req.tenantId, oleh: "kantin", alasan, bolehDari: ["diterima", "diproses", "siap"] });
  res.json({ message: "Pesanan dibatalkan", ...r });
}

// DELETE /api/kasir/orders/:orderTenantId -> "hapus" pesanan dari tampilan kantin.
// Hanya untuk pesanan yang sudah selesai / dibatalkan. Datanya tetap tersimpan, laporan pendapatan tidak berubah.
export async function hapusOrder(req, res) {
  const id = toInt(req.params.orderTenantId);
  if (Number.isNaN(id)) throw new HttpError(400, "ID tidak valid");
  const [r] = await pool.query(
    "UPDATE order_tenants SET disembunyikan_kantin = 1 WHERE id = ? AND tenant_id = ? AND status_order IN ('diambil','dibatalkan')",
    [id, req.tenantId]
  );
  if (r.affectedRows === 0) {
    const [f] = await pool.query("SELECT 1 FROM order_tenants WHERE id = ? AND tenant_id = ?", [id, req.tenantId]);
    if (!f[0]) throw new HttpError(404, "Pesanan tidak ditemukan");
    throw new HttpError(409, "Hanya pesanan yang sudah selesai atau dibatalkan yang bisa dihapus");
  }
  res.json({ message: "Pesanan dihapus dari tampilan" });
}

// POST /api/kasir/orders/bersihkan -> hapus sekaligus semua pesanan selesai / dibatalkan dari tampilan
export async function bersihkanOrder(req, res) {
  const [r] = await pool.query(
    "UPDATE order_tenants SET disembunyikan_kantin = 1 WHERE tenant_id = ? AND status_order IN ('diambil','dibatalkan') AND disembunyikan_kantin = 0",
    [req.tenantId]
  );
  res.json({ message: `${r.affectedRows} pesanan dibersihkan`, jumlah: r.affectedRows });
}

// ---------- MENU ----------

const VALID_VARIAN = new Set(["auto", "level", "pedas", "minuman", "air", "none"]);

// GET /api/kasir/menus -> semua menu kantin sendiri (tersedia & habis)
export async function listMenus(req, res) {
  const [rows] = await pool.query(
    "SELECT *, foto AS image_url FROM menus WHERE tenant_id = ? ORDER BY nama_menu ASC",
    [req.tenantId]
  );
  res.json(rows);
}

function readMenuBody(req) {
  const namaMenu = typeof req.body?.nama_menu === "string" ? req.body.nama_menu.trim() : "";
  const harga = Number(req.body?.harga);
  const rawVarian = typeof req.body?.opsi_varian === "string" ? req.body.opsi_varian.trim() : "auto";
  const opsiVarian = VALID_VARIAN.has(rawVarian) ? rawVarian : "auto";
  if (!namaMenu || namaMenu.length > 100 || !Number.isSafeInteger(harga) || harga <= 0 || harga > 10_000_000) {
    throw new HttpError(400, "Nama menu (maks. 100 karakter) dan harga bulat lebih dari 0 wajib diisi");
  }
  return { namaMenu, harga, opsiVarian };
}

// POST /api/kasir/menus
export async function tambahMenu(req, res) {
  const { namaMenu, harga, opsiVarian } = readMenuBody(req);
  const file = fileOf(req, "foto");
  const foto = file ? await saveImage(file.buffer, "foodcourt/menus") : null;
  const [result] = await pool.query(
    "INSERT INTO menus (tenant_id, nama_menu, harga, foto, opsi_varian) VALUES (?, ?, ?, ?, ?)",
    [req.tenantId, namaMenu, harga, foto, opsiVarian]
  );
  res.status(201).json({ id: result.insertId, message: "Menu berhasil ditambahkan" });
}

// PUT /api/kasir/menus/:menuId
export async function updateMenu(req, res) {
  const menuId = toInt(req.params.menuId);
  if (Number.isNaN(menuId)) throw new HttpError(400, "ID menu tidak valid");
  const { namaMenu, harga, opsiVarian } = readMenuBody(req);

  const [menus] = await pool.query("SELECT foto FROM menus WHERE id = ? AND tenant_id = ?", [menuId, req.tenantId]);
  if (!menus[0]) throw new HttpError(404, "Menu tidak ditemukan");

  let foto = req.body?.hapus_foto === "true" ? null : menus[0].foto;
  const file = fileOf(req, "foto");
  if (file) foto = await saveImage(file.buffer, "foodcourt/menus");

  await pool.query(
    "UPDATE menus SET nama_menu = ?, harga = ?, foto = ?, opsi_varian = ? WHERE id = ? AND tenant_id = ?",
    [namaMenu, harga, foto, opsiVarian, menuId, req.tenantId]
  );
  res.json({ message: "Menu berhasil diperbarui" });
}

// PATCH /api/kasir/menus/:menuId/status
export async function updateStatusMenu(req, res) {
  const { status } = req.body || {};
  if (!["tersedia", "habis"].includes(status)) throw new HttpError(400, "Status tidak valid");
  const [result] = await pool.query(
    "UPDATE menus SET status = ? WHERE id = ? AND tenant_id = ?",
    [status, req.params.menuId, req.tenantId]
  );
  if (result.affectedRows === 0) throw new HttpError(404, "Menu tidak ditemukan");
  res.json({ message: "Status menu diperbarui" });
}

// DELETE /api/kasir/menus/:menuId (riwayat pesanan tetap aman: nama menu disimpan di order_items)
export async function deleteMenu(req, res) {
  const [result] = await pool.query(
    "DELETE FROM menus WHERE id = ? AND tenant_id = ?",
    [req.params.menuId, req.tenantId]
  );
  if (result.affectedRows === 0) throw new HttpError(404, "Menu tidak ditemukan");
  res.json({ message: "Menu dihapus" });
}

// ---------- LAPORAN ----------
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

// GET /api/kasir/laporan?dari=YYYY-MM-DD&sampai=YYYY-MM-DD
export async function getLaporan(req, res) {
  const dari = isDate(req.query.dari) ? req.query.dari : "1970-01-01";
  const sampai = isDate(req.query.sampai) ? req.query.sampai : "2999-12-31";
  const base = [req.tenantId, dari, sampai];

  const [[ringkas]] = await pool.query(
    `SELECT COUNT(*) AS jumlah_order,
            COALESCE(SUM(subtotal), 0) AS total_pendapatan,
            COALESCE(SUM(CASE WHEN metode_bayar = 'qris' THEN subtotal END), 0) AS total_qris,
            COALESCE(SUM(CASE WHEN metode_bayar = 'cash' THEN subtotal END), 0) AS total_cash
     FROM order_tenants
     WHERE tenant_id = ? AND status_bayar = 'lunas' AND status_order <> 'dibatalkan' AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    base
  );
  const [harian] = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS tanggal, COUNT(*) AS jumlah_order, SUM(subtotal) AS total
     FROM order_tenants
     WHERE tenant_id = ? AND status_bayar = 'lunas' AND status_order <> 'dibatalkan' AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY DATE_FORMAT(created_at, '%Y-%m-%d') ORDER BY DATE_FORMAT(created_at, '%Y-%m-%d') DESC LIMIT 62`,
    base
  );
  const [terlaris] = await pool.query(
    `SELECT oi.nama_menu, SUM(oi.qty) AS qty, SUM(oi.qty * oi.harga_satuan) AS omzet
     FROM order_items oi JOIN order_tenants ot ON ot.id = oi.order_tenant_id
     WHERE ot.tenant_id = ? AND ot.status_bayar = 'lunas' AND ot.status_order <> 'dibatalkan' AND ot.created_at >= ? AND ot.created_at < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY oi.nama_menu ORDER BY qty DESC LIMIT 5`,
    base
  );
  const num = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v]));
  res.json({
    ...num(ringkas),
    harian: harian.map(num),
    menu_terlaris: terlaris.map(num)
  });
}

// POST /api/kasir/push-token -> simpan token FCM perangkat kasir ini
export async function registerPushToken(req, res) {
  const token = String(req.body?.token || "").trim();
  if (token.length < 20 || token.length > 512) throw new HttpError(400, "Token tidak valid");
  await saveToken(req.tenantId, token, "android");
  res.json({ ok: true });
}

// DELETE /api/kasir/push-token -> dipanggil saat logout
export async function unregisterPushToken(req, res) {
  const token = String(req.body?.token || "").trim();
  if (token) await deleteToken(token);
  res.json({ ok: true });
}
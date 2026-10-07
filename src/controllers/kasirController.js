import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
import { saveImage } from "../config/images.js";
import { fileOf } from "../middleware/upload.js";
import { emitToOrder } from "../sockets/socket.js";
import { HttpError, toInt } from "../utils.js";

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
  if (user.role === "dev") throw new HttpError(403, "Akun developer login lewat halaman Panel Dev");
  if (!user.tenant_id) throw new HttpError(403, "Akun ini belum terhubung ke kantin");

  const token = jwt.sign(
    { userId: user.id, tenantId: user.tenant_id, role: "kasir" },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );
  res.json({ token, tenant_id: user.tenant_id, username: user.username, nama_kantin: user.nama_kantin });
}

// GET /api/kasir/me -> info kantin yang login (nama, status buka/tutup, QRIS)
export async function getMe(req, res) {
  const [rows] = await pool.query(
    `SELECT id, nama_kantin, foto, status, qris_image, qris_nama FROM tenants WHERE id = ?`,
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
    `SELECT COUNT(*) AS total_order,
            COALESCE(SUM(status_order = 'diambil'), 0) AS total_selesai,
            COALESCE(SUM(status_order IN ('diterima','diproses')), 0) AS perlu_diproses,
            COALESCE(SUM(status_bayar = 'pending'), 0) AS belum_bayar,
            COALESCE(SUM(CASE WHEN status_bayar = 'lunas' THEN subtotal ELSE 0 END), 0) AS total_pemasukan,
            COALESCE(SUM(CASE WHEN status_bayar = 'lunas' AND metode_bayar = 'qris' THEN subtotal ELSE 0 END), 0) AS pemasukan_qris,
            COALESCE(SUM(CASE WHEN status_bayar = 'lunas' AND metode_bayar = 'cash' THEN subtotal ELSE 0 END), 0) AS pemasukan_cash
     FROM order_tenants
     WHERE tenant_id = ? AND DATE(created_at) = CURDATE()`,
    [req.tenantId]
  );
  res.json(Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, Number(v)])));
}

// GET /api/kasir/orders -> pesanan hari ini + yang belum selesai/belum dibayar dari hari sebelumnya
export async function getOrdersMasuk(req, res) {
  const [rows] = await pool.query(
    `SELECT ot.id AS order_tenant_id, ot.nomor_antrian, ot.status_bayar, ot.status_order,
            ot.metode_bayar, ot.subtotal, ot.catatan, ot.tipe_makan, ot.klaim_bayar, ot.created_at, tb.nomor_meja
     FROM order_tenants ot
     JOIN orders o ON o.id = ot.order_id
     JOIN tables_fc tb ON tb.id = o.table_id
     WHERE ot.tenant_id = ?
       AND (DATE(ot.created_at) = CURDATE() OR ot.status_order <> 'diambil')
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
    klaim_bayar: Boolean(r.klaim_bayar),
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
    "SELECT order_id FROM order_tenants WHERE id = ? AND tenant_id = ?",
    [id, req.tenantId]
  );
  if (!found[0]) throw new HttpError(404, "Pesanan tidak ditemukan");

  await pool.query("UPDATE order_tenants SET status_order = ? WHERE id = ? AND tenant_id = ?", [status_order, id, req.tenantId]);
  emitToOrder(found[0].order_id, "status_update", { order_tenant_id: id, status_order });
  res.json({ message: "Status diperbarui" });
}

// PATCH /api/kasir/orders/:orderTenantId/bayar -> konfirmasi pembayaran (cash ATAU QRIS yang sudah masuk) lunas
export async function konfirmasiBayar(req, res) {
  const id = toInt(req.params.orderTenantId);
  if (Number.isNaN(id)) throw new HttpError(400, "ID tidak valid");

  const [found] = await pool.query(
    "SELECT order_id, status_bayar FROM order_tenants WHERE id = ? AND tenant_id = ?",
    [id, req.tenantId]
  );
  if (!found[0]) throw new HttpError(404, "Pesanan tidak ditemukan");
  if (found[0].status_bayar === "lunas") return res.json({ message: "Pesanan ini sudah lunas" });

  await pool.query("UPDATE order_tenants SET status_bayar = 'lunas' WHERE id = ? AND tenant_id = ?", [id, req.tenantId]);
  emitToOrder(found[0].order_id, "bayar_update", { order_tenant_id: id, status_bayar: "lunas" });
  res.json({ message: "Pembayaran dikonfirmasi lunas" });
}

// ---------- MENU ----------

// GET /api/kasir/menus -> semua menu kantin sendiri (tersedia & habis)
export async function listMenus(req, res) {
  const [rows] = await pool.query(
    "SELECT id, nama_menu, harga, foto AS image_url, status FROM menus WHERE tenant_id = ? ORDER BY nama_menu ASC",
    [req.tenantId]
  );
  res.json(rows);
}

function readMenuBody(req) {
  const namaMenu = typeof req.body?.nama_menu === "string" ? req.body.nama_menu.trim() : "";
  const harga = Number(req.body?.harga);
  if (!namaMenu || namaMenu.length > 100 || !Number.isSafeInteger(harga) || harga <= 0 || harga > 10_000_000) {
    throw new HttpError(400, "Nama menu (maks. 100 karakter) dan harga bulat lebih dari 0 wajib diisi");
  }
  return { namaMenu, harga };
}

// POST /api/kasir/menus
export async function tambahMenu(req, res) {
  const { namaMenu, harga } = readMenuBody(req);
  const file = fileOf(req, "foto");
  const foto = file ? await saveImage(file.buffer, "foodcourt/menus") : null;
  const [result] = await pool.query(
    "INSERT INTO menus (tenant_id, nama_menu, harga, foto) VALUES (?, ?, ?, ?)",
    [req.tenantId, namaMenu, harga, foto]
  );
  res.status(201).json({ id: result.insertId, message: "Menu berhasil ditambahkan" });
}

// PUT /api/kasir/menus/:menuId
export async function updateMenu(req, res) {
  const menuId = toInt(req.params.menuId);
  if (Number.isNaN(menuId)) throw new HttpError(400, "ID menu tidak valid");
  const { namaMenu, harga } = readMenuBody(req);

  const [menus] = await pool.query("SELECT foto FROM menus WHERE id = ? AND tenant_id = ?", [menuId, req.tenantId]);
  if (!menus[0]) throw new HttpError(404, "Menu tidak ditemukan");

  let foto = req.body?.hapus_foto === "true" ? null : menus[0].foto;
  const file = fileOf(req, "foto");
  if (file) foto = await saveImage(file.buffer, "foodcourt/menus");

  await pool.query(
    "UPDATE menus SET nama_menu = ?, harga = ?, foto = ? WHERE id = ? AND tenant_id = ?",
    [namaMenu, harga, foto, menuId, req.tenantId]
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
     WHERE tenant_id = ? AND status_bayar = 'lunas' AND DATE(created_at) BETWEEN ? AND ?`,
    base
  );
  const [harian] = await pool.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS tanggal, COUNT(*) AS jumlah_order, SUM(subtotal) AS total
     FROM order_tenants
     WHERE tenant_id = ? AND status_bayar = 'lunas' AND DATE(created_at) BETWEEN ? AND ?
     GROUP BY DATE(created_at) ORDER BY DATE(created_at) DESC LIMIT 62`,
    base
  );
  const [terlaris] = await pool.query(
    `SELECT oi.nama_menu, SUM(oi.qty) AS qty, SUM(oi.qty * oi.harga_satuan) AS omzet
     FROM order_items oi JOIN order_tenants ot ON ot.id = oi.order_tenant_id
     WHERE ot.tenant_id = ? AND ot.status_bayar = 'lunas' AND DATE(ot.created_at) BETWEEN ? AND ?
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

import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "../config/db.js";
import { saveImage } from "../config/images.js";
import { fileOf } from "../middleware/upload.js";
import { HttpError, toInt } from "../utils.js";

// POST /api/dev/login
export async function loginDev(req, res) {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!username || !password) throw new HttpError(400, "Isi username dan password");

  const [rows] = await pool.query(
    "SELECT id, username, password FROM users WHERE username = ? AND role = 'dev'",
    [username]
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password))) {
    throw new HttpError(401, "Username atau password salah");
  }
  const token = jwt.sign({ userId: user.id, role: "dev" }, process.env.JWT_SECRET, { expiresIn: "12h" });
  res.json({ token, username: user.username });
}

// GET /api/dev/metrics
export async function getMetrics(req, res) {
  const [[m]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM tenants) AS total_kantin,
       (SELECT COUNT(*) FROM tenants WHERE status = 'buka') AS kantin_buka,
       (SELECT COUNT(*) FROM tenants WHERE qris_image IS NOT NULL AND qris_image <> '') AS kantin_qris,
       (SELECT COUNT(*) FROM menus) AS total_menu,
       (SELECT COUNT(*) FROM tables_fc) AS total_meja,
       (SELECT COUNT(*) FROM order_tenants WHERE DATE(created_at) = CURDATE()) AS total_order_hari_ini,
       (SELECT COALESCE(SUM(subtotal), 0) FROM order_tenants
          WHERE DATE(created_at) = CURDATE() AND status_bayar = 'lunas') AS omzet_hari_ini`
  );
  res.json(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Number(v)])));
}

// GET /api/dev/tenants
export async function getAllTenants(req, res) {
  const [rows] = await pool.query(
    `SELECT t.id, t.nama_kantin, t.foto, t.status, t.created_at, t.qris_nama,
            (t.qris_image IS NOT NULL AND t.qris_image <> '') AS qris_aktif,
            (SELECT u.username FROM users u WHERE u.tenant_id = t.id AND u.role = 'kasir' ORDER BY u.id LIMIT 1) AS kasir_username
     FROM tenants t ORDER BY t.id ASC`
  );
  res.json(rows.map((r) => ({ ...r, qris_aktif: Boolean(r.qris_aktif) })));
}

// GET /api/dev/tenants/:id/qris -> gambar QRIS 1 kantin (untuk pratinjau)
export async function getTenantQris(req, res) {
  const id = toInt(req.params.id);
  const [rows] = await pool.query("SELECT nama_kantin, qris_image, qris_nama FROM tenants WHERE id = ?", [id]);
  if (!rows[0]) throw new HttpError(404, "Kantin tidak ditemukan");
  res.json(rows[0]);
}

function validCredentials(username, password) {
  if (!username && !password) return false;
  if (!/^[a-zA-Z0-9_.-]{3,50}$/.test(username || "")) {
    throw new HttpError(400, "Username kasir 3-50 karakter (huruf, angka, _ . -)");
  }
  if (!password || password.length < 6) throw new HttpError(400, "Password kasir minimal 6 karakter");
  return true;
}

// POST /api/dev/tenants (multipart: nama_kantin, username?, password?, qris_nama?, foto?, qris?)
export async function createTenant(req, res) {
  const nama = String(req.body?.nama_kantin || "").trim();
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const qrisNama = String(req.body?.qris_nama || "").trim().slice(0, 100) || null;
  if (!nama || nama.length > 100) throw new HttpError(400, "Nama kantin wajib diisi (maks. 100 karakter)");
  const withUser = validCredentials(username, password);

  const fotoFile = fileOf(req, "foto");
  const qrisFile = fileOf(req, "qris");
  const foto = fotoFile ? await saveImage(fotoFile.buffer, "foodcourt/kantin") : null;
  const qris = qrisFile ? await saveImage(qrisFile.buffer, "foodcourt/qris") : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [t] = await conn.query(
      "INSERT INTO tenants (nama_kantin, foto, qris_image, qris_nama) VALUES (?, ?, ?, ?)",
      [nama, foto, qris, qrisNama]
    );
    if (withUser) {
      await conn.query(
        "INSERT INTO users (tenant_id, username, password, role) VALUES (?, ?, ?, 'kasir')",
        [t.insertId, username, await bcrypt.hash(password, 10)]
      );
    }
    await conn.commit();
    res.status(201).json({ id: t.insertId, message: "Kantin berhasil ditambahkan" });
  } catch (err) {
    await conn.rollback();
    if (err.code === "ER_DUP_ENTRY") throw new HttpError(409, "Username kasir sudah dipakai");
    throw err;
  } finally {
    conn.release();
  }
}

// PATCH /api/dev/tenants/:id (multipart: nama_kantin?, qris_nama?, foto?, qris?, hapus_foto?, hapus_qris?)
export async function updateTenant(req, res) {
  const id = toInt(req.params.id);
  if (Number.isNaN(id)) throw new HttpError(400, "ID tidak valid");
  const [rows] = await pool.query("SELECT * FROM tenants WHERE id = ?", [id]);
  const cur = rows[0];
  if (!cur) throw new HttpError(404, "Kantin tidak ditemukan");

  const b = req.body || {};
  const nama = b.nama_kantin !== undefined ? String(b.nama_kantin).trim() : cur.nama_kantin;
  if (!nama || nama.length > 100) throw new HttpError(400, "Nama kantin tidak valid");
  const qrisNama = b.qris_nama !== undefined ? (String(b.qris_nama).trim().slice(0, 100) || null) : cur.qris_nama;

  let foto = b.hapus_foto === "true" ? null : cur.foto;
  let qris = b.hapus_qris === "true" ? null : cur.qris_image;
  const fotoFile = fileOf(req, "foto");
  const qrisFile = fileOf(req, "qris");
  if (fotoFile) foto = await saveImage(fotoFile.buffer, "foodcourt/kantin");
  if (qrisFile) qris = await saveImage(qrisFile.buffer, "foodcourt/qris");

  await pool.query(
    "UPDATE tenants SET nama_kantin = ?, foto = ?, qris_image = ?, qris_nama = ? WHERE id = ?",
    [nama, foto, qris, qrisNama, id]
  );
  res.json({ message: "Kantin berhasil diperbarui" });
}

// PATCH /api/dev/tenants/:id/status
export async function toggleTenantStatus(req, res) {
  const { status } = req.body || {};
  if (!["buka", "tutup"].includes(status)) throw new HttpError(400, "Status tidak valid");
  const [r] = await pool.query("UPDATE tenants SET status = ? WHERE id = ?", [status, req.params.id]);
  if (r.affectedRows === 0) throw new HttpError(404, "Kantin tidak ditemukan");
  res.json({ message: "Status kantin diperbarui" });
}

// PATCH /api/dev/tenants/:id/kasir  body: { username?, password } -> buat akun kasir / reset password
export async function setKasirAccount(req, res) {
  const id = toInt(req.params.id);
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const [t] = await pool.query("SELECT id FROM tenants WHERE id = ?", [id]);
  if (!t[0]) throw new HttpError(404, "Kantin tidak ditemukan");

  const [existing] = await pool.query(
    "SELECT id, username FROM users WHERE tenant_id = ? AND role = 'kasir' ORDER BY id LIMIT 1",
    [id]
  );
  try {
    if (existing[0]) {
      if (!password || password.length < 6) throw new HttpError(400, "Password minimal 6 karakter");
      const newUsername = username || existing[0].username;
      if (!/^[a-zA-Z0-9_.-]{3,50}$/.test(newUsername)) throw new HttpError(400, "Username tidak valid");
      await pool.query("UPDATE users SET username = ?, password = ? WHERE id = ?",
        [newUsername, await bcrypt.hash(password, 10), existing[0].id]);
    } else {
      validCredentials(username, password);
      await pool.query("INSERT INTO users (tenant_id, username, password, role) VALUES (?, ?, ?, 'kasir')",
        [id, username, await bcrypt.hash(password, 10)]);
    }
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") throw new HttpError(409, "Username sudah dipakai");
    throw err;
  }
  res.json({ message: "Akun kasir diperbarui" });
}

// DELETE /api/dev/tenants/:id -> hapus kantin beserta menu, akun kasir, dan riwayat ordernya
export async function deleteTenant(req, res) {
  const id = toInt(req.params.id);
  if (Number.isNaN(id)) throw new HttpError(400, "ID tidak valid");
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM order_items WHERE order_tenant_id IN (SELECT id FROM order_tenants WHERE tenant_id = ?)", [id]);
    await conn.query("DELETE FROM order_tenants WHERE tenant_id = ?", [id]);
    await conn.query("DELETE FROM queue_counters WHERE tenant_id = ?", [id]);
    await conn.query("DELETE FROM users WHERE tenant_id = ?", [id]);
    await conn.query("DELETE FROM menus WHERE tenant_id = ?", [id]);
    const [r] = await conn.query("DELETE FROM tenants WHERE id = ?", [id]);
    if (r.affectedRows === 0) throw new HttpError(404, "Kantin tidak ditemukan");
    await conn.query("DELETE FROM orders WHERE id NOT IN (SELECT order_id FROM order_tenants)");
    await conn.commit();
    res.json({ message: "Kantin dihapus" });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// ---------- MEJA & QR ----------

// GET /api/dev/tables
export async function listTables(req, res) {
  const [rows] = await pool.query("SELECT id, nomor_meja, qr_code FROM tables_fc ORDER BY CAST(nomor_meja AS UNSIGNED), nomor_meja");
  res.json(rows);
}

const newQrCode = (nomor) => `MEJA-${nomor}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

// POST /api/dev/tables  body: { nomor_meja } atau { dari, sampai }
export async function createTables(req, res) {
  const { nomor_meja, dari, sampai } = req.body || {};
  let numbers = [];
  if (dari !== undefined && sampai !== undefined) {
    const a = toInt(dari), z = toInt(sampai);
    if (Number.isNaN(a) || Number.isNaN(z) || a < 1 || z < a || z - a >= 100) {
      throw new HttpError(400, "Rentang meja tidak valid (maks. 100 meja sekali buat)");
    }
    for (let n = a; n <= z; n++) numbers.push(String(n).padStart(2, "0"));
  } else {
    const n = String(nomor_meja || "").trim();
    if (!n || n.length > 10) throw new HttpError(400, "Nomor meja wajib diisi (maks. 10 karakter)");
    numbers = [n];
  }
  const [existing] = await pool.query("SELECT nomor_meja FROM tables_fc WHERE nomor_meja IN (?)", [numbers]);
  const taken = new Set(existing.map((r) => r.nomor_meja));
  const fresh = numbers.filter((n) => !taken.has(n));
  if (fresh.length === 0) throw new HttpError(409, "Nomor meja tersebut sudah ada");
  await pool.query("INSERT INTO tables_fc (nomor_meja, qr_code) VALUES ?", [fresh.map((n) => [n, newQrCode(n)])]);
  res.status(201).json({ dibuat: fresh.length, dilewati: numbers.length - fresh.length, message: `${fresh.length} meja ditambahkan` });
}

// DELETE /api/dev/tables/:id
export async function deleteTable(req, res) {
  const id = toInt(req.params.id);
  const [used] = await pool.query("SELECT COUNT(*) AS n FROM orders WHERE table_id = ?", [id]);
  if (used[0].n > 0) throw new HttpError(409, "Meja ini sudah punya riwayat pesanan, tidak bisa dihapus");
  const [r] = await pool.query("DELETE FROM tables_fc WHERE id = ?", [id]);
  if (r.affectedRows === 0) throw new HttpError(404, "Meja tidak ditemukan");
  res.json({ message: "Meja dihapus" });
}

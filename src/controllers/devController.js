import { parseIzin, IZIN_VALID } from "../middleware/authDev.js";
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
    "SELECT id, username, password, role, izin FROM users WHERE username = ? AND role IN ('dev', 'admin')",
    [username]
  );
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password))) {
    throw new HttpError(401, "Username atau password salah");
  }
  const token = jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "12h" });
  res.json({ token, username: user.username, role: user.role, izin: parseIzin(user.izin) });
}

// GET /api/dev/metrics
export async function getMetrics(req, res) {
  const [[m]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM tenants) AS total_kantin,
       (SELECT COUNT(*) FROM tenants WHERE status = 'buka') AS kantin_buka,
       (SELECT COUNT(*) FROM menus) AS total_menu,
       (SELECT COUNT(*) FROM tables_fc) AS total_meja,
       (SELECT COUNT(*) FROM order_tenants WHERE DATE(created_at) = CURDATE() AND status_order <> 'dibatalkan') AS total_order_hari_ini,
       (SELECT COALESCE(SUM(subtotal), 0) FROM order_tenants
          WHERE DATE(created_at) = CURDATE() AND status_bayar = 'lunas' AND status_order <> 'dibatalkan') AS omzet_hari_ini`
  );
  res.json(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Number(v)])));
}

// GET /api/dev/tenants
export async function getAllTenants(req, res) {
  const [rows] = await pool.query(
    `SELECT t.id, t.nama_kantin, t.foto, t.status, t.created_at, t.nama_bank, t.nomor_rekening, t.atas_nama,
            (SELECT u.username FROM users u WHERE u.tenant_id = t.id AND u.role = 'kasir' ORDER BY u.id LIMIT 1) AS kasir_username,
            (SELECT COUNT(*) FROM menus m WHERE m.tenant_id = t.id) AS menu_count
     FROM tenants t ORDER BY t.id ASC`
  );
  res.json(rows);
}

function validCredentials(username, password) {
  if (!username && !password) return false;
  if (!/^[a-zA-Z0-9_.-]{3,50}$/.test(username || "")) {
    throw new HttpError(400, "Username kasir 3-50 karakter (huruf, angka, _ . -)");
  }
  if (!password || password.length < 6) throw new HttpError(400, "Password kasir minimal 6 karakter");
  return true;
}

// POST /api/dev/tenants (multipart: nama_kantin, username?, password?, foto?, nama_bank?, nomor_rekening?, atas_nama?)
export async function createTenant(req, res) {
  const nama = String(req.body?.nama_kantin || "").trim();
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const namaBank = String(req.body?.nama_bank || "").trim() || null;
  const nomorRekening = String(req.body?.nomor_rekening || "").trim() || null;
  const atasNama = String(req.body?.atas_nama || "").trim() || null;

  if (!nama || nama.length > 100) throw new HttpError(400, "Nama kantin wajib diisi (maks. 100 karakter)");
  const [dup] = await pool.query("SELECT id FROM tenants WHERE LOWER(TRIM(nama_kantin)) = LOWER(?) LIMIT 1", [nama]);
  if (dup[0]) throw new HttpError(409, `Kantin "${nama}" sudah ada, gunakan nama lain`);
  // Admin tidak boleh menetapkan akun kasir (supaya tidak bisa login ke kantin): hanya dev yang boleh.
  const withUser = req.role === "dev" ? validCredentials(username, password) : false;

  const fotoFile = fileOf(req, "foto");
  const foto = fotoFile ? await saveImage(fotoFile.buffer, "foodcourt/kantin") : null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [t] = await conn.query(
      "INSERT INTO tenants (nama_kantin, foto, nama_bank, nomor_rekening, atas_nama) VALUES (?, ?, ?, ?, ?)",
      [nama, foto, namaBank, nomorRekening, atasNama]
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

// PATCH /api/dev/tenants/:id (multipart: nama_kantin?, foto?, hapus_foto?, nama_bank?, nomor_rekening?, atas_nama?)
export async function updateTenant(req, res) {
  const id = toInt(req.params.id);
  if (Number.isNaN(id)) throw new HttpError(400, "ID tidak valid");
  const [rows] = await pool.query("SELECT * FROM tenants WHERE id = ?", [id]);
  const cur = rows[0];
  if (!cur) throw new HttpError(404, "Kantin tidak ditemukan");

  const b = req.body || {};
  const nama = b.nama_kantin !== undefined ? String(b.nama_kantin).trim() : cur.nama_kantin;
  if (!nama || nama.length > 100) throw new HttpError(400, "Nama kantin tidak valid");
  const [dup] = await pool.query("SELECT id FROM tenants WHERE LOWER(TRIM(nama_kantin)) = LOWER(?) AND id <> ? LIMIT 1", [nama, id]);
  if (dup[0]) throw new HttpError(409, `Kantin "${nama}" sudah ada, gunakan nama lain`);

  const namaBank = b.nama_bank !== undefined ? (String(b.nama_bank).trim() || null) : cur.nama_bank;
  const nomorRekening = b.nomor_rekening !== undefined ? (String(b.nomor_rekening).trim() || null) : cur.nomor_rekening;
  const atasNama = b.atas_nama !== undefined ? (String(b.atas_nama).trim() || null) : cur.atas_nama;

  let foto = b.hapus_foto === "true" ? null : cur.foto;
  const fotoFile = fileOf(req, "foto");
  if (fotoFile) foto = await saveImage(fotoFile.buffer, "foodcourt/kantin");

  await pool.query(
    "UPDATE tenants SET nama_kantin = ?, foto = ?, nama_bank = ?, nomor_rekening = ?, atas_nama = ? WHERE id = ?",
    [nama, foto, namaBank, nomorRekening, atasNama, id]
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
  const [tn] = await pool.query("SELECT nama_kantin FROM tenants WHERE id = ?", [id]);
  if (!tn[0]) throw new HttpError(404, "Kantin tidak ditemukan");
  if (String(req.body?.konfirmasi || "").trim().toLowerCase() !== tn[0].nama_kantin.trim().toLowerCase()) {
    throw new HttpError(400, "Ketik nama kantin dengan benar untuk menghapus");
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM setoran_qris WHERE tenant_id = ?", [id]);
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

// ---------- REKAP PEMBAYARAN ----------
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const numRow = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v]));

// GET /api/dev/rekap?dari=YYYY-MM-DD&sampai=YYYY-MM-DD
// Hasil penjualan per kantin dipisah per metode pembayaran. QRIS = uang masuk ke akun food court (harus disetor ke kantin),
// Cash = uang sudah dipegang kantin masing-masing.

// Rentang tanggal rekap: default HARI INI (bukan seluruh data), maksimal 366 hari supaya query tetap ringan.
const MAX_HARI = 366;
async function rentang(req) {
  const [[{ h }]] = await pool.query("SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS h");
  const dari = isDate(req.query.dari) ? req.query.dari : isDate(req.query.sampai) ? req.query.sampai : h;
  const sampai = isDate(req.query.sampai) ? req.query.sampai : dari;
  if (dari > sampai) throw new HttpError(400, "Tanggal 'dari' harus sebelum 'sampai'");
  if (!((Date.parse(sampai) - Date.parse(dari)) / 86400000 <= MAX_HARI)) throw new HttpError(400, `Rentang tanggal maksimal ${MAX_HARI} hari`);
  return [dari, sampai];
}

export async function getRekap(req, res) {
  const [dari, sampai] = await rentang(req);
  const [rows] = await pool.query(
    `SELECT t.id AS tenant_id, t.nama_kantin, t.nama_bank, t.nomor_rekening, t.atas_nama,
            COUNT(CASE WHEN ot.metode_bayar = 'qris' THEN 1 END) AS qris_order,
            COALESCE(SUM(CASE WHEN ot.metode_bayar = 'qris' THEN ot.subtotal END), 0) AS qris_total,
            COUNT(CASE WHEN ot.metode_bayar = 'cash' THEN 1 END) AS cash_order,
            COALESCE(SUM(CASE WHEN ot.metode_bayar = 'cash' THEN ot.subtotal END), 0) AS cash_total
     FROM tenants t
     LEFT JOIN order_tenants ot ON ot.tenant_id = t.id AND ot.status_bayar = 'lunas' AND ot.status_order <> 'dibatalkan' AND ot.created_at >= ? AND ot.created_at < DATE_ADD(?, INTERVAL 1 DAY)
     GROUP BY t.id, t.nama_kantin, t.nama_bank, t.nomor_rekening, t.atas_nama ORDER BY t.nama_kantin ASC`,
    [dari, sampai]
  );
  const [setor] = await pool.query(
    "SELECT tenant_id, COALESCE(SUM(nominal), 0) AS n FROM setoran_qris WHERE dari >= ? AND sampai <= ? GROUP BY tenant_id",
    [dari, sampai]
  );
  const setorMap = new Map(setor.map((x) => [x.tenant_id, Number(x.n)]));
  const kantin = rows.map((r) => {
    const n = numRow(r);
    const disetor = setorMap.get(n.tenant_id) || 0;
    return {
      ...n, total: n.qris_total + n.cash_total, jumlah_order: n.qris_order + n.cash_order,
      disetor, sisa_qris: Math.max(0, n.qris_total - disetor)
    };
  });
  const sum = (k) => kantin.reduce((a, r) => a + r[k], 0);
  const [[fee]] = await pool.query(
    `SELECT COALESCE(SUM(biaya_layanan), 0) AS fee FROM orders
     WHERE status_bayar = 'lunas' AND metode_bayar = 'qris' AND created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY)`,
    [dari, sampai]
  );
  res.json({
    dari, sampai, kantin,
    total: {
      qris_total: sum("qris_total"), qris_order: sum("qris_order"),
      cash_total: sum("cash_total"), cash_order: sum("cash_order"),
      total: sum("total"), jumlah_order: sum("jumlah_order"),
      biaya_layanan_qris: Number(fee.fee), sisa_qris: sum("sisa_qris")
    }
  });
}

// GET /api/dev/rekap/:tenantId?dari=&sampai=&metode=qris|cash -> rincian transaksi satu kantin
export async function getRekapDetail(req, res) {
  const id = toInt(req.params.tenantId);
  if (Number.isNaN(id)) throw new HttpError(400, "ID kantin tidak valid");
  const [dari, sampai] = await rentang(req);
  const metode = ["qris", "cash"].includes(req.query.metode) ? req.query.metode : null;
  const limit = Math.min(Math.max(toInt(req.query.limit) || 50, 1), 100);
  const offset = Math.min(Math.max(toInt(req.query.offset) || 0, 0), 100000);
  // Potongan SQL di bawah konstanta; semua nilai (id, tanggal, metode, limit, offset) lewat placeholder.
  const filter = `ot.tenant_id = ? AND ot.status_bayar = 'lunas' AND ot.status_order <> 'dibatalkan' AND ot.created_at >= ? AND ot.created_at < DATE_ADD(?, INTERVAL 1 DAY)${metode ? " AND ot.metode_bayar = ?" : ""}`;
  const params = metode ? [id, dari, sampai, metode] : [id, dari, sampai];
  const [[agg]] = await pool.query(`SELECT COUNT(*) AS jumlah, COALESCE(SUM(ot.subtotal), 0) AS nominal FROM order_tenants ot WHERE ${filter}`, params);
  const [rows] = await pool.query(
    `SELECT ot.id, ot.order_id, ot.nomor_antrian, ot.metode_bayar, ot.subtotal, ot.paid_at, ot.paid_via, ot.created_at, tb.nomor_meja
     FROM order_tenants ot
     JOIN orders o ON o.id = ot.order_id
     JOIN tables_fc tb ON tb.id = o.table_id
     WHERE ${filter}
     ORDER BY ot.created_at DESC, ot.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const jumlah = Number(agg.jumlah);
  res.json({ rows, jumlah, nominal: Number(agg.nominal), limit, offset, ada_lagi: offset + rows.length < jumlah });
}

// ---------- AKUN ADMIN FOOD COURT + HAK AKSES ----------
const USER_RE = /^[a-zA-Z0-9_.-]{3,50}$/;

// GET /api/dev/admin
export async function getAdminAccount(req, res) {
  const [r] = await pool.query("SELECT username, izin FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  res.json({ username: r[0]?.username || null, izin: parseIzin(r[0]?.izin), semua: IZIN_VALID });
}

// PUT /api/dev/admin  body: { username?, password?, izin?: [] }
// Buat akun admin (password wajib) atau ubah username / reset password / atur hak akses.
export async function setAdminAccount(req, res) {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  const izinList = Array.isArray(req.body?.izin) ? parseIzin(req.body.izin.map(String).join(",")) : null;
  const [ex] = await pool.query("SELECT id, username FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  const name = username || ex[0]?.username || "";
  if (!USER_RE.test(name)) throw new HttpError(400, "Username admin 3-50 karakter (huruf, angka, _ . -)");
  if ((!ex[0] || password) && password.length < 6) throw new HttpError(400, "Password admin minimal 6 karakter");
  try {
    if (!ex[0]) {
      await pool.query("INSERT INTO users (tenant_id, username, password, role, izin) VALUES (NULL, ?, ?, 'admin', ?)",
        [name, await bcrypt.hash(password, 10), (izinList || []).join(",")]);
    } else {
      const sets = [], vals = [];   // potongan SQL di bawah konstanta; semua nilai lewat placeholder
      if (name !== ex[0].username) { sets.push("username = ?"); vals.push(name); }
      if (password) { sets.push("password = ?"); vals.push(await bcrypt.hash(password, 10)); }
      if (izinList) { sets.push("izin = ?"); vals.push(izinList.join(",")); }
      if (sets.length) await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, [...vals, ex[0].id]);
    }
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") throw new HttpError(409, "Username sudah dipakai");
    throw err;
  }
  res.json({ message: "Akun admin diperbarui" });
}

// GET /api/dev/me -> role + hak akses terbaru (dibaca dari database)
export async function me(req, res) {
  res.json({ role: req.role, izin: req.role === "dev" ? IZIN_VALID : [...req.izin] });
}


// ---------- TAMBAHAN ----------

// PUT /api/dev/password  body: { lama, baru }  -> ganti password akun yang sedang login
export async function gantiPassword(req, res) {
  const lama = String(req.body?.lama || ""), baru = String(req.body?.baru || "");
  if (baru.length < 8) throw new HttpError(400, "Password baru minimal 8 karakter");
  if (baru === lama) throw new HttpError(400, "Password baru harus berbeda dari yang lama");
  const [r] = await pool.query("SELECT password FROM users WHERE id = ?", [req.userId]);
  if (!r[0] || !(await bcrypt.compare(lama, r[0].password))) throw new HttpError(400, "Password lama salah");
  await pool.query("UPDATE users SET password = ? WHERE id = ?", [await bcrypt.hash(baru, 10), req.userId]);
  res.json({ message: "Password berhasil diganti" });
}

// GET /api/dev/grafik?hari=7|30  -> penjualan harian, kantin terlaris, jam ramai
export async function getGrafik(req, res) {
  const hari = Math.min(Math.max(toInt(req.query.hari) || 7, 1), 90);
  const where = "ot.status_bayar = 'lunas' AND ot.status_order <> 'dibatalkan' AND ot.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)";
  const [harian] = await pool.query(
    `SELECT DATE_FORMAT(ot.created_at, '%Y-%m-%d') AS tanggal, COUNT(*) AS jumlah_order, COALESCE(SUM(ot.subtotal), 0) AS total
     FROM order_tenants ot WHERE ${where}
     GROUP BY DATE_FORMAT(ot.created_at, '%Y-%m-%d') ORDER BY DATE_FORMAT(ot.created_at, '%Y-%m-%d') ASC`,
    [hari - 1]
  );
  const [terlaris] = await pool.query(
    `SELECT t.nama_kantin, COUNT(*) AS jumlah_order, COALESCE(SUM(ot.subtotal), 0) AS total
     FROM order_tenants ot JOIN tenants t ON t.id = ot.tenant_id WHERE ${where}
     GROUP BY t.id, t.nama_kantin ORDER BY total DESC LIMIT 5`,
    [hari - 1]
  );
  const [jam] = await pool.query(
    `SELECT HOUR(ot.created_at) AS jam, COUNT(*) AS jumlah FROM order_tenants ot WHERE ${where}
     GROUP BY HOUR(ot.created_at) ORDER BY jumlah DESC LIMIT 3`,
    [hari - 1]
  );
  res.json({ hari, harian: harian.map(numRow), terlaris: terlaris.map(numRow), jam_ramai: jam.map(numRow) });
}

// GET /api/dev/audit?limit=100 -> log aktivitas (khusus dev)
export async function listAudit(req, res) {
  const limit = Math.min(Math.max(toInt(req.query.limit) || 100, 1), 300);
  const [rows] = await pool.query(
    `SELECT a.id, a.role, a.aksi, a.created_at, u.username
     FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.id DESC LIMIT ?`,
    [limit]
  );
  res.json(rows);
}

// POST /api/dev/setoran  body: { tenant_id, dari, sampai, nominal } -> catat setoran QRIS ke kantin
export async function createSetoran(req, res) {
  const tenantId = toInt(req.body?.tenant_id), nominal = toInt(req.body?.nominal);
  const dari = req.body?.dari, sampai = req.body?.sampai;
  if (Number.isNaN(tenantId) || Number.isNaN(nominal) || nominal <= 0 || !isDate(dari) || !isDate(sampai) || dari > sampai) {
    throw new HttpError(400, "Data setoran tidak valid");
  }
  const [t] = await pool.query("SELECT id FROM tenants WHERE id = ?", [tenantId]);
  if (!t[0]) throw new HttpError(404, "Kantin tidak ditemukan");
  await pool.query(
    "INSERT INTO setoran_qris (tenant_id, dari, sampai, nominal, user_id) VALUES (?, ?, ?, ?, ?)",
    [tenantId, dari, sampai, nominal, req.userId]
  );
  res.status(201).json({ message: "Setoran dicatat" });
}

// PATCH /api/dev/tables/:id  body: { nomor_meja }
export async function updateTable(req, res) {
  const id = toInt(req.params.id);
  const n = String(req.body?.nomor_meja || "").trim();
  if (Number.isNaN(id)) throw new HttpError(400, "ID tidak valid");
  if (!n || n.length > 10) throw new HttpError(400, "Nomor meja wajib diisi (maks. 10 karakter)");
  const [dup] = await pool.query("SELECT id FROM tables_fc WHERE nomor_meja = ? AND id <> ? LIMIT 1", [n, id]);
  if (dup[0]) throw new HttpError(409, "Nomor meja tersebut sudah ada");
  const [r] = await pool.query("UPDATE tables_fc SET nomor_meja = ? WHERE id = ?", [n, id]);
  if (r.affectedRows === 0) throw new HttpError(404, "Meja tidak ditemukan");
  res.json({ message: "Nomor meja diperbarui" });
}

// POST /api/dev/tables/:id/qr -> buat ulang kode QR (kode lama langsung tidak berlaku)
export async function regenerateQr(req, res) {
  const id = toInt(req.params.id);
  if (Number.isNaN(id)) throw new HttpError(400, "ID tidak valid");
  const [t] = await pool.query("SELECT nomor_meja FROM tables_fc WHERE id = ?", [id]);
  if (!t[0]) throw new HttpError(404, "Meja tidak ditemukan");
  await pool.query("UPDATE tables_fc SET qr_code = ? WHERE id = ?", [newQrCode(t[0].nomor_meja), id]);
  res.json({ message: "QR meja dibuat ulang. Cetak ulang QR-nya." });
}

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import bcrypt from "bcryptjs";
import { pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function columnInfo(table, column) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME, CHARACTER_MAXIMUM_LENGTH AS len, IS_NULLABLE AS nullable, DATA_TYPE AS type
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0] || null;
}

async function run(sql, label) {
  try {
    await pool.query(sql);
    if (label) console.log(`🛠  ${label}`);
  } catch (err) {
    console.warn(`⚠️  Migrasi dilewati (${label || sql.slice(0, 40)}): ${err.message}`);
  }
}

// 1) Buat tabel yang belum ada (+ data awal kalau kosong) dari sql/schema.sql
async function runSqlFile(name) {
  const file = path.resolve(__dirname, "../../sql", name);
  const raw = fs.readFileSync(file, "utf8");
  const cleaned = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const statements = cleaned.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    await pool.query(stmt);
  }
}

// 2) Upgrade database lama (dibuat dari schema versi sebelumnya)
async function ensureIndex(table, name, cols) {
  const [r] = await pool.query(
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ? LIMIT 1", [table, name]);
  if (!r[0]) await run(`CREATE INDEX ${name} ON ${table} (${cols})`, `index ${name} dibuat`);
}

async function upgradeLegacy() {
  const [[roleCol]] = await pool.query(
    "SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'role'"
  );
  if (roleCol && !String(roleCol.t).includes("'admin'")) {
    await run("ALTER TABLE users MODIFY COLUMN role ENUM('kasir','dev','admin') NOT NULL DEFAULT 'kasir'", "users.role + admin");
  }
  if (!(await columnInfo("users", "izin"))) await run("ALTER TABLE users ADD COLUMN izin VARCHAR(255) NULL", "users.izin ditambahkan");
  if (!(await columnInfo("tenants", "qris_image"))) {
    await run("ALTER TABLE tenants ADD COLUMN qris_image MEDIUMTEXT NULL", "tenants.qris_image ditambahkan");
  }
  if (!(await columnInfo("tenants", "qris_nama"))) {
    await run("ALTER TABLE tenants ADD COLUMN qris_nama VARCHAR(100) NULL", "tenants.qris_nama ditambahkan");
  }
  const tFoto = await columnInfo("tenants", "foto");
  if (tFoto && tFoto.type !== "mediumtext") {
    await run("ALTER TABLE tenants MODIFY COLUMN foto MEDIUMTEXT NULL", "tenants.foto -> MEDIUMTEXT");
  }
  const mFoto = await columnInfo("menus", "foto");
  if (mFoto && mFoto.type !== "mediumtext") {
    await run("ALTER TABLE menus MODIFY COLUMN foto MEDIUMTEXT NULL", "menus.foto -> MEDIUMTEXT");
  }
  const antrian = await columnInfo("order_tenants", "nomor_antrian");
  if (antrian && antrian.len < 20) {
    await run("ALTER TABLE order_tenants MODIFY COLUMN nomor_antrian VARCHAR(20) NOT NULL", "nomor_antrian diperlebar");
  }
  if (!(await columnInfo("order_tenants", "klaim_bayar"))) {
    await run("ALTER TABLE order_tenants ADD COLUMN klaim_bayar TINYINT(1) NOT NULL DEFAULT 0", "order_tenants.klaim_bayar ditambahkan");
  }
  if (!(await columnInfo("order_tenants", "catatan"))) {
    await run("ALTER TABLE order_tenants ADD COLUMN catatan VARCHAR(255) NULL", "order_tenants.catatan ditambahkan");
  }
  for (const [col, ddl] of [
    ["payment_ref", "VARCHAR(64) NULL"], ["qris_string", "TEXT NULL"], ["qris_expires_ms", "BIGINT NULL"],
    ["paid_at", "DATETIME NULL"], ["paid_via", "VARCHAR(20) NULL"]
  ]) {
    if (!(await columnInfo("order_tenants", col))) await run(`ALTER TABLE order_tenants ADD COLUMN ${col} ${ddl}`, `order_tenants.${col} ditambahkan`);
  }
  if (!(await columnInfo("order_tenants", "tipe_makan"))) {
    await run("ALTER TABLE order_tenants ADD COLUMN tipe_makan ENUM('dine_in','takeaway') NOT NULL DEFAULT 'dine_in'", "order_tenants.tipe_makan ditambahkan");
  }
  if (!(await columnInfo("order_items", "nama_menu"))) {
    await run("ALTER TABLE order_items ADD COLUMN nama_menu VARCHAR(100) NOT NULL DEFAULT ''", "order_items.nama_menu ditambahkan");
    await run(
      "UPDATE order_items oi JOIN menus m ON m.id = oi.menu_id SET oi.nama_menu = m.nama_menu WHERE oi.nama_menu = ''",
      "nama_menu lama diisi dari tabel menus"
    );
  }
  // Pembatalan pesanan: status baru + alasan + kantin bisa menyembunyikan pesanan dari tampilannya
  const [[stCol]] = await pool.query(
    "SELECT COLUMN_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'order_tenants' AND COLUMN_NAME = 'status_order'"
  );
  if (stCol && !String(stCol.t).includes("'dibatalkan'")) {
    await run("ALTER TABLE order_tenants MODIFY COLUMN status_order ENUM('diterima','diproses','siap','diambil','dibatalkan') NOT NULL DEFAULT 'diterima'", "order_tenants.status_order + dibatalkan");
  }
  for (const [col, ddl] of [
    ["alasan_batal", "VARCHAR(255) NULL"], ["dibatalkan_oleh", "VARCHAR(10) NULL"], ["dibatalkan_at", "DATETIME NULL"],
    ["disembunyikan_kantin", "TINYINT(1) NOT NULL DEFAULT 0"]
  ]) {
    if (!(await columnInfo("order_tenants", col))) await run(`ALTER TABLE order_tenants ADD COLUMN ${col} ${ddl}`, `order_tenants.${col} ditambahkan`);
  }
  if (!(await columnInfo("orders", "token_batal"))) await run("ALTER TABLE orders ADD COLUMN token_batal VARCHAR(32) NULL", "orders.token_batal ditambahkan");

  // Pembayaran dipindah ke tingkat checkout (1 QR untuk semua kantin)
  for (const [col, ddl] of [
    ["metode_bayar", "ENUM('qris','cash') NOT NULL DEFAULT 'cash'"], ["total", "INT NOT NULL DEFAULT 0"],
    ["biaya_layanan", "INT NOT NULL DEFAULT 0"], ["total_bayar", "INT NOT NULL DEFAULT 0"],
    ["status_bayar", "ENUM('pending','lunas') NOT NULL DEFAULT 'pending'"], ["payment_ref", "VARCHAR(64) NULL"],
    ["qris_string", "TEXT NULL"], ["qris_expires_ms", "BIGINT NULL"], ["paid_at", "DATETIME NULL"], ["paid_via", "VARCHAR(20) NULL"]
  ]) {
    if (!(await columnInfo("orders", col))) await run(`ALTER TABLE orders ADD COLUMN ${col} ${ddl}`, `orders.${col} ditambahkan`);
  }

  // FK order_items.menu_id harus ON DELETE SET NULL, supaya menu bisa dihapus tanpa merusak riwayat
  const [fks] = await pool.query(
    `SELECT k.CONSTRAINT_NAME AS name, r.DELETE_RULE AS rule
     FROM information_schema.KEY_COLUMN_USAGE k
     JOIN information_schema.REFERENTIAL_CONSTRAINTS r
       ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
     WHERE k.TABLE_SCHEMA = DATABASE() AND k.TABLE_NAME = 'order_items'
       AND k.COLUMN_NAME = 'menu_id' AND k.REFERENCED_TABLE_NAME = 'menus'`
  );
  if (fks.length === 0 || fks.some((fk) => fk.rule !== "SET NULL")) {
    for (const fk of fks) await run(`ALTER TABLE order_items DROP FOREIGN KEY \`${fk.name}\``);
    await run("ALTER TABLE order_items MODIFY COLUMN menu_id INT NULL");
    await run(
      "ALTER TABLE order_items ADD CONSTRAINT fk_oi_menu FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE SET NULL",
      "order_items.menu_id -> ON DELETE SET NULL"
    );
  }
}

// 3) Password plain-text (data dummy lama) -> bcrypt
async function hashPlainPasswords() {
  const [rows] = await pool.query("SELECT id, password FROM users WHERE password NOT LIKE '$2%'");
  for (const u of rows) {
    const hash = await bcrypt.hash(u.password, 10);
    await pool.query("UPDATE users SET password = ? WHERE id = ?", [hash, u.id]);
  }
  if (rows.length) console.log(`🔐 ${rows.length} password lama di-hash bcrypt`);
}

// Data awal hanya masuk SEKALI (database baru). Sebelumnya seed ikut jalan tiap start dan menghidupkan lagi
// akun default (admin_dev / kasir_* dengan password123) setelah dihapus atau di-rename.
async function seedIfFresh() {
  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM users");
  if (n === 0) {
    await runSqlFile("seed.sql");
    console.log("🌱 Data awal dimasukkan (database baru). Segera ganti password default!");
  }
}

async function ensureExtraTables() {
  await run(`CREATE TABLE IF NOT EXISTS audit_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    role VARCHAR(10) NULL,
    aksi VARCHAR(255) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`, "tabel audit_log siap");
  await run(`CREATE TABLE IF NOT EXISTS setoran_qris (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    dari DATE NOT NULL,
    sampai DATE NOT NULL,
    nominal INT NOT NULL,
    user_id INT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`, "tabel setoran_qris siap");
}

export async function migrate() {
  await runSqlFile("schema.sql");
  await upgradeLegacy();
  await ensureExtraTables();
  await ensureIndex("orders", "idx_orders_created", "created_at");
  await ensureIndex("order_tenants", "idx_ot_status_created", "status_bayar, created_at");
  await seedIfFresh();
  await hashPlainPasswords();
  console.log("✅ Skema database siap");
}

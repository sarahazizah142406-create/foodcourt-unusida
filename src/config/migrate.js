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
async function applySchemaFile() {
  const file = path.resolve(__dirname, "../../sql/schema.sql");
  const raw = fs.readFileSync(file, "utf8");
  const cleaned = raw.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const statements = cleaned.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    await pool.query(stmt);
  }
}

// 2) Upgrade database lama (dibuat dari schema versi sebelumnya)
async function upgradeLegacy() {
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

export async function migrate() {
  await applySchemaFile();
  await upgradeLegacy();
  await hashPlainPasswords();
  console.log("✅ Skema database siap");
}

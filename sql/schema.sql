-- ============================================================
-- FOOD COURT UNUSIDA — SKEMA MYSQL (aman dijalankan berulang)
-- Jalankan lewat DBeaver / phpMyAdmin / mysql CLI.
-- Database lama otomatis di-upgrade saat server start (src/config/migrate.js),
-- jadi file ini cukup dipakai untuk database baru / referensi.
-- ============================================================

SET NAMES utf8mb4;

-- 1. KANTIN
CREATE TABLE IF NOT EXISTS tenants (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nama_kantin   VARCHAR(100) NOT NULL,
  foto          MEDIUMTEXT NULL,
  qris_image    MEDIUMTEXT NULL,            -- URL gambar QRIS (Cloudinary) atau data-URL
  qris_nama     VARCHAR(100) NULL,          -- nama merchant yang tampil di QRIS
  status        ENUM('buka','tutup') NOT NULL DEFAULT 'buka',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. USER (kasir per kantin ATAU developer)
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id     INT NULL,
  username      VARCHAR(50) NOT NULL UNIQUE,
  password      VARCHAR(255) NOT NULL,      -- hash bcrypt
  role          ENUM('kasir','dev') NOT NULL DEFAULT 'kasir',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. MEJA + QR  ("table" reserved word, jadi dinamai tables_fc)
CREATE TABLE IF NOT EXISTS tables_fc (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  nomor_meja    VARCHAR(10) NOT NULL,
  qr_code       VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. MENU PER KANTIN
CREATE TABLE IF NOT EXISTS menus (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id     INT NOT NULL,
  nama_menu     VARCHAR(100) NOT NULL,
  harga         INT NOT NULL,
  foto          MEDIUMTEXT NULL,
  status        ENUM('tersedia','habis') NOT NULL DEFAULT 'tersedia',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_menus_tenant (tenant_id),
  CONSTRAINT fk_menus_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. ORDER HEADER (1 kali checkout, bisa multi-kantin)
CREATE TABLE IF NOT EXISTS orders (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  table_id      INT NOT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_table FOREIGN KEY (table_id) REFERENCES tables_fc(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. SUB-ORDER PER KANTIN (pembayaran menempel di sini)
CREATE TABLE IF NOT EXISTS order_tenants (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  order_id      INT NOT NULL,
  tenant_id     INT NOT NULL,
  nomor_antrian VARCHAR(20) NOT NULL,
  metode_bayar  ENUM('qris','cash') NOT NULL,
  status_bayar  ENUM('pending','lunas') NOT NULL DEFAULT 'pending',
  status_order  ENUM('diterima','diproses','siap','diambil') NOT NULL DEFAULT 'diterima',
  subtotal      INT NOT NULL,
  catatan       VARCHAR(255) NULL,
  tipe_makan    ENUM('dine_in','takeaway') NOT NULL DEFAULT 'dine_in',  -- makan di tempat / bungkus
  klaim_bayar   TINYINT(1) NOT NULL DEFAULT 0,   -- pelanggan menekan "Saya sudah bayar"
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ot_tenant_created (tenant_id, created_at),
  INDEX idx_ot_order (order_id),
  CONSTRAINT fk_ot_order  FOREIGN KEY (order_id)  REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_ot_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. DETAIL ITEM (menu_id boleh NULL kalau menu dihapus; nama disimpan sebagai snapshot)
CREATE TABLE IF NOT EXISTS order_items (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  order_tenant_id INT NOT NULL,
  menu_id         INT NULL,
  nama_menu       VARCHAR(100) NOT NULL,
  qty             INT NOT NULL,
  harga_satuan    INT NOT NULL,
  INDEX idx_oi_ot (order_tenant_id),
  CONSTRAINT fk_oi_ot   FOREIGN KEY (order_tenant_id) REFERENCES order_tenants(id) ON DELETE CASCADE,
  CONSTRAINT fk_oi_menu FOREIGN KEY (menu_id) REFERENCES menus(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 8. COUNTER NOMOR ANTRIAN per kantin per hari (anti race-condition)
CREATE TABLE IF NOT EXISTS queue_counters (
  tenant_id     INT NOT NULL,
  tanggal       DATE NOT NULL,
  last_no       INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, tanggal),
  CONSTRAINT fk_qc_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- DATA AWAL (hanya masuk kalau tabel masih kosong)
-- Semua password awal: password123  (sudah di-hash bcrypt)
-- GANTI setelah login pertama.
-- ============================================================
INSERT INTO tenants (nama_kantin, status)
SELECT * FROM (
  SELECT 'Kantin Bu Siti' AS n, 'buka' AS s UNION ALL SELECT 'Kantin Pak Joko','buka'
  UNION ALL SELECT 'Warung Nasi Padang','buka' UNION ALL SELECT 'Kedai Mie Ayam','buka'
  UNION ALL SELECT 'Kantin Sehat','buka'       UNION ALL SELECT 'Warung Soto','buka'
  UNION ALL SELECT 'Kedai Jajanan','buka'      UNION ALL SELECT 'Kantin Minuman & Snack','buka'
) x WHERE NOT EXISTS (SELECT 1 FROM tenants);

INSERT INTO users (tenant_id, username, password, role)
SELECT t.id, u.username, '$2a$10$NXa2//Ob3srGUPinkIU/Z.Joo/DXEbE6hRfbGfkJR5VhLUwVXTuC6', 'kasir'
FROM (
  SELECT 'Kantin Bu Siti' AS nama, 'kasir_siti' AS username
  UNION ALL SELECT 'Kantin Pak Joko','kasir_joko'
  UNION ALL SELECT 'Warung Nasi Padang','kasir_padang'
  UNION ALL SELECT 'Kedai Mie Ayam','kasir_mieayam'
  UNION ALL SELECT 'Kantin Sehat','kasir_sehat'
  UNION ALL SELECT 'Warung Soto','kasir_soto'
  UNION ALL SELECT 'Kedai Jajanan','kasir_jajanan'
  UNION ALL SELECT 'Kantin Minuman & Snack','kasir_minuman'
) u JOIN tenants t ON t.nama_kantin = u.nama
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = u.username);

INSERT INTO users (tenant_id, username, password, role)
SELECT NULL, 'admin_dev', '$2a$10$NXa2//Ob3srGUPinkIU/Z.Joo/DXEbE6hRfbGfkJR5VhLUwVXTuC6', 'dev'
WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin_dev');

INSERT INTO tables_fc (nomor_meja, qr_code)
SELECT * FROM (
  SELECT '01' AS n, 'MEJA-01-A1B2C3' AS q UNION ALL SELECT '02','MEJA-02-D4E5F6'
  UNION ALL SELECT '03','MEJA-03-G7H8I9'
) x WHERE NOT EXISTS (SELECT 1 FROM tables_fc);

INSERT INTO menus (tenant_id, nama_menu, harga)
SELECT t.id, m.nama, m.harga
FROM (
  SELECT 'Kantin Bu Siti' AS k, 'Es Kopi Susu' AS nama, 8000 AS harga
  UNION ALL SELECT 'Kantin Bu Siti','Kopi Hitam',5000
  UNION ALL SELECT 'Kantin Pak Joko','Ayam Geprek',12000
  UNION ALL SELECT 'Kantin Pak Joko','Nasi Goreng',10000
  UNION ALL SELECT 'Warung Nasi Padang','Nasi Padang Ayam',15000
  UNION ALL SELECT 'Warung Nasi Padang','Nasi Padang Rendang',18000
  UNION ALL SELECT 'Kedai Mie Ayam','Mie Ayam Biasa',10000
  UNION ALL SELECT 'Kedai Mie Ayam','Mie Ayam Bakso',13000
  UNION ALL SELECT 'Kantin Sehat','Gado-Gado',11000
  UNION ALL SELECT 'Kantin Sehat','Salad Buah',9000
  UNION ALL SELECT 'Warung Soto','Soto Ayam',12000
  UNION ALL SELECT 'Warung Soto','Soto Daging',15000
  UNION ALL SELECT 'Kedai Jajanan','Risoles',3000
  UNION ALL SELECT 'Kedai Jajanan','Pisang Goreng',5000
  UNION ALL SELECT 'Kantin Minuman & Snack','Es Teh',4000
  UNION ALL SELECT 'Kantin Minuman & Snack','Es Jeruk',5000
) m JOIN tenants t ON t.nama_kantin = m.k
WHERE NOT EXISTS (SELECT 1 FROM menus);

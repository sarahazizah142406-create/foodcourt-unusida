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
  role          ENUM('kasir','dev','admin') NOT NULL DEFAULT 'kasir',
  izin          VARCHAR(255) NULL,          -- hak akses admin (dipisah koma), diatur dari Panel Dev
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
  metode_bayar  ENUM('qris','cash') NOT NULL DEFAULT 'cash',
  total         INT NOT NULL DEFAULT 0,
  biaya_layanan INT NOT NULL DEFAULT 0,
  total_bayar   INT NOT NULL DEFAULT 0,
  status_bayar  ENUM('pending','lunas') NOT NULL DEFAULT 'pending',
  payment_ref   VARCHAR(64) NULL,
  qris_string   TEXT NULL,
  qris_expires_ms BIGINT NULL,
  paid_at       DATETIME NULL,
  paid_via      VARCHAR(20) NULL,
  token_batal   VARCHAR(32) NULL,               -- rahasia pelanggan untuk membatalkan pesanannya sendiri
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
  status_order  ENUM('diterima','diproses','siap','diambil','dibatalkan') NOT NULL DEFAULT 'diterima',
  subtotal      INT NOT NULL,
  catatan       VARCHAR(255) NULL,
  tipe_makan    ENUM('dine_in','takeaway') NOT NULL DEFAULT 'dine_in',  -- makan di tempat / bungkus
  klaim_bayar   TINYINT(1) NOT NULL DEFAULT 0,   -- pelanggan menekan "Saya sudah bayar"
  payment_ref   VARCHAR(64) NULL,                -- order_id terakhir yang dikirim ke payment gateway
  qris_string   TEXT NULL,                       -- isi QRIS dinamis (nominal otomatis) dari gateway
  qris_expires_ms BIGINT NULL,                   -- kapan QR dinamis kedaluwarsa (epoch ms)
  paid_at       DATETIME NULL,
  paid_via      VARCHAR(20) NULL,                -- 'gateway' (otomatis) / 'kasir' (manual)
  alasan_batal  VARCHAR(255) NULL,               -- alasan pembatalan (diisi kantin, atau pelanggan)
  dibatalkan_oleh VARCHAR(10) NULL,              -- 'kantin' / 'pelanggan'
  dibatalkan_at DATETIME NULL,
  disembunyikan_kantin TINYINT(1) NOT NULL DEFAULT 0,  -- kantin "menghapus" pesanan dari tampilannya (data & laporan tetap aman)
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

-- 9. TOKEN PERANGKAT untuk push notification (aplikasi Android kantin)
CREATE TABLE IF NOT EXISTS device_tokens (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id   INT NOT NULL,
  token       VARCHAR(512) NOT NULL,
  platform    VARCHAR(20) NOT NULL DEFAULT 'android',
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_device_token (token),
  KEY idx_device_tenant (tenant_id),
  CONSTRAINT fk_dt_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- DATA AWAL (hanya masuk kalau tabel masih kosong)
-- Semua password awal: password123  (sudah di-hash bcrypt)
-- GANTI setelah login pertama.
-- ============================================================

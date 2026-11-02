-- DATA AWAL: hanya dijalankan SEKALI, saat tabel users masih kosong (database baru).
-- Password awal: password123 -> GANTI segera. Tidak ada akun admin food court di sini: buat dari Panel Dev.
SET NAMES utf8mb4;

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

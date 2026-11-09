# Food Court UNUSIDA

Sistem pemesanan food court multi-kantin: pelanggan scan QR di meja, pesan dari beberapa
kantin, **bayar sekali lewat satu QRIS (semua kantin) atau cash**, dan memantau status pesanan realtime.

Panduan lengkap pemakaian & hosting: lihat **PANDUAN.md**.

Tiga tampilan, satu server:

| Alamat | Untuk | Login |
|---|---|---|
| `/customer/?qr=<kode-meja>` | Pelanggan (dari scan QR meja) | tanpa login |
| `/kantin/` | Kasir / staf kantin | akun kasir per kantin |
| `/dev/` | Admin food court | akun admin |

## Menjalankan

```bash
npm install
cp .env.example .env     # lalu isi DB_* dan JWT_SECRET
npm start                # atau: npm run dev
```

Server otomatis **membuat tabel & data awal**, dan **meng-upgrade database lama**
(menambah kolom pembayaran, meng-hash password plain-text, dll.). Tidak perlu menjalankan SQL manual.
Setelah jalan, buka `http://localhost:3000/dev/`.

Login awal (password semua: `password123` — **segera ganti** lewat Panel Admin → Akun):
- **Admin**: `admin_dev` (superuser/dev), `mia_tif` (admin)
- **Kantin/Kasir**: `bunda_iin`, `nasi_campur`, `bu_ayu`, `bu_tutik`, `bu_nanik`, `bu_tatik`, `kasir_minuman`

MySQL lokal (bukan Aiven): isi `DB_SSL=false` di `.env`.

## Pembayaran QRIS (GoPay Merchant + Mutasiku, satu QR untuk semua kantin)

- Pelanggan bisa memesan dari beberapa kantin sekaligus dan membayar **satu kali** dengan **satu QR** bernominal gabungan.
- Begitu Mutasiku menandai pembayaran PAID, semua pesanan ikut **lunas otomatis** dan kasir tiap kantin mendengar nada "bayar masuk".
- QRIS tidak bisa ditandai lunas manual. Cash dikonfirmasi kasir tiap kantin.
- Uang QRIS masuk ke **satu akun GoPay Merchant** milik pengelola. Hasil per kantin per metode bayar ada di **Panel Admin, tab Rekap** (bisa diunduh CSV) sebagai dasar penyetoran ke kantin.
- Pengaturan lengkap (variabel `.env`, webhook, mode simulasi `MUTASIKU_MOCK=true`) ada di **PANDUAN.md bagian E**.
- **Penting:** isi `MUTASIKU_API_KEY`, `MUTASIKU_WALLET_ACCOUNT_ID`, dan daftarkan webhook (lihat PANDUAN bagian E).

## Cetak nota

Di dashboard kantin, tiap pesanan punya tombol cetak. Nota (struk) memakai dialog cetak browser dan
bisa ke printer thermal 58 mm atau 80 mm (ubah dengan tombol "Nota 58/80 mm" di filter pesanan).

## QR meja

Panel Admin → tab **Meja & QR**: tambah meja (satu / rentang), lihat QR, dan **Cetak semua QR**.
QR mengarah ke alamat tempat panel dibuka, jadi buka panel dari domain/IP final sebelum mencetak.

## Deploy (Render + opsional Vercel)

Cara termudah: **deploy server saja di Render** — frontend ikut dilayani dari server yang sama
(`https://nama-app.onrender.com/customer/?qr=...`), tidak perlu mengatur `config.js`.

1. Push ke GitHub → Render → New Web Service (`render.yaml` sudah siap).
2. Isi env: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` (+ `DB_SSL=true`). `JWT_SECRET` dibuat otomatis.
3. Buka `/dev/` dari URL Render, lalu cetak QR meja dari sana.

Kalau frontend dipisah (mis. Vercel, Root Directory = `frontend`), ganti `PRODUCTION_API` di `frontend/config.js`
dengan URL Render, dan isi `CORS_ORIGIN` di Render dengan domain Vercel.
Render Free bisa "tidur" bila sepi; permintaan pertama bisa ~1 menit.

## Foto menu / kantin

Gambar dikecilkan otomatis di browser sebelum diunggah.
- **Tanpa Cloudinary**: gambar disimpan langsung di database (cukup untuk demo).
- **Dengan Cloudinary**: isi `CLOUDINARY_*` di `.env`, gambar disimpan di Cloudinary (disarankan untuk produksi).

## Struktur

```
src/        server.js, routes/, controllers/, middleware/, config/ (db, migrate, images)
sql/        schema.sql (skema + data awal, aman dijalankan berulang)
frontend/   customer/, kantin/, dev/, shared/ (desain & helper bersama), vendor/ (socket.io, qrcode)
```

## Yang diperbaiki dari versi sebelumnya

- **Database**: skema bisa dijalankan berulang, auto-migrasi DB lama, kolom pembayaran per pesanan, nomor antrian atomik
  (tidak bentrok saat order bersamaan), nama menu disimpan di riwayat (menu boleh dihapus), zona waktu WIB.
- **Keamanan**: password bcrypt (termasuk akun lama), rate-limit login/checkout, harga & ketersediaan menu
  divalidasi di server, socket kasir butuh token, upload gambar diverifikasi isinya, XSS ditutup.
- **Fitur**: satu QRIS untuk semua kantin (GoPay Merchant + Mutasiku), pencarian yang membandingkan harga antar kedai, cetak nota, rekap pembayaran per kantin, catatan pesanan, buka/tutup kantin
  oleh kasir, hapus menu, laporan (per hari, QRIS vs cash, menu terlaris), notifikasi suara (pesanan baru, bayar masuk, pesanan siap),
  kelola meja & cetak QR, reset password kasir.
- **Tampilan**: desain baru yang hangat & konsisten (font Plus Jakarta Sans, ukuran wajar), responsif
  HP/tablet/desktop, tanpa gambar placeholder dari internet.


---

## 🔒 Mencegah SQL Injection

SQL injection terjadi ketika input pengguna ikut **dirangkai menjadi teks SQL**, sehingga input bisa mengubah arti query. Contoh buruk:

```js
// ❌ BAHAYA: username = "' OR '1'='1" melewati login
pool.query(`SELECT * FROM users WHERE username = '${username}'`);
```

### Aturan yang dipakai di proyek ini

1. **Selalu pakai placeholder `?`** (prepared/parameterized query). Nilai dikirim terpisah dari SQL, jadi tidak pernah dieksekusi sebagai perintah.
   ```js
   // ✅ AMAN
   pool.query("SELECT * FROM users WHERE username = ?", [username]);
   pool.query("SELECT * FROM menus WHERE tenant_id = ? AND id IN (?)", [tenantId, ids]);
   ```
2. **Jangan pernah menyisipkan input ke SQL dengan template string** (`${...}`) atau penjumlahan string, termasuk untuk `LIMIT`, `OFFSET`, `ORDER BY`.
3. **Nama kolom / tabel / arah sort tidak bisa pakai `?`** → gunakan *whitelist*:
   ```js
   const SORT = { nama: "nama_menu", harga: "harga" };
   const col = SORT[req.query.sort] ?? "nama_menu";   // input tak dikenal → default
   pool.query(`SELECT * FROM menus ORDER BY ${col}`);  // col berasal dari konstanta kita
   ```
4. **Validasi tipe input di server** sebelum dipakai: angka lewat `toInt()` (`src/utils.js`), tanggal lewat regex `YYYY-MM-DD`, enum (`status`, `metode_bayar`) lewat daftar yang diperbolehkan.
5. **Harga & total selalu dihitung dari database**, bukan dari data yang dikirim browser (lihat `checkout` di `customerController.js`).
6. **Hak akses database minimal**: user MySQL aplikasi cukup `SELECT, INSERT, UPDATE, DELETE` pada database ini, jangan `root` / `DROP` / `FILE`.
7. **Jangan bocorkan error SQL ke pengguna**. Error handler di `server.js` hanya mengirim pesan umum; detail cukup di log server.
8. **Defense in depth**: rate limit login (`express-rate-limit`), password di-hash `bcrypt`, JWT untuk kasir/admin, `helmet` untuk header keamanan.
9. **Output di frontend di-escape** dengan `esc()` (mencegah XSS, yang sering dipasangkan dengan injeksi data).

### Checklist sebelum menambah query baru

- [ ] Semua nilai dari `req.body / req.query / req.params` masuk lewat `?`
- [ ] Bagian dinamis non-nilai (kolom, sort) berasal dari whitelist
- [ ] Angka/tanggal/enum sudah divalidasi
- [ ] Tidak ada `${input}` di dalam string SQL

### Cara mengetes cepat

Coba isi kolom login / pencarian dengan `' OR '1'='1`, `"; DROP TABLE users; --`, atau `1 UNION SELECT ...`. Aplikasi harus menganggapnya teks biasa (login gagal / hasil kosong), bukan error SQL.

---

## 🧹 Pembersihan Pesanan Otomatis

Pesanan dari hari sebelumnya dibersihkan otomatis (saat server start, lalu tiap 30 menit) oleh `src/config/cleanup.js`:

- Pesanan **belum dibayar** & belum selesai (mis. QRIS mode demo yang tidak pernah diklik "bayar") → dibatalkan otomatis oleh sistem.
- Semua pesanan **sebelum hari ini** → disembunyikan dari dashboard kantin.
- Data tetap ada di database; laporan hanya menghitung pesanan lunas yang tidak dibatalkan.

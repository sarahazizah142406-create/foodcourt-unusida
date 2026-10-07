# Food Court UNUSIDA

Sistem pemesanan food court multi-kantin: pelanggan scan QR di meja, pesan dari beberapa
kantin, **bayar QRIS / cash langsung ke tiap kantin**, dan memantau status pesanan realtime.

Panduan lengkap pemakaian & hosting: lihat **PANDUAN.md**.

Tiga tampilan, satu server:

| Alamat | Untuk | Login |
|---|---|---|
| `/customer/?qr=<kode-meja>` | Pelanggan (dari scan QR meja) | tanpa login |
| `/kantin/` | Kasir / staf kantin | akun kasir per kantin |
| `/dev/` | Developer / admin food court | akun dev |

## Menjalankan

```bash
npm install
cp .env.example .env     # lalu isi DB_* dan JWT_SECRET
npm start                # atau: npm run dev
```

Server otomatis **membuat tabel & data awal**, dan **meng-upgrade database lama**
(menambah kolom QRIS, meng-hash password plain-text, dll.). Tidak perlu menjalankan SQL manual.
Setelah jalan, buka `http://localhost:3000/dev/`.

Login awal (password semua: `password123` — **segera ganti** lewat Panel Dev → Akun):
`admin_dev` (dev), `kasir_siti`, `kasir_joko`, `kasir_padang`, `kasir_mieayam`,
`kasir_sehat`, `kasir_soto`, `kasir_jajanan`, `kasir_minuman`.

MySQL lokal (bukan Aiven): isi `DB_SSL=false` di `.env`.

## Cara pasang QRIS tiap kantin (Panel Dev)

1. Login `/dev/` → tab **Kantin & QRIS**.
2. Pada kartu kantin, klik bagian **QRIS** → upload gambar QRIS kantin itu → isi nama merchant → **Simpan**.
   (Kantin baru: bisa langsung diupload saat *Tambah kantin*.)
3. Selesai. Pelanggan yang memilih QRIS di kantin tersebut akan melihat QR kantin itu beserta nominalnya.
   Kantin tanpa QRIS otomatis hanya bisa bayar **Cash**.

Alur pembayaran QRIS: pelanggan scan & bayar → tekan **"Saya sudah bayar"** → kasir mendapat notifikasi,
mengecek dana masuk di aplikasi merchant-nya → menekan **tandai lunas**. Sistem hanya mencatat status;
uang masuk langsung ke rekening/e-wallet kantin (tidak lewat sistem).

## QR meja

Panel Dev → tab **Meja & QR**: tambah meja (satu / rentang), lihat QR, dan **Cetak semua QR**.
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

## Foto menu / kantin / QRIS

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

- **Database**: skema bisa dijalankan berulang, auto-migrasi DB lama, kolom QRIS, nomor antrian atomik
  (tidak bentrok saat order bersamaan), nama menu disimpan di riwayat (menu boleh dihapus), zona waktu WIB.
- **Keamanan**: password bcrypt (termasuk akun lama), rate-limit login/checkout, harga & ketersediaan menu
  divalidasi di server, socket kasir butuh token, upload gambar diverifikasi isinya, XSS ditutup.
- **Fitur**: QRIS per kantin, tombol "sudah bayar" + konfirmasi kasir, catatan pesanan, buka/tutup kantin
  oleh kasir, hapus menu, laporan (per hari, QRIS vs cash, menu terlaris), notifikasi suara pesanan baru,
  kelola meja & cetak QR, reset password kasir.
- **Tampilan**: desain baru yang hangat & konsisten (font Plus Jakarta Sans, ukuran wajar), responsif
  HP/tablet/desktop, tanpa gambar placeholder dari internet.

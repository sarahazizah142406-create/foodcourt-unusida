# Panduan Food Court UNUSIDA

## A. Panduan pemakaian

### Pelanggan (`/customer/?qr=<kode-meja>`)
1. Scan QR di meja → beranda terbuka. Cari kantin **atau nama makanan** di kolom pencarian.
2. Pilih kantin → tekan **+** pada menu → buka **Keranjang** (navbar bawah).
3. Pilih cara bayar per kantin (QRIS / Cash), isi catatan, tekan **Pesan**.
4. **QRIS**: scan QR kantin, bayar sesuai nominal, lalu tekan **Selesai bayar, kembali ke beranda**. Kasir langsung mendapat notifikasi dan mengecek dana masuk.
   **Cash**: sebutkan nomor antrian dan bayar di kasir.
5. Pantau status di tab **Pesanan** (Diterima → Dimasak → Siap → Selesai). Ada getar/notifikasi saat siap.

### Kasir (`/kantin/`)
- Login dengan akun kasir. Tab **Pesanan**: proses pesanan (Mulai proses → Tandai siap → Sudah diambil). Bunyi bip saat ada pesanan baru.
- Pesanan QRIS bertanda "pelanggan sudah bayar": cek aplikasi merchant-mu, lalu tekan **tandai lunas**.
- Tab **Menu**: tambah/ubah menu, foto, harga, tandai habis. Tombol **Buka/Tutup** di header.
- Tab **Laporan** (omzet, menu terlaris) dan **QRIS** (QR milik kantin).

### Developer (`/dev/`)
- **Kantin & QRIS**: tambah kantin + akun kasir, **upload foto kantin asli**, pasang QRIS tiap kantin.
- **Meja & QR**: tambah meja, **Cetak semua QR**, tempel di meja. Cetak setelah panel dibuka dari domain final.
- **Logo**: simpan file di `frontend/assets/logo.png`.
- Ganti semua password bawaan (`password123`) lewat panel.

## B. Menjalankan di komputer sendiri
```bash
npm install
cp .env.example .env     # isi DB_*, JWT_SECRET
npm start                # buka http://localhost:3000/dev/
```
MySQL lokal: `DB_SSL=false`. Tabel dibuat otomatis saat server pertama jalan.
Tes dari HP: satu Wi-Fi, buka `http://<IP-komputer>:3000/customer/?qr=<kode>`.

## C. Hosting (gratis / murah)

### 1. Database — Aiven MySQL
1. Daftar di aiven.io → Create service → **MySQL** (Free plan).
2. Dari *Connection information* catat Host, Port, User, Password, Database name. SSL wajib (`DB_SSL=true`).

### 2. (Opsional, disarankan) Foto — Cloudinary
Daftar cloudinary.com (gratis) → ambil Cloud name, API key, API secret. Tanpa ini foto disimpan di database (maks ~900 KB per gambar).

### 3. Server + tampilan — Render
1. Push folder proyek ke **GitHub** (jangan commit `.env`).
2. render.com → New → **Web Service** → pilih repo (`render.yaml` sudah siap).
3. Isi Environment: `DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, DB_SSL=true`, serta `CLOUDINARY_*` bila dipakai. `JWT_SECRET` dibuat otomatis.
4. Deploy. Buka `https://nama-app.onrender.com/dev/`, login `admin_dev` / `password123`, **langsung ganti password**.
5. Paket Free Render bisa "tidur" saat sepi (permintaan pertama ±1 menit). Untuk dipakai harian, naik ke paket berbayar atau ping `/api/health` berkala (mis. UptimeRobot).

### 4. Domain sendiri (opsional)
Render → Settings → Custom Domains → tambahkan domain, atur CNAME di penyedia domain. HTTPS otomatis. Setelah domain final, **cetak ulang QR meja** dari panel Dev.

### 5. Frontend terpisah di Vercel (opsional)
Tidak wajib. Jika dipakai: Root Directory = `frontend`, ubah `PRODUCTION_API` di `frontend/config.js` ke URL Render, dan isi `CORS_ORIGIN` di Render dengan domain Vercel.

## D. Checklist sebelum dipakai
- [ ] Password dev & semua kasir sudah diganti
- [ ] QRIS tiap kantin diupload, foto kantin asli diupload, logo dipasang
- [ ] Meja dibuat, QR dicetak dari domain final, dites scan dari HP
- [ ] Coba 1 pesanan QRIS dan 1 Cash sampai status Selesai
- [ ] `JWT_SECRET` panjang & rahasia; `.env` tidak masuk GitHub

## E. Catatan pembayaran QRIS
Memakai QRIS statis milik kantin, jadi uang masuk langsung ke kantin dan sistem **tidak bisa mendeteksi pembayaran otomatis**. Karena itu pelanggan menekan tombol selesai bayar dan kasir tetap memverifikasi. Untuk status lunas otomatis, perlu payment gateway QRIS dinamis (mis. Midtrans / Xendit) — itu pengembangan terpisah.

## F. Masalah umum
- **Gambar gagal upload**: kecilkan gambar atau pasang Cloudinary.
- **Tidak bisa terhubung ke server**: server Render sedang "tidur", tunggu ±1 menit.
- **QR meja salah alamat**: buka panel Dev dari domain final lalu cetak ulang.

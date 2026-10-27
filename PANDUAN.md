# Panduan Food Court UNUSIDA

## A. Panduan pemakaian

### Pelanggan (`/customer/?qr=<kode-meja>`)
1. Scan QR di meja → beranda terbuka. Cari kantin **atau nama makanan** di kolom pencarian.
2. Pilih kantin → tekan **+** pada menu → buka **Keranjang** (navbar bawah).
3. Pilih cara bayar per kantin (QRIS / Cash), isi catatan, tekan **Pesan**.
4. **QRIS (otomatis)**: scan QR yang muncul, nominal sudah terisi sesuai pesanan. Setelah bayar, halaman otomatis menandai **lunas** dan kembali ke beranda; kasir langsung mendapat notifikasi. QR berlaku 15 menit dan dibuat ulang otomatis bila habis.
   *(Jika QRIS otomatis belum diaktifkan, sistem memakai QRIS statis kantin: pelanggan menekan "Selesai bayar" lalu kasir mengecek.)*
   **Cash**: sebutkan nomor antrian dan bayar di kasir.
5. Pantau status di tab **Pesanan** (Diterima → Dimasak → Siap → Selesai). Ada getar/notifikasi saat siap.

### Kasir (`/kantin/`)
- Login dengan akun kasir. Tab **Pesanan**: proses pesanan (Mulai proses → Tandai siap → Sudah diambil). Bunyi bip saat ada pesanan baru.
- Pesanan QRIS otomatis langsung berstatus **Lunas otomatis via QRIS** (bunyi bip + notifikasi). Tombol tandai lunas hanya perlu untuk Cash atau mode QRIS statis.
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

## E. QRIS otomatis (GoPay Merchant + Mutasiku) — satu QR untuk semua kantin

Uang QRIS masuk ke **satu akun GoPay Merchant** milik pengelola. Mutasiku membuat QR dinamis, memantau mutasi akun itu, dan menandai pembayaran `PAID` begitu uang masuk.

**Cara kerja**
1. Pelanggan pilih QRIS -> server memanggil `POST /api/v1/payments` (tipe `QRIS-DYNAMIC`) -> Mutasiku mengembalikan gambar QR, total bayar, dan masa berlaku.
2. Bila Mutasiku menambahkan kode unik ke nominal, selisihnya tampil di halaman pelanggan sebagai "biaya layanan".
3. Saat uang masuk, Mutasiku mengirim webhook `payment.completed`. Server memverifikasi tanda tangan HMAC, lalu **konfirmasi ulang** ke API status sebelum menandai lunas. Sebagai cadangan, server juga menanyakan status tiap 8 detik.

**Pengaturan**
1. Daftar di mutasiku.co.id, beli poin, lalu tambah akun **GoPay Merchant** (login nomor HP + OTP WhatsApp/SMS).
2. Ambil **API key** dari dashboard dan **ID akun** GoPay Merchant (UUID, dari `GET /api/v1/accounts`). Isi `MUTASIKU_API_KEY` dan `MUTASIKU_WALLET_ACCOUNT_ID`.
3. Isi `MUTASIKU_REDIRECT_URL` dengan alamat aplikasimu.
4. Di dashboard Mutasiku, **Settings -> Webhooks**: tambah `https://DOMAIN-KAMU/api/payments/mutasiku/notify`, pilih event `payment.completed`, lalu isi secret-nya ke `MUTASIKU_WEBHOOK_SECRET`.
5. Restart server, tes dengan nominal kecil dulu.

**Tanpa GoPay/Mutasiku (tes / demo):** isi `MUTASIKU_MOCK=true`. QR palsu, ada tombol **Simulasi bayar**.

**Catatan penting**
- Mutasiku membaca akun lewat login atas namamu (bukan API resmi GoPay). Cek syarat layanan GoPay Merchant dan Mutasiku, pakai akun khusus kantin, dan siapkan Cash sebagai cadangan.
- Ada biaya per transaksi di Mutasiku (cek halaman harga mereka; informasi di situsnya belum seragam, konfirmasi ke support).
- Rincian setoran per kantin ada di panel Dev, tab **Rekap** (bisa diunduh CSV).
- Jika variabel di atas kosong, pilihan QRIS nonaktif dan pelanggan hanya bisa Cash.

## F. Masalah umum
- **Gambar gagal upload**: kecilkan gambar atau pasang Cloudinary.
- **Tidak bisa terhubung ke server**: server Render sedang "tidur", tunggu ±1 menit.
- **QR meja salah alamat**: buka panel Dev dari domain final lalu cetak ulang.

## F. Notifikasi

| Siapa | Kejadian | Suara | Notifikasi sistem + judul tab berkedip |
|---|---|---|---|
| Kasir | Pesanan Cash masuk | ding-dong | ya |
| Kasir | Pesanan QRIS masuk (belum bayar) | bunyi pendek, tanpa alarm | tidak |
| Kasir | Pembayaran QRIS masuk (siap diproses) | ding-dong | ya |
| Kasir | Masih ada pesanan siap-proses yang belum disentuh | bunyi ulang tiap 45 detik | tidak |
| Pelanggan | Pembayaran berhasil | nada naik + getar | ya |
| Pelanggan | Pesanan siap diambil | nada panjang + getar + banner | ya |

- Suara dibunyikan lewat Web Audio dan baru aktif setelah pengguna menyentuh layar sekali (aturan browser). Tombol bel di pojok mematikan/menyalakan suara.
- Notifikasi sistem butuh **izin browser**. Izin diminta saat kasir pertama kali menyentuh layar / menekan bel, dan saat pelanggan menekan "Pesan". Notifikasi sistem hanya muncul saat halaman **tidak sedang dilihat** (tab lain / aplikasi di latar belakang).
- Batasan: notifikasi bekerja selama halamannya masih terbuka. Kalau browser benar-benar ditutup, notifikasi tidak bisa masuk (butuh Web Push dengan server push, belum dipasang). Untuk HP kasir, biarkan halaman dashboard terbuka dan layar tidak dimatikan total.
- Notifikasi memakai service worker `/sw.js`. Di HP, notifikasi sistem butuh HTTPS (domain Railway sudah HTTPS).

## G. Aplikasi Android kantin (APK + notifikasi saat aplikasi ditutup)

Halaman kasir `/kantin/` dibungkus jadi APK memakai Capacitor. APK memuat halaman dari server online, jadi setiap deploy ulang otomatis memperbarui isi aplikasi. Socket tetap realtime saat aplikasi terbuka; saat aplikasi ditutup atau HP terkunci, notifikasi datang lewat push Firebase (FCM, gratis). Push dikirim untuk pesanan **Cash** baru dan pembayaran **QRIS lunas**.

**1. Firebase (sekali saja)**
1. Buka console.firebase.google.com, **Add project** (Google Analytics boleh dimatikan).
2. Di project, **Add app -> Android**, isi package name `app.foodcourt.kantin`, lalu unduh **google-services.json**.
3. **Project settings -> Service accounts -> Generate new private key**. Isi seluruh file JSON itu ke variabel `FIREBASE_SERVICE_ACCOUNT` di Render (atau hosting-mu). Jangan taruh file ini di GitHub.
4. Deploy ulang server supaya tabel `device_tokens` ikut dibuat (atau impor ulang `sql/schema.sql`).

**2. GitHub (build APK otomatis)**
1. Repo -> **Settings -> Secrets and variables -> Actions**.
2. Tab **Secrets** -> New secret `GOOGLE_SERVICES_JSON_B64` berisi google-services.json yang di-base64. Di PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("google-services.json"))`.
3. Tab **Variables** -> New variable `KANTIN_URL` berisi `https://NAMA-KAMU.onrender.com/kantin/` (pakai alamat yang stabil).
4. Tab **Actions** -> **Build APK Kantin** -> **Run workflow**. Tunggu beberapa menit, lalu unduh artifact `kantin-apk` (zip berisi `app-debug.apk`).

**3. Pasang dan tes**
1. Salin `app-debug.apk` ke HP kantin, buka, izinkan "pasang dari sumber tidak dikenal".
2. Login kasir, izinkan notifikasi saat diminta.
3. Kunci layar HP, buat pesanan Cash dari HP lain. Notifikasi harus muncul dan berbunyi.

**Catatan**
- Ini APK debug untuk dipasang langsung, bukan untuk Play Store.
- Matikan penghematan baterai untuk aplikasi ini (Pengaturan -> Aplikasi -> Kantin FoodCourt -> Baterai -> Tidak dibatasi), supaya notifikasi tidak tertunda.
- Di Render free, server yang sedang tidur butuh sekitar satu menit untuk bangun, jadi aplikasi bisa menampilkan layar menunggu dulu.
- Alur ini belum diuji di lingkungan pengembangan; kalau build gagal di GitHub Actions, salin log langkah yang merah dan kirim ke pengembang.

## H. Deploy ke VPS (Ubuntu) dengan skrip otomatis

Cocok kalau server harus hidup terus tanpa tidur. Skrip `deploy/setup-vps.sh` memasang Node.js 20, pm2 (menjaga aplikasi tetap hidup dan menyala lagi setelah restart), dan Caddy (HTTPS otomatis). Tabel database dibuat otomatis saat server pertama menyala, jadi tidak perlu impor `schema.sql` manual.

1. **Beli VPS** Ubuntu 22.04 atau 24.04 dengan RAM minimal 1 GB. Bayar **bulanan** dulu. Catat alamat IP dan password root.
2. **Siapkan domain** supaya HTTPS bisa aktif. Gratis: buat subdomain di duckdns.org, lalu arahkan ke IP VPS. Alternatif: beli domain `.my.id` dan arahkan record A ke IP VPS.
3. **Masuk ke VPS**: di PowerShell ketik `ssh root@IP-VPS`, lalu masukkan password.
4. **Ambil project dan jalankan skrip**:
   ```
   apt update && apt install -y git
   git clone https://github.com/USERNAME/REPO.git /opt/foodcourt
   bash /opt/foodcourt/deploy/setup-vps.sh
   ```
   (Repo privat: pakai `https://TOKEN@github.com/USERNAME/REPO.git`.)
5. **Jawab pertanyaan skrip**: domain, data Aiven, dan mode QRIS (`y` = simulasi). JWT_SECRET dibuat otomatis.
6. **Tes**: buka `https://DOMAIN/api/health`.
7. **Update setelah git push versi baru**: `bash /opt/foodcourt/deploy/update.sh`.

Berguna: `pm2 logs foodcourt` (log aplikasi), `pm2 restart foodcourt`, `journalctl -u caddy -n 30` (log HTTPS). Jangan taruh password VPS atau isi `.env` di GitHub.

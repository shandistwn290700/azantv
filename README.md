# 🕌 AdhanCast - Aplikasi Monitoring Jadwal Azan & Display TV Digital Masjid

Aplikasi web modern berbasis **Server - Client Architecture** untuk sistem informasi masjid (*digital signage*). Server bertindak sebagai pusat administrasi bagi takmir/pengurus masjid untuk mengelola jadwal, pengumuman, dan timer, sedangkan client dirancang khusus untuk layar **Google TV / Android TV** yang terhubung ke internet.

Aplikasi ini sangat siap di-deploy pada **Coolify + WSL + Cloudflare Tunnel** menggunakan Docker, dengan konsumsi resource yang sangat ringan, tanpa dependensi C++ native berat, dan tangguh saat koneksi internet TV mengalami gangguan (*offline caching*).

---

## ✨ Fitur Utama

### 1. Layar Display Google TV (`/tv`)
- **Tampilan Khusus Layar TV (1080p / 4K)**: Desain beresolusi tinggi, kontras tajam, teks besar yang terbaca jelas dari saf sholat paling belakang (jarak 15–25 meter).
- **Jam Digital Presisi & Penanggalan Ganda**: Sinkronisasi waktu real-time dengan detik, tanggal Masehi bahasa Indonesia, dan penanggalan Hijriyah (+ koreksi hisab -2 s/d +2 hari).
- **Engine Hisab Astronomis Akurat (Standar Kemenag RI / Bimas Islam)**:
  - Subuh: Sudut depresi matahari 20°
  - Isya: Sudut depresi matahari 18°
  - Terbit, Dhuha, Dzuhur, Ashar (bayangan 1:1 Syafi'i), dan Maghrib.
  - Penyesuaian menit koreksi (*Ihtiyat*) per waktu sholat.
- **Spotlight & Countdown Sholat**: Kartu fokus yang menyorot waktu sholat berikutnya dengan hitung mundur detik-demi-detik.
- **Transisi Otomatis 4 Tahap**:
  1. **Mode Normal**: Tampilan jadwal, countdown, dan rotasi slide pengumuman.
  2. **Mode Azan**: Saat waktu sholat tiba (00:00), layar otomatis berganti menampilkan banner besar pemberitahuan azan disertai nada bip/chime.
  3. **Mode Iqomah**: Setelah durasi azan selesai, layar otomatis menampilkan hitung mundur Iqamah (dapat diatur berbeda untuk Subuh, Dzuhur, Ashar, Maghrib, Isya) dengan peringatan bip pada 10 detik terakhir.
  4. **Mode Salat (Layar Gelap/Hening)**: Layar meredup/gelap dengan pesan *"Luruskan dan Rapatkan Shaf"* selama durasi sholat berlangsung (misal 15 menit), agar tidak menyilaukan jamaah saat sholat.
  5. Kembali normal secara otomatis ke jadwal dan pengumuman.
- **Audio Synthesizer Mandiri**: Menggunakan Web Audio API internal untuk menghasilkan bunyi chime dan peringatan bip tanpa ketergantungan file MP3 eksternal yang rawan gagal putar di browser Android TV.
- **Resiliensi Offline (Offline Cache)**: Jika koneksi internet atau tunnel ke TV sempat terputus, TV tetap berjalan normal menghitung jam dan jadwal sholat secara mandiri menggunakan cache lokal.

### 2. Panel Administrasi Takmir (`/admin`)
- **Login Terproteksi Password**: Akses aman khusus pengurus masjid (password awal dari env `ADMIN_PASSWORD`, atau dibuat acak dan ditampilkan di log saat pertama kali jalan; dapat diubah di panel).
- **Data Masjid & Preset Kota Indonesia**: Pilihan cepat puluhan kota di Indonesia yang otomatis mengisikan koordinat Latitude, Longitude, dan Zona Waktu (WIB/WITA/WIT).
- **Pengaturan Ihtiyat (Koreksi Menit)**: Kemudahan mengatur selisih menit jadwal (+/- menit) per waktu sholat.
- **Pengaturan Timer Khusus**: Mengatur durasi azan, durasi iqamah masing-masing sholat, durasi layar gelap salat, dan saklar audio bip.
- **Manajemen Running Text**: Tambah, edit, nonaktifkan, dan urutkan teks berjalan di bagian bawah TV.
- **Manajemen Slide Dinamis**:
  - Pengumuman Teks / Kajian Rutin.
  - Kutipan Hadits / Ayat Al-Qur'an.
  - Laporan Keuangan Infaq / Kas Masjid (Pemasukan, Pengeluaran, Saldo Akhir).
  - Petugas Sholat Jum'at (Khatib, Imam, Muadzin, Bilal).
  - Upload Poster Gambar Kegiatan (format JPG/PNG/WebP rasio 16:9).
- **Pilihan Tema Warna TV**: Pilihan tema *Islamic Emerald Green & Gold*, *Royal Midnight Navy*, dan *Onyx Dark Charcoal*.
- **Monitoring Google TV Real-time**: Memantau status perangkat TV yang sedang online, resolusi layar, IP, serta fitur remote **"Test Bip di TV"** dan **"Paksa Refresh TV"**.

---

## 📁 Struktur Direktori

```text
azan-display-tv/
├── Dockerfile              # Docker image berbasis Node 22 slim untuk Coolify
├── docker-compose.yml      # Konfigurasi container dan volume persisten
├── package.json            # Dependensi Express & Multer
├── server.js               # Web server Express, SSE live-sync, REST API
├── db.js                   # Database SQLite native (node:sqlite)
├── prayer-times.js         # Perhitungan astronomis hisab jadwal sholat & kalender Hijriyah
├── public/
│   ├── index.html          # Portal utama (pilihan layar TV atau login admin)
│   ├── tv.html             # Layar display utama Google TV
│   ├── admin.html          # Dashboard administrasi takmir
│   ├── login.html          # Halaman login takmir
│   ├── css/
│   │   ├── tv.css          # Desain dan animasi layar TV 1080p/4K
│   │   └── admin.css       # Desain antarmuka panel admin
│   ├── js/
│   │   ├── tv.js           # Logika display TV, state machine, audio chime, SSE
│   │   ├── admin.js        # Logika SPA dashboard admin, upload, live-monitoring
│   │   └── prayer-engine.js # Fallback kalkulasi hisab di browser jika offline
│   └── uploads/            # Direktori penyimpanan poster/gambar (volume mount)
└── data/                   # Direktori penyimpanan SQLite database (volume mount)
```

---

## 🚀 Panduan Deployment: Coolify + WSL + Cloudflare Tunnel

Karena server Anda sudah online menggunakan **Coolify** yang terintegrasi dengan **WSL** dan **Cloudflare Tunnel**, berikut langkah instalasi cepatnya:

### Langkah 1: Siapkan Repository di Git
1. Buat repository baru di GitHub / GitLab (misal: `azan-display-tv`).
2. Masukkan folder project ini ke repository tersebut:
   ```bash
   git init
   git add .
   git commit -m "feat: initial commit azan display tv"
   git branch -M main
   git remote add origin git@github.com:USERNAME/azan-display-tv.git
   git push -u origin main
   ```

### Langkah 2: Deploy di Coolify
1. Buka dashboard **Coolify** Anda.
2. Klik **+ Create New Resource** -> Pilih **Application**.
3. Pilih sumber dari **Public Repository** atau **GitHub App / Private Repository**.
4. Masukkan URL repository Anda.
5. Konfigurasi Application:
   - **Build Pack**: Pilih `Dockerfile` (Coolify akan otomatis mendeteksi `Dockerfile` di root).
   - **Port Exposes**: `3000`
6. Pada tab **Persistent Storage** (PENTING agar data pengaturan & upload gambar tidak hilang saat restart):
   - Tambahkan Volume 1:
     - **Name**: `azan-data`
     - **Destination Path**: `/app/data`
   - Tambahkan Volume 2:
     - **Name**: `azan-uploads`
     - **Destination Path**: `/app/public/uploads`
7. Pada tab **Environment Variables**, Anda dapat menambahkan (opsional):
   - `ADMIN_PASSWORD=<password-kuat>`: password awal panel takmir, hanya dipakai saat database pertama kali dibuat. Kalau dikosongkan, server membuat password acak dan menampilkannya sekali di log. Setelah itu ganti password lewat panel.
   - `PORT=3000`
8. Klik **Deploy**. Tunggu proses build beberapa saat hingga statusnya menjadi **Healthy**.

### Langkah 3: Konfigurasi Cloudflare Tunnel
1. Buka dashboard **Cloudflare Zero Trust** -> **Networks** -> **Tunnels**.
2. Pilih Tunnel yang sudah aktif di server WSL Anda -> Klik **Configure**.
3. Pada tab **Public Hostname**, tambahkan hostname baru:
   - **Subdomain**: misal `azan`
   - **Domain**: `domainmasjidanda.com` (sehingga menjadi `https://azan.domainmasjidanda.com`)
   - **Service**:
     - **Type**: `HTTP`
     - **URL**: `localhost:3000` (atau IP/Container name dari Coolify)
4. Simpan konfigurasi. Sekarang aplikasi Anda dapat diakses di seluruh dunia melalui:
   - **Tampilan TV**: `https://azan.domainmasjidanda.com/tv`
   - **Panel Admin**: `https://azan.domainmasjidanda.com/admin`

---

## 📺 Panduan Pengaturan di Google TV / Android TV

Agar Google TV di masjid dapat menampilkan jadwal secara otomatis, bersih tanpa address bar, dan tidak mudah tertutup:

### 1. Pasang Browser Khusus TV
Buka Google Play Store di Google TV, lalu cari dan install browser yang ramah remote TV:
- **Rekomendasi 1 (Paling Bagus)**: **TV Bro** (Gratis, open-source, bebas iklan, memiliki fitur *Full Screen Mode* dan *Set as Homepage*).
- **Rekomendasi 2**: **JioPages TV** atau **Open Browser**.

### 2. Atur Halaman Awal & Layar Penuh
1. Buka aplikasi **TV Bro** di Google TV.
2. Buka URL TV Anda: `https://azan.domainmasjidanda.com/tv`
3. Masuk ke menu pengaturan browser (biasanya tombol panah atas atau tombol menu pada remote TV):
   - Aktifkan **Start with this page** (Jadikan URL ini sebagai beranda saat browser dibuka).
   - Aktifkan **Full Screen / Hide Navigation Bar**.
   - Pada izin Audio, izinkan situs memainkan suara agar notifikasi azan dan iqomah terdengar.

> **Tips Navigasi Remote TV**:
> - Tekan tombol **'F'** (jika memakai keyboard nirkabel) atau **Klik 2x / Tombol Tengah Remote** untuk keluar/masuk mode Fullscreen.
> - Tekan tombol **'R'** untuk memuat ulang data seketika.

### 3. (Opsional) Auto-Start saat TV Dinyalakan
Jika ingin saat Google TV dinyalakan aplikasi langsung terbuka otomatis tanpa perlu menekan tombol remote:
1. Install aplikasi **Launch on Boot** dari Google Play Store TV.
2. Buka aplikasinya, pilih aplikasi **TV Bro** sebagai target startup.
3. Sekarang setiap kali TV masjid dinyalakan, layar jadwal azan akan langsung tampil secara otomatis!

---

## 💻 Menjalankan Secara Lokal (Development / Testing)

Jika ingin mencoba atau mengembangkan aplikasi ini terlebih dahulu di komputer lokal:

```bash
# 1. Pindah ke direktori project
cd azan-display-tv

# 2. Install dependensi
npm install

# 3. Jalankan server
npm start
# atau dengan live-reload otomatis:
npm run dev
```

Akses melalui browser di:
- Layar Google TV: [http://localhost:3000/tv](http://localhost:3000/tv)
- Panel Admin Takmir: [http://localhost:3000/admin](http://localhost:3000/admin) (password: lihat log server saat pertama kali jalan, atau set `ADMIN_PASSWORD`)
- Portal Navigasi: [http://localhost:3000/](http://localhost:3000/)

---

## 🛡️ Keamanan & Kestabilan
- Password admin tersimpan secara aman dalam SQLite dan dapat diubah langsung dari tab **Tema & Keamanan**.
- Endpoint publik `/api/data` tidak membocorkan hash/password admin.
- Proteksi upload file gambar dibatasi maksimal 10 MB dan hanya mengizinkan ekstensi gambar yang valid.
- Komunikasi real-time menggunakan **Server-Sent Events (SSE)** yang sangat ramah terhadap Cloudflare Tunnel (bebas timeout dan auto-reconnect).

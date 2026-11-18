# Aplikasi Android Azan TV

Satu proyek Gradle berisi dua aplikasi:

| Modul | Aplikasi | Untuk | Membuka |
|---|---|---|---|
| `tv`  | **Azan TV** (`com.azantv.display`) | Google TV / Android TV di masjid | `https://azan.shandistwn.dpdns.org/tv` |
| `dkm` | **Takmir Azan TV** (`com.azantv.dkm`) | HP pengurus DKM | `https://azan.shandistwn.dpdns.org/login` → panel takmir |

Alamat server diatur di `tv/build.gradle.kts` (`TV_URL`) dan `dkm/build.gradle.kts` (`BASE_URL`).

## Build

Buka folder `android/` di Android Studio, lalu **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
Atau dari terminal:

```
./gradlew assembleDebug
```

Hasilnya:

- `tv/build/outputs/apk/debug/tv-debug.apk`
- `dkm/build/outputs/apk/debug/dkm-debug.apk`

APK ditandatangani dengan kunci debug PC ini (`%USERPROFILE%\.android\debug.keystore`).
Update berikutnya harus di-build dari PC yang sama (atau dengan kunci yang sama), kalau tidak
aplikasi lama harus di-uninstall dulu. Simpan cadangan file kunci itu.

## Aplikasi TV (`tv`)

Pasang lewat flashdisk + file manager di TV, atau `adb install -r tv-debug.apk`.

- Muncul di baris aplikasi Google TV dengan banner "Azan TV"; dibuka manual.
- Layar selalu menyala, tanpa address bar, bunyi azan (Web Audio) jalan tanpa menekan remote.
- Offline: menampilkan salinan halaman terakhir dari cache; kalau belum pernah dimuat, tampil
  layar "Menunggu koneksi internet…" dan mencoba lagi tiap 15 detik dan saat jaringan kembali.
- Tombol Kembali harus ditekan 2× untuk keluar.

## Aplikasi pengurus (`dkm`)

Bagikan `dkm-debug.apk` lewat WhatsApp atau Google Drive. Di HP pengurus:

1. Buka file APK, izinkan **Install unknown apps** untuk WhatsApp/Drive/File Manager bila diminta.
2. Kalau Play Protect memperingatkan, pilih **More details → Install anyway**.
3. Buka **Takmir Azan TV**, login dengan akun pengurus masing-masing
   (dibuat admin di panel → **Akun Pengurus**).

Perilaku:

- Login tersimpan sampai 30 hari tidak dipakai, atau sampai akun dinonaktifkan / kata sandi diganti.
- Unggah foto latar atau poster langsung dari galeri HP.
- Tombol Kembali berpindah halaman di dalam panel sebelum keluar aplikasi.
- Tautan ke luar panel (mis. layar TV) dibuka di browser.
- Saat offline tampil layar "Tidak ada koneksi" dan otomatis memuat ulang saat internet kembali.

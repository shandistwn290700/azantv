# Azan TV — aplikasi Android TV

Pembungkus WebView layar penuh untuk `https://azan.shandistwn.dpdns.org/tv`.
Alamatnya diatur di `app/build.gradle.kts` (`TV_URL`).

## Build

Buka folder `android-tv/` di Android Studio, lalu **Build → Build App Bundle(s) / APK(s) → Build APK(s)**.
Atau dari terminal:

```
./gradlew assembleDebug
```

Hasilnya: `app/build/outputs/apk/debug/app-debug.apk`

## Pasang ke TV (lewat jaringan)

1. Di TV: **Settings → System → About**, klik **Android TV OS build** 7× sampai Developer options aktif.
2. **Settings → System → Developer options**: nyalakan **USB debugging** (dan **Wireless debugging** kalau ada).
3. Cek IP TV di **Settings → Network & Internet**.
4. Di PC (TV dan PC harus satu jaringan):

```
adb connect <IP-TV>:5555
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

   Terima dialog "Allow USB debugging" di TV saat pertama kali connect.
   Di Google TV yang memakai **Wireless debugging**, gunakan `adb pair <IP>:<port-pairing>` dulu dengan kode yang tampil di TV.

Alternatif tanpa adb: unggah APK ke Google Drive, lalu pasang lewat aplikasi **Downloader** di TV.

## Perilaku aplikasi

- Muncul di baris aplikasi Google TV dengan banner "Azan TV"; dibuka manual.
- Layar selalu menyala, tanpa address bar, bunyi azan (Web Audio) jalan tanpa harus menekan remote.
- Offline: menampilkan salinan halaman terakhir dari cache; kalau belum pernah dimuat, tampil layar
  "Menunggu koneksi internet…" dan otomatis mencoba lagi (tiap 15 detik dan saat jaringan kembali).
- Tombol Kembali harus ditekan 2× untuk keluar.

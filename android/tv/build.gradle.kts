plugins {
    id("com.android.application")
}

android {
    namespace = "com.azantv.display"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.azantv.display"
        // Android 7.0+: covers older Android TV boxes as well as Google TV
        minSdk = 24
        targetSdk = 37
        versionCode = 2
        versionName = "1.1"

        // Halaman yang ditampilkan di TV. Ganti di sini kalau domainnya pindah.
        buildConfigField("String", "TV_URL", "\"https://azan.shandistwn.dpdns.org/tv\"")
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Sementara pakai kunci debug supaya APK release bisa langsung dipasang.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

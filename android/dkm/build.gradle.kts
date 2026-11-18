plugins {
    id("com.android.application")
}

android {
    namespace = "com.azantv.dkm"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.azantv.dkm"
        minSdk = 24
        targetSdk = 37
        versionCode = 1
        versionName = "1.0"

        // Server panel takmir. Ganti di sini kalau domainnya pindah.
        buildConfigField("String", "BASE_URL", "\"https://azan.shandistwn.dpdns.org\"")
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

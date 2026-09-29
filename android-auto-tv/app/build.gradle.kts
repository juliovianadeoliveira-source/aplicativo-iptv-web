plugins {
    id("com.android.application")
}

android {
    namespace = "com.jstech.autotv"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.jstech.autotv"
        minSdk = 23
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
        }
    }
}

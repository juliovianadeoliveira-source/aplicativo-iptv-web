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
        versionCode = 2
        versionName = "1.1.0"
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
        }
    }
}

dependencies {
    implementation("androidx.media3:media3-exoplayer:1.7.1")
    implementation("androidx.media3:media3-exoplayer-hls:1.7.1")
    implementation("androidx.media3:media3-ui:1.7.1")
}

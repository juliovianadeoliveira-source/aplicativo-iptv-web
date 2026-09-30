plugins { id("com.android.application") }
android {
    namespace = "com.aurora.browser"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.aurora.browser"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

// Build 131: secure owner pairing support; existing Deplexo API remains compatible until enforcement.
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}
android {
    namespace = "com.devtrader.app"
    compileSdk = 37
    defaultConfig {
        applicationId = "com.devtrader.app"
        minSdk = 26
        targetSdk = 37
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        versionCode = (providers.gradleProperty("devTraderVersionCode").orNull ?: "152").toInt()
        versionName = providers.gradleProperty("devTraderVersionName").orNull ?: "0.21.27"
        val backendUrl = providers.gradleProperty("devTraderBackendUrl").orNull
            ?: "https://kyvoriq-staging.getvoroa.com"
        require(Regex("https://[A-Za-z0-9.-]+(?::[0-9]+)?/?").matches(backendUrl)) {
            "devTraderBackendUrl must be an HTTPS origin without credentials or a path"
        }
        buildConfigField("String", "BACKEND_BASE_URL", "\"${backendUrl.trimEnd('/')}\"")
    }
    signingConfigs {
        create("devTraderRelease") {
            val keystorePath = System.getenv("DEV_TRADER_KEYSTORE_PATH")
            if (!keystorePath.isNullOrBlank()) {
                storeFile = file(keystorePath)
            }
            storePassword = System.getenv("DEV_TRADER_KEYSTORE_PASSWORD")
            keyAlias = System.getenv("DEV_TRADER_KEY_ALIAS")
            keyPassword = System.getenv("DEV_TRADER_KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("devTraderRelease")
        }
        debug { applicationIdSuffix = ".debug" }
    }
    // MediaPlayer uses AssetFileDescriptor; the MP3s must remain uncompressed
    // inside the APK or openFd() cannot provide their file descriptor.
    androidResources { noCompress += "mp3" }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    buildFeatures { buildConfig = true }
}
dependencies {
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("com.airbnb.android:lottie:6.7.1")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.compose.runtime:runtime:1.12.1")
}

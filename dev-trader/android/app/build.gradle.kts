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
        versionCode = (providers.gradleProperty("devTraderVersionCode").orNull ?: "115").toInt()
        versionName = providers.gradleProperty("devTraderVersionName").orNull ?: "0.18.0"
        val backendUrl = providers.gradleProperty("devTraderBackendUrl").orNull
            ?: "https://dev-trader-engine.de.deplexo.com"
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
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
    buildFeatures { buildConfig = true }
}
dependencies {
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.compose.runtime:runtime:1.12.1")
}

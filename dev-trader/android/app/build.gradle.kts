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
        versionCode = (providers.gradleProperty("devTraderVersionCode").orNull ?: "62").toInt()
        versionName = providers.gradleProperty("devTraderVersionName").orNull ?: "0.9.4"
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
}
dependencies {
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("androidx.compose.runtime:runtime:1.12.1")
}

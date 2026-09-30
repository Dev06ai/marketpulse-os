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
        versionCode = (providers.gradleProperty("devTraderVersionCode").orNull ?: "7").toInt()
        versionName = providers.gradleProperty("devTraderVersionName").orNull ?: "0.2.1"
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
    buildFeatures { compose = true }
    packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
}
dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.fragment:fragment-ktx:1.9.1")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation(platform("com.google.firebase:firebase-bom:34.19.0"))
    implementation("com.google.firebase:firebase-messaging")
    debugImplementation("androidx.compose.ui:ui-tooling")
}

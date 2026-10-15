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
        versionCode = (providers.gradleProperty("devTraderVersionCode").orNull ?: "183").toInt()
        versionName = providers.gradleProperty("devTraderVersionName").orNull ?: "0.21.58"
        val backendUrl = providers.gradleProperty("devTraderBackendUrl").orNull
            ?: "https://kyvoriq-staging.getvoroa.com"
        require(Regex("https://[A-Za-z0-9.-]+(?::[0-9]+)?/?").matches(backendUrl)) {
            "devTraderBackendUrl must be an HTTPS origin without credentials or a path"
        }
        buildConfigField("String", "BACKEND_BASE_URL", "\"${backendUrl.trimEnd('/')}\"")
        // Separate hosted consumer identity portal; blank until deployment.
        val consumerPortal = providers.gradleProperty("kyvoriqConsumerPortalUrl").orNull ?: ""
        require(consumerPortal.isBlank() ||
            Regex("https://[A-Za-z0-9.-]+(?::[0-9]+)?/?").matches(consumerPortal)) {
            "kyvoriqConsumerPortalUrl must be an HTTPS origin without path or credentials"
        }
        buildConfigField("String", "CONSUMER_PORTAL_URL", "\"${consumerPortal.trimEnd('/')}\"")
        // These are client-public Firebase project identifiers, NOT admin
        // credentials. The Google/Firebase project must be configured before
        // real sign-in is activated. Empty settings fail closed.
        val firebaseApiKey = providers.gradleProperty("kyvoriqFirebaseApiKey").orNull ?: ""
        val firebaseAppId = providers.gradleProperty("kyvoriqFirebaseAppId").orNull ?: ""
        val firebaseProjectId = providers.gradleProperty("kyvoriqFirebaseProjectId").orNull ?: ""
        val googleWebClientId = providers.gradleProperty("kyvoriqGoogleWebClientId").orNull ?: ""
        require(listOf(firebaseApiKey, firebaseAppId, firebaseProjectId, googleWebClientId)
            .all { it.matches(Regex("[A-Za-z0-9_:.\\-]*")) }) {
            "Consumer identity identifiers contain invalid characters"
        }
        buildConfigField("String", "FIREBASE_API_KEY", "\"$firebaseApiKey\"")
        buildConfigField("String", "FIREBASE_APP_ID", "\"$firebaseAppId\"")
        buildConfigField("String", "FIREBASE_PROJECT_ID", "\"$firebaseProjectId\"")
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", "\"$googleWebClientId\"")
        val consumerApiOrigin = providers.gradleProperty("kyvoriqConsumerApiOrigin").orNull ?: ""
        require(consumerApiOrigin.isBlank() ||
            Regex("https://[A-Za-z0-9.-]+(?::[0-9]+)?/?").matches(consumerApiOrigin)) {
            "Consumer API must be an HTTPS origin without paths or credentials"
        }
        require(consumerApiOrigin.isBlank() ||
            consumerApiOrigin.trimEnd('/') != backendUrl.trimEnd('/')) {
            "Consumer account API must not point to the private owner trading backend"
        }
        buildConfigField("String", "CONSUMER_API_ORIGIN", "\"${consumerApiOrigin.trimEnd('/')}\"")

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
    androidTestImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.viewpager2:viewpager2:1.1.0")
    implementation("com.airbnb.android:lottie:6.7.1")
    implementation("androidx.biometric:biometric:1.1.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.firebase:firebase-auth:23.2.1")
    implementation("com.google.android.gms:play-services-auth:21.4.0")
    implementation("androidx.compose.runtime:runtime:1.12.1")
}


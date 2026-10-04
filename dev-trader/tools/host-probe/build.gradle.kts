plugins { application }
repositories { mavenCentral() }
dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.json:json:20240303")
}
application { mainClass = "HostProbe" }

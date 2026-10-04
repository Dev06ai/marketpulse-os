package com.devtrader.app

/** One build setting controls HTTP, dashboard and background alerts together. */
object BackendEndpoint {
    val base: String = BuildConfig.BACKEND_BASE_URL.trimEnd('/')
    fun socket(profile: String): String =
        "wss://" + base.removePrefix("https://") + "/ws?profile=" + profile
}

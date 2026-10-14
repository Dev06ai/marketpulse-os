package com.devtrader.app

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

@RunWith(AndroidJUnit4::class)
class MarketRecoveryTest {
    private val inst get() = InstrumentationRegistry.getInstrumentation()
    private val context get() = inst.targetContext
    private fun rows(tf: String = "1h"): JSONArray {
        val step = MarketRecovery.intervalMs(tf)
        val now = System.currentTimeMillis() / step * step
        return JSONArray().apply {
            repeat(40) { i -> put(JSONObject().put("start", now - (39-i)*step)
                .put("open", 100.0).put("high", 110.0).put("low", 90.0)
                .put("close", 105.0).put("volume", 50.0).put("private_signal", "MUST_NOT_PERSIST")) }
        }
    }
    private fun field(name: String) = SafeActivity::class.java.getDeclaredField(name).apply { isAccessible = true }
    private fun call(activity: SafeActivity, name: String, force: Boolean) = SafeActivity::class.java
        .getDeclaredMethod(name, Boolean::class.javaPrimitiveType!!).apply { isAccessible = true }.invoke(activity, force)

    @Test fun timeoutsUseFallbackButAuthenticationDenialsDoNotRetryPrivately() {
        for (error in listOf("NETWORK TIMEOUT", "NETWORK UNAVAILABLE", "HTTP 404", "HTTP 502", "HTTP 503", "HTTP 504", "INVALID SNAPSHOT"))
            assertTrue(error, MarketRecovery.transientFailure(error))
        assertFalse(MarketRecovery.transientFailure("HTTP 401"))
        assertFalse(MarketRecovery.transientFailure("HTTP 403"))
        assertTrue(MarketRecovery.retryDelay(false) < MarketRecovery.retryDelay(true))
    }

    @Test fun cachePersistsOnlyPublicCandlesAndKeepsTimeframesSeparate() {
        context.getSharedPreferences("kyvoriq_public_candles_v1", Context.MODE_PRIVATE).edit().clear().commit()
        MarketRecovery.save(context, "1h", rows(), MarketRecovery.PERPETUAL)
        val restored = MarketRecovery.load(context, "1h")!!
        assertEquals(40, restored.getJSONArray("candles").length())
        assertEquals(MarketRecovery.PERPETUAL, restored.getString("source"))
        assertFalse(restored.toString().contains("MUST_NOT_PERSIST"))
        assertFalse(restored.toString().contains("private_signal"))
        assertNull(MarketRecovery.load(context, "5m"))
        assertNull(MarketRecovery.load(context, "1h", System.currentTimeMillis() + 49*60*60_000L))
    }

    @Test fun alternativeSpotCacheRemainsPublicAndHasExplicitProvenance() {
        MarketRecovery.save(context, "1h", rows(), MarketRecovery.KRAKEN_SPOT)
        val saved = MarketRecovery.load(context, "1h")!!
        assertEquals(MarketRecovery.KRAKEN_SPOT, saved.getString("source"))
        assertFalse(saved.toString().contains("private_signal"))
        assertFalse(saved.toString().contains("MUST_NOT_PERSIST"))
    }

    @Test fun malformedNetworkCandlesCannotReplaceLastValidCache() {
        MarketRecovery.save(context, "1h", rows(), MarketRecovery.PERPETUAL)
        val bad = rows().apply { getJSONObject(39).put("low", 9999.0) }
        MarketRecovery.save(context, "1h", bad, MarketRecovery.SPOT)
        assertEquals(MarketRecovery.PERPETUAL, MarketRecovery.load(context, "1h")!!.getString("source"))
        assertTrue(runCatching { MarketRecovery.sanitize(bad, "1h") }.isFailure)
        assertTrue(runCatching { MarketRecovery.sanitize(JSONArray(), "1h") }.isFailure)
        val duplicate = rows().apply { getJSONObject(39).put("start", getJSONObject(38).getLong("start")) }
        assertTrue(runCatching { MarketRecovery.sanitize(duplicate, "1h") }.isFailure)
    }

    @Test fun actualPrivateTimeoutLoadsPublicChartWithoutLeakingBearer() {
        val server = MockWebServer()
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
        server.enqueue(MockResponse().setHeader("Content-Type", "application/json").setBody(
            JSONObject().put("interval", "1h").put("candles", rows()).put("last_price", 105.0).toString()))
        server.start()
        // MockWebServer.url() may resolve a hostname; keep it off Android's main thread.
        val mockBase = server.url("/").toString().trimEnd('/')
        val activity = inst.startActivitySync(Intent(context, SafeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("visual_preview", true)) as SafeActivity
        try {
            KyvoriqSecureSession.save(context, "kvq.v1.test-only-no-server-access", System.currentTimeMillis()/1000 + 3600)
            inst.runOnMainSync {
                field("backendBase").set(activity, mockBase)
                field("restClient\$delegate").set(activity, lazy { OkHttpClient.Builder()
                    .readTimeout(250, TimeUnit.MILLISECONDS).callTimeout(400, TimeUnit.MILLISECONDS).build() })
                field("debugPreview").setBoolean(activity, false)
                field("latestChartCandles").set(activity, JSONArray())
                call(activity, "bootstrap", true)
            }
            val deadline = SystemClock.elapsedRealtime() + 7000
            var recovered = false
            while (!recovered && SystemClock.elapsedRealtime() < deadline) {
                inst.runOnMainSync {
                    recovered = (field("latestChartCandles").get(activity) as JSONArray).optJSONObject(39)?.optDouble("close") == 105.0
                }
                SystemClock.sleep(50)
            }
            assertTrue("Private timeout must recover candles without Refresh", recovered)
            val privateRequest = server.takeRequest(1, TimeUnit.SECONDS)!!
            val publicRequest = server.takeRequest(1, TimeUnit.SECONDS)!!
            assertTrue(privateRequest.path!!.startsWith("/bootstrap"))
            assertTrue(publicRequest.path!!.startsWith("/chart"))
            assertNull("No credentials sent to public chart provider", publicRequest.getHeader("Authorization"))
            inst.runOnMainSync {
                assertTrue(field("privateRouteFallback").getBoolean(activity))
                assertTrue(field("publicMarketOnly").getBoolean(activity))
                assertFalse(field("chartRequestInFlight").getBoolean(activity))
                assertFalse(field("bootstrapInFlight").getBoolean(activity))
                assertNull(field("latestRoot").get(activity))
                assertFalse((field("status").get(activity) as TextView).text.toString().contains("LIVE"))
            }
        } finally {
            inst.runOnMainSync { field("debugPreview").setBoolean(activity, true); activity.finish() }
            KyvoriqSecureSession.clear(context)
            server.shutdown()
        }
    }

    @Test fun networkResetReleasesRequestLocksAndInvalidatesLateResponses() {
        val activity = inst.startActivitySync(Intent(context, SafeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK).putExtra("visual_preview", true)) as SafeActivity
        try {
            inst.runOnMainSync {
                field("bootstrapInFlight").setBoolean(activity, true)
                field("chartRequestInFlight").setBoolean(activity, true)
                val generation = field("bootstrapGeneration").getLong(activity)
                val token = field("chartRequestToken").getLong(activity)
                SafeActivity::class.java.getDeclaredMethod("resetMarketRequests").apply { isAccessible = true }.invoke(activity)
                assertFalse(field("bootstrapInFlight").getBoolean(activity))
                assertFalse(field("chartRequestInFlight").getBoolean(activity))
                assertTrue(field("bootstrapGeneration").getLong(activity) > generation)
                assertTrue(field("chartRequestToken").getLong(activity) > token)
            }
        } finally { inst.runOnMainSync { activity.finish() } }
    }
}

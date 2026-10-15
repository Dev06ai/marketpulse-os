package com.devtrader.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class VolumeProfileViewportPolicyTest {
    private fun profile(start: Long, end: Long, poc: Double): JSONObject =
        JSONObject().put("source", "OHLCV_15M_ESTIMATE")
            .put("start_ms", start).put("end_ms", end)
            .put("val", poc - 100.0).put("poc", poc).put("vah", poc + 100.0)
            .put("bins", JSONArray().put(JSONObject().put("price", poc - 100).put("volume", 10))
                .put(JSONObject().put("price", poc).put("volume", 30)))

    @Test fun historicalSessionReplacesCurrentOnlyWhenItsBarsOverlapTheViewport() {
        val profiles = JSONArray()
            .put(profile(1000L, 2000L, 81000.0))
            .put(profile(3000L, 4000L, 83000.0))
        val nearOld = VolumeProfileViewportPolicy.select(profiles, 1300L, 1600L)!!
        assertFalse(nearOld.pinned)
        assertEquals(81000.0, nearOld.profile.getDouble("poc"), 0.001)
        val nearCurrent = VolumeProfileViewportPolicy.select(profiles, 3400L, 3900L)!!
        assertFalse(nearCurrent.pinned)
        assertEquals(83000.0, nearCurrent.profile.getDouble("poc"), 0.001)
    }

    @Test fun panBeyondAvailableHistoryKeepsNearestRealProfileLabeledPinned() {
        val rows = JSONArray().put(profile(5000L, 6000L, 81000.0))
            .put(profile(8000L, 9000L, 83000.0))
        val distantPast = VolumeProfileViewportPolicy.select(rows, 1000L, 2000L)!!
        assertTrue(distantPast.pinned)
        assertEquals(81000.0, distantPast.profile.getDouble("poc"), 0.001)
        val gap = VolumeProfileViewportPolicy.select(rows, 6500L, 6800L)!!
        assertTrue(gap.pinned)
        assertEquals(81000.0, gap.profile.getDouble("poc"), 0.001)
        val future = VolumeProfileViewportPolicy.select(rows, 11000L, 13000L)!!
        assertTrue(future.pinned)
        assertEquals(83000.0, future.profile.getDouble("poc"), 0.001)
    }

    @Test fun invalidSourcesOrMissingProfileBinsNeverBecomeFakePriceLevels() {
        val invalid = JSONArray().put(profile(1000, 2000, 83000.0).put("source", "RAW"))
            .put(profile(1000, 2000, 81000.0).put("bins", JSONArray()))
            .put(profile(1000, 2000, 85000.0).put("val", 86000.0))
        assertNull(VolumeProfileViewportPolicy.select(invalid, 1200, 1700))
        assertNull(VolumeProfileViewportPolicy.select(JSONArray(), 1200, 1700))
    }

    @Test fun offscreenHintsUseRealNearestPriceWithoutPretendingToBeInView() {
        val levels = listOf(
            JSONObject().put("price", 84000.0).put("kind", "DAILY"),
            JSONObject().put("price", 83500.0).put("kind", "NPOC"),
            JSONObject().put("price", 82500.0).put("kind", "DAILY"),
            JSONObject().put("price", 80100.0).put("kind", "WEEKLY"),
            JSONObject().put("price", 79000.0).put("kind", "WEEKLY_NPOC")
        )
        val (above, below) = VolumeProfileViewportPolicy.offscreenPriceLevels(levels, 80500.0, 83100.0)
        assertEquals(83500.0, above!!.getDouble("price"), 0.01)
        assertEquals(80100.0, below!!.getDouble("price"), 0.01)
        assertEquals(null to null,
            VolumeProfileViewportPolicy.offscreenPriceLevels(levels, 78000.0, 85000.0))
    }
}

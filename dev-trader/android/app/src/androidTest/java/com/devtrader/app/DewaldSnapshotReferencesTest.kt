package com.devtrader.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class DewaldSnapshotReferencesTest {
    @Test fun pricesMatchTheVisibleOct15ScreenshotAtOneDecimalWithoutFibs() {
        val arr = DewaldSnapshotReferences.rows(DewaldSnapshotReferences.START_MS)
        assertEquals(17, arr.length())
        val expected = doubleArrayOf(
            89409.5, 89261.7, 87996.6, 87783.9, 86482.8, 85563.9,
            83903.4, 83125.7, 82337.2, 80530.0, 80095.9,
            77249.9, 77246.5, 76805.0, 76384.9, 75790.1, 75599.9
        )
        for (i in expected.indices) {
            val row = arr.getJSONObject(i)
            assertEquals(expected[i], row.getDouble("price"), 0.001)
            assertEquals(DewaldSnapshotReferences.SOURCE, row.getString("source"))
            assertEquals("REFERENCE", row.getString("status"))
            assertFalse(row.optBoolean("estimated"))
            assertFalse(row.getString("kind").contains("FIB"))
            assertFalse(row.getString("kind").contains("OB"))
        }
    }

    @Test fun referenceExpiresAndNeverBecomesAStaleLiveLevel() {
        assertEquals(0, DewaldSnapshotReferences.rows(DewaldSnapshotReferences.START_MS - 1).length())
        assertEquals(17, DewaldSnapshotReferences.rows(DewaldSnapshotReferences.EXPIRES_MS - 1).length())
        assertEquals(0, DewaldSnapshotReferences.rows(DewaldSnapshotReferences.EXPIRES_MS).length())
    }

    @Test fun offlineFallbackKeepsTheExactMapAndDeduplicatesRemote() {
        val now = DewaldSnapshotReferences.START_MS + 1000
        val duplicate = DewaldSnapshotReferences.rows(now).getJSONObject(0)
        val obsolete = JSONObject().put("kind", "NPOC").put("price", 99999.0)
            .put("source", "MINDPILLAR_SCREENSHOT_2026_10_14")
            .put("reference_expires_ms", DewaldSnapshotReferences.EXPIRES_MS)
        val mixed = JSONArray().put(duplicate).put(obsolete)
        assertEquals(17, DewaldSnapshotReferences.merge(mixed, now).length())
        assertEquals(17, DewaldSnapshotReferences.merge(null, now).length())
    }
}

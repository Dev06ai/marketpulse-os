package com.devtrader.app

import android.content.Intent
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import java.io.File
import android.graphics.Rect
import android.os.SystemClock
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Verifies that music controls never overlap market or trading controls. */
@RunWith(AndroidJUnit4::class)
class MusicIslandVisualTest {
    private val inst get() = InstrumentationRegistry.getInstrumentation()

    private fun descendants(root: View): List<View> =
        listOf(root) + if (root is ViewGroup)
            (0 until root.childCount).flatMap { descendants(root.getChildAt(it)) } else emptyList()

    @Test fun islandOpensWithFiveTracksAndDoesNotCoverTradeControls() {
        inst.targetContext.getSharedPreferences("kyvoriq_music_island_v1", Context.MODE_PRIVATE)
            .edit().putInt("selected", 0).commit()
        val activity = inst.startActivitySync(Intent(inst.targetContext, SafeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra("visual_preview", true))
        try {
            SystemClock.sleep(950)
            inst.runOnMainSync {
                val root = activity.window.decorView
                val note = descendants(root).filterIsInstance<TextView>().single {
                    it.contentDescription == "Open KYVORIQ music island"
                }
                assertTrue("Music launcher should be visible in the header", note.isShown)
                note.performClick()
            }
            SystemClock.sleep(480)
            inst.runOnMainSync {
                val root = activity.window.decorView
                val island = descendants(root).single {
                    it.contentDescription == "KYVORIQ music island"
                }
                assertTrue("Island must be visible when music is selected", island.isShown)
                val bitmap = Bitmap.createBitmap(root.width, root.height, Bitmap.Config.ARGB_8888)
                root.draw(Canvas(bitmap))
                val out = File(inst.targetContext.getExternalFilesDir(null), "build155").apply { mkdirs() }
                File(out, "island-trade.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
                bitmap.recycle()
                val alert = descendants(root).filterIsInstance<Button>().first {
                    it.contentDescription == "Enable trade alerts"
                }
                val refresh = descendants(root).filterIsInstance<Button>().first {
                    it.contentDescription == "Reconnect market data"
                }
                val islandRect = Rect()
                val alertRect = Rect()
                val refreshRect = Rect()
                assertTrue(island.getGlobalVisibleRect(islandRect))
                assertTrue(alert.getGlobalVisibleRect(alertRect))
                assertTrue(refresh.getGlobalVisibleRect(refreshRect))
                assertFalse("Island must not cover alerts action", Rect.intersects(islandRect, alertRect))
                assertFalse("Island must not cover refresh action", Rect.intersects(islandRect, refreshRect))
                val next = descendants(root).filterIsInstance<TextView>().single {
                    it.contentDescription == "Next song"
                }
                assertTrue(descendants(root).filterIsInstance<TextView>().any {
                    it.text.toString().contains("bipolar X svj", ignoreCase = true)
                })
                next.performClick()
                assertTrue(descendants(root).filterIsInstance<TextView>().any {
                    it.text.toString() == "Iris"
                })
                assertTrue(descendants(root).filterIsInstance<TextView>().any {
                    it.contentDescription == "Play music"
                })
            }
        } finally { inst.runOnMainSync { activity.finish() } }
    }

    @Test fun fiveTrackPaletteAndPrivateImportAreAvailable() {
        val activity = inst.startActivitySync(Intent(inst.targetContext, SafeActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .putExtra("visual_preview", true))
        try {
            inst.runOnMainSync {
                val player = KyvoriqMusicIsland(activity as androidx.fragment.app.FragmentActivity) {}
                assertEquals(5, player.tracks.size)
                assertEquals("Iris", player.tracks[1].title)
                assertEquals("Dark Beach (Slowed)", player.tracks[2].title)
                assertEquals("AKAI (Slowed)", player.tracks[3].title)
                assertEquals("it was written (slowed + reverbed)", player.tracks[4].title)
                assertTrue(player.tracks.map { it.first }.distinct().size >= 4)
                assertEquals(View.GONE, player.island.visibility)
                player.release()
            }
        } finally { inst.runOnMainSync { activity.finish() } }
    }
}

package com.devtrader.app

import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.FileOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

@RunWith(AndroidJUnit4::class)
class PrivateMusicLibraryTest {
    private val names = listOf(
        "track_01_bipolar.mp3", "track_02_iris.mp3",
        "track_03_dark_beach.mp3", "track_04_akai.mp3", "track_05_written.mp3"
    )

    @Test fun zipImportCopiesFiveSongsToPrivateFiles() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val zip = File(context.cacheDir, "test-five-songs.zip")
        val library = File(context.filesDir, "kyvoriq_private_music")
        try {
            FileOutputStream(zip).use { file ->
                ZipOutputStream(file).use { out ->
                    names.forEach { name ->
                        out.putNextEntry(ZipEntry("dev-trader/android/app/src/main/assets/music/$name"))
                        val sample = ByteArray(4096).apply {
                            this[0] = 'I'.code.toByte()
                            this[1] = 'D'.code.toByte()
                            this[2] = '3'.code.toByte()
                        }
                        out.write(sample)
                        out.closeEntry()
                    }
                    out.putNextEntry(ZipEntry("README_PRIVATE_ASSETS.txt"))
                    out.write("ignored".toByteArray())
                    out.closeEntry()
                }
            }
            assertEquals(5, KyvoriqPrivateMusic.install(context, Uri.fromFile(zip)))
            names.forEachIndexed { index, name ->
                val file = KyvoriqPrivateMusic.track(context, index)
                assertNotNull("Missing private music slot ${index + 1}", file)
                assertEquals(name, file!!.name)
                assertEquals(4096L, file.length())
            }
        } finally {
            zip.delete()
            library.deleteRecursively()
        }
    }

    @Test fun rejectsIncompleteBundleWithoutModifyingExistingFiles() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val zip = File(context.cacheDir, "incomplete-five-songs.zip")
        val library = File(context.filesDir, "kyvoriq_private_music")
        try {
            FileOutputStream(zip).use { file ->
                ZipOutputStream(file).use { out ->
                    out.putNextEntry(ZipEntry(names[0]))
                    out.write(ByteArray(4096).apply {
                        this[0] = 'I'.code.toByte()
                        this[1] = 'D'.code.toByte()
                        this[2] = '3'.code.toByte()
                    })
                    out.closeEntry()
                }
            }
            assertTrue(runCatching { KyvoriqPrivateMusic.install(context, Uri.fromFile(zip)) }.isFailure)
            assertNull(KyvoriqPrivateMusic.track(context, 1))
        } finally {
            zip.delete()
            library.deleteRecursively()
        }
    }
}

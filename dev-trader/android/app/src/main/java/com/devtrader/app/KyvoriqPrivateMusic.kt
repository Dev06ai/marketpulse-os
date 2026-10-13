package com.devtrader.app

import android.content.Context
import android.net.Uri
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.util.zip.ZipInputStream

/**
 * Private, one-time 5-song ZIP importer. No commercial recordings are included
 * in the publicly signed APK or uploaded to the public source repository.
 * Input is an explicitly owner-selected document, copied to sandboxed app files.
 */
internal object KyvoriqPrivateMusic {
    private val names = listOf(
        "track_01_bipolar.mp3",
        "track_02_iris.mp3",
        "track_03_dark_beach.mp3",
        "track_04_akai.mp3",
        "track_05_written.mp3"
    )
    private const val MAX_SONG_BYTES = 22L * 1024 * 1024
    private const val MAX_TOTAL_BYTES = 90L * 1024 * 1024

    fun track(context: Context, slot: Int): File? {
        val name = names.getOrNull(slot) ?: return null
        val file = File(File(context.filesDir, "kyvoriq_private_music"), name)
        return file.takeIf { it.isFile && it.length() > 1000 }
    }

    /** Must run on a worker thread; never on the Android UI thread. */
    fun install(context: Context, source: Uri): Int {
        val library = File(context.filesDir, "kyvoriq_private_music")
        if (!library.isDirectory && !library.mkdirs()) throw IOException("Cannot prepare private music directory")
        val staging = File.createTempFile("music-import-", ".tmp", library).apply {
            if (!delete() || !mkdir()) throw IOException("Cannot create private import directory")
        }
        val recognized = mutableSetOf<String>()
        var total = 0L
        try {
            val input = context.contentResolver.openInputStream(source)
                ?: throw IOException("Cannot open the selected music ZIP")
            ZipInputStream(input.buffered()).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    if (entry.isDirectory) {
                        zip.closeEntry()
                        continue
                    }
                    val basename = entry.name.substringAfterLast('/').substringAfterLast('\\')
                    if (basename !in names) {
                        zip.closeEntry()
                        continue
                    }
                    if (!recognized.add(basename)) throw IOException("Duplicate track in music ZIP: $basename")
                    val output = File(staging, basename)
                    var count = 0L
                    FileOutputStream(output).use { sink ->
                        val buf = ByteArray(32 * 1024)
                        while (true) {
                            val n = zip.read(buf)
                            if (n < 0) break
                            count += n
                            total += n
                            if (count > MAX_SONG_BYTES || total > MAX_TOTAL_BYTES) {
                                throw IOException("Music ZIP exceeds private storage limits")
                            }
                            sink.write(buf, 0, n)
                        }
                    }
                    if (count < 2048L) throw IOException("Audio file appears incomplete: $basename")
                    FileInputStream(output).use { file ->
                        val signature = ByteArray(3)
                        if (file.read(signature) != 3) throw IOException("Invalid MP3 header")
                        val id3 = signature[0] == 'I'.code.toByte() &&
                            signature[1] == 'D'.code.toByte() && signature[2] == '3'.code.toByte()
                        val frame = (signature[0].toInt() and 0xff) == 0xff &&
                            (signature[1].toInt() and 0xe0) == 0xe0
                        if (!id3 && !frame) throw IOException("Invalid MP3 content: $basename")
                    }
                    zip.closeEntry()
                }
            }
            if (recognized.size != names.size) {
                throw IOException("This ZIP needs all five tracks. Found ${recognized.size} of ${names.size}.")
            }
            for (name in names) {
                val from = File(staging, name)
                val target = File(library, name)
                // All files are staged and checked before any installed file is replaced.
                if (!from.renameTo(target)) {
                    from.copyTo(target, overwrite = true)
                    from.delete()
                }
            }
            return recognized.size
        } finally {
            staging.deleteRecursively()
        }
    }
}

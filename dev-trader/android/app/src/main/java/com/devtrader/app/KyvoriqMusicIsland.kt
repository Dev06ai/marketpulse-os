package com.devtrader.app

import android.animation.ArgbEvaluator
import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.app.AlertDialog
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaMetadataRetriever
import android.media.MediaPlayer
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.fragment.app.FragmentActivity

/**
 * In-app music island, deliberately NOT a system overlay or a remote downloader.
 * All media comes from the Android document picker and stays behind a persisted
 * read-only URI grant. No audio permissions, background microphones or network APIs.
 */
internal class KyvoriqMusicIsland(
    private val activity: FragmentActivity,
    private val importAudio: (Int) -> Unit
) {
    data class Track(val title: String, val artist: String, val first: Int, val second: Int)

    val tracks = listOf(
        Track("bipolar X svj v12 car sounds (slowed)", "eternityfounddead",
            Color.rgb(210, 214, 221), Color.rgb(97, 106, 117)),
        Track("Iris", "pastel_ghost",
            Color.rgb(132, 208, 247), Color.rgb(250, 171, 207)),
        Track("Dark Beach (Slowed)", "pastel_ghost",
            Color.rgb(183, 73, 227), Color.rgb(83, 47, 132)),
        Track("AKAI (Slowed)", "udiexrn",
            Color.rgb(235, 239, 246), Color.rgb(116, 131, 152)),
        Track("it was written (slowed + reverbed)", "hiroisekaiofficial",
            Color.rgb(145, 105, 233), Color.rgb(65, 42, 119))
    )

    private val prefs = activity.getSharedPreferences("kyvoriq_music_island_v1", Context.MODE_PRIVATE)
    private val main = Handler(Looper.getMainLooper())
    private val manager = activity.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val focusAttributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
        .build()
    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        if (change == AudioManager.AUDIOFOCUS_LOSS ||
            change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ||
            change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
            main.post { pause() }
        }
    }
    private val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
        .setAudioAttributes(focusAttributes)
        .setOnAudioFocusChangeListener(focusListener)
        .build()

    private fun dp(value: Int): Int = (value * activity.resources.displayMetrics.density + .5f).toInt()
    private var index = prefs.getInt("selected", 0).coerceIn(0, tracks.lastIndex)
    private var media: MediaPlayer? = null
    private var preparing = false
    private var playing = false
    private var ending = false
    private var destroyed = false
    private var volume = 0f
    private var fade: ValueAnimator? = null
    private var auraPulse: ObjectAnimator? = null
    private var auraColor = tracks[index].first
    private val textColor = Color.rgb(245, 245, 248)
    private val mutedColor = Color.rgb(164, 166, 176)

    private val trackTitle = TextView(activity).apply {
        setTextColor(textColor)
        textSize = 11f
        typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
        maxLines = 1
        ellipsize = android.text.TextUtils.TruncateAt.END
        includeFontPadding = false
    }
    private val trackArtist = TextView(activity).apply {
        setTextColor(mutedColor)
        textSize = 9f
        maxLines = 1
        ellipsize = android.text.TextUtils.TruncateAt.END
        includeFontPadding = false
    }
    private val coverText = TextView(activity).apply {
        text = "♫"
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
        textSize = 21f
    }
    private val coverImage = ImageView(activity).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        visibility = View.GONE
    }
    private val cover = FrameLayout(activity).apply {
        clipToOutline = true
        addView(coverText, FrameLayout.LayoutParams(-1, -1))
        addView(coverImage, FrameLayout.LayoutParams(-1, -1))
        contentDescription = "Choose or import a music track"
    }
    private val status = TextView(activity).apply {
        textSize = 9f
        setTextColor(mutedColor)
        maxLines = 1
        ellipsize = android.text.TextUtils.TruncateAt.END
        includeFontPadding = false
    }
    private fun control(symbol: String, description: String): TextView =
        TextView(activity).apply {
            text = symbol
            textSize = 20f
            gravity = Gravity.CENTER
            setTextColor(textColor)
            contentDescription = description
            setOnTouchListener { view, event ->
                if (event.action == android.view.MotionEvent.ACTION_DOWN) {
                    view.animate().scaleX(.90f).scaleY(.90f).setDuration(70).start()
                } else if (event.action == android.view.MotionEvent.ACTION_UP ||
                    event.action == android.view.MotionEvent.ACTION_CANCEL) {
                    view.animate().scaleX(1f).scaleY(1f).setDuration(140).start()
                }
                false
            }
        }
    private val prev = control("‹", "Previous song")
    private val play = control("▶", "Play music")
    private val next = control("›", "Next song")
    private val aura = FrameLayout(activity)
    private val inner = LinearLayout(activity).apply {
        gravity = Gravity.CENTER_VERTICAL
        orientation = LinearLayout.HORIZONTAL
        setPadding(dp(9), dp(6), dp(9), dp(6))
        background = GradientDrawable().apply {
            cornerRadius = dp(24).toFloat()
            setColor(Color.rgb(13, 14, 18))
        }
    }
    private val progress = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
        max = 1000
        progress = 0
        progressTintList = ColorStateList.valueOf(auraColor)
        progressBackgroundTintList = ColorStateList.valueOf(Color.rgb(51, 53, 59))
    }
    val island: FrameLayout = FrameLayout(activity).apply {
        visibility = View.GONE
        clipChildren = false
        clipToPadding = false
        contentDescription = "KYVORIQ music island"
    }
    private val ticker = object : Runnable {
        override fun run() {
            if (destroyed || !playing) return
            val p = media
            if (p != null && !preparing) {
                runCatching {
                    val duration = p.duration.coerceAtLeast(1)
                    val elapsed = p.currentPosition
                    progress.progress = (elapsed.toLong() * 1000 / duration).toInt().coerceIn(0, 1000)
                    if (duration >= 4000 && duration - elapsed <= 2200 && !ending) {
                        ending = true
                        fadeTo(0f, (duration - elapsed).coerceIn(350, 2200).toLong()) {
                            if (playing && !destroyed) autoNext()
                        }
                    }
                }
            }
            main.postDelayed(this, 220)
        }
    }

    init {
        // Aura stays within its own reserved layout row, below the status bar.
        island.addView(aura, FrameLayout.LayoutParams(-1, -1))
        island.addView(inner, FrameLayout.LayoutParams(-1, -1).apply {
            setMargins(dp(3), dp(3), dp(3), dp(3))
        })
        inner.addView(cover, LinearLayout.LayoutParams(dp(43), dp(43)).apply {
            rightMargin = dp(8)
        })
        val caption = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_VERTICAL
            addView(trackTitle, LinearLayout.LayoutParams(-1, -2))
            addView(trackArtist, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(3) })
            addView(status, LinearLayout.LayoutParams(-1, -2).apply { topMargin = dp(4) })
            setOnClickListener { showPlaylist() }
            contentDescription = "Open five-song music playlist"
        }
        inner.addView(caption, LinearLayout.LayoutParams(0, -1, 1f))
        for (control in listOf(prev, play, next)) {
            inner.addView(control, LinearLayout.LayoutParams(dp(33), dp(43)))
        }
        prev.setOnClickListener { step(-1) }
        next.setOnClickListener { step(1) }
        play.setOnClickListener { togglePlayback() }
        cover.setOnClickListener { showPlaylist() }
        island.addView(progress, FrameLayout.LayoutParams(-1, dp(2), Gravity.BOTTOM).apply {
            leftMargin = dp(24)
            rightMargin = dp(24)
            bottomMargin = dp(4)
        })
        updateAppearance(false)
    }

    private fun linked(trackIndex: Int): Uri? = prefs.getString("uri_" + trackIndex, null)
        ?.takeIf { it.isNotBlank() }?.let { Uri.parse(it) }

    private fun updateAppearance(animated: Boolean) {
        val track = tracks[index]
        trackTitle.text = track.title
        trackArtist.text = track.artist
        status.text = when {
            preparing -> "LOADING AUDIO"
            playing -> "●  NOW PLAYING"
            linked(index) == null -> "TAP PLAY TO IMPORT AUDIO"
            else -> "READY  •  LOCAL AUDIO"
        }
        play.text = if (playing) "Ⅱ" else "▶"
        play.contentDescription = if (playing) "Pause music" else "Play music"
        coverImage.visibility = View.GONE
        coverText.visibility = View.VISIBLE
        cover.background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
            intArrayOf(track.first, track.second)).apply { cornerRadius = dp(13).toFloat() }
        progress.progressTintList = ColorStateList.valueOf(track.first)
        val target = track.first
        if (animated) {
            ValueAnimator.ofObject(ArgbEvaluator(), auraColor, target).apply {
                duration = 420
                addUpdateListener {
                    auraColor = it.animatedValue as Int
                    updateAura()
                }
                start()
            }
        } else {
            auraColor = target
            updateAura()
        }
        val uri = linked(index)
        if (uri != null) runCatching {
            val retriever = MediaMetadataRetriever()
            try {
                retriever.setDataSource(activity, uri)
                retriever.embeddedPicture?.let { bytes ->
                    val opts = BitmapFactory.Options().apply { inSampleSize = 2 }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, opts)?.let { bitmap ->
                        coverImage.setImageBitmap(bitmap)
                        coverImage.visibility = View.VISIBLE
                        coverText.visibility = View.GONE
                    }
                }
            } finally { retriever.release() }
        }
    }

    private fun updateAura() {
        val second = tracks[index].second
        aura.background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
            intArrayOf(auraColor, second, auraColor)).apply {
            cornerRadius = dp(28).toFloat()
            setStroke(dp(1), auraColor)
        }
    }

    private fun pulse(enabled: Boolean) {
        auraPulse?.cancel()
        auraPulse = null
        aura.alpha = .52f
        if (enabled && KyvoriqTheme.motionEnabled(activity)) {
            auraPulse = ObjectAnimator.ofFloat(aura, View.ALPHA, .42f, .91f).apply {
                duration = 1650L
                repeatCount = ObjectAnimator.INFINITE
                repeatMode = ObjectAnimator.REVERSE
                start()
            }
        }
    }

    fun toggleIsland() {
        if (island.visibility == View.VISIBLE) {
            island.animate().cancel()
            island.animate().alpha(0f).translationY(-dp(6).toFloat())
                .setDuration(180L).withEndAction {
                    island.visibility = View.GONE
                    island.translationY = 0f
                }.start()
            return
        }
        island.animate().cancel()
        island.visibility = View.VISIBLE
        island.alpha = 0f
        island.translationY = -dp(9).toFloat()
        island.animate().alpha(1f).translationY(0f).setDuration(280L)
            .setInterpolator(DecelerateInterpolator()).start()
        if (linked(index) != null && !playing && media == null) startTrack(index)
    }

    private fun ensureShown() {
        if (island.visibility != View.VISIBLE) toggleIsland()
    }

    fun importFile(trackIndex: Int, uri: Uri) {
        if (destroyed || trackIndex !in tracks.indices) return
        runCatching {
            activity.contentResolver.takePersistableUriPermission(
                uri, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }.onFailure {
            // The current URI can still work for the app session, but decline to
            // advertise persistent availability when the provider cannot grant it.
            Toast.makeText(activity, "Select an audio file supporting saved access", Toast.LENGTH_LONG).show()
            return
        }
        prefs.edit().putString("uri_" + trackIndex, uri.toString()).apply()
        ensureShown()
        startTrack(trackIndex)
    }

    private fun togglePlayback() {
        if (preparing) return
        if (playing) { pause(); return }
        val p = media
        if (p != null) {
            if (!requestFocus()) return
            runCatching {
                p.setVolume(0f, 0f)
                p.start()
                playing = true
                volume = 0f
                fadeTo(1f, 1650L)
                main.removeCallbacks(ticker)
                main.post(ticker)
                pulse(true)
                updateAppearance(false)
            }.onFailure { startTrack(index) }
        } else if (linked(index) == null) {
            importAudio(index)
        } else startTrack(index)
    }

    private fun requestFocus(): Boolean {
        return manager.requestAudioFocus(focusRequest) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    private fun fadeTo(target: Float, time: Long, done: (() -> Unit)? = null) {
        fade?.cancel()
        val p = media ?: return
        fade = ValueAnimator.ofFloat(volume, target).apply {
            duration = time
            addUpdateListener {
                if (media === p) {
                    volume = (it.animatedValue as Float).coerceIn(0f, 1f)
                    runCatching { p.setVolume(volume, volume) }
                }
            }
            addListener(object : android.animation.AnimatorListenerAdapter() {
                private var canceled = false
                override fun onAnimationCancel(animation: android.animation.Animator) { canceled = true }
                override fun onAnimationEnd(animation: android.animation.Animator) {
                    if (!canceled && media === p) done?.invoke()
                }
            })
            start()
        }
    }

    private fun step(direction: Int) {
        val newIndex = (index + direction + tracks.size) % tracks.size
        if (playing) {
            fadeTo(0f, 320L) { select(newIndex, true) }
        } else select(newIndex, false)
    }

    private fun select(trackIndex: Int, autoplay: Boolean) {
        if (trackIndex !in tracks.indices || destroyed) return
        fade?.cancel()
        runCatching { media?.release() }
        media = null
        preparing = false
        playing = false
        ending = false
        index = trackIndex
        prefs.edit().putInt("selected", index).apply()
        progress.progress = 0
        pulse(false)
        updateAppearance(true)
        if (autoplay && linked(trackIndex) != null) startTrack(trackIndex)
        else manager.abandonAudioFocusRequest(focusRequest)
    }

    private fun autoNext() {
        val found = (1..tracks.size).map { (index + it) % tracks.size }.firstOrNull { linked(it) != null }
        if (found == null) {
            pause()
            return
        }
        select(found, true)
    }

    private fun startTrack(trackIndex: Int) {
        if (destroyed) return
        val uri = linked(trackIndex) ?: run { select(trackIndex, false); importAudio(trackIndex); return }
        if (!requestFocus()) {
            Toast.makeText(activity, "Audio output unavailable right now", Toast.LENGTH_SHORT).show()
            return
        }
        if (index != trackIndex) select(trackIndex, false)
        fade?.cancel()
        media?.let { runCatching { it.release() } }
        val p = MediaPlayer()
        media = p
        preparing = true
        playing = false
        ending = false
        pulse(false)
        updateAppearance(false)
        runCatching {
            p.setAudioAttributes(focusAttributes)
            p.setDataSource(activity, uri)
            p.setVolume(0f, 0f)
            p.setOnPreparedListener { prepared ->
                if (destroyed || media !== prepared) return@setOnPreparedListener
                preparing = false
                runCatching {
                    prepared.start()
                    playing = true
                    volume = 0f
                    fadeTo(1f, 1750L)
                    main.removeCallbacks(ticker)
                    main.post(ticker)
                    pulse(true)
                    updateAppearance(false)
                }.onFailure { handleError() }
            }
            p.setOnCompletionListener { complete ->
                if (media === complete && !destroyed) autoNext()
            }
            p.setOnErrorListener { failing, _, _ ->
                if (media === failing) handleError()
                true
            }
            p.prepareAsync()
        }.onFailure { handleError() }
    }

    private fun handleError() {
        runCatching { media?.release() }
        media = null
        preparing = false
        playing = false
        ending = false
        main.removeCallbacks(ticker)
        manager.abandonAudioFocusRequest(focusRequest)
        pulse(false)
        status.text = "AUDIO UNAVAILABLE  •  REIMPORT FILE"
        play.text = "▶"
        Toast.makeText(activity, "Audio could not be opened. Please relink this track.", Toast.LENGTH_LONG).show()
    }

    fun pause() {
        if (destroyed) return
        if (!playing) return
        playing = false
        ending = false
        main.removeCallbacks(ticker)
        fadeTo(0f, 230L) {
            runCatching { media?.pause() }
            manager.abandonAudioFocusRequest(focusRequest)
        }
        pulse(false)
        updateAppearance(false)
    }

    fun release() {
        destroyed = true
        main.removeCallbacks(ticker)
        fade?.cancel()
        auraPulse?.cancel()
        runCatching { media?.release() }
        media = null
        manager.abandonAudioFocusRequest(focusRequest)
    }

    private fun showPlaylist() {
        val items = tracks.mapIndexed { i, t ->
            (if (linked(i) != null) "♪  " else "＋  ") + t.title + "  ·  " + t.artist
        }.toTypedArray()
        AlertDialog.Builder(activity)
            .setTitle("KYVORIQ  ·  MUSIC")
            .setSingleChoiceItems(items, index) { dialog, which ->
                dialog.dismiss()
                select(which, linked(which) != null)
                if (linked(which) == null) importAudio(which)
            }
            .setPositiveButton("LINK AUDIO FILE") { _, _ -> importAudio(index) }
            .setNegativeButton("CLOSE", null)
            .show()
    }
}

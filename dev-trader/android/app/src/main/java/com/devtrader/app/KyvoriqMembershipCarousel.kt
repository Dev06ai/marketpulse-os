package com.devtrader.app

import android.app.AlertDialog
import android.app.Dialog
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.fragment.app.FragmentActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.recyclerview.widget.RecyclerView
import androidx.viewpager2.widget.ViewPager2
import kotlin.math.abs

/**
 * Visual membership preview only. No pricing, checkout, entitlement decisions, or trading
 * signals are ever derived from this view. Billing and feature access must be server-owned.
 */
class KyvoriqMembershipCarousel(private val activity: FragmentActivity) {
    private val ivory = Color.rgb(242, 238, 227)
    private val muted = Color.rgb(164, 161, 155)
    private val nearBlack = Color.rgb(7, 8, 10)
    private val surface = Color.rgb(23, 24, 26)

    private data class Plan(
        val name: String,
        val marker: String,
        val headline: String,
        val description: String,
        val caption: String,
        val features: List<String>
    )

    private val plans = listOf(
        Plan(
            "BASIC", "FREE",
            "Explore the market.",
            "Essential chart analysis, always accessible.",
            "START HERE",
            listOf(
                "BTC chart and market structure",
                "Bollinger Bands + 50 EMA",
                "SFP references and candle Volume",
                "Home-screen widgets",
                "Public trading signals: coming soon"
            )
        ),
        Plan(
            "PRO", "PRO ACCESS",
            "Trade with more context.",
            "Important market levels, Volume Profile, full-screen charts and alerts.",
            "FOR ACTIVE ANALYSIS",
            listOf(
                "All Basic features: Volume + widgets",
                "Daily / Weekly / NPOC levels",
                "Volume Profile (VP) + fullscreen chart",
                "Premium market-level alerts",
                "Enhanced widgets and chart interactions"
            )
        ),
        Plan(
            "ELITE", "ELITE ACCESS",
            "See the complete picture.",
            "The complete chart intelligence experience, including VP and fullscreen.",
            "FULL MARKET INTELLIGENCE",
            listOf(
                "Everything in Pro: Volume, widgets, VP + fullscreen",
                "High-value order blocks",
                "D-Line and VAH / VAL levels",
                "Extended premium chart tools",
                "Premium alerts and enhanced widgets"
            )
        )
    )

    fun show(initialPlan: Int = 1): Dialog? {
        if (activity.isFinishing || activity.isDestroyed) return null

        val dialog = Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        val root = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(15), dp(16), dp(15), dp(16))
            background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(nearBlack, Color.rgb(12, 12, 15), nearBlack))
        }
        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val bars = insets.getInsets(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            view.setPadding(dp(15), bars.top + dp(12), dp(15), bars.bottom + dp(13))
            insets
        }

        val header = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        header.addView(TextView(activity).apply {
            text = "✦  KYVORIQ"
            textSize = 17f
            letterSpacing = .12f
            setTextColor(ivory)
            setTypeface(null, Typeface.BOLD)
            contentDescription = "KYVORIQ membership plans"
        }, LinearLayout.LayoutParams(0, dp(52), 1f).apply { gravity = Gravity.CENTER_VERTICAL })
        val close = TextView(activity).apply {
            text = "×"
            gravity = Gravity.CENTER
            textSize = 30f
            setTextColor(ivory)
            background = roundSurface(Color.rgb(30, 30, 33), 40f, Color.rgb(58, 58, 62))
            contentDescription = "Close membership plans"
            isClickable = true
            isFocusable = true
            setOnClickListener { dialog.dismiss() }
        }
        header.addView(close, LinearLayout.LayoutParams(dp(43), dp(43)))
        root.addView(header, LinearLayout.LayoutParams(-1, dp(56)))

        val viewport = ScrollView(activity).apply {
            isFillViewport = false
            isVerticalScrollBarEnabled = false
            overScrollMode = View.OVER_SCROLL_IF_CONTENT_SCROLLS
        }
        val content = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
        }
        viewport.addView(content, FrameLayout.LayoutParams(-1, -2))
        root.addView(viewport, LinearLayout.LayoutParams(-1, 0, 1f))

        content.addView(TextView(activity).apply {
            text = "MEMBERSHIP"
            gravity = Gravity.CENTER
            textSize = 11f
            letterSpacing = .24f
            setTextColor(muted)
            setPadding(0, dp(21), 0, dp(10))
        }, LinearLayout.LayoutParams(-1, -2))

        val symbol = TextView(activity).apply {
            text = "✦"
            gravity = Gravity.CENTER
            textSize = 27f
            setTextColor(ivory)
            background = roundSurface(Color.rgb(30, 29, 28), 22f, Color.rgb(68, 65, 59))
        }
        content.addView(symbol, LinearLayout.LayoutParams(dp(52), dp(52)).apply {
            bottomMargin = dp(13)
        })
        val headline = TextView(activity).apply {
            gravity = Gravity.CENTER
            textSize = 22f
            setTextColor(ivory)
            setTypeface(null, Typeface.BOLD)
            maxLines = 2
        }
        content.addView(headline, LinearLayout.LayoutParams(-1, -2))
        val subtitle = TextView(activity).apply {
            gravity = Gravity.CENTER
            textSize = 13f
            setTextColor(muted)
            maxLines = 3
            setPadding(dp(22), dp(8), dp(22), dp(7))
        }
        content.addView(subtitle, LinearLayout.LayoutParams(-1, dp(64)))

        val glowHost = FrameLayout(activity).apply {
            clipChildren = false
            clipToPadding = false
        }
        val glow = View(activity).apply {
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                gradientType = GradientDrawable.RADIAL_GRADIENT
                setColors(intArrayOf(Color.argb(88, 242, 238, 227), Color.argb(25, 242, 238, 227), Color.TRANSPARENT))
                gradientRadius = dp(190).toFloat()
            }
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        glowHost.addView(glow, FrameLayout.LayoutParams(-1, dp(295), Gravity.CENTER))
        val pager = ViewPager2(activity).apply {
            orientation = ViewPager2.ORIENTATION_HORIZONTAL
            adapter = PlanAdapter(activity, plans)
            offscreenPageLimit = 2
            clipChildren = false
            clipToPadding = false
            setPadding(dp(36), 0, dp(36), 0)
        }
        (pager.getChildAt(0) as? RecyclerView)?.apply {
            clipChildren = false
            clipToPadding = false
            overScrollMode = View.OVER_SCROLL_NEVER
        }
        val allowMotion = KyvoriqTheme.motionEnabled(activity)
        pager.setPageTransformer { page, position ->
            if (allowMotion) {
                val distance = abs(position).coerceIn(0f, 1f)
                page.scaleX = 1f - .055f * distance
                page.scaleY = 1f - .11f * distance
                page.alpha = 1f - .36f * distance
                page.translationY = dp(12) * distance
            } else {
                page.scaleX = 1f
                page.scaleY = 1f
                page.alpha = 1f
                page.translationY = 0f
            }
        }
        glowHost.addView(pager, FrameLayout.LayoutParams(-1, dp(289)))
        content.addView(glowHost, LinearLayout.LayoutParams(-1, dp(289)).apply { topMargin = dp(3) })

        val dots = LinearLayout(activity).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
            setPadding(0, dp(14), 0, dp(12))
        }
        content.addView(dots, LinearLayout.LayoutParams(-1, -2))
        val featureLabel = TextView(activity).apply {
            gravity = Gravity.CENTER
            textSize = 12f
            setTextColor(muted)
            setPadding(dp(12), dp(4), dp(12), dp(12))
        }
        content.addView(featureLabel, LinearLayout.LayoutParams(-1, -2))
        val action = Button(activity).apply {
            isAllCaps = false
            textSize = 15f
            setTextColor(nearBlack)
            setTypeface(null, Typeface.BOLD)
            backgroundTintList = null
            background = RippleDrawable(
                ColorStateList.valueOf(Color.argb(46, 30, 30, 30)),
                roundSurface(ivory, 48f), null
            )
            minHeight = dp(55)
            stateListAnimator = null
            contentDescription = "View selected membership features"
        }
        root.addView(action, LinearLayout.LayoutParams(-1, dp(55)).apply {
            leftMargin = dp(19)
            rightMargin = dp(19)
            topMargin = dp(9)
        })
        root.addView(TextView(activity).apply {
            text = "Preview only  •  Paid memberships and checkout are not active"
            gravity = Gravity.CENTER
            textSize = 10.5f
            setTextColor(muted)
            setPadding(dp(4), dp(11), dp(4), dp(6))
            maxLines = 2
        }, LinearLayout.LayoutParams(-1, -2))

        var selectedPlan = -1
        fun select(index: Int) {
            val plan = plans[index]
            val changed = selectedPlan >= 0 && selectedPlan != index
            selectedPlan = index
            headline.animate().cancel()
            subtitle.animate().cancel()
            headline.text = plan.headline
            subtitle.text = plan.description
            if (changed && allowMotion) {
                headline.alpha = .45f
                headline.translationY = dp(7).toFloat()
                headline.animate().alpha(1f).translationY(0f)
                    .setDuration(220L).setInterpolator(KyvoriqTheme.motion).start()
                subtitle.alpha = .45f
                subtitle.translationY = dp(5).toFloat()
                subtitle.animate().alpha(1f).translationY(0f)
                    .setDuration(260L).setInterpolator(KyvoriqTheme.motion).start()
            } else {
                headline.alpha = 1f
                headline.translationY = 0f
                subtitle.alpha = 1f
                subtitle.translationY = 0f
            }
            featureLabel.text = plan.caption
            action.text = if (index == 0) "EXPLORE BASIC" else "EXPLORE " + plan.name
            dots.removeAllViews()
            plans.indices.forEach { i ->
                val active = i == index
                val target = FrameLayout(activity).apply {
                    isClickable = true
                    isFocusable = true
                    contentDescription = "Show " + plans[i].name + " membership"
                    setOnClickListener { pager.setCurrentItem(i, KyvoriqTheme.motionEnabled(activity)) }
                }
                target.addView(View(activity).apply {
                    background = roundSurface(if (active) ivory else Color.rgb(83, 84, 88), 100f)
                    importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
                }, FrameLayout.LayoutParams(dp(if (active) 21 else 7), dp(7), Gravity.CENTER))
                dots.addView(target, LinearLayout.LayoutParams(dp(38), dp(34)))
            }
            action.setOnClickListener {
                AlertDialog.Builder(activity)
                    .setTitle(plan.name + " membership")
                    .setMessage(plan.features.joinToString("\n\n") { "•  " + it } +
                        "\n\nTrading signals and paid checkout are coming later. No purchase is available yet.")
                    .setPositiveButton("Close", null)
                    .show()
            }
        }
        val callback = object : ViewPager2.OnPageChangeCallback() {
            override fun onPageSelected(position: Int) = select(position)
        }
        pager.registerOnPageChangeCallback(callback)
        val startPlan = initialPlan.coerceIn(0, plans.lastIndex)
        pager.setCurrentItem(startPlan, false)
        select(startPlan)
        dialog.setOnDismissListener { pager.unregisterOnPageChangeCallback(callback) }
        dialog.setContentView(root)
        dialog.show()
        dialog.window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        dialog.window?.statusBarColor = nearBlack
        dialog.window?.navigationBarColor = nearBlack
        return dialog
    }

    private inner class PlanAdapter(
        private val context: Context,
        private val items: List<Plan>
    ) : RecyclerView.Adapter<PlanAdapter.Holder>() {
        inner class Holder(val container: FrameLayout) : RecyclerView.ViewHolder(container)

        override fun getItemCount() = items.size
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
            return Holder(FrameLayout(context).apply {
                layoutParams = RecyclerView.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
                )
                setPadding(dp(5), dp(5), dp(5), dp(8))
            })
        }

        override fun onBindViewHolder(holder: Holder, position: Int) {
            val plan = items[position]
            holder.container.removeAllViews()
            val card = LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER_HORIZONTAL
                setPadding(dp(15), dp(17), dp(15), dp(16))
                background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                    intArrayOf(Color.rgb(41, 41, 40), surface)).apply {
                    cornerRadius = dp(24).toFloat()
                    setStroke(dp(1), Color.rgb(180, 176, 163))
                }
                elevation = dp(3).toFloat()
                contentDescription = plan.name + " membership: " + plan.features.joinToString(", ")
            }
            holder.container.addView(card, FrameLayout.LayoutParams(-1, -1))
            card.addView(TextView(context).apply {
                text = plan.marker
                textSize = 10f
                letterSpacing = .14f
                gravity = Gravity.CENTER
                setTextColor(ivory)
                setPadding(dp(10), dp(5), dp(10), dp(5))
                background = roundSurface(Color.rgb(73, 70, 62), 40f)
            })
            card.addView(TextView(context).apply {
                text = plan.name
                setTextColor(ivory)
                textSize = 30f
                letterSpacing = .08f
                gravity = Gravity.CENTER
                setTypeface(null, Typeface.BOLD)
            }, LinearLayout.LayoutParams(-1, dp(66)).apply { topMargin = dp(7) })
            card.addView(View(context).apply {
                setBackgroundColor(Color.rgb(106, 102, 94))
            }, LinearLayout.LayoutParams(dp(46), dp(1)).apply { bottomMargin = dp(13) })
            plan.features.take(4).forEach { feature ->
                card.addView(TextView(context).apply {
                    text = "✦  " + feature
                    setTextColor(ivory)
                    textSize = 11.5f
                    gravity = Gravity.CENTER
                    maxLines = 2
                    setPadding(0, dp(5), 0, dp(5))
                }, LinearLayout.LayoutParams(-1, -2))
            }
        }
    }

    private fun dp(value: Int) = (value * activity.resources.displayMetrics.density).toInt()

    private fun roundSurface(color: Int, radius: Float, stroke: Int? = null): GradientDrawable =
        GradientDrawable().apply {
            setColor(color)
            cornerRadius = radius * activity.resources.displayMetrics.density
            if (stroke != null) setStroke(dp(1), stroke)
        }
}

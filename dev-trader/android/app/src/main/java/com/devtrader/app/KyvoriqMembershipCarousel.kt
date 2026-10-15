package com.devtrader.app

import android.widget.ImageView
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
    private val ivory = Color.rgb(244, 239, 226)
    private val softIvory = Color.rgb(222, 208, 180)
    private val quote = KyvoriqRegionalPricing.forDevice(activity)
    private val muted = Color.rgb(164, 161, 155)
    private val nearBlack = Color.rgb(7, 8, 10)
    private val surface = Color.rgb(17, 18, 20)

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
        header.addView(ImageView(activity).apply {
            setImageResource(R.drawable.kyvoriq_mark)
            scaleType = ImageView.ScaleType.FIT_CENTER
            contentDescription = "KYVORIQ logo"
        }, LinearLayout.LayoutParams(dp(29), dp(32)).apply { rightMargin = dp(12) })
        header.addView(TextView(activity).apply {
            text = "K Y V O R I Q"
            textSize = 15f
            letterSpacing = .09f
            setTextColor(ivory)
            setTypeface(null, Typeface.BOLD)
            contentDescription = "KYVORIQ membership plans"
        }, LinearLayout.LayoutParams(0, dp(52), 1f).apply { gravity = Gravity.CENTER_VERTICAL })
        val close = TextView(activity).apply {
            text = "×"
            gravity = Gravity.CENTER
            textSize = 30f
            setTextColor(ivory)
            background = roundSurface(Color.rgb(25, 26, 28), 40f, Color.rgb(90, 83, 73))
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
            setPadding(0, dp(23), 0, dp(12))
        }, LinearLayout.LayoutParams(-1, -2))

        // The identity mark now lives in the header, leaving room for a premium serif hero.
        val headline = TextView(activity).apply {
            gravity = Gravity.CENTER
            textSize = if (activity.resources.configuration.screenWidthDp < 360) 28f else 32f
            setTextColor(ivory)
            typeface = Typeface.create("serif", Typeface.NORMAL)
            includeFontPadding = false
            setLineSpacing(dp(2).toFloat(), 1.01f)
            maxLines = 2
        }
        content.addView(headline, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(6); bottomMargin = dp(9)
        })
        val subtitle = TextView(activity).apply {
            gravity = Gravity.CENTER
            textSize = 13f
            setTextColor(muted)
            maxLines = 3
            setLineSpacing(dp(2).toFloat(), 1.09f)
            setPadding(dp(12), 0, dp(12), dp(5))
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
                setColors(intArrayOf(
                    Color.argb(142, 248, 227, 189), Color.argb(86, 244, 231, 210),
                    Color.argb(20, 242, 238, 227), Color.TRANSPARENT))
                gradientRadius = dp(220).toFloat()
            }
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        val cardHeight = (activity.resources.configuration.screenHeightDp * .44f).toInt().coerceIn(295, 400)
        glowHost.addView(glow, FrameLayout.LayoutParams(-1, dp(cardHeight + 50), Gravity.CENTER))
        val pager = ViewPager2(activity).apply {
            orientation = ViewPager2.ORIENTATION_HORIZONTAL
            adapter = PlanAdapter(activity, plans)
            offscreenPageLimit = 2
            clipChildren = false
            clipToPadding = false
            setPadding(dp(45), 0, dp(45), 0)
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
                page.scaleX = 1f - .10f * distance
                page.scaleY = 1f - .13f * distance
                page.alpha = 1f - .44f * distance
                page.translationY = dp(19) * distance
            } else {
                page.scaleX = 1f
                page.scaleY = 1f
                page.alpha = 1f
                page.translationY = 0f
            }
            // Ivory border brightens as a card approaches the carousel center.
            (page as? FrameLayout)?.getChildAt(0)?.let { card ->
                (card.background as? GradientDrawable)?.setStroke(
                    dp(1).coerceAtLeast(1),
                    Color.argb(((1f - .70f * abs(position).coerceIn(0f, 1f)) * 240).toInt(),
                        245, 237, 217))
            }
        }
        glowHost.addView(pager, FrameLayout.LayoutParams(-1, dp(cardHeight)))
        content.addView(glowHost, LinearLayout.LayoutParams(-1, dp(cardHeight)).apply { topMargin = dp(3) })

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
        content.addView(TextView(activity).apply {
            val region = quote.regionName
            text = (if (region.length == 2) "Your region (" + region + ")" else region) +
                "  •  Indicative launch prices"
            gravity = Gravity.CENTER
            textSize = 10f
            setTextColor(muted)
        }, LinearLayout.LayoutParams(-1, dp(24)))
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
            minHeight = dp(58)
            stateListAnimator = null
            contentDescription = "View selected membership features"
        }
        root.addView(action, LinearLayout.LayoutParams(-1, dp(58)).apply {
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
            headline.text = when (index) {
                0 -> "Discover the\nmarket."
                1 -> "Unlock premium\nmarket analysis."
                else -> "See the complete\nmarket picture."
            }
            subtitle.text = plan.description
            if (changed && allowMotion) {
                headline.alpha = .45f
                headline.translationY = dp(7).toFloat()
                headline.animate().alpha(1f).translationY(0f)
                    .setDuration(340L).setInterpolator(KyvoriqTheme.motion).start()
                subtitle.alpha = .45f
                subtitle.translationY = dp(5).toFloat()
                subtitle.animate().alpha(1f).translationY(0f)
                    .setDuration(380L).setInterpolator(KyvoriqTheme.motion).start()
            } else {
                headline.alpha = 1f
                headline.translationY = 0f
                subtitle.alpha = 1f
                subtitle.translationY = 0f
            }
            featureLabel.text = plan.caption
            action.text = "EXPLORE " + plan.name + "    ↗"
            if (changed && allowMotion) {
                glow.animate().cancel()
                glow.alpha = .55f
                glow.animate().alpha(1f).setDuration(420L)
                    .setInterpolator(KyvoriqTheme.motion).start()
                action.animate().cancel()
                action.scaleX = .97f
                action.animate().scaleX(1f).setDuration(310L)
                    .setInterpolator(KyvoriqTheme.motion).start()
            }
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
            action.setOnClickListener { showPlanDetails(plan) }
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


    /**
     * Custom ivory/charcoal details bottom sheet, never Android's grey AlertDialog.
     * There is deliberately no route from this sheet to Play purchase APIs.
     */
    private fun showPlanDetails(plan: Plan) {
        if (activity.isFinishing || activity.isDestroyed) return
        val sheet = Dialog(activity)
        val body = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(22), dp(21), dp(22), dp(21))
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR,
                intArrayOf(Color.rgb(36, 35, 32), Color.rgb(17, 18, 20), nearBlack)).apply {
                cornerRadius = dp(29).toFloat()
                setStroke(dp(1), Color.argb(200, 243, 228, 196))
            }
        }
        val scroll = ScrollView(activity).apply {
            isFillViewport = false
            isVerticalScrollBarEnabled = false
            addView(body, FrameLayout.LayoutParams(-1, -2))
        }
        body.addView(View(activity).apply {
            background = roundSurface(softIvory, 90f)
        }, LinearLayout.LayoutParams(dp(38), dp(4)).apply {
            gravity = Gravity.CENTER_HORIZONTAL
            bottomMargin = dp(17)
        })
        body.addView(TextView(activity).apply {
            text = "K Y V O R I Q    /    " + plan.name
            textSize = 10.5f
            letterSpacing = .10f
            setTextColor(softIvory)
        })
        body.addView(TextView(activity).apply {
            text = plan.name.lowercase().replaceFirstChar { it.uppercase() } + " membership"
            textSize = 28f
            typeface = Typeface.create("serif", Typeface.NORMAL)
            setTextColor(ivory)
            setPadding(0, dp(12), 0, dp(7))
        })
        val tier = when (plan.name) {
            "PRO" -> KyvoriqAccessTier.PRO
            "ELITE" -> KyvoriqAccessTier.ELITE
            else -> KyvoriqAccessTier.BASIC
        }
        val amount = KyvoriqRegionalPricing.displayAmount(tier, quote)
        body.addView(TextView(activity).apply {
            text = if (tier == KyvoriqAccessTier.BASIC) "Free forever"
                else if (amount == "TBA") "Regional launch price coming soon"
                else amount + " / month  •  Indicative preview"
            textSize = 14f
            setTextColor(softIvory)
            setPadding(0, 0, 0, dp(16))
        })
        body.addView(View(activity).apply {
            background = GradientDrawable(GradientDrawable.Orientation.LEFT_RIGHT,
                intArrayOf(softIvory, Color.TRANSPARENT))
        }, LinearLayout.LayoutParams(-1, dp(1)).apply { bottomMargin = dp(15) })
        plan.features.forEach { feature ->
            val line = LinearLayout(activity).apply {
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(8), 0, dp(8))
            }
            line.addView(TextView(activity).apply {
                text = "✓"
                textSize = 17f
                setTextColor(softIvory)
            }, LinearLayout.LayoutParams(dp(28), -2))
            line.addView(TextView(activity).apply {
                text = feature
                textSize = 14f
                setTextColor(ivory)
                setLineSpacing(dp(2).toFloat(), 1.08f)
            }, LinearLayout.LayoutParams(0, -2, 1f))
            body.addView(line, LinearLayout.LayoutParams(-1, -2))
        }
        body.addView(TextView(activity).apply {
            text = "Preview only. Paid memberships and checkout are not active. " +
                "Trading signals are coming soon. Final localized prices, cancellation " +
                "terms and renewal details will be displayed by Google Play when available."
            textSize = 12f
            setLineSpacing(dp(2).toFloat(), 1.07f)
            setTextColor(muted)
            setPadding(dp(13), dp(13), dp(13), dp(13))
            background = roundSurface(Color.rgb(31, 32, 33), 16f, Color.rgb(75, 72, 66))
        }, LinearLayout.LayoutParams(-1, -2).apply {
            topMargin = dp(16); bottomMargin = dp(15)
        })
        val back = Button(activity).apply {
            text = "BACK TO MEMBERSHIPS"
            isAllCaps = false
            textSize = 14f
            setTextColor(nearBlack)
            setTypeface(null, Typeface.BOLD)
            stateListAnimator = null
            backgroundTintList = null
            background = RippleDrawable(
                ColorStateList.valueOf(Color.argb(40, 45, 42, 37)),
                roundSurface(ivory, 60f), null)
            setOnClickListener { sheet.dismiss() }
        }
        body.addView(back, LinearLayout.LayoutParams(-1, dp(52)))
        sheet.setContentView(scroll)
        sheet.show()
        sheet.window?.apply {
            setBackgroundDrawable(android.graphics.drawable.ColorDrawable(Color.TRANSPARENT))
            addFlags(android.view.WindowManager.LayoutParams.FLAG_DIM_BEHIND)
            attributes = attributes.apply {
                gravity = Gravity.BOTTOM
                dimAmount = .72f
            }
            setLayout(activity.resources.displayMetrics.widthPixels - dp(15),
                ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        if (KyvoriqTheme.motionEnabled(activity)) {
            body.alpha = 0f
            body.translationY = dp(24).toFloat()
            body.animate().alpha(1f).translationY(0f).setDuration(330L)
                .setInterpolator(KyvoriqTheme.motion).start()
        }
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
                    intArrayOf(Color.rgb(38, 37, 33), surface, Color.rgb(12, 13, 15))).apply {
                    cornerRadius = dp(28).toFloat()
                    setStroke(dp(1), softIvory)
                }
                elevation = dp(3).toFloat()
                contentDescription = plan.name + " membership: " + plan.features.joinToString(", ")
            }
            holder.container.addView(card, FrameLayout.LayoutParams(-1, -1))
            card.addView(TextView(context).apply {
                text = if (position == 1) "MOST POPULAR" else plan.marker
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
                textSize = 29f
                letterSpacing = .04f
                gravity = Gravity.CENTER
                typeface = Typeface.create("serif", Typeface.NORMAL)
            }, LinearLayout.LayoutParams(-1, dp(66)).apply { topMargin = dp(7) })
            card.addView(View(context).apply {
                setBackgroundColor(Color.rgb(106, 102, 94))
            }, LinearLayout.LayoutParams(dp(46), dp(1)).apply { bottomMargin = dp(13) })
            plan.features.take(3).forEach { feature ->
                card.addView(TextView(context).apply {
                    text = "✓  " + feature
                    setTextColor(ivory)
                    textSize = 11.2f
                    gravity = Gravity.CENTER
                    maxLines = 2
                    setPadding(0, dp(5), 0, dp(5))
                }, LinearLayout.LayoutParams(-1, -2))
            }
            card.addView(View(context), LinearLayout.LayoutParams(1, 0, 1f))
            val price = KyvoriqRegionalPricing.displayAmount(
                when (position) {
                    0 -> KyvoriqAccessTier.BASIC
                    1 -> KyvoriqAccessTier.PRO
                    else -> KyvoriqAccessTier.ELITE
                }, quote)
            card.addView(TextView(context).apply {
                text = price
                textSize = if (price.length > 10) 22f else 29f
                setTextColor(ivory)
                gravity = Gravity.CENTER
                typeface = Typeface.create("serif", Typeface.NORMAL)
                maxLines = 1
            }, LinearLayout.LayoutParams(-1, dp(41)))
            card.addView(TextView(context).apply {
                text = if (position == 0) "Always free" else if (price == "TBA")
                    "Regional price coming soon" else "per month  •  preview"
                textSize = 10.5f
                setTextColor(muted)
                gravity = Gravity.CENTER
            }, LinearLayout.LayoutParams(-1, dp(24)))
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

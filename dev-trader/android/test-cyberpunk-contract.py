"""Build 158 non-live Android source contract; intentionally no external trades."""
from pathlib import Path

root = Path(__file__).resolve().parent
src = root / "app/src/main"
gradle = (root / "app/build.gradle.kts").read_text()
activity = (src / "java/com/devtrader/app/SafeActivity.kt").read_text()
chart = (src / "java/com/devtrader/app/MarketChartView.kt").read_text()
motion = (src / "java/com/devtrader/app/KyvoriqMotionIdentity.kt").read_text()
splash = (src / "java/com/devtrader/app/KyvoriqLaunchOverlay.kt").read_text()

assert 'applicationId = "com.devtrader.app"' in gradle
assert 'orNull ?: "158"' in gradle
assert 'orNull ?: "0.21.33"' in gradle
assert 'CONSUMER_PORTAL_URL' in gradle
assert 'implementation("com.airbnb.android:lottie:6.7.1")' in gradle

# Preserve signed release's emblem, wordmark, visual identity and reduced motion.
assert 'KyvoriqEmblemMotionView(this)' in activity
assert 'KyvoriqRazorWordmarkView(this)' in activity
assert 'setImageResource(R.drawable.kyvoriq_emblem_intro_tight)' in splash
assert 'KyvoriqRazorWordmarkView(context)' in splash
assert 'showVerificationFrame()' in splash
assert 'KyvoriqTheme.motionEnabled(context)' in splash
assert 'KyvoriqTheme.motionEnabled(context)' in motion

# Remove product entry points rather than hiding a consumer's empty cards.
for removed in ('DECISION CENTER', 'SETUP DETAILS', 'TRADINGVIEW CHART',
                'showTradingViewPreview', 'showTradeDetails'):
    assert removed not in activity, removed
assert not (src / "java/com/devtrader/app/TradingViewPreview.kt").exists()
assert 'listOf("TRADE", "SIGNALS", "INSIGHTS")' in activity
assert '"COMING SOON"' in activity
assert 'P&L CALCULATOR' in activity
assert 'LinearLayout.LayoutParams(-1, dp(44))' in activity
assert 'accountButton' in activity
assert 'private fun showConsumerAccountPanel()' in activity
assert 'android.app.Dialog(this)' in activity
assert 'private fun showPnlCalculator()' in activity
assert 'Estimated fee rate per side (%)' in activity
assert 'Risk budget (USDT)' in activity
assert 'val pnl = qty * priceMove' not in activity  # gross/net/fees now explicit
assert 'val gross = qty * priceMove' in activity
assert 'val net = gross - estimatedFees' in activity
# Preserve native chart, candle axis geometry and pan/zoom.
assert 'private fun axisWidth()' in chart
assert 'private fun plotRight(): Float = width - axisWidth()' in chart
assert 'val right = plotRight()' in chart
assert 'touchDownX >= plotRight()' in chart
assert 'right + dp(1f)' in chart
assert 'pinchStartZoomX' in chart

for code in (motion, splash):
    for forbidden in ('WebSocket', 'Bitget', 'DEMO_EXECUTION_PAUSED',
                      'Runtime.getRuntime', 'java.net.'):
        assert forbidden not in code, forbidden

print("KYVORIQ_BUILD158_CONSUMER_CHART_AND_BRANDING_CONTRACT_OK")

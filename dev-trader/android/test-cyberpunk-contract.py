"""Sanity checks for visual-only KYVORIQ Build 139; executed before Gradle."""
from pathlib import Path
import json

root = Path(__file__).resolve().parent
source = root / "app/src/main"
gradle = (root/"app/build.gradle.kts").read_text()
activity = (source/"java/com/devtrader/app/SafeActivity.kt").read_text()
chart = (source/"java/com/devtrader/app/MarketChartView.kt").read_text()
motion = (source/"java/com/devtrader/app/KyvoriqMotionIdentity.kt").read_text()
splash = (source/"java/com/devtrader/app/KyvoriqLaunchOverlay.kt").read_text()

assert 'implementation("com.airbnb.android:lottie:6.7.1")' in gradle
assert 'orNull ?: "139"' in gradle and 'orNull ?: "0.21.14"' in gradle
assert "KyvoriqEmblemMotionView(this)" in activity
assert "KyvoriqRazorWordmarkView(this)" in activity
assert "CyberpunkHeaderRail(this)" not in activity
assert "CyberpunkMarkView(this)" not in activity
assert "KyvoriqEmblemMotionView(context)" in splash
assert "KyvoriqRazorWordmarkView(context)" in splash
assert "setAnimation(filename)" in motion
assert "LottieDrawable.INFINITE" in motion
assert "pauseAnimation()" in motion and "resumeAnimation()" in motion
assert "KyvoriqTheme.motionEnabled(context)" in motion

flames = json.loads((source/"assets/kyvoriq_gold_flames.json").read_text())
wordmark = json.loads((source/"assets/kyvoriq_razor_wordmark.json").read_text())
assert flames["w"] == 180 and flames["h"] == 140 and len(flames["layers"]) >= 20
assert wordmark["w"] == 490 and wordmark["h"] == 105
assert len(wordmark["layers"]) >= 3 and len(wordmark["layers"][0]["shapes"][0]["it"]) >= 20
assert "molten gold" in json.dumps(flames)
assert "cyan" in json.dumps(wordmark).lower()
assert all(layer["ty"] == 4 for layer in flames["layers"] + wordmark["layers"])
assert len(chart.split("val right = width - dp(50f)")) == 2
assert "val axisLeft = right - dp(14f)" in chart
assert "touchDownX >= width - dp(50f)" in chart
assert "width - dp(82f)" in chart  # preserve historical default candle count
for code in (motion, splash):
    for forbidden in ("WebSocket", "Bitget", "DEMO_EXECUTION_PAUSED", "Runtime.getRuntime", "java.net."):
        assert forbidden not in code, forbidden
print("KYVORIQ_BUILD_139_LOTTIE_AND_CHART_CONTRACT_OK")

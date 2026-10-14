"""Fail-closed KYVORIQ Build 140 Android visual and release contract."""
from pathlib import Path
import json

root = Path(__file__).resolve().parent
src = root / "app/src/main"
gradle = (root / "app/build.gradle.kts").read_text()
activity = (src / "java/com/devtrader/app/SafeActivity.kt").read_text()
chart = (src / "java/com/devtrader/app/MarketChartView.kt").read_text()
motion = (src / "java/com/devtrader/app/KyvoriqMotionIdentity.kt").read_text()
splash = (src / "java/com/devtrader/app/KyvoriqLaunchOverlay.kt").read_text()

assert 'implementation("com.airbnb.android:lottie:6.7.1")' in gradle
assert 'orNull ?: "158"' in gradle and 'orNull ?: "0.21.33"' in gradle
assert 'applicationId = "com.devtrader.app"' in gradle
assert 'KyvoriqEmblemMotionView(this)' in activity
assert 'KyvoriqRazorWordmarkView(this)' in activity
assert 'CyberpunkHeaderRail(this)' not in activity
assert 'CyberpunkMarkView(this)' not in activity
assert 'narrowHeader' in activity and 'identityRow' in activity
assert 'KyvoriqEmblemMotionView(context)' in splash
assert 'KyvoriqRazorWordmarkView(context)' in splash
assert 'showVerificationFrame()' in splash
assert 'postDelayed(timeout, 1900L)' in splash
assert 'setAnimation(filename)' in motion
assert 'LottieDrawable.INFINITE' in motion
assert 'pauseAnimation()' in motion and 'resumeAnimation()' in motion
assert 'KyvoriqTheme.motionEnabled(context)' in motion
assert 'still.visibility' in motion  # static fallback under reduced motion or slow Lottie parse

flames = json.loads((src / "assets/kyvoriq_gold_flames.json").read_text())
wordmark = json.loads((src / "assets/kyvoriq_razor_wordmark.json").read_text())
intro = json.loads((src / "assets/kyvoriq_ignition_intro.json").read_text())
assert (flames["w"], flames["h"]) == (280, 280)
assert (wordmark["w"], wordmark["h"]) == (740, 160)
assert len(flames["layers"]) >= 12 and len(wordmark["layers"]) >= 10
assert all(l["ty"] == 4 for l in flames["layers"] + wordmark["layers"])
names = {l["nm"] for l in wordmark["layers"]}
assert {f"Letter {c}" for c in "KYVORIQ"} <= names
assert any("gold emblem" in l.get("nm", "").lower() for l in flames["layers"])
# Intro is now purely circuit art; foreground emblem and wordmark are separate.
assert not any(l.get("ty") == 0 for l in intro["layers"])
assert intro.get("assets", []) == []

# Candle positions, touches, and axis labels must share the same width calculation.
assert "private fun axisWidth()" in chart
assert "private fun plotRight(): Float = width - axisWidth()" in chart
assert "val right = plotRight()" in chart
assert "touchDownX >= plotRight()" in chart
assert "right + dp(1f)" in chart

for code in (motion, splash):
    for forbidden in ("WebSocket", "Bitget", "DEMO_EXECUTION_PAUSED", "Runtime.getRuntime", "java.net."):
        assert forbidden not in code, forbidden
print("KYVORIQ_BUILD140_MOTION_AND_CHART_CONTRACT_OK")

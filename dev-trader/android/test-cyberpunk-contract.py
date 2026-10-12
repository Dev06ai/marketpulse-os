"""Fail-closed checks for the Android-only animated KYVORIQ design."""
from pathlib import Path
root = Path(__file__).resolve().parent / "app/src/main"
identity = (root / "java/com/devtrader/app/CyberpunkIdentityViews.kt").read_text()
boot = (root / "java/com/devtrader/app/KyvoriqLaunchOverlay.kt").read_text()
backdrop = (root / "java/com/devtrader/app/CyberpunkCircuitBackdrop.kt").read_text()
activity = (root / "java/com/devtrader/app/SafeActivity.kt").read_text()
gradle = (Path(__file__).resolve().parent / "app/build.gradle.kts").read_text()
for phrase in [
    "class CyberpunkMarkView", "class CyberpunkWordmarkView",
    "emblem.draw(canvas)", "flame.cubicTo", "Ion.MAGENTA", "Ion.VIOLET",
    "canvas.clipRect", "postInvalidateOnAnimation", "onVisibilityAggregated",
    "KyvoriqTheme.motionEnabled(context)", "goldState"
]:
    assert phrase in identity, phrase
for phrase in [
    "CyberpunkCircuitBackdrop", "setStartDelay(650L)", "setStartDelay(1550L)",
    "onDetachedFromWindow", "KyvoriqTheme.motionEnabled"
]:
    assert phrase in boot, phrase
assert "class CyberpunkHeaderRail" in backdrop
assert "CyberpunkHeaderRail(this)" in activity
assert "devTraderVersionCode\").orNull ?: \"138\"" in gradle
assert "devTraderVersionName\").orNull ?: \"0.21.13\"" in gradle
for source in [identity, boot, backdrop]:
    for forbidden in ["java.net.", "WebSocket", "Bitget", "Runtime.getRuntime", "Thread.sleep"]:
        assert forbidden not in source, (forbidden, source[:80])
print("CYBERPUNK_ANDROID_ONLY_CONTRACT_OK")

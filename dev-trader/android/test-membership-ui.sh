#!/usr/bin/env bash
# Offline emulator test for user-visible KYVORIQ membership tier interactions.
set -euo pipefail

adb install -r dev-trader/android/app/build/outputs/apk/debug/app-debug.apk
adb install -r dev-trader/android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
for dimensions in '720x1280:320' '1080x2400:420'; do
  resolution="${dimensions%%:*}"
  density="${dimensions##*:}"
  echo "Testing KYVORIQ membership on ${resolution} @ ${density} dpi"
  adb shell wm size "$resolution"
  adb shell wm density "$density"
  adb shell am instrument -w \
    -e class com.devtrader.app.KyvoriqMembershipCarouselTest,com.devtrader.app.KyvoriqMembershipAccessTest \
    com.devtrader.app.debug.test/androidx.test.runner.AndroidJUnitRunner | tee /tmp/kyvoriq-membership-tests.txt
  grep -q "OK (" /tmp/kyvoriq-membership-tests.txt
done
echo "Membership UI instrumentation passed at both device sizes."

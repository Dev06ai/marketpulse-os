#!/usr/bin/env bash
set -euo pipefail
mkdir -p ui-159
adb install -r preview/app-debug.apk
adb install -r preview/app-debug-androidTest.apk
# All app data comes from the offline preview fixture. No market/exchange calls.
adb shell svc wifi disable
adb shell svc data disable
for spec in 'small:640:1280:1.0' 'normal:720:1600:1.0' 'tall:824:1830:1.0' 'large-font:720:1600:1.5' 'landscape:1600:720:1.0'; do
  IFS=: read -r name width height font <<< "$spec"
  adb shell am force-stop com.devtrader.app.debug
  adb shell wm density 320
  adb shell wm size "${width}x${height}"
  adb shell settings put system font_scale "$font"
  sleep 2
  mkdir -p "ui-159/$name"
  adb shell am instrument -w -r -e class com.devtrader.app.HeroChartVisualTest \
    com.devtrader.app.debug.test/androidx.test.runner.AndroidJUnitRunner | tee "ui-159/$name/test.txt"
  adb pull /sdcard/Android/data/com.devtrader.app.debug/files/. "ui-159/$name/" || true
  grep -q 'OK (1 test)' "ui-159/$name/test.txt"
done

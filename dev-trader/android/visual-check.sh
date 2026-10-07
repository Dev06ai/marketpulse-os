#!/usr/bin/env bash
set -euo pipefail
mkdir -p ui-check

app_package="com.devtrader.app.debug"
headings=('DECISION CENTER' 'DEMO PERFORMANCE' 'ENTRY CHECKS')

app_health_failed() {
  local log_file="$1"
  if grep -q 'FATAL EXCEPTION' "$log_file" && \
      grep -A 8 'FATAL EXCEPTION' "$log_file" | grep -q "Process: ${app_package}"; then
    return 0
  fi
  grep -Eq "ANR in ${app_package}|Application Not Responding: ${app_package}" "$log_file"
}

collect_diagnostics() {
  adb logcat -d > ui-check/logcat.txt || true
  adb exec-out screencap -p > ui-check/last-screen.png || true
  if app_health_failed ui-check/logcat.txt; then
    grep -n -E -A 22 "FATAL EXCEPTION|ANR in ${app_package}|Application Not Responding: ${app_package}" ui-check/logcat.txt | tail -n 160 || true
  fi
}
trap collect_diagnostics EXIT

adb install -r dist/app-debug.apk
adb logcat -c
# Android emulator system UI/launcher can occasionally ANR while wm size/density is
# changed. Do not let that unrelated modal cover the app under test. App crashes
# and app-specific ANRs are still detected from logcat below.
adb shell settings put global hide_error_dialogs 1 || true
adb shell settings put global anr_show_background 0 || true
adb shell input keyevent KEYCODE_WAKEUP || true
adb shell wm dismiss-keyguard || true
adb shell settings put system screen_off_timeout 600000

for viewport in compact tall; do
  if [[ "$viewport" == compact ]]; then
    adb shell wm size 720x1280
    adb shell wm density 320
  else
    adb shell wm size 1080x2400
    adb shell wm density 420
  fi
  for workspace in 0 1 2; do
    adb shell am start -S -W -n "${app_package}/com.devtrader.app.SafeActivity" \
      --ez visual_preview true --ei visual_workspace "$workspace"
    captured=false
    expected_heading="${headings[$workspace]}"
    for attempt in {1..8}; do
      sleep 1
      adb shell rm -f /sdcard/dev-trader-ui.xml
      adb shell uiautomator dump /sdcard/dev-trader-ui.xml
      candidate="ui-check/${viewport}-${workspace}.candidate.xml"
      if adb pull /sdcard/dev-trader-ui.xml "$candidate"; then
        # A successful uiautomator dump is not sufficient: a system ANR dialog
        # can be the top window. Accept only the Dev Trader hierarchy for the
        # requested workspace, otherwise close system UI and retry.
        if grep -q "package=\"${app_package}\"" "$candidate" && \
            grep -q "text=\"${expected_heading}\"" "$candidate"; then
          mv "$candidate" "ui-check/${viewport}-${workspace}.xml"
          captured=true
          break
        fi
      fi
      rm -f "$candidate"
      adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS >/dev/null 2>&1 || true
      # A transient null/foreign accessibility root must not press Back: that
      # closes KYVORIQ and turns a retry into a guaranteed launcher failure.
      # Reassert the requested preview activity instead.
      adb shell am start -W -n "${app_package}/com.devtrader.app.SafeActivity" \
        --ez visual_preview true --ei visual_workspace "$workspace" >/dev/null 2>&1 || true
    done
    if [[ "$captured" != true ]]; then
      echo "Unable to capture Dev Trader workspace ${workspace} at ${viewport}; top window never became the requested app workspace."
      exit 1
    fi
    adb exec-out screencap -p > "ui-check/${viewport}-${workspace}.png"
  done
done

adb logcat -d > ui-check/logcat.txt
if app_health_failed ui-check/logcat.txt; then
  grep -n -E -A 22 "FATAL EXCEPTION|ANR in ${app_package}|Application Not Responding: ${app_package}" ui-check/logcat.txt | tail -n 160 || true
  exit 1
fi

python3 - <<'PY'
from pathlib import Path
import re
import xml.etree.ElementTree as ET
headings = ['DECISION CENTER', 'DEMO PERFORMANCE', 'ENTRY CHECKS']
for path in Path('ui-check').glob('*.xml'):
    root = ET.parse(path).getroot()
    nodes = list(root.iter('node'))
    workspace = int(path.stem.rsplit('-', 1)[1])
    assert any(n.get('text') == headings[workspace] for n in nodes), path
    assert any(n.get('package') == 'com.devtrader.app.debug' for n in nodes), path
    nav = [n for n in nodes if n.get('content-desc', '').startswith('Workspace ')]
    assert len(nav) == 3, path
    if workspace == 0:
        chart = next(n for n in nodes if n.get('content-desc') == 'Interactive price chart')
        _, chart_top, _, chart_bottom = map(int, re.findall(r'\d+', chart.get('bounds')))
        assert chart_bottom-chart_top >= 280, (path, 'Chart is too compressed', chart.attrib)
    height = 1280 if path.stem.startswith('compact') else 2400
    width = 720 if path.stem.startswith('compact') else 1080
    for node in nav:
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds')))
        assert 0 <= x1 < x2 <= width and 0 < y1 < y2 < height, (path, node.attrib)
    assert any(n.get('text') == 'LIVE' for n in nodes) if workspace == 0 else True
print('Six native workspace layouts verified; navigation stays inside both viewports.')
PY

python3 dev-trader/android/verify-interactions.py

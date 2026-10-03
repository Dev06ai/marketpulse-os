#!/usr/bin/env bash
set -euo pipefail
mkdir -p ui-check
collect_diagnostics() {
  adb logcat -d > ui-check/logcat.txt || true
  adb exec-out screencap -p > ui-check/last-screen.png || true
  if grep -q 'FATAL EXCEPTION' ui-check/logcat.txt; then
    grep -A 22 'FATAL EXCEPTION' ui-check/logcat.txt | head -n 100 || true
  fi
}
trap collect_diagnostics EXIT
adb install -r dist/app-debug.apk
adb logcat -c
adb shell input keyevent 82
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
    adb shell am start -S -W -n com.devtrader.app.debug/com.devtrader.app.SafeActivity \
      --ez visual_preview true --ei visual_workspace "$workspace"
    captured=false
    for attempt in {1..8}; do
      sleep 1
      adb shell rm -f /sdcard/dev-trader-ui.xml
      adb shell uiautomator dump /sdcard/dev-trader-ui.xml
      if adb pull /sdcard/dev-trader-ui.xml "ui-check/${viewport}-${workspace}.xml"; then
        captured=true
        break
      fi
    done
    if [[ "$captured" != true ]]; then
      echo "Unable to capture workspace ${workspace} at ${viewport}."
      exit 1
    fi
    adb exec-out screencap -p > "ui-check/${viewport}-${workspace}.png"
  done
done
adb logcat -d > ui-check/logcat.txt
if grep -q 'FATAL EXCEPTION' ui-check/logcat.txt; then
  grep -A 22 'FATAL EXCEPTION' ui-check/logcat.txt | head -n 100
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
    nav = [n for n in nodes if n.get('content-desc', '').startswith('Workspace ')]
    assert len(nav) == 3, path
    height = 1280 if path.stem.startswith('compact') else 2400
    width = 720 if path.stem.startswith('compact') else 1080
    for node in nav:
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds')))
        assert 0 <= x1 < x2 <= width and 0 < y1 < y2 < height, (path, node.attrib)
    assert any(n.get('text') == 'LIVE' for n in nodes) if workspace == 0 else True
print('Six native workspace layouts verified; navigation stays inside both viewports.')
PY

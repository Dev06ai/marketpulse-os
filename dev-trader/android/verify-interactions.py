"""Native, fixture-only consumer flows. No order or host mutation is performed."""
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

OUT = Path('ui-check/interactions')
OUT.mkdir(parents=True, exist_ok=True)
PKG = 'com.devtrader.app.debug'

def adb(*args):
    return subprocess.check_output(['adb', *args], timeout=30)

def nodes():
    """Retry transient emulator accessibility null-root errors without hiding app failures."""
    last_error = None
    for _ in range(6):
        try:
            adb('shell', 'rm', '-f', '/sdcard/interaction.xml')
            adb('shell', 'uiautomator', 'dump', '/sdcard/interaction.xml')
            raw = adb('shell', 'cat', '/sdcard/interaction.xml')
            root = ET.fromstring(raw)
            found = list(root.iter('node'))
            if found:
                return found
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, ET.ParseError) as exc:
            last_error = exc
        time.sleep(.7)
    raise AssertionError(f'Could not capture Android accessibility hierarchy: {last_error}')

def find(text=None, desc=None):
    for _ in range(4):
        for n in nodes():
            if (text is not None and n.get('text') == text) or (desc is not None and n.get('content-desc') == desc):
                return n
        time.sleep(.4)
    raise AssertionError(f'Cannot find {text or desc}')

def tap(text=None, desc=None):
    n = find(text, desc)
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', n.get('bounds')))
    assert x2 > x1 and y2 > y1
    adb('shell', 'input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
    time.sleep(.4)

def scroll_trade_to(text):
    """The enlarged trade chart intentionally puts decision tools below the fold."""
    for attempt in range(7):
        current = nodes()
        if any(n.get('text') == text for n in current):
            return
        # Right price-axis rail scrolls the page; plot swipes pan the chart.
        adb('shell', 'input', 'swipe', '1015', '1730', '1015', '570', '290')
        time.sleep(.35)
    raise AssertionError(f'Trade control not reachable after scrolling: {text}')

def shot(name):
    OUT.joinpath(name + '.png').write_bytes(adb('exec-out', 'screencap', '-p'))
    OUT.joinpath(name + '.xml').write_bytes(adb('shell', 'cat', '/sdcard/interaction.xml'))

# Native default 1h chart, scroll-safe inverse panning, navigation and calculator.

adb('shell', 'am', 'start', '-S', '-W', '-n', f'{PKG}/com.devtrader.app.SafeActivity',
    '--ez', 'visual_preview', 'true', '--ei', 'visual_workspace', '0')
# Launch default must be the same 1h chart as the supplied reference.
assert find(desc='Chart 1h').get('selected') == 'true'
tap(desc='Chart 1h')
assert find(desc='Chart 1h').get('selected') == 'true'
# Isolated TradingView preview must open and close without replacing the native
# chart, even if the optional public chart bundle cannot load in the emulator.
scroll_trade_to('TRADINGVIEW CHART  ↗')
tap(desc='Open optional TradingView Lightweight Charts preview')
find(text='TRADINGVIEW LIGHTWEIGHT CHARTS · PREVIEW')
tap(desc='Close optional TradingView preview and return to KYVORIQ chart')
assert find(desc='Chart 1h').get('selected') == 'true'
tap(desc='Workspace POSITIONS')
find(text='DEMO PERFORMANCE')
tap(desc='Workspace TRADE')
assert find(desc='Chart 1h').get('selected') == 'true'
scroll_trade_to('P&L CALCULATOR')
tap(text='P&L CALCULATOR')
find(text='P&L calculator')
shot('calculator')
tap(text='SHORT')
assert find(text='SHORT').get('selected') == 'true'
adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
scroll_trade_to('DECISION CENTER')
find(text='DECISION CENTER')
adb('shell', 'input', 'swipe', '540', '540', '540', '1720', '300')
assert find(desc='Chart 1h').get('selected') == 'true'
assert len([n for n in nodes() if n.get('content-desc', '').startswith('Workspace ')]) == 3
# Repeat the former duplicate-page path with the on-screen back button.
scroll_trade_to('P&L CALCULATOR')
tap(text='P&L CALCULATOR')
tap(desc='Back to trading workspace')
assert len([n for n in nodes() if n.get('content-desc', '').startswith('Workspace ')]) == 3

# Privacy sheet remains accessible after scrolling, without changing preferences.
tap(desc='Workspace INSIGHTS')
for _ in range(7):
    if any(n.get('text', '').startswith('PRIVACY') for n in nodes()):
        break
    adb('shell', 'input', 'swipe', '500', '1750', '500', '550', '300')
privacy = next(n.get('text') for n in nodes() if n.get('text', '').startswith('PRIVACY'))
tap(text=privacy)
find(text='PRIVACY SHIELD')
shot('privacy')
adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')

# Android reduced-motion setting: content and navigation must remain visible.
adb('shell', 'settings', 'put', 'global', 'animator_duration_scale', '0')
adb('shell', 'am', 'start', '-S', '-W', '-n', f'{PKG}/com.devtrader.app.SafeActivity',
    '--ez', 'visual_preview', 'true', '--ei', 'visual_workspace', '0')
scroll_trade_to('DECISION CENTER')
find(text='DECISION CENTER')
tap(desc='Workspace INSIGHTS')
find(text='ENTRY CHECKS')
tap(desc='Workspace TRADE')
scroll_trade_to('DECISION CENTER')
find(text='DECISION CENTER')
shot('reduced-motion')
adb('shell', 'settings', 'put', 'global', 'animator_duration_scale', '1')
print('Native navigation, selections, calculator return, privacy sheet and reduced motion verified.')

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

# Native Build 158 Trade > Signals > Insights and responsive account surface.

adb('shell', 'am', 'start', '-S', '-W', '-n', f'{PKG}/com.devtrader.app.SafeActivity',
    '--ez', 'visual_preview', 'true', '--ei', 'visual_workspace', '0')
assert find(desc='Chart 1h').get('selected') == 'true'

# User-facing account is an accessible custom panel, not the old gray list dialog.
tap(desc='Account: sign in or create account')
find(text='KYVORIQ  /  ACCOUNT')
find(text='Log in')
find(text='Sign up')
shot('account-logged-out')
adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
assert find(desc='Chart 1h').get('selected') == 'true'

# All tiers, including Elite, are locked out of signals.
tap(desc='Workspace SIGNALS')
find(text='COMING SOON')
shot('signals-locked')
tap(desc='Workspace TRADE')
assert find(desc='Chart 1h').get('selected') == 'true'

# The full-width calculator launches without changing the chart or timeframe.
calculator_desc = 'Open manual profit and loss and risk calculator'
for attempt in range(9):
    if any(n.get('content-desc') == calculator_desc for n in nodes()):
        break
    adb('shell', 'input', 'swipe', '1015', '1750', '1015', '570', '300')
    time.sleep(.3)
else:
    raise AssertionError('Full-width P&L card missing or unreachable')
tap(desc=calculator_desc)
find(text='P&L calculator')
find(text='Stop price (USDT)  •  optional risk sizing')
find(text='Estimated fee rate per side (%)')
shot('calculator')
tap(text='SHORT')
assert find(text='SHORT').get('selected') == 'true'
tap(desc='Back to trading workspace')
assert find(desc='Chart 1h').get('selected') == 'true'

tap(desc='Workspace INSIGHTS')
find(text='INSIGHTS')
shot('insights-free')
tap(desc='Workspace TRADE')

# Reduced motion must not hide the chart, calculator, or navigation.
adb('shell', 'settings', 'put', 'global', 'animator_duration_scale', '0')
adb('shell', 'am', 'start', '-S', '-W', '-n', f'{PKG}/com.devtrader.app.SafeActivity',
    '--ez', 'visual_preview', 'true', '--ei', 'visual_workspace', '0')
find(desc='Interactive price chart')
tap(desc='Workspace SIGNALS')
find(text='COMING SOON')
shot('reduced-motion-signals')
adb('shell', 'settings', 'put', 'global', 'animator_duration_scale', '1')
print('Build158 native Trade, Signals, account panel, calculator and reduced motion verified.')

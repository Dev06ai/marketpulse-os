from dataclasses import dataclass
from typing import Optional
from .models import Candle, MarketState
from .knowledge import RULES

@dataclass
class Signal:
    id: str
    direction: str
    setup: str
    entry: float
    stop: float
    target1: float
    target2: float
    rr: float
    invalidation: str
    thesis: list[str]
    timeframe: str

    def to_dict(self):
        return self.__dict__

def pivots(candles: list[Candle], window: int = 2):
    highs, lows = [], []
    for i in range(window, len(candles)-window):
        c = candles[i]
        if c.high >= max(x.high for x in candles[i-window:i+window+1]):
            highs.append((i, c.high))
        if c.low <= min(x.low for x in candles[i-window:i+window+1]):
            lows.append((i, c.low))
    return highs, lows

def rr(entry: float, stop: float, target: float) -> float:
    risk = abs(entry-stop)
    reward = abs(target-entry)
    return reward/risk if risk else 0.0

def detect_sfp(state: MarketState) -> Optional[Signal]:
    cs = [c for c in state.candles_15 if c.confirmed]
    if len(cs) < 10 or state.last_price is None:
        return None
    recent = cs[-1]
    highs, lows = pivots(cs[:-1], 2)
    ph = highs[-1][1] if highs else None
    pl = lows[-1][1] if lows else None
    min_rr = float(RULES["risk"]["preferred_min_rr"])

    if ph and recent.high > ph and recent.close < ph:
        entry, stop = recent.close, recent.high*1.0005
        target = min((x[1] for x in lows[-5:]), default=recent.low)
        if target >= entry: target = entry-(stop-entry)*min_rr
        ratio = rr(entry, stop, target)
        if ratio >= min_rr:
            return Signal(
                id=f"sfp-short-{recent.end}", direction="SHORT", setup="Bearish SFP",
                entry=entry, stop=stop, target1=entry-(stop-entry)*1.5, target2=target,
                rr=ratio, invalidation=f"15m close above swept high {recent.high:.2f}",
                thesis=[f"Sweep above prior swing high {ph:.2f}",
                        "Candle closed back below the swept level",
                        "Stop anchored at sweep wick extreme"],
                timeframe="15m")

    if pl and recent.low < pl and recent.close > pl:
        entry, stop = recent.close, recent.low*0.9995
        target = max((x[1] for x in highs[-5:]), default=recent.high)
        if target <= entry: target = entry+(entry-stop)*min_rr
        ratio = rr(entry, stop, target)
        if ratio >= min_rr:
            return Signal(
                id=f"sfp-long-{recent.end}", direction="LONG", setup="Bullish SFP",
                entry=entry, stop=stop, target1=entry+(entry-stop)*1.5, target2=target,
                rr=ratio, invalidation=f"15m close below swept low {recent.low:.2f}",
                thesis=[f"Sweep below prior swing low {pl:.2f}",
                        "Candle closed back above the swept level",
                        "Stop anchored at sweep wick extreme"],
                timeframe="15m")
    return None

def line_value(p1, p2, x):
    i1,y1=p1; i2,y2=p2
    return y2 if i2==i1 else y1+(y2-y1)*((x-i1)/(i2-i1))

def detect_dline(state: MarketState) -> Optional[Signal]:
    cs=[c for c in state.candles_15 if c.confirmed]
    if len(cs)<18 or len(state.candles_60)<12: return None
    highs,lows=pivots(cs[:-1],2)
    last=cs[-1]
    candidates=[]
    if len(lows)>=3:
        for a,b in zip(lows[-5:-1],lows[-4:]):
            if b[1]>a[1]: candidates.append(("LONG",a,b))
    if len(highs)>=3:
        for a,b in zip(highs[-5:-1],highs[-4:]):
            if b[1]<a[1]: candidates.append(("SHORT",a,b))
    if not candidates: return None
    direction,p1,p2=candidates[-1]
    touches=0
    for i,c in enumerate(cs[max(0,p1[0]-4):p2[0]+5],start=max(0,p1[0]-4)):
        lv=line_value(p1,p2,i)
        tol=max(1.0,abs(lv)*0.0015)
        if abs(c.low-lv)<=tol or abs(c.high-lv)<=tol: touches+=1
    if touches<int(RULES["dline"]["preferred_touches"]): return None
    projected=line_value(p1,p2,len(cs)-1)
    min_rr=float(RULES["risk"]["preferred_min_rr"])
    if direction=="LONG" and last.close>projected and last.open<=projected:
        stop=min(c.low for c in cs[-5:])*0.9995
        entry=last.close; target=entry+(entry-stop)*min_rr
        ratio=rr(entry,stop,target)
        if ratio>=min_rr:
            return Signal(id=f"dline-long-{last.end}",direction="LONG",setup="D-Line Breakout",
                entry=entry,stop=stop,target1=entry+(entry-stop)*1.5,target2=target,rr=ratio,
                invalidation=f"15m close back below D-Line near {projected:.2f}",
                thesis=["Multiple qualifying D-Line touches","15m body close beyond the trend line",
                        "Stop anchored below the recent execution swing"],timeframe="15m")
    if direction=="SHORT" and last.close<projected and last.open>=projected:
        stop=max(c.high for c in cs[-5:])*1.0005
        entry=last.close; target=entry-(stop-entry)*min_rr
        ratio=rr(entry,stop,target)
        if ratio>=min_rr:
            return Signal(id=f"dline-short-{last.end}",direction="SHORT",setup="D-Line Breakout",
                entry=entry,stop=stop,target1=entry-(stop-entry)*1.5,target2=target,rr=ratio,
                invalidation=f"15m close back above D-Line near {projected:.2f}",
                thesis=["Multiple qualifying D-Line touches","15m body close beyond the trend line",
                        "Stop anchored above the recent execution swing"],timeframe="15m")
    return None

class StrategyEngine:
    def __init__(self): self.last_signal_id=None
    def evaluate(self,state:MarketState)->Optional[Signal]:
        if state.data_health!="HEALTHY": return None
        signal=detect_sfp(state) or detect_dline(state)
        if signal and signal.id!=self.last_signal_id:
            self.last_signal_id=signal.id
            return signal
        return None

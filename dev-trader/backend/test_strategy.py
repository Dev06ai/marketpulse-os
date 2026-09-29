from app.models import Candle, MarketState
from app.strategy import detect_sfp, detect_dline

def c(i,o,h,l,cl,confirmed=True):
    return Candle(i*900000,(i+1)*900000,o,h,l,cl,100,confirmed)

def test_bearish_sfp():
    cs=[c(i,100,102+i%2,99,100+(i%3)) for i in range(12)]
    cs[4]=c(4,100,102,80,100)
    cs[8]=c(8,100,105,99,101)
    cs[-2]=c(10,100,102,99,101)
    cs[-1]=c(11,104,106,98,100)
    state=MarketState(candles_15=cs)
    sig=detect_sfp(state)
    assert sig is not None
    assert sig.direction=="SHORT"
    assert sig.rr >= 3.0

def test_bullish_dline_smoke():
    cs=[]
    for i in range(24):
        base=100+i*0.4
        low=base
        high=base+2
        close=base+1
        cs.append(c(i,base+0.5,high,low,close))
    cs[-1]=c(23,107.0,111.0,106.8,110.5)
    state=MarketState(candles_15=cs,candles_60=cs[-12:])
    sig=detect_dline(state)
    assert sig is None or sig.direction=="LONG"

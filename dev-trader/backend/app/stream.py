import asyncio,json,time
import websockets
from .models import Candle,MarketState

class BybitStream:
    def __init__(self,url,symbol,on_state):
        self.url=url; self.symbol=symbol; self.on_state=on_state
        self.state=MarketState(symbol=symbol); self.stop=False
        self.subs=[f"tickers.{symbol}",f"publicTrade.{symbol}",f"orderbook.1.{symbol}",f"kline.15.{symbol}",f"kline.60.{symbol}"]
        self.last_trade_minute=None; self.delta_base=0.0

    async def run(self):
        while not self.stop:
            try:
                async with websockets.connect(self.url,ping_interval=20,ping_timeout=10,max_queue=10000) as ws:
                    self.state.ws_connected=True; self.state.data_health="HEALTHY"
                    await ws.send(json.dumps({"op":"subscribe","args":self.subs}))
                    await self.on_state(self.state)
                    async for raw in ws:
                        await self.handle(raw)
                        if self.stop: break
            except Exception:
                self.state.ws_connected=False; self.state.data_health="RECONNECTING"
                await self.on_state(self.state)
                await asyncio.sleep(2)

    async def handle(self,raw):
        now=int(time.time()*1000); msg=json.loads(raw); topic=msg.get("topic","")
        self.state.received_ts=now; self.state.exchange_ts=int(msg.get("ts",now))

        if topic.startswith("tickers."):
            d=msg.get("data") or {}
            for attr,key in [("last_price","lastPrice"),("mark_price","markPrice"),("index_price","indexPrice"),
                              ("open_interest","openInterest"),("open_interest_value","openInterestValue"),
                              ("funding_rate","fundingRate"),("bid","bid1Price"),("ask","ask1Price")]:
                if d.get(key) not in (None,""):
                    setattr(self.state,attr,float(d[key]))
            if self.state.open_interest is not None:
                self.state.oi_window.append((now,self.state.open_interest)); self.state.oi_window=self.state.oi_window[-120:]
        elif topic.startswith("publicTrade."):
            for t in msg.get("data") or []:
                size=float(t.get("v",0)); self.state.cvd += size if t.get("S")=="Buy" else -size
                self.state.last_trade_ts=int(t.get("T",now))
                minute=self.state.last_trade_ts//60000
                if minute!=self.last_trade_minute:
                    self.last_trade_minute=minute; self.delta_base=self.state.cvd
            self.state.delta_1m=self.state.cvd-self.delta_base
        elif topic.startswith("orderbook."):
            d=msg.get("data") or {}; self.state.orderbook_seq=int(d.get("u",self.state.orderbook_seq or 0))
        elif topic.startswith("kline."):
            for k in msg.get("data") or []:
                c=Candle(int(k["start"]),int(k["end"]),float(k["open"]),float(k["high"]),
                         float(k["low"]),float(k["close"]),float(k.get("volume",0)),bool(k.get("confirm",False)))
                dest=self.state.candles_15 if k["interval"]=="15" else self.state.candles_60
                if dest and dest[-1].start==c.start: dest[-1]=c
                else: dest.append(c)
                del dest[:-240]
                if k["interval"]=="15": self.state.last_kline_15_ts=int(k.get("timestamp",now))
                else: self.state.last_kline_60_ts=int(k.get("timestamp",now))
        recent=[x for x in [self.state.exchange_ts,self.state.last_trade_ts,self.state.last_kline_15_ts] if x]
        self.state.data_health="HEALTHY" if self.state.ws_connected and recent and max(now-x for x in recent)<5000 else "STALE"
        await self.on_state(self.state)

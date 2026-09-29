import asyncio,os,time
from contextlib import asynccontextmanager
from fastapi import FastAPI,WebSocket,WebSocketDisconnect
from pydantic import BaseModel
from dotenv import load_dotenv
from .models import MarketState
from .stream import BybitStream
from .strategy import StrategyEngine
from .push import PushService

load_dotenv()
SYMBOL=os.getenv("SYMBOL","BTCUSDT")
WS_URL=os.getenv("BYBIT_WS_URL","wss://stream.bybit.com/v5/public/linear")
SNAPSHOT=float(os.getenv("SNAPSHOT_SECONDS","1"))
clients=set(); state=MarketState(symbol=SYMBOL); last_signal=None
engine=StrategyEngine(); push=PushService(); stream=None

class TokenPayload(BaseModel): token:str

async def broadcast_loop():
    while True:
        await asyncio.sleep(SNAPSHOT)
        payload={"type":"state",**state.snapshot(),"server_ts":int(time.time()*1000),"signal":last_signal}
        for ws in list(clients):
            try: await ws.send_json(payload)
            except Exception: clients.discard(ws)

async def on_state(s):
    global state,last_signal
    state=s
    sig=engine.evaluate(state)
    if sig:
        last_signal=sig.to_dict(); push.send_signal(last_signal)

@asynccontextmanager
async def lifespan(app):
    global stream
    stream=BybitStream(WS_URL,SYMBOL,on_state)
    tasks=[asyncio.create_task(stream.run()),asyncio.create_task(broadcast_loop())]
    yield
    stream.stop=True
    for t in tasks: t.cancel()

app=FastAPI(title="Dev Trader Engine",version="0.1.0",lifespan=lifespan)

@app.get("/health")
async def health():
    latency=(state.received_ts-state.exchange_ts) if state.received_ts and state.exchange_ts else None
    return {"ok":True,"symbol":state.symbol,"data_health":state.data_health,
            "ws_connected":state.ws_connected,"last_price":state.last_price,
            "latency_ms":latency,"signal":last_signal}

@app.get("/config")
async def config():
    return {"symbol":SYMBOL,"snapshot_seconds":SNAPSHOT,"manual_execution_only":True,
            "min_rr":float(os.getenv("MIN_RR","3")),"max_risk_pct":float(os.getenv("MAX_RISK_PCT","1"))}

@app.post("/device/register")
async def register(payload:TokenPayload):
    push.register(payload.token); return {"registered":True}

@app.websocket("/ws")
async def socket(ws:WebSocket):
    await ws.accept(); clients.add(ws)
    await ws.send_json({"type":"state",**state.snapshot(),"server_ts":int(time.time()*1000),"signal":last_signal})
    try:
        while True: await ws.receive_text()
    except (WebSocketDisconnect,Exception):
        clients.discard(ws)

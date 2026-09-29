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

class PushTestPayload(BaseModel): token: str | None = None

async def broadcast_loop():
    while True:
        await asyncio.sleep(SNAPSHOT)
        payload={"type":"state",**state.snapshot(),"server_ts":int(time.time()*1000),"signal":last_signal,"engine":engine.last_diagnostics}
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

@app.get("/diagnostics")
async def diagnostics():
    return engine.last_diagnostics

@app.get("/system-check")
async def system_check():
    try:
        latency = (state.received_ts-state.exchange_ts) if state.received_ts and state.exchange_ts else None
        diag = engine.last_diagnostics or {}
        push_status = push.status() or {}
        return {
            "backend_ok": True,
            "market": {
                "data_health": str(state.data_health or "UNKNOWN"),
                "ws_connected": bool(state.ws_connected),
                "last_price": float(state.last_price) if state.last_price is not None else None,
                "latency_ms": int(latency) if latency is not None else None,
                "orderbook_seq": int(state.orderbook_seq) if state.orderbook_seq is not None else None,
                "last_trade_ts": int(state.last_trade_ts) if state.last_trade_ts is not None else None,
                "last_kline_15_ts": int(state.last_kline_15_ts) if state.last_kline_15_ts is not None else None,
                "last_kline_60_ts": int(state.last_kline_60_ts) if state.last_kline_60_ts is not None else None,
            },
            "strategy": {
                "status": str(diag.get("status", "UNKNOWN")),
                "wait_reason": str(diag.get("wait_reason", "")),
                "manual_execution_only": bool(diag.get("manual_execution_only", True)),
            },
            "client": {
                "connected_websocket_clients": int(len(clients)),
            },
            "push": {
                "firebase_ready": bool(push_status.get("firebase_ready", False)),
                "registered_tokens": int(push_status.get("registered_tokens", 0)),
            },
        }
    except Exception as exc:
        return {
            "backend_ok": False,
            "market": {"data_health": "ERROR", "ws_connected": False, "last_price": None,
                       "latency_ms": None, "orderbook_seq": None, "last_trade_ts": None,
                       "last_kline_15_ts": None, "last_kline_60_ts": None},
            "strategy": {"status": "ERROR", "wait_reason": "System diagnostics error", "manual_execution_only": True},
            "client": {"connected_websocket_clients": int(len(clients))},
            "push": {"firebase_ready": False, "registered_tokens": 0},
        }

@app.post("/system-check/push")
async def system_check_push(payload: PushTestPayload):
    return push.send_test(payload.token)

@app.get("/health")
async def health():
    latency=(state.received_ts-state.exchange_ts) if state.received_ts and state.exchange_ts else None
    return {"ok":True,"symbol":state.symbol,"data_health":state.data_health,
            "ws_connected":state.ws_connected,"last_price":state.last_price,
            "latency_ms":latency,"signal":last_signal}

@app.get("/config")
async def config():
    return {"symbol":SYMBOL,"snapshot_seconds":SNAPSHOT,"manual_execution_only":True,
            "min_rr":float(os.getenv("MIN_RR", str(engine.last_diagnostics.get("min_rr", 2.0)))),
            "min_confidence":float(os.getenv("MIN_CONFIDENCE", str(engine.last_diagnostics.get("min_confidence", 0.52)))),
            "max_risk_pct":float(os.getenv("MAX_RISK_PCT","1")),
            "remote_tunable":["MIN_RR","MIN_CONFIDENCE","MAX_RISK_PCT","SNAPSHOT_SECONDS"]}

@app.post("/device/register")
async def register(payload:TokenPayload):
    push.register(payload.token); return {"registered":True}

@app.websocket("/ws")
async def socket(ws:WebSocket):
    await ws.accept(); clients.add(ws)
    await ws.send_json({"type":"state",**state.snapshot(),"server_ts":int(time.time()*1000),"signal":last_signal,"engine":engine.last_diagnostics})
    try:
        while True: await ws.receive_text()
    except (WebSocketDisconnect,Exception):
        clients.discard(ws)

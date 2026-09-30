import asyncio
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from dotenv import load_dotenv

from .models import MarketState
from .stream import BybitStream
from .strategy import StrategyEngine
from .push import PushService
from .analytics import compute_features
from .risk import calculate_risk
from .backtest import run_walk_forward

load_dotenv()

SYMBOL = os.getenv("SYMBOL", "BTCUSDT")
WS_URL = os.getenv("BYBIT_WS_URL", "wss://stream.bybit.com/v5/public/linear")
SNAPSHOT = float(os.getenv("SNAPSHOT_SECONDS", "1"))
clients = set()
state = MarketState(symbol=SYMBOL)
engine = StrategyEngine()
push = PushService()
stream = None
server_started_ms = int(time.time() * 1000)


class PushTestPayload(BaseModel):
    token: str | None = None


class RiskPayload(BaseModel):
    account_balance: float = 5000.0
    risk_pct: float = 1.0
    entry: float
    stop: float
    target: float | None = None


def mobile_payload():
    now = int(time.time() * 1000)
    f = compute_features(state)
    diag = engine.last_diagnostics or {}
    return {
        "type": "state",
        "symbol": state.symbol,
        "last_price": state.last_price,
        "mark_price": state.mark_price,
        "index_price": state.index_price,
        "open_interest": state.open_interest,
        "funding_rate": state.funding_rate,
        "bid": state.bid,
        "ask": state.ask,
        "data_health": state.data_health,
        "ws_connected": state.ws_connected,
        "exchange_ts": state.exchange_ts,
        "received_ts": state.received_ts,
        "server_ts": now,
        "signal": engine.active_signal,
        "engine": {
            "status": diag.get("status", "UNKNOWN"),
            "wait_reason": diag.get("wait_reason", ""),
            "signal_state": engine.signal_status,
            "last_evaluated_ts": engine.last_evaluated_ts,
            "setups": diag.get("setups", {}),
        },
        "features": {
            "trend_15": f.trend_15,
            "trend_60": f.trend_60,
            "trend_240": f.trend_240,
            "market_structure": f.market_structure,
            "regime": f.regime,
            "oi_change_5m_pct": f.oi_change_5m_pct,
            "cvd_price_divergence": f.cvd_price_divergence,
            "fvg_direction": f.fvg_direction,
            "order_block_direction": f.order_block_direction,
            "golden_pocket": f.golden_pocket,
            "weekly_open": f.weekly_open,
        },
        "heartbeat": {
            "server_uptime_ms": max(0, now - server_started_ms),
            "last_received_ts": state.received_ts,
            "last_trade_ts": state.last_trade_ts,
            "last_kline_5_ts": state.last_kline_5_ts,
            "last_kline_15_ts": state.last_kline_15_ts,
            "last_kline_60_ts": state.last_kline_60_ts,
        },
    }


async def broadcast_loop():
    while True:
        await asyncio.sleep(max(0.5, min(SNAPSHOT, 2.0)))
        payload = mobile_payload()
        for ws in list(clients):
            try:
                await asyncio.wait_for(ws.send_json(payload), timeout=0.5)
            except Exception:
                clients.discard(ws)


async def on_state(s: MarketState):
    global state
    state = s
    sig = engine.evaluate(state)
    if sig:
        push.send_signal(sig.to_dict())


@asynccontextmanager
async def lifespan(app: FastAPI):
    global stream
    stream = BybitStream(WS_URL, SYMBOL, on_state)
    tasks = [
        asyncio.create_task(stream.run()),
        asyncio.create_task(broadcast_loop()),
    ]
    yield
    stream.stop = True
    for t in tasks:
        t.cancel()


app = FastAPI(title="Dev Trader BTC Trading Bot", version="0.5.0", lifespan=lifespan)


@app.get("/health")
async def health():
    now = int(time.time() * 1000)
    latency = (state.received_ts - state.exchange_ts) if state.received_ts and state.exchange_ts else None
    recent_market = [x for x in (state.last_trade_ts, state.last_kline_15_ts, state.last_kline_60_ts) if x]
    data_age = min([now - x for x in recent_market], default=None)
    return {
        "ok": True,
        "symbol": state.symbol,
        "data_health": state.data_health,
        "ws_connected": state.ws_connected,
        "last_price": state.last_price,
        "latency_ms": latency,
        "data_age_ms": data_age,
        "signal": engine.active_signal,
        "signal_state": engine.signal_status,
    }


@app.get("/heartbeat")
async def heartbeat():
    now = int(time.time() * 1000)
    ages = {
        "trade_ms": (now - state.last_trade_ts) if state.last_trade_ts else None,
        "kline_15_ms": (now - state.last_kline_15_ts) if state.last_kline_15_ts else None,
        "kline_60_ms": (now - state.last_kline_60_ts) if state.last_kline_60_ts else None,
        "received_ms": (now - state.received_ts) if state.received_ts else None,
    }
    return {
        "server_ts": now,
        "server_uptime_ms": now - server_started_ms,
        "market_ws": state.ws_connected,
        "data_health": state.data_health,
        "ages_ms": ages,
        "strategy_last_evaluation_ts": engine.last_evaluated_ts,
        "strategy_signal_state": engine.signal_status,
        "clients": len(clients),
    }


@app.get("/diagnostics")
async def diagnostics():
    return engine.last_diagnostics


@app.get("/chart")
async def chart(interval: str = "15m"):
    mapping = {
        "5m": state.candles_5,
        "15m": state.candles_15,
        "1h": state.candles_60,
        "4h": state.candles_4h(),
    }
    candles = mapping.get(interval, state.candles_15)
    return {
        "symbol": state.symbol,
        "interval": interval,
        "last_price": state.last_price,
        "candles": [c.to_dict() for c in candles[-120:]],
    }


@app.get("/features")
async def features():
    return compute_features(state).__dict__


@app.get("/signal-history")
async def signal_history():
    return {
        "active": engine.active_signal,
        "state": engine.signal_status,
        "history": engine.signal_history,
    }


@app.get("/system-check")
async def system_check():
    try:
        now = int(time.time() * 1000)
        f = compute_features(state)
        diag = engine.last_diagnostics or {}
        push_status = push.status() or {}
        heartbeat = {
            "trade_age_ms": (now - state.last_trade_ts) if state.last_trade_ts else None,
            "kline_15_age_ms": (now - state.last_kline_15_ts) if state.last_kline_15_ts else None,
            "kline_60_age_ms": (now - state.last_kline_60_ts) if state.last_kline_60_ts else None,
            "received_age_ms": (now - state.received_ts) if state.received_ts else None,
        }
        return {
            "backend_ok": True,
            "market": {
                "data_health": str(state.data_health or "UNKNOWN"),
                "ws_connected": bool(state.ws_connected),
                "last_price": float(state.last_price) if state.last_price is not None else None,
                "latency_ms": int(state.received_ts - state.exchange_ts) if state.received_ts and state.exchange_ts else None,
                "orderbook_seq": int(state.orderbook_seq) if state.orderbook_seq is not None else None,
                "last_trade_ts": int(state.last_trade_ts) if state.last_trade_ts is not None else None,
                "last_kline_5_ts": int(state.last_kline_5_ts) if state.last_kline_5_ts is not None else None,
                "last_kline_15_ts": int(state.last_kline_15_ts) if state.last_kline_15_ts is not None else None,
                "last_kline_60_ts": int(state.last_kline_60_ts) if state.last_kline_60_ts is not None else None,
            },
            "features": {
                "trend_15": f.trend_15,
                "trend_60": f.trend_60,
                "trend_240": f.trend_240,
                "market_structure": f.market_structure,
                "regime": f.regime,
                "cvd_divergence": f.cvd_price_divergence,
                "fvg": f.fvg_direction,
                "order_block": f.order_block_direction,
                "golden_pocket": f.golden_pocket,
            },
            "strategy": {
                "status": str(diag.get("status", "UNKNOWN")),
                "wait_reason": str(diag.get("wait_reason", "")),
                "manual_execution_only": bool(diag.get("manual_execution_only", True)),
                "signal_state": engine.signal_status,
                "last_evaluated_ts": engine.last_evaluated_ts,
            },
            "heartbeat": heartbeat,
            "client": {"connected_websocket_clients": int(len(clients))},
            "push": {
                "firebase_ready": bool(push_status.get("firebase_ready", False)),
                "registered_tokens": int(push_status.get("registered_tokens", 0)),
            },
        }
    except Exception:
        return {
            "backend_ok": False,
            "market": {"data_health": "ERROR", "ws_connected": False},
            "strategy": {"status": "ERROR", "manual_execution_only": True},
            "client": {"connected_websocket_clients": int(len(clients))},
        }


@app.get("/risk")
async def risk(
    account_balance: float = 5000.0,
    risk_pct: float = 1.0,
    entry: float | None = None,
    stop: float | None = None,
    target: float | None = None,
):
    if entry is None or stop is None:
        if not engine.active_signal:
            return {"ready": False, "reason": "No active signal and no entry/stop supplied.", "manual_execution_only": True}
        entry = float(engine.active_signal["entry"])
        stop = float(engine.active_signal["stop"])
        target = float(engine.active_signal["target2"])
    return {"ready": True, **calculate_risk(
        account_balance=account_balance,
        risk_pct=risk_pct,
        entry=entry,
        stop=stop,
        target=target,
        hard_cap_pct=float(os.getenv("MAX_RISK_PCT", "1")),
    )}


@app.get("/backtest/recent")
async def backtest_recent(lookback: int = 240):
    c15 = [c for c in state.candles_15 if c.confirmed][-max(60, min(int(lookback), 600)):]
    c60 = [c for c in state.candles_60 if c.confirmed]
    if len(c15) < 40:
        return {"ready": False, "reason": f"Need 40 confirmed 15m candles; have {len(c15)}."}
    report = run_walk_forward(c15, c60)
    wins = sum(t.result_r for t in report.trades if t.result_r > 0)
    losses = abs(sum(t.result_r for t in report.trades if t.result_r < 0))
    profit_factor = (wins / losses) if losses else None
    expectancy = report.total_r / len(report.trades) if report.trades else 0.0
    return {
        "ready": True,
        "trades": [t.__dict__ for t in report.trades[-50:]],
        "stats": {
            "trades": len(report.trades),
            "total_r": round(report.total_r, 3),
            "win_rate_pct": round(report.win_rate, 2),
            "max_drawdown_r": round(report.max_drawdown_r, 3),
            "profit_factor": round(profit_factor, 3) if profit_factor is not None else None,
            "expectancy_r": round(expectancy, 4),
        },
        "manual_execution_only": True,
    }


@app.get("/app-config")
async def app_config():
    return {
        "distribution": "github-release",
        "package_name": "com.devtrader.app",
        "client_updates": "verified-in-app-apk-update",
        "update_manifest_url": "https://raw.githubusercontent.com/Dev06ai/marketpulse-os/dev-trader-v1/dev-trader/update.json",
        "engine_updates": "remote-render",
        "manual_execution_only": True,
        "remote_strategy_updates": True,
        "remote_tunables": [
            "MIN_RR", "MIN_CONFIDENCE", "MAX_RISK_PCT", "SNAPSHOT_SECONDS",
            "DLINE_TOUCHES", "SIGNAL_EXPIRY_MINUTES",
        ],
        "product": "Dev Trader BTC Trading Bot",
        "scan_mode": "loose",
        "signal_timeframes": ["5m", "15m", "1h"],
        "remote_feature_flags": {
            "system_check": True,
            "strategy_diagnostics": True,
            "reconnect_watch": True,
            "chart": True,
            "risk_engine": True,
            "signal_lifecycle": True,
            "replay": True,
            "journal": True,
        },
    }


@app.get("/config")
async def config():
    return {
        "symbol": SYMBOL,
        "snapshot_seconds": SNAPSHOT,
        "manual_execution_only": True,
        "min_rr": float(os.getenv("MIN_RR", str(engine.last_diagnostics.get("min_rr", 2.0))),
        ),
        "min_confidence": float(os.getenv("MIN_CONFIDENCE", str(engine.last_diagnostics.get("min_confidence", 0.52))),
        ),
        "max_risk_pct": float(os.getenv("MAX_RISK_PCT", "1")),
        "dline_touches": int(os.getenv("DLINE_TOUCHES", "3")),
        "signal_expiry_minutes": int(os.getenv("SIGNAL_EXPIRY_MINUTES", "45")),
    }


@app.post("/system-check/push")
async def system_check_push(payload: PushTestPayload):
    return push.send_test(payload.token)


@app.websocket("/ws")
async def socket(ws: WebSocket):
    await ws.accept()
    clients.add(ws)
    payload = mobile_payload()
    await ws.send_json(payload)
    try:
        while True:
            await ws.receive_text()
    except (WebSocketDisconnect, Exception):
        clients.discard(ws)

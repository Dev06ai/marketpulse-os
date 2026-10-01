import asyncio
import json
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from dotenv import load_dotenv

from .models import MarketState
from .stream import BybitStream
from .strategy import StrategyEngine
from .bridge import MarketPulseBridge
from .push import PushService
from .analytics import compute_features
from .risk import calculate_risk
from .backtest import run_walk_forward
from .execution import DemoExecutionEngine

load_dotenv()

SYMBOL = os.getenv("SYMBOL", "BTCUSDT")
WS_URL = os.getenv("BYBIT_WS_URL", "wss://stream.bybit.com/v5/public/linear")
SNAPSHOT = float(os.getenv("SNAPSHOT_SECONDS", "1"))
clients = set()
client_failures = {}
state = MarketState(symbol=SYMBOL)
engine = StrategyEngine()
bridge = MarketPulseBridge()
execution = DemoExecutionEngine(engine.learning, bridge=bridge)
push = PushService()
stream = None
server_started_ms = int(time.time() * 1000)
last_engine_eval_ms = 0
last_opportunity_alert = {"key": "", "ts": 0, "title": "", "body": ""}
last_trade_event = {}
last_learning_rehydrate_ts = 0.0


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
            "position_management": engine.position_management,
            "trade_governor": engine.governor_status(),
            "setup_watch": diag.get("setup_watch", []),
            "opportunity_radar": diag.get("opportunity_radar", []),
            "scenario_tree": diag.get("scenario_tree", []),
            "liquidity_map": diag.get("liquidity_map", {"above": [], "below": []}),
            "multi_timeframe_story": diag.get("multi_timeframe_story", ""),
            "radar_lead": diag.get("radar_lead"),
            "evidence_matrix": diag.get("evidence_matrix", {}),
            "sfp_hunter": diag.get("sfp_hunter", {}),
            "breakout_watch": diag.get("breakout_watch", {}),
            "data_quality": diag.get("data_quality", state.data_health),
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
            "harmonic_pattern": f.harmonic_pattern,
            "harmonic_direction": f.harmonic_direction,
            "harmonic_confidence": round(f.harmonic_confidence, 3),
            "harmonic_reason": f.harmonic_reason,
            "weekly_open": f.weekly_open,
        },
        "opportunity_alert": {
            "key": last_opportunity_alert.get("key", ""),
            "title": last_opportunity_alert.get("title", ""),
            "body": last_opportunity_alert.get("body", ""),
            "ts": last_opportunity_alert.get("ts", 0),
        },
        "trade_event": dict(last_trade_event) if last_trade_event else (execution.snapshot().get("last_event") or {}),
        "execution": execution.snapshot(),
        "learning": diag.get("learning", {}),
        "learning_context": diag.get("learning_context"),
        "upstream": {
            "rest_ok": bool(stream.last_rest_ok) if stream else False,
            "last_error": stream.last_upstream_error if stream else "",
            "last_rest_sync_ts": stream.last_rest_sync_ms if stream else 0,
            "source": stream.last_data_source if stream else "NONE",
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
        await asyncio.sleep(max(0.5, min(SNAPSHOT, 1.0)))
        try:
            payload = mobile_payload()
        except Exception:
            continue
        async def push(ws):
            try:
                await asyncio.wait_for(ws.send_json(payload), timeout=1.5)
                client_failures[ws] = 0
                return
            except Exception:
                failures = client_failures.get(ws, 0) + 1
                client_failures[ws] = failures
                if failures >= 8:
                    clients.discard(ws)
                    client_failures.pop(ws, None)

        # Send to clients concurrently so one slow mobile connection can never
        # block the other connection or starve the broadcast loop.
        if clients:
            await asyncio.gather(*(push(ws) for ws in list(clients)), return_exceptions=True)


async def on_state(s: MarketState):
    global state, last_engine_eval_ms
    state = s
    now = int(time.time() * 1000)

    # Do not run the full strategy stack on every trade/order-book tick.
    # The feed can arrive many times per second; the engine only needs a
    # bounded evaluation cadence to keep the event loop responsive.
    should_evaluate = (
        now - last_engine_eval_ms >= 1000
        or s.last_kline_5_ts == now
        or s.last_kline_15_ts == now
    )
    if should_evaluate:
        last_engine_eval_ms = now
        sig = engine.evaluate(state)

        # Notify only on meaningful opportunity transitions, not on every radar refresh.
        global last_opportunity_alert
        radar = engine.opportunity_radar_state
        sfp = (engine.last_diagnostics or {}).get("sfp_hunter", {})
        breakout = (engine.last_diagnostics or {}).get("breakout_watch", {})
        now_alert = int(time.time() * 1000)
        alert = None
        fast_move = (engine.last_diagnostics or {}).get("fast_move", {})
        fast_status = fast_move.get("status")
        fast_direction = fast_move.get("direction")
        if fast_status in {"ARMED", "TRIGGERED"} and fast_direction in {"LONG", "SHORT"}:
            fast_key = f"fast:{fast_direction}:{fast_status}:{int(now_alert // (7 * 60_000))}"
            if fast_key != last_opportunity_alert["key"] or now_alert - last_opportunity_alert["ts"] > 7 * 60_000:
                alert = {
                    "key": fast_key,
                    "title": f"BTC {fast_direction} • FAST MOMENTUM {fast_status}",
                    "body": (
                        f"5m move {float(fast_move.get('move_atr', 0.0)):.2f} ATR • "
                        f"volume {float(fast_move.get('volume_ratio', 1.0)):.1f}x. "
                        + ("; ".join(fast_move.get("reasons", [])[:3]) or "Early momentum is building.")
                        + " Manual confirmation/quality gate still required."
                    ),
                }
        if radar:
            lead = radar[0]
            if lead.get("tier") in {"DEVELOPING", "CONFIRMED"}:
                key = f"radar:{lead.get('direction')}:{lead.get('tier')}:{lead.get('setup')}"
                if key != last_opportunity_alert["key"] or now_alert - last_opportunity_alert["ts"] > 15 * 60_000:
                    alert = {
                        "key": key,
                        "title": f"BTC {lead.get('direction')} • {lead.get('tier')} opportunity",
                        "body": f"{lead.get('setup')} • {lead.get('score')}/{lead.get('max_score')} evidence. " +
                                 ("; ".join(lead.get('reasons', [])[:3]) or "Multiple live confirmations developing."),
                    }
        if sfp.get("status") == "TRIGGERED":
            key = f"sfp:{sfp.get('direction')}:{sfp.get('pattern')}:{sfp.get('target_level')}"
            if key != last_opportunity_alert["key"] or now_alert - last_opportunity_alert["ts"] > 15 * 60_000:
                alert = {
                    "key": key,
                    "title": f"BTC {sfp.get('direction')} • SFP detected",
                    "body": f"{sfp.get('pattern')} at {sfp.get('target_level')}. CVD {sfp.get('cvd')} • OI 5m {sfp.get('oi_5m_pct')}%.",
                }
        if breakout.get("status") == "BREAKOUT":
            level = breakout.get('nearby_levels', [{}])[0].get('level') if breakout.get('nearby_levels') else ''
            key = f"breakout:{breakout.get('event')}:{level}"
            if key != last_opportunity_alert["key"] or now_alert - last_opportunity_alert["ts"] > 15 * 60_000:
                alert = {
                    "key": key,
                    "title": f"BTC {breakout.get('event','BREAKOUT')}",
                    "body": breakout.get('message', 'Breakout/reclaim detected.'),
                }
        if alert and push.ready and not clients:
            last_opportunity_alert = {"key": alert["key"], "ts": now_alert, "title": alert["title"], "body": alert["body"]}
            push.send_opportunity(alert)

        lifecycle_events = list(getattr(engine, "last_lifecycle_events", []) or [])
        if lifecycle_events:
            global last_trade_event
            for event in lifecycle_events:
                last_trade_event = dict(event)
                # The background Android service receives the same event over the
                # persistent socket. FCM is the secondary path when the foreground
                # app has no connected client.
                if push.ready and not clients:
                    push.send_trade_event(event)
            final_event = next((e for e in reversed(lifecycle_events) if e.get("final")), None)
            if final_event and bridge.enabled and engine.last_lifecycle_event:
                asyncio.create_task(
                    bridge.post_outcome(
                        engine.last_lifecycle_event["signal"],
                        engine.last_lifecycle_event["outcome"],
                        float(engine.last_lifecycle_event.get("result_r", 0)),
                    )
                )

        execution_event = execution.snapshot().get("last_event") or {}
        if execution_event and execution_event.get("key") != last_trade_event.get("key"):
            last_trade_event = dict(execution_event)
            if execution_event.get("type") in {"EXECUTION_CLOSED", "EXECUTION_FAILED"}:
                if execution_event.get("type") == "EXECUTION_FAILED":
                    execution_event["close_reason"] = "FAILED"
                engine.resolve_external_execution(execution_event)
            if push.ready and not clients:
                push.send_trade_event(execution_event)

        if sig:
            signal_payload = sig.to_dict()
            if bridge.enabled:
                asyncio.create_task(
                    bridge.post_open_signal(
                        signal_payload,
                        signal_payload.get("evidence", {}).get("memory_match"),
                    )
                )
            if not clients:
                push.send_signal(signal_payload)
            if execution.enabled and execution.ready:
                asyncio.create_task(execution.handle_signal(signal_payload))


async def setup_memory_refresh_loop():
    global last_learning_rehydrate_ts
    while True:
        try:
            if bridge.enabled:
                memories = await bridge.fetch_setup_memories(SYMBOL)
                engine.set_setup_memories(memories)

                # Rehydrate the local adaptive learner from durable resolved
                # Dev Trader outcomes so a service restart does not reset what it
                # has learned about setups and contexts.
                now_mono = asyncio.get_running_loop().time()
                if now_mono - last_learning_rehydrate_ts >= 60.0:
                    history = await bridge.fetch_learning_history(SYMBOL)
                    engine.learning.rehydrate(history)
                    engine.rehydrate_remote_history(history)
                    last_learning_rehydrate_ts = now_mono

                # Reconcile any persisted live signal after a restart/cold start.
                # This prevents an open signal from being forgotten merely because
                # the Python process restarted while the market was moving.
                open_predictions = await bridge.fetch_open_signals(SYMBOL)
                if open_predictions:
                    engine.restore_external_active_signal(open_predictions[0])
                if state.last_price is not None:
                    current_price = float(state.last_price)
                    for row in open_predictions[:20]:
                        side = str(row.get("side") or "").upper()
                        stop = row.get("stop")
                        target = row.get("target")
                        try:
                            stop = float(stop)
                            target = float(target)
                        except (TypeError, ValueError):
                            continue
                        if side == "LONG":
                            if current_price <= stop:
                                asyncio.create_task(bridge.post_outcome(row, "INVALIDATED", -1.0))
                            elif current_price >= target:
                                asyncio.create_task(bridge.post_outcome(row, "TARGET_REACHED", 1.0))
                        elif side == "SHORT":
                            if current_price >= stop:
                                asyncio.create_task(bridge.post_outcome(row, "INVALIDATED", -1.0))
                            elif current_price <= target:
                                asyncio.create_task(bridge.post_outcome(row, "TARGET_REACHED", 1.0))
        except Exception:
            pass
        await asyncio.sleep(10)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global stream
    stream = BybitStream(WS_URL, SYMBOL, on_state)
    tasks = [
        asyncio.create_task(stream.run()),
        asyncio.create_task(stream.rest_fallback_loop()),
        asyncio.create_task(broadcast_loop()),
        asyncio.create_task(setup_memory_refresh_loop()),
        asyncio.create_task(execution.run()),
    ]
    yield
    stream.stop = True
    for t in tasks:
        t.cancel()


app = FastAPI(title="Dev Trader BTC Trading Bot", version="0.6.0", lifespan=lifespan)


@app.get("/health")
async def health():
    now = int(time.time() * 1000)
    latency = (state.received_ts - state.exchange_ts) if state.received_ts and state.exchange_ts else None
    recent_market = [x for x in (state.last_trade_ts, state.last_kline_15_ts, state.last_kline_60_ts) if x]
    data_age = max([now - x for x in recent_market], default=None)
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
        "last_market_update_ts": state.last_market_update_ts,
        "strategy_last_evaluation_ts": engine.last_evaluated_ts,
        "strategy_signal_state": engine.signal_status,
        "clients": len(clients),
        "learning_bridge": {"enabled": bridge.enabled, "setup_memories": len(engine.setup_memories)},
    }


@app.get("/diagnostics")
async def diagnostics():
    return engine.last_diagnostics


@app.get("/bootstrap")
async def bootstrap(interval: str = "15m"):
    if stream is not None:
        try:
            if state.last_price is None or not state.candles_15:
                await asyncio.wait_for(stream.bootstrap_rest(), timeout=8.0)
        except Exception:
            pass
    payload = mobile_payload()
    pools = {
        "5m": state.candles_5,
        "15m": state.candles_15,
        "1h": state.candles_60,
        "4h": state.candles_4h(),
    }
    candles = pools.get(interval, state.candles_15)
    payload["chart"] = {
        "symbol": state.symbol,
        "interval": interval,
        "last_price": state.last_price,
        "candles": [c.to_dict() for c in candles[-120:]],
    }
    payload["upstream"] = {
        "rest_ok": bool(stream.last_rest_ok) if stream else False,
        "last_error": stream.last_upstream_error if stream else "",
        "last_rest_sync_ts": stream.last_rest_sync_ms if stream else 0,
    }
    return payload


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


@app.get("/trades")
async def trades(limit: int = 100):
    if execution.enabled and execution.ready:
        await execution.sync()
    return {
        "mode": "BITGET_DEMO",
        "summary": execution.summary(),
        "trades": execution.history(limit),
    }


@app.get("/trades/summary")
async def trades_summary():
    if execution.enabled and execution.ready:
        await execution.sync()
    return execution.summary()


@app.get("/execution/status")
async def execution_status():
    if execution.enabled and execution.ready:
        await execution.sync()
    return execution.snapshot()


@app.get("/signal-history")
async def signal_history():
    return {
        "active": engine.active_signal,
        "state": engine.signal_status,
        "history": engine.signal_history,
        "learning": engine.learning.summary(),
        "latest_lesson": (engine.learning.summary() or {}).get("latest_lesson"),
    }


@app.get("/learning")
async def learning():
    return {
        "summary": engine.learning.summary(),
        "context": engine.learning.context(engine.active_signal) if engine.active_signal else None,
        "manual_execution_only": not execution.enabled,
        "demo_execution": execution.snapshot(),
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
                "manual_execution_only": bool(diag.get("manual_execution_only", not execution.enabled)),
                "signal_state": engine.signal_status,
                "demo_execution": execution.snapshot(),
                "last_evaluated_ts": engine.last_evaluated_ts,
            },
            "heartbeat": heartbeat,
            "client": {"connected_websocket_clients": int(len(clients))},
            "learning": engine.learning.summary(),
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
        "manual_execution_only": not execution.enabled,
        "demo_auto_execution": bool(execution.enabled and execution.ready),
        "live_money_execution": False,
        "remote_strategy_updates": True,
        "remote_tunables": [
            "MIN_RR", "MIN_CONFIDENCE", "MAX_RISK_PCT", "SNAPSHOT_SECONDS",
            "DLINE_TOUCHES", "SIGNAL_EXPIRY_MINUTES",
            "MAX_DAILY_SIGNALS", "SIGNAL_COOLDOWN_MINUTES",
            "QUALITY_MIN_CONFIDENCE", "QUALITY_MIN_RR",
        ],
        "product": "Dev Trader BTC Trading Bot",
        "scan_mode": "elite_quality",
        "signal_timeframes": ["5m", "15m", "1h"],
        "remote_feature_flags": {
            "system_check": True,
            "strategy_diagnostics": True,
            "reconnect_watch": True,
            "chart": True,
            "risk_engine": True,
            "signal_lifecycle": True,
            "trade_milestones": True,
            "adaptive_learning": True,
            "demo_execution": True,
            "trade_history": True,
            "execution_learning": True,
            "replay": True,
            "journal": True,
        },
    }


@app.get("/config")
async def config():
    return {
        "symbol": SYMBOL,
        "snapshot_seconds": SNAPSHOT,
        "manual_execution_only": not execution.enabled,
        "demo_execution_enabled": execution.enabled,
        "min_rr": float(os.getenv("MIN_RR", str(engine.last_diagnostics.get("min_rr", 2.0))),
        ),
        "min_confidence": float(os.getenv("MIN_CONFIDENCE", str(engine.last_diagnostics.get("min_confidence", 0.52))),
        ),
        "max_risk_pct": float(os.getenv("MAX_RISK_PCT", "1")),
        "max_daily_signals": int(os.getenv("MAX_DAILY_SIGNALS", str((engine.governor_status() or {}).get("daily_max", 3)))),
        "signal_cooldown_minutes": int(os.getenv("SIGNAL_COOLDOWN_MINUTES", str((engine.governor_status() or {}).get("cooldown_minutes", 120)))),
        "quality_min_confidence": float(os.getenv("QUALITY_MIN_CONFIDENCE", str((engine.governor_status() or {}).get("min_confidence", 0.70)))),
        "quality_min_rr": float(os.getenv("QUALITY_MIN_RR", str((engine.governor_status() or {}).get("min_rr", 3.0)))),
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
    client_failures[ws] = 0
    try:
        # Send immediately so the phone gets price/OI/chart state without waiting for
        # the next periodic broadcast tick.
        await ws.send_json(mobile_payload())
        # The server is the publisher. Transport-level ping/pong is handled by the
        # WebSocket stack; the client does not need to send keepalive text frames.
        # Keep a lightweight receive loop so disconnects are detected cleanly
        # instead of surfacing as noisy ASGI exceptions. The server remains the
        # publisher; the client only needs the transport heartbeat.
        while ws in clients:
            try:
                message = await asyncio.wait_for(ws.receive(), timeout=25.0)
                if message.get("type") == "websocket.disconnect":
                    break

                # Application-level keepalive creates regular inbound traffic on
                # the long-lived mobile socket in addition to transport ping/pong.
                if message.get("type") == "websocket.receive":
                    raw_text = message.get("text")
                    if raw_text:
                        try:
                            incoming = json.loads(raw_text)
                        except (TypeError, ValueError):
                            incoming = {}
                        if incoming.get("type") == "keepalive":
                            await asyncio.wait_for(
                                ws.send_json({
                                    "type": "ack",
                                    "server_ts": int(time.time() * 1000),
                                }),
                                timeout=2.0,
                            )
            except asyncio.TimeoutError:
                continue
            except WebSocketDisconnect:
                break
    except Exception:
        pass
    finally:
        clients.discard(ws)
        client_failures.pop(ws, None)

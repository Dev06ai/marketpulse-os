import asyncio
import hmac
import json
import math
import os
import time
from collections import deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Response, Request
from fastapi.exceptions import RequestValidationError
from starlette.middleware.gzip import GZipMiddleware
from starlette.responses import JSONResponse
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from .models import MarketState
from .stream import BitgetMarketStream, BybitStream
from .strategy import StrategyEngine
from .bridge import MarketPulseBridge
from .push import PushService
from .analytics import compute_features
from .risk import calculate_risk
from .build_info import BUILD_INFO
from .evaluation_cadence import evaluation_due
from .backtest import run_walk_forward
from .execution import DemoExecutionEngine
from .journal import ENGINE_REVISION, performance_scorecard
from .evaluation import ShadowEvaluator, chronological_split, replay_decisions
from .transport import Subscription, alert_payload, dashboard_payload, event_key
from .manual_levels import load_manual_level_pack
from .agent_metrics import summarize_agent_reviews
from .opportunity_scout import OpportunityScout
from .performance_learning_agent import analyze_performance
from .agent_orchestration import risk_guardian, graph_market, data_sentinel
from .smc_shadow import compare_structure
from .observability import (
    record_eval, record_eval_duration, record_smc, expose as expose_metrics, CONTENT_TYPE_LATEST
)
from .htf_policy import evaluate_htf_policy, MAX_LEVERAGE, MAX_RISK_PCT, MIN_NET_RR
from .api_security import (
    MAX_CLIENTS, MAX_HTTP_BODY_BYTES, PUBLIC_GET_PATHS,
    private_http_error, websocket_error, security_headers,
    owner_token, issue_device_token, BodyLimitMiddleware,
)

load_dotenv()

SYMBOL = os.getenv("SYMBOL", "BTCUSDT")
WS_URL = os.getenv("BYBIT_WS_URL", "wss://stream.bybit.com/v5/public/linear")
SNAPSHOT = float(os.getenv("SNAPSHOT_SECONDS", "1"))
clients = set()
client_failures = {}
subscriptions = {}
DASHBOARD_SECONDS = max(1.0, float(os.getenv("DASHBOARD_SECONDS", "5")))
state = MarketState(symbol=SYMBOL)
engine = StrategyEngine()
bridge = MarketPulseBridge()
execution = DemoExecutionEngine(engine.learning, bridge=bridge)
execution.journal=engine.journal


def verify_entry_feed(_signal: dict) -> tuple[bool, str]:
    now = int(time.time()*1000)
    if not state.ws_connected or state.data_health != "HEALTHY":
        return False, "Primary market feed lost health during entry checks; wait for a new setup."
    for name, ts, limit in (("quote", state.last_market_update_ts, 3000),
            ("trade", state.last_trade_ts, 15000), ("book", state.last_book_ts, 5000)):
        if not ts or not -1000 <= now-ts <= limit:
            return False, f"Primary {name} data expired during entry checks; wait for a new setup."
    # The feed-health helper can also be queried in isolation. Actual order
    # admission always has a nonempty id, enforced by _signal_allowed().
    # Only real signals need the more expensive HTF policy review.
    if not _signal.get("id"):
        return True, ""
    # Re-evaluate on the CURRENT live feed. A signal's saved evidence is
    # informational, not authorization that survives a new quote/bar.
    report = evaluate_htf_policy(state, _signal, compute_features(state), now)
    if not report["eligible"]:
        return False, "Higher-timeframe trade policy: " + ", ".join(report["reasons"][:3])
    # Defense in depth: independent risk review is required immediately
    # before new Bitget Demo orders. The executor still sizes to exchange
    # equity, fee budget, lot step, protective stop and margin limits.
    reviewed=dict(_signal)
    reviewed["evidence"]=dict(reviewed.get("evidence") or {})
    reviewed["evidence"]["htf_policy"]={
        "eligible":report["eligible"],
        "estimated_net_rr":report["estimated_net_rr"],
    }
    guardian=risk_guardian(reviewed,selected=True,
                           max_leverage=execution.leverage,
                           max_risk_pct=execution.max_planned_loss_pct)
    if guardian["blockers"]:
        return False, "Independent risk guardian: " + ", ".join(guardian["blockers"][:3])
    return True, ""


execution.entry_guard = verify_entry_feed
shadow=ShadowEvaluator(engine.journal)
scout = OpportunityScout(engine.journal)
agent_learning_snapshot = {}
agent_learning_updated_ms = 0
smc_snapshot: dict = {}
last_smc_observed_ms = 0
last_smc_saved_ms = 0
last_smc_disagreement = None
push = PushService()
stream = None
server_started_ms = int(time.time() * 1000)
last_engine_eval_ms = 0
last_evaluated_bars = None
last_opportunity_alert = {"key": "", "ts": 0, "title": "", "body": ""}
last_trade_event = {}
last_learning_rehydrate_ts = 0.0


def reconcile_execution_truth():
    """Make exchange execution state authoritative over cached strategy signals."""
    try:
        snapshot = execution.snapshot()
        trades = list(snapshot.get("recent_trades") or [])
    except Exception:
        return
    decision = snapshot.get("last_decision") or {}
    by_signal = {}
    for trade in trades:
        sid = str(trade.get("signal_id") or "").strip()
        if not sid:
            continue
        current = by_signal.get(sid)
        # history() is newest-first; keep the first matching record.
        if current is None:
            by_signal[sid] = trade

    for signal_id, signal in list(engine.active_signals.items()):
        trade = by_signal.get(str(signal_id))
        if not trade:
            # Also retire the persisted pre-fix rejection after a restart.
            if decision.get("signal_id") == signal_id and decision.get("status") == "SKIPPED":
                engine.retire_unexecuted_signal(signal_id, str(decision.get("reason") or "Entry skipped."))
            continue
        status = str(trade.get("status") or "").upper()
        signal["execution_status"] = status
        signal["actual_fill_confirmed"] = bool(trade.get("actual_fill_confirmed"))
        if trade.get("entry_price") not in (None, 0, 0.0):
            signal["actual_entry"] = float(trade.get("entry_price"))
        if status == "CLOSED":
            engine.resolve_external_execution({
                "type": "EXECUTION_CLOSED",
                "key": f"EXECUTION_CLOSED:{trade.get('execution_id')}",
                "execution_id": trade.get("execution_id"),
                "signal_id": signal_id,
                "direction": trade.get("direction"),
                "setup": trade.get("setup"),
                "entry_price": trade.get("entry_price"),
                "exit_price": trade.get("exit_price"),
                "realized_pnl_usdt": trade.get("realized_pnl_usdt"),
                "net_profit_usdt": trade.get("net_profit_usdt"),
                "result_r": trade.get("result_r"),
                "close_reason": trade.get("close_reason"),
                "status": "CLOSED",
                "ts": trade.get("closed_ts"),
                "learning_review": trade.get("learning_review"),
            })
        elif status == "FAILED":
            engine.retire_unexecuted_signal(signal_id, str(trade.get("error") or "Entry failed."), "FAILED")


class PushTestPayload(BaseModel):
    token: str | None = None


class PairDevicePayload(BaseModel):
    pairing_secret: str = Field(min_length=32, max_length=512, strict=True)


class RiskPayload(BaseModel):
    account_balance: float = 5000.0
    risk_pct: float = 1.0
    entry: float
    stop: float
    target: float | None = None


def chart_overlay_payload(f, diag):
    """Compact auditable chart map aligned with the reaction engine.

    Recent 15m high/low display noise is intentionally excluded. Daily levels,
    weekly open, exact NPOC, SFP and multi-timeframe OB midpoints are emitted
    with stable semantic kinds so Android can render the requested colors.
    """
    rows = []
    seen = []

    def add(kind, label, price, status="", direction="", source="", hide_after_ms=None,
            zone_low=None, zone_high=None, manual=False, pack_id="", priority=0, estimated=False,
            reaction_score=None, reaction_confirmations=None):
        try:
            value = float(price)
        except (TypeError, ValueError):
            return
        if not math.isfinite(value) or value <= 0:
            return
        if any(abs(value - prior) / max(value, 1.0) < 0.00010 for prior in seen):
            return
        seen.append(value)
        item = {"kind": kind, "label": label, "price": round(value, 2)}
        if status:
            item["status"] = str(status)
        if direction:
            item["direction"] = str(direction)
        if source:
            item["source"] = str(source)
        if hide_after_ms:
            item["hide_after_ms"] = int(hide_after_ms)
        try:
            zl, zh = sorted((float(zone_low), float(zone_high)))
            if math.isfinite(zl) and math.isfinite(zh) and zl > 0 and zh > 0:
                item["zone_low"], item["zone_high"] = round(zl, 2), round(zh, 2)
        except (TypeError, ValueError):
            pass
        if manual: item["manual"] = True
        if pack_id: item["pack_id"] = str(pack_id)
        if priority: item["priority"] = int(priority)
        if estimated: item["estimated"] = True
        if reaction_score is not None:
            try: item["reaction_score"] = int(reaction_score)
            except (TypeError, ValueError): pass
        if reaction_confirmations: item["reaction_confirmations"] = list(reaction_confirmations)[:8]
        rows.append(item)

    reaction_map = (diag or {}).get("level_reactions") or {}
    reaction_levels = reaction_map.get("levels") or []
    if reaction_levels:
        order = {"SFP": 0, "NPOC": 1, "DAILY": 2, "WEEKLY_OPEN": 3, "OB": 4}
        for row in sorted(reaction_levels, key=lambda x: order.get(str(x.get("kind") or "").upper(), 9)):
            add(
                str(row.get("kind") or "LEVEL").upper(),
                str(row.get("label") or row.get("kind") or "LEVEL"),
                row.get("price"),
                row.get("state", row.get("status", "")),
                row.get("direction", ""),
                row.get("source", ""),
                row.get("hide_after_ms"),
                row.get("zone_low"), row.get("zone_high"), bool(row.get("manual")),
                row.get("pack_id", ""), row.get("priority", 0), bool(row.get("estimated")),
                row.get("reaction_score"), row.get("reaction_confirmations"),
            )
    else:
        # Fallback while the reaction tracker warms.
        add("DAILY", "D HIGH", getattr(f, "previous_day_high", None), source="PREVIOUS_DAY_HIGH")
        add("DAILY", "D LOW", getattr(f, "previous_day_low", None), source="PREVIOUS_DAY_LOW")
        add("WEEKLY_OPEN", "W OPEN", getattr(f, "weekly_open", None), source="WEEKLY_OPEN")

        volume = getattr(f, "volume_context", {}) or {}
        if bool(volume.get("exact_npoc")) and volume.get("untouched_poc") is not None:
            add("NPOC", "NPOC", volume.get("untouched_poc"), "UNTOUCHED", source="EXECUTED_TRADE_PROFILE")

        labels = {"15m": "15M OB", "1h": "1H OB", "4h": "4H OB", "1D": "1D OB", "2D": "2D OB"}
        blocks = getattr(f, "order_blocks", {}) or {}
        for timeframe in ("15m", "1h", "4h", "1D", "2D"):
            detail = blocks.get(timeframe) or {}
            direction = str(detail.get("direction") or "NONE").upper()
            if direction != "NONE":
                add("OB", labels[timeframe], detail.get("mid"), direction=direction, source=f"{timeframe}_ORDER_BLOCK")

        sfp = (diag or {}).get("sfp_hunter") or {}
        add("SFP", "SFP", sfp.get("target_level"), sfp.get("status", ""), sfp.get("direction", ""), "SFP_HUNTER")

    # D-Line remains a distinct strategy reference; it is not a liquidity level.
    dline = ((diag or {}).get("setups") or {}).get("D-Line") or {}
    add("DLINE", "D-LINE", dline.get("projected_line"), dline.get("status", ""), dline.get("direction", ""), "DLINE")

    return rows[:24]


def mobile_payload(include_research=True):
    now = int(time.time() * 1000)
    # Reconcile any exchange-side close before broadcasting cached signal state.
    reconcile_execution_truth()
    f = compute_features(state)
    diag = engine.last_diagnostics or {}
    execution_state = execution.snapshot()
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
        "last_market_update_ts": state.last_market_update_ts,
        "server_ts": now,
        "signal": engine.active_signal,
        "chart_overlays": chart_overlay_payload(f, diag),
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
            "level_reactions": diag.get("level_reactions", {}),
            "data_quality": diag.get("data_quality", state.data_health),
            "engine_revision": ENGINE_REVISION,
            "regime_selector": engine.regime_state,
            "structure_map": f.structure_map,
            "candidate_decisions": engine.candidate_decisions,
            "htf_policy": {
                "decision": (diag.get("htf_policy") or {}).get("decision", "HOLD/WAIT"),
                "eligible": bool((diag.get("htf_policy") or {}).get("eligible")),
                "reasons": (diag.get("htf_policy") or {}).get("reasons", []),
                "min_net_rr": MIN_NET_RR,
                "max_leverage": MAX_LEVERAGE,
            },
            "early_router": {
                "action":(diag.get("early_router") or {}).get("action","NO_WATCH"),
                "route":(diag.get("early_router") or {}).get("route",{}),
                "execution_capable":False,
            },
            "langgraph": {
                "mode": os.getenv("KYVORIQ_LANGGRAPH_MODE", "shadow").strip().lower(),
                "version": (diag.get("langgraph") or {}).get("version"),
                "action": (diag.get("langgraph") or {}).get("action"),
                "agent_disagreement": (diag.get("langgraph") or {}).get("agent_disagreement"),
                "selected_concerns": (diag.get("langgraph") or {}).get("selected_concerns", []),
            },
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
            "volume_context": f.volume_context,
        },
        "opportunity_alert": {
            "key": last_opportunity_alert.get("key", ""),
            "title": last_opportunity_alert.get("title", ""),
            "body": last_opportunity_alert.get("body", ""),
            "ts": last_opportunity_alert.get("ts", 0),
        },
        "trade_event": dict(last_trade_event) if last_trade_event else (execution_state.get("last_event") or {}),
        "execution": execution_state,
        "learning": diag.get("learning", {}),
        "learning_context": diag.get("learning_context"),
        "evaluation": shadow.summary() if include_research else None,
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


def market_tick():
    return dict(type="market_tick", symbol=state.symbol, last_price=state.last_price,
        mark_price=state.mark_price, index_price=state.index_price,
        open_interest=state.open_interest, funding_rate=state.funding_rate,
        bid=state.bid, ask=state.ask, data_health=state.data_health,
        ws_connected=state.ws_connected, exchange_ts=state.exchange_ts,
        received_ts=state.received_ts, last_market_update_ts=state.last_market_update_ts,
        server_ts=int(time.time()*1000), upstream={
            "rest_ok": bool(stream.last_rest_ok) if stream else False,
            "last_error": stream.last_upstream_error if stream else "",
            "last_rest_sync_ts": stream.last_rest_sync_ms if stream else 0,
            "source": stream.last_data_source if stream else "NONE",
        })


def current_alerts():
    return alert_payload(engine.active_signal, last_opportunity_alert,
        last_trade_event or execution.data.get("last_event"), int(time.time()*1000))


async def broadcast_loop():
    while True:
        await asyncio.sleep(max(0.5, min(SNAPSHOT, 1.0)))
        try:
            # Reconciliation must keep running even when no phone is connected.
            reconcile_execution_truth()
            if not clients:
                continue
            now = time.monotonic()
            alerts = current_alerts()
            key = event_key(alerts)
            kinds = {ws: subscriptions.get(ws, Subscription()).next_kind(now, key, DASHBOARD_SECONDS)
                     for ws in list(clients)}
            frames = {"alerts": alerts}
            if "legacy" in kinds.values() or "dashboard" in kinds.values():
                full = mobile_payload(include_research="legacy" in kinds.values())
                frames["legacy"] = full
                frames["dashboard"] = dashboard_payload(full)
            if "market_tick" in kinds.values():
                frames["market_tick"] = market_tick()
            # Serialize once per profile, rather than once per connected phone.
            encoded = {k: json.dumps(v, separators=(",", ":"), allow_nan=False)
                       for k, v in frames.items()}
        except Exception:
            continue
        async def push(ws):
            # Expiry/owner rotation must terminate existing quiet subscriptions,
            # not just reject their next reconnect or HTTP request.
            if websocket_error(ws.headers):
                clients.discard(ws)
                client_failures.pop(ws, None)
                subscriptions.pop(ws, None)
                await asyncio.wait_for(ws.close(code=1008), timeout=1.5)
                return
            kind = kinds.get(ws)
            if kind is None:
                return
            try:
                await asyncio.wait_for(ws.send_text(encoded[kind]), timeout=1.5)
                client_failures[ws] = 0
                if ws in subscriptions:
                    subscriptions[ws].delivered(kind, now, key)
                return
            except Exception:
                failures = client_failures.get(ws, 0) + 1
                client_failures[ws] = failures
                if failures >= 8:
                    clients.discard(ws)
                    client_failures.pop(ws, None)
                    subscriptions.pop(ws, None)

        # Send to clients concurrently so one slow mobile connection can never
        # block the other connection or starve the broadcast loop.
        if clients:
            await asyncio.gather(*(push(ws) for ws in list(clients)), return_exceptions=True)


execution_tasks: set[asyncio.Task] = set()


def dispatch_signal(signal_payload: dict):
    """Route a qualified strategy signal without creating phantom durable state.

    Manual mode keeps the durable prediction immediately. In autonomous Bitget
    Demo mode the execution engine owns durable-open persistence after an order
    has actually been accepted. If auto-execution is enabled but credentials are
    not configured, retire the plan immediately so it cannot consume daily quota
    or remain falsely ACTIVE.
    """
    sid = str(signal_payload.get("id") or "").strip()
    if execution.enabled:
        if not execution.ready:
            reason = "Bitget Demo auto-execution is enabled but API credentials are not configured."
            if sid:
                engine.retire_unexecuted_signal(sid, reason, "SKIPPED")
            engine.journal.record(
                "EXECUTION",
                dict(signal_id=sid, ok=False, skipped=True, reason=reason, trade=None),
                identity="execution-dispatch:" + (sid or "missing-id"),
            )
            return {"scheduled": False, "skipped": True, "reason": reason}

        if not clients:
            push.send_signal(signal_payload)
        schedule_execution(signal_payload)
        return {"scheduled": True, "skipped": False, "reason": ""}

    # Manual/signal-only mode still needs durable prediction persistence because
    # no exchange executor will post it after admission.
    if bridge.enabled:
        asyncio.create_task(
            bridge.post_open_signal(
                signal_payload,
                signal_payload.get("evidence", {}).get("memory_match"),
            )
        )
    if not clients:
        push.send_signal(signal_payload)
    return {"scheduled": False, "skipped": False, "reason": "manual signal mode"}


def schedule_execution(signal_payload: dict):
    # Private REST calls must not block processing the market WebSocket.
    payload = dict(signal_payload)
    payload["created_ts"] = engine.last_evaluated_ts
    payload["engine_revision"] = ENGINE_REVISION
    active = engine.active_signals.get(str(payload.get("id") or ""))
    if active is not None:
        active["execution_status"] = "CHECKING"
        active["execution_reason"] = "Verifying exchange state and entry conditions."
    task = asyncio.create_task(execute_signal(payload))
    execution_tasks.add(task)
    task.add_done_callback(execution_tasks.discard)


async def execute_signal(payload: dict):
    sid = str(payload.get("id") or "")
    try:
        result = await execution.handle_signal(payload)
        active = engine.active_signals.get(sid)
        if active is not None:
            active["execution_status"] = result.get("trade", {}).get("status") if result.get("ok") else "SKIPPED" if result.get("skipped") else "FAILED"
            active["execution_reason"] = result.get("reason", "Exchange submission accepted")
        reconcile_execution_truth()
        # The execution engine owns durable-open persistence in autonomous
        # mode. If it opened a durable prediction and later proved there was no
        # fill, it also performs the cleanup. Retain this fallback only for
        # legacy/pre-fix paths that report a clean skip without a completed
        # durable cleanup.
        if (
            result.get("skipped")
            and not result.get("durable_cleanup_done")
            and sid
            and sid not in engine.active_signals
            and bridge.enabled
        ):
            await bridge.post_outcome(payload, "NOT_EXECUTED", 0.0)
        engine.journal.record("EXECUTION",dict(signal_id=sid,ok=result.get("ok"),
            skipped=result.get("skipped"),reason=result.get("reason"),trade=result.get("trade")),
            identity="execution:"+sid)
    except Exception as exc:
        active = engine.active_signals.get(sid)
        if active is not None:
            active["execution_status"] = "RECONCILIATION_PENDING"
            active["execution_reason"] = str(exc)


async def on_state(s: MarketState):
    global state, last_engine_eval_ms, smc_snapshot, last_smc_observed_ms, last_smc_saved_ms, last_smc_disagreement
    global last_evaluated_bars
    state = s
    now = int(time.time() * 1000)

    # Do not run the full strategy stack on every trade/order-book tick.
    # The feed can arrive many times per second; the engine only needs a
    # bounded evaluation cadence to keep the event loop responsive.
    should_evaluate, bar_key = evaluation_due(s, now, last_engine_eval_ms, last_evaluated_bars)
    if should_evaluate:
        last_engine_eval_ms = now
        last_evaluated_bars = bar_key
        if state.last_market_update_ts and now-state.last_market_update_ts<=3000:
            engine.journal.tick(now,state.last_price)
        evaluation_started = time.perf_counter()
        try:
            sig = engine.evaluate(state)
        finally:
            record_eval_duration(time.perf_counter() - evaluation_started)
        record_eval(state.data_health)
        # Original, confirmed-bar SMC cross-check. It never changes any
        # trade candidate and runs at a bounded 60-second cadence.
        if now-last_smc_observed_ms>=60_000:
            last_smc_observed_ms=now
            try:
                smc_snapshot=compare_structure(state,compute_features(state),now)
                disagreement=bool(smc_snapshot.get("structure_disagreement"))
                record_smc(disagreement)
                if disagreement!=last_smc_disagreement or now-last_smc_saved_ms>=300_000:
                    engine.journal.record("SMC_SHADOW",smc_snapshot,ts=now)
                    last_smc_saved_ms=now
                    last_smc_disagreement=disagreement
            except Exception as exc:
                smc_snapshot={"status":"ERROR","error_type":type(exc).__name__,
                              "execution_capable":False}
        shadow.tick(state,now,compute_features(state).structure_map)
        for candidate in engine.shadow_candidates:
            shadow.observe_candidate(candidate["signal"],now,
                selected=bool(sig and candidate["signal"]["id"]==sig.id),
                legacy_allow=candidate["legacy_allow"])
        # Read-only scouting runs even when no Grade-A signal is selected.
        # A scout fault cannot interrupt data processing or change demo orders.
        try:
            scout.observe(
                state, engine.candidate_decisions, engine.opportunity_radar_state,
                selected_id=sig.id if sig else None, now_ms=now,
            )
            scout.resolve_due(now)
        except Exception as exc:
            scout.last_error = type(exc).__name__

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
        if alert:
            last_opportunity_alert = {"key": alert["key"], "ts": now_alert, "title": alert["title"], "body": alert["body"]}
            if push.ready and not clients:
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
                # Keep the durable bridge state synchronized with the exchange.
                # Otherwise an old OPEN prediction can be rehydrated on the next
                # memory-refresh cycle and resurrect a trade that Bitget already closed.
                resolved = getattr(engine, "last_lifecycle_event", None)
                if resolved and bridge.enabled:
                    asyncio.create_task(
                        bridge.post_outcome(
                            resolved["signal"],
                            resolved["outcome"],
                            float(resolved.get("result_r", 0.0)),
                        )
                    )
            if push.ready and not clients:
                push.send_trade_event(execution_event)

        if sig:
            dispatch_signal(sig.to_dict())


async def performance_learning_loop():
    """Periodic read-only attribution, never adaptive trading parameter writes."""
    global agent_learning_snapshot, agent_learning_updated_ms
    while True:
        try:
            now_ms = int(time.time() * 1000)
            report = analyze_performance(
                execution.history(500),
                engine.journal.records(300, "LANGGRAPH"),
                engine.journal.records(300, "SCOUT"),
                (execution.data.get("fill_ledger") or {}),
            )
            agent_learning_snapshot = report
            agent_learning_updated_ms = now_ms
            # One durable hourly record, updated in place within the hour.
            engine.journal.record(
                "AGENT_LEARNING", report, ts=now_ms,
                identity="agent-learning:" + str(now_ms // 3_600_000),
            )
        except Exception as exc:
            agent_learning_snapshot = {
                "mode": "READ_ONLY_NO_AUTOTUNING",
                "status": "EVALUATION_ERROR",
                "error_type": type(exc).__name__,
                "execution_capable": False,
            }
        await asyncio.sleep(300)


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
                    for open_row in open_predictions[:10]:
                        engine.restore_external_active_signal(open_row)
                # In Bitget Demo mode the exchange order/position lifecycle is
                # authoritative. Never resolve the durable prediction from a local
                # last-price touch because the attached exchange TP/SL may have a
                # different trigger price, fill, or execution state.
                if os.getenv("BITGET_DEMO_TRADING", "false").lower() not in {"1", "true", "yes", "on"} and state.last_price is not None:
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
    # Bitget is the execution venue, so its public market stream is the
    # authoritative source for price/OI/orderbook/CVD/liquidations and candles.
    # Bybit remains available in code for compatibility, but is not used to
    # define actionable execution levels.
    if str(os.getenv("MARKET_DATA_PRIMARY", "bitget")).lower() == "bitget":
        stream = BitgetMarketStream(SYMBOL, on_state)
    else:
        stream = BybitStream(WS_URL, SYMBOL, on_state)
    tasks = [
        asyncio.create_task(stream.run()),
        asyncio.create_task(stream.rest_fallback_loop()),
        asyncio.create_task(broadcast_loop()),
        asyncio.create_task(setup_memory_refresh_loop()),
        asyncio.create_task(performance_learning_loop()),
        asyncio.create_task(execution.run()),
    ]
    yield
    stream.stop = True
    for t in tasks + list(execution_tasks):
        t.cancel()


app = FastAPI(
    title="KYVORIQ AI Trading Assistant", version="0.15.0", lifespan=lifespan,
    docs_url=None, redoc_url=None, openapi_url=None,
)
app.add_middleware(GZipMiddleware, minimum_size=700)
app.add_middleware(BodyLimitMiddleware)


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError):
    # Pairing validation errors must never echo credential input to a response.
    if request.url.path == "/auth/pair":
        return JSONResponse({"detail": "Invalid pairing request"}, status_code=422)
    from fastapi.exception_handlers import request_validation_exception_handler
    return await request_validation_exception_handler(request, exc)


@app.middleware("http")
async def security_boundary(request: Request, call_next):
    """Guard private data by default; allow only explicitly reviewed public market reads."""
    path = request.url.path
    method = request.method.upper()
    private = not (method in {"GET", "HEAD"} and path in PUBLIC_GET_PATHS)

    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            size = int(content_length)
        except ValueError:
            size = MAX_HTTP_BODY_BYTES + 1
        if size < 0 or size > MAX_HTTP_BODY_BYTES:
            response = JSONResponse({"detail": "Request body too large"}, status_code=413)
            for key, value in security_headers(private).items():
                response.headers[key] = value
            return response

    if len(request.scope.get("query_string", b"")) > 4096:
        response = JSONResponse({"detail": "Query string too long"}, status_code=414)
    else:
        denied = private_http_error(method, path, request.headers)
        if denied:
            status, detail = denied
            response = JSONResponse({"detail": detail}, status_code=status)
        else:
            if method == "POST" and path == "/auth/pair":
                now = time.monotonic()
                while pair_attempts and now - pair_attempts[0] >= 60.0:
                    pair_attempts.popleft()
                if len(pair_attempts) >= 10:
                    response = JSONResponse({"detail": "Pairing temporarily unavailable"}, status_code=429)
                    for key, value in security_headers(True).items():
                        response.headers[key] = value
                    return response
                # Include malformed/oversized bodies in the attempt budget.
                pair_attempts.append(now)
            response = await call_next(request)

    for key, value in security_headers(private).items():
        response.headers[key] = value
    return response


# Bounded global rate limit resists spoofed client IPs and credential guessing
# in the single-worker demo-only backend. Independent ingress throttling is still advised.
pair_attempts: deque[float] = deque(maxlen=12)


@app.post("/auth/pair")
async def pair_device(payload: PairDevicePayload):
    expected = owner_token()
    if not expected:
        raise HTTPException(status_code=503, detail="Private API is not provisioned")
    candidate = payload.pairing_secret
    if not candidate or len(candidate) > 512 or not hmac.compare_digest(candidate.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=401, detail="Pairing refused")
    access_token, expires = issue_device_token(expected)
    return {"access_token": access_token, "expires_at": expires, "token_type": "Bearer"}


@app.get("/health")
async def health():
    now = int(time.time() * 1000)
    latency = (state.received_ts - state.exchange_ts) if state.received_ts and state.exchange_ts else None
    data_age = now - state.last_market_update_ts if state.last_market_update_ts else None
    return {
        "ok": True,
        "engine_revision": ENGINE_REVISION,
        "build": BUILD_INFO,
        "symbol": state.symbol,
        "data_health": state.data_health,
        "ws_connected": state.ws_connected,
        "last_price": state.last_price,
        "latency_ms": latency,
        "data_age_ms": data_age,
        "book_age_ms": now - state.last_book_ts if state.last_book_ts else None,
        "trade_age_ms": now - state.last_trade_ts if state.last_trade_ts else None,
        # Public, bounded market-feed diagnosis: shows failed/absent demo
        # subscriptions without exposing tokens, positions or strategy plans.
        "feed_channels": ({
            "depth_subscription": str((stream.subscription_status.get("books5") or {}).get("event") or "UNKNOWN"),
            "trades_subscription": str((stream.subscription_status.get("publicTrade") or {}).get("event") or "UNKNOWN"),
            "depth_packets": int(stream.channel_packets.get("books5", 0)),
            "trade_packets": int(stream.channel_packets.get("publicTrade", 0)),
            "critical_stall": stream._critical_channel_stall(now),
            "bounded_reconnects": stream.critical_reconnect_count,
        } if stream is not None and hasattr(stream, "_critical_channel_stall") else None),
        # Health probes must not publish private trade plans or execution evidence.
        "signal": None,
        "signal_state": engine.signal_status,
    }


@app.get("/heartbeat")
async def heartbeat():
    now = int(time.time() * 1000)
    ages = {
        "book_ms": (now - state.last_book_ts) if state.last_book_ts else None,
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
async def bootstrap(interval: str = "15m", profile: str = "legacy"):
    if stream is not None:
        try:
            if state.last_price is None or not state.candles_15:
                await asyncio.wait_for(stream.bootstrap_rest(), timeout=8.0)
        except Exception:
            pass
    payload = mobile_payload(include_research=profile != "dashboard")
    if profile == "dashboard":
        payload = dashboard_payload(payload)
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
        "source": stream.last_data_source if stream else "NONE",
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


@app.get("/performance")
async def performance():
    return dict(execution.performance(),playbook_scorecard=performance_scorecard(execution.history(500)),
                exit_experiments=shadow.summary(),decision_journal=engine.journal.status())


@app.get("/evaluation")
async def evaluation():
    return dict(engine_revision=ENGINE_REVISION,journal=engine.journal.status(),shadow=shadow.summary(),
                chronological_windows=chronological_split(engine.journal.records(500,"DECISION")),
                scorecard=performance_scorecard(execution.history(500)))


@app.get("/agents")
async def agent_status():
    """Read-only evidence review; no broker credentials or control API."""
    mode = os.getenv("KYVORIQ_LANGGRAPH_MODE", "shadow").strip().lower()
    records = engine.journal.records(250, "LANGGRAPH")
    latest = (engine.last_diagnostics or {}).get("langgraph") or {}
    return {
        "mode": mode if mode in {"off", "shadow", "guard"} else "off",
        "ready": mode in {"shadow", "guard"},
        "execution_capable": False,
        "agent_names": ["regime", "liquidity", "orderflow", "entry_timing", "opportunity_scout", "performance_learning",
                        "early_opportunity_router", "adaptive_supervisor", "data_quality_sentinel", "risk_guardian"],
        "graph_workers": ["regime", "liquidity", "orderflow", "entry_timing"],
        "early_router": {
            "mode": os.getenv("KYVORIQ_EARLY_ROUTER_MODE","shadow"),
            "current": (engine.last_diagnostics or {}).get("early_router", {}),
            "persisted_samples":len(engine.journal.records(100,"AGENT_EARLY")),
            "execution_capable":False,
        },
        "data_sentinel": data_sentinel(graph_market(
            state,compute_features(state),int(time.time()*1000),
            engine.level_reaction_state)),
        "risk_guardian": {
            "mode":"ENFORCED_AT_ENTRY",
            "execution_capable":False,"max_leverage":MAX_LEVERAGE,
            "max_planned_loss_pct":min(execution.max_planned_loss_pct, MAX_RISK_PCT),
            "min_net_rr":MIN_NET_RR,
        },
        "last_review": {
            "version": latest.get("version"),
            "action": latest.get("action"),
            "selected_id": latest.get("selected_id"),
            "agent_disagreement": latest.get("agent_disagreement"),
            "selected_concerns": latest.get("selected_concerns", []),
            "duration_ms": latest.get("duration_ms"),
        },
        "statistics": summarize_agent_reviews(records),
        "scout": {k: v for k, v in scout.summary().items() if k != "latest"},
        "smc_shadow": {
            "status":smc_snapshot.get("mode","STARTING"),
            "structure_disagreement":bool(smc_snapshot.get("structure_disagreement")),
            "execution_capable":False,
        },
        "performance_learning": {
            "mode": "READ_ONLY_NO_AUTOTUNING",
            "updated_ts": agent_learning_updated_ms,
            "tracked_demo_closes": (agent_learning_snapshot.get("exchange_demo") or {}).get("verified_closed"),
        },
        "journal": engine.journal.status(),
    }


@app.get("/agents/router")
async def opportunity_router_status():
    """Read-only prequalification graph; cannot create an exchange order."""
    return {
        "mode":os.getenv("KYVORIQ_EARLY_ROUTER_MODE","shadow"),
        "current":(engine.last_diagnostics or {}).get("early_router",{}),
        "recent":engine.journal.records(6,"AGENT_EARLY"),
        "execution_capable":False,
        "can_override_strategy":False,
    }


@app.get("/agents/storage")
async def agents_storage_status():
    """Expose actual mounted volume evidence; do not assume restart durability."""
    return engine.journal.status()


@app.get("/decision/signal")
async def strict_trade_decision():
    """Actual current best candidate or explicit HOLD/WAIT; never invent a plan."""
    sig = engine.active_signal
    if not sig:
        return {
            "decision": "HOLD/WAIT",
            "eligible": False,
            "reasons": [(engine.last_diagnostics or {}).get("wait_reason") or
                        "No currently eligible 1H/4H candidate"],
            "entry": None, "stop_loss": None,
            "take_profit_1": None, "take_profit_2": None,
            "structural_catalyst": None,
            "macroeconomic_catalyst": "NOT VERIFIED (no macro event feed)",
            "data_ts": state.last_market_update_ts,
            "execution_capable": False,
        }
    report = evaluate_htf_policy(
        state, sig, compute_features(state), int(time.time()*1000),
    )
    return dict(report, signal_id=sig.get("id"), data_ts=state.last_market_update_ts,
                structural_catalyst=sig.get("setup"),
                macroeconomic_catalyst="NOT VERIFIED (no macro event feed)",
                execution_capable=False)


@app.get("/agents/smc")
async def agent_smc_status():
    """Confirmed-candle SMC reference research, never execution signals."""
    return dict(smc_snapshot or {
        "mode":"SHADOW_ONLY","status":"AWAITING_MARKET_DATA",
        "execution_capable":False
    }, persisted_samples=len(engine.journal.records(100,"SMC_SHADOW")))


@app.get("/metrics")
async def metrics():
    """Public, low-cardinality, privacy-safe operational metrics."""
    return Response(content=expose_metrics(), media_type=CONTENT_TYPE_LATEST)


@app.get("/agents/scout")
async def scout_status():
    """Read-only scout observations: no signals, orders, or missed-PnL claims."""
    return scout.summary()


@app.get("/agents/learning")
async def performance_learning_status():
    """Last completed forward-study snapshot; no trading controls."""
    return dict(agent_learning_snapshot or {
        "mode": "READ_ONLY_NO_AUTOTUNING",
        "status": "NO_REPORT_YET",
        "execution_capable": False,
    }, updated_ts=agent_learning_updated_ms)


@app.get("/decisions")
async def decisions(limit: int=25):
    records=engine.journal.records(limit,"DECISION")
    # Compact review omits full recorded candles; export is explicit below.
    return dict(status=engine.journal.status(),records=[{k:v for k,v in r.items() if k!="market"} for r in records])


@app.get("/decisions/export")
async def decision_export(limit: int=100):
    return dict(status=engine.journal.status(),records=engine.journal.records(limit,"DECISION"))


@app.get("/evaluation/replay")
async def decision_replay(limit: int=25):
    return replay_decisions(engine.journal.records(min(100,max(1,limit)),"DECISION"))


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
            "engine_revision": ENGINE_REVISION,
            "decision_journal": engine.journal.status(),
            "strategy_evaluation": shadow.summary(),
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
            "market_feed": {
                "primary_ws_connected": bool(state.ws_connected),
                "rest_ok": bool(stream.last_rest_ok) if stream else False,
                "source": stream.last_data_source if stream else "NONE",
                "last_rest_sync_ts": stream.last_rest_sync_ms if stream else 0,
                "last_error": stream.last_upstream_error if stream else "",
                "public_channels": stream.feed_diagnostics() if stream and hasattr(stream, "feed_diagnostics") else {},
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
                "manual_execution_only": not execution.enabled,
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
    try:
        return {"ready": True, **calculate_risk(
            account_balance=account_balance, risk_pct=risk_pct,
            entry=entry, stop=stop, target=target,
            hard_cap_pct=float(os.getenv("MAX_RISK_PCT", "1")),
        )}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.get("/backtest/recent")
async def backtest_recent(lookback: int = 240):
    # The live strategy requires historical trade/book/OI snapshots and 5m/4h
    # context. A candle-only replay cannot validate this execution strategy.
    return {
        "ready": False,
        "profitability_validated": False,
        "reason": "Candle-only replay cannot validate the live order-flow strategy. Historical synchronized market snapshots and fee/slippage-aware execution replay are required.",
        "validation_source": "BITGET_DEMO_FORWARD_TEST",
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
        "product": "KYVORIQ AI Trading Assistant",
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


@app.get("/level-pack")
async def level_pack():
    return load_manual_level_pack()


@app.get("/config")
async def config():
    return {
        "symbol": SYMBOL,
        "engine_revision": ENGINE_REVISION,
        "decision_policy": "PLAYBOOK_V3",
        "htf_policy": {
            "mode": "STRICT",
            "signal_timeframes": ["1h", "4h"],
            "max_leverage": MAX_LEVERAGE,
            "max_risk_pct": min(execution.max_planned_loss_pct, MAX_RISK_PCT),
            "min_net_rr": MIN_NET_RR,
            "require_structural_stop": True,
            "macro_feed_available": False,
        },
        "langgraph_mode": os.getenv("KYVORIQ_LANGGRAPH_MODE", "shadow").strip().lower(),
        "langgraph_agent_count": 4,
        "additional_observer_agents": ["opportunity_scout", "performance_learning", "early_opportunity_router",
                                       "adaptive_supervisor", "data_quality_sentinel", "risk_guardian"],
        "early_router_mode":os.getenv("KYVORIQ_EARLY_ROUTER_MODE","shadow"),
        "entry_risk_guardian":"ENABLED",
        "exit_experiments": "SHADOW_ONLY",
        "snapshot_seconds": SNAPSHOT,
        "manual_execution_only": not execution.enabled,
        "demo_execution_enabled": execution.enabled,
        "min_rr": float(os.getenv("MIN_RR", str(engine.last_diagnostics.get("min_rr", 2.0))),
        ),
        "min_confidence": float(os.getenv("MIN_CONFIDENCE", str(engine.last_diagnostics.get("min_confidence", 0.52))),
        ),
        "max_risk_pct": min(float(os.getenv("MAX_RISK_PCT", "1")), MAX_RISK_PCT),
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
    # Browser Origin alone is not authentication. Owner authorization is mandatory.
    if websocket_error(ws.headers):
        await ws.close(code=1008)
        return
    if len(clients) >= MAX_CLIENTS:
        await ws.close(code=1013)
        return
    # Reserve the listener slot before awaiting accept to prevent a parallel
    # handshake burst from bypassing the connection cap.
    clients.add(ws)
    try:
        await ws.accept()
    except Exception:
        clients.discard(ws)
        return
    client_failures[ws] = 0
    profile = ws.query_params.get("profile", "legacy")
    profile = profile if profile in {"dashboard", "alerts"} else "legacy"
    sub = subscriptions[ws] = Subscription(profile=profile)
    try:
        # Send immediately so the phone gets price/OI/chart state without waiting for
        # the next periodic broadcast tick.
        alerts = current_alerts()
        initial = alerts if profile == "alerts" else mobile_payload(include_research=profile != "dashboard")
        if profile == "dashboard":
            initial = dashboard_payload(initial)
        await ws.send_json(initial)
        sub.delivered(profile, time.monotonic(), event_key(alerts))
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
                if websocket_error(ws.headers):
                    await ws.close(code=1008)
                    break

                # Application-level keepalive creates regular inbound traffic on
                # the long-lived mobile socket in addition to transport ping/pong.
                if message.get("type") == "websocket.receive":
                    if len(message.get("bytes") or b"") > 2048:
                        await ws.close(code=1009)
                        break
                    raw_text = message.get("text")
                    if raw_text:
                        # Reject oversized application messages before JSON decoding.
                        if len(raw_text.encode("utf-8")) > 2048:
                            await ws.close(code=1009)
                            break
                        try:
                            incoming = json.loads(raw_text)
                        except (TypeError, ValueError):
                            incoming = {}
                        if isinstance(incoming, dict) and incoming.get("type") == "keepalive":
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
        subscriptions.pop(ws, None)

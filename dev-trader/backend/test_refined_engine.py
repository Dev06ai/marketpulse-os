import asyncio
import json
import time

import pytest

from app.analytics import MarketFeatures, compute_features, _order_block_detail
from app.bitget import BitgetDemoClient, BitgetDemoError
from app.learning import AdaptiveLearning
from app.models import Candle, MarketState
from app.protection import stop_coverage
from app.strategy import Signal, StrategyEngine, detect_breakout_retest, entry_room
from app.stream import BitgetMarketStream
from app.trade_identity import client_identity, decode_identity
from app.volume_context import DAY_MS, BAR_MS, volume_context
from test_execution import audit_executor, audit_signal
from test_learning import base_signal


def position(side="long", qty=".01"):
    return dict(symbol="BTCUSDT", holdSide=side, total=qty)


def stop(qty=".005", **overrides):
    return dict(dict(orderId="sl-1", posSide="long", stopLoss="99000",
                     slOrderType="market", status="pending", qty=qty), **overrides)


def test_partial_duplicate_and_limit_stops_do_not_imply_full_coverage():
    p = [position()]
    assert stop_coverage(p, [stop(), stop(), stop(orderId="limit", slOrderType="limit")], 100000)["positions"][0]["coverage_pct"] == 50
    assert not stop_coverage(p, [stop(), stop(orderId="wrong", posSide="short")], 100000)["all_positions_protected"]
    assert stop_coverage(p, [stop(), stop(orderId="sl-2")], 100000)["all_positions_protected"]


@pytest.mark.parametrize("side,trigger,covered", [("long", "99000", True), ("long", "100001", False),
                                                    ("short", "101000", True), ("short", "99000", False)])
def test_full_stop_requires_correct_side_of_mark(side, trigger, covered):
    result = stop_coverage([position(side)], [stop(qty="0", clientOid="DTSL-own", posSide=side, stopLoss=trigger)], 100000)
    assert result["all_positions_protected"] is covered
    assert not stop_coverage([position(side)], [stop(qty="0", posSide=side, stopLoss=trigger)], 100000)["all_positions_protected"]


@pytest.mark.parametrize("direction,setup,timeframe,regime", [("LONG", "Bullish SFP • FAST", "5m", "RANGE"),
    ("SHORT", "D-Line Breakout", "15m", "TREND_DOWN"), ("LONG", "Breakout Retest", "15m", "TREND_UP")])
def test_exchange_identity_recovers_strategy_context(direction, setup, timeframe, regime):
    signal = dict(id="identity", direction=direction, setup=setup, timeframe=timeframe, regime=regime)
    oid = client_identity(signal, 2.456)
    assert len(oid) == 32 and oid == client_identity(signal, 2.456)
    recovered = decode_identity(oid)
    assert recovered["direction"] == direction and recovered["timeframe"] == timeframe
    assert recovered["regime"] == regime and recovered["planned_risk_usdt"] == 2.46
    assert decode_identity("DTDEMO-legacy") == {} and decode_identity(oid[:-1]+"!") == {}


def test_restart_outcome_alias_does_not_duplicate_learning(tmp_path):
    learner = AdaptiveLearning()
    learner.path = tmp_path/"learning.json"
    learner.data = dict(version=1, trades=[], profiles={}, conditions={}, lessons=[])
    original = dict(base_signal(), execution_id="exchange-entry")
    learner.resolve(original, "CLOSED", -.8)
    recovered = dict(original, id="recovered-id", setup="SFP")
    learner.resolve(recovered, "CLOSED", -.8)
    assert learner.summary()["trades_learned"] == 1
    assert learner.summary()["losses"] == 1
    assert len(learner.data["trades"]) == 1 and len(learner.data["lessons"]) == 1


def protection_trade():
    return dict(execution_id="own-entry", direction="LONG", filled_qty=.01, stop_loss=99000)


def test_missing_stop_is_repaired_and_ambiguous_success_is_read_back(monkeypatch, tmp_path):
    executor = audit_executor(monkeypatch, tmp_path)
    executor.client.positions = lambda _: [position()]
    orders, calls = [], []
    executor.client.strategy_orders = lambda _: orders
    def place(_symbol, _side, price, oid):
        calls.append(oid)
        orders.append(stop(qty="0", clientOid=oid, stopLoss=price))
        raise TimeoutError("accepted but reply lost")
    executor.client.place_full_stop = place
    trade = protection_trade()
    async def concurrent_checks():
        await asyncio.gather(executor._ensure_trade_protection(trade),executor._ensure_trade_protection(trade))
    asyncio.run(concurrent_checks())
    assert len(calls) == 1 and trade["protection"]["all_positions_protected"]
    assert not executor.data.get("protection_halt") and not executor.client.close_calls


def test_failed_stop_repair_halts_entries_and_closes_remaining_once(monkeypatch, tmp_path):
    executor = audit_executor(monkeypatch, tmp_path)
    executor.client.positions = lambda _: [position(qty=".004")]
    executor.client.strategy_orders = lambda _: []
    executor.client.place_full_stop = lambda *args: None
    trade = protection_trade()
    asyncio.run(executor._ensure_trade_protection(trade))
    asyncio.run(executor._ensure_trade_protection(trade))
    assert executor.data["protection_halt"]
    assert len(executor.client.close_calls) == 1 and executor.client.close_calls[0][2] == "0.004"
    assert not executor._signal_allowed(audit_signal())[0]


def test_stop_read_failure_does_not_close_unverified_quantity(monkeypatch, tmp_path):
    executor = audit_executor(monkeypatch, tmp_path)
    def unavailable(_):
        raise TimeoutError("position snapshot unavailable")
    executor.client.positions = unavailable
    asyncio.run(executor._ensure_trade_protection(protection_trade()))
    assert executor.data["protection_halt"] and not executor.client.close_calls


def test_pending_exit_blocks_flat_new_entry(monkeypatch, tmp_path):
    executor = audit_executor(monkeypatch, tmp_path)
    executor.client.strategy_orders = lambda _: [stop()]
    result = asyncio.run(executor.handle_signal(audit_signal()))
    assert not result["ok"] and "Pending exchange orders" in result["reason"]
    assert not executor.data["trades"]


def test_fresh_session_skips_legacy_entries_but_retains_global_loss_budget(monkeypatch, tmp_path):
    epoch = int(time.time()*1000)
    monkeypatch.setenv("DEMO_SESSION_START_MS", str(epoch))
    executor = audit_executor(monkeypatch, tmp_path)
    executor.data["trades"] = [dict(opened_ts=epoch-1, status="OPEN", client_oid="DTDEMO-old")]
    assert executor._count_today() == 0 and executor._open_local_trade() is None
    executor._merge_exchange_open_orders([dict(clientOid="DTDEMO-old-order", createdTime=epoch-1, orderStatus="filled")])
    assert len(executor.data["trades"]) == 1
    executor.data["client_status"] = {"available_balance_usdt": 1000.0}
    executor.data["fill_ledger"] = dict(complete_window=True, fee_accounting_complete=True,
        daily_net_usdt={str(epoch//DAY_MS*DAY_MS): -9.5})
    qty, risk, _ = asyncio.run(executor._risk_size(audit_signal()))
    assert qty > 0
    assert qty * 100000 / executor.leverage == 40
    assert 0 < risk <= 5
    allowed, reason = executor._signal_allowed(audit_signal())
    assert allowed, reason
    executor.data["fill_ledger"]["daily_net_usdt"][str(epoch//DAY_MS*DAY_MS)] = -10.1
    allowed, reason = executor._signal_allowed(audit_signal())
    assert not allowed and "daily loss limit" in reason
    executor.data["trades"].append(dict(opened_ts=epoch+1, status="OPEN"))
    assert executor._count_today() == 1


@pytest.mark.parametrize("trade_age,book_age,healthy", [(9000,100,True), (16000,100,False), (100,6000,False)])
def test_freshness_distinguishes_quiet_tape_from_stale_book(trade_age, book_age, healthy):
    stream = BitgetMarketStream("BTCUSDT", None)
    now = int(time.time()*1000)
    stream.last_data_source = "BITGET_WS"
    stream.state = MarketState(ws_connected=True, last_market_update_ts=now-100,
        last_trade_ts=now-trade_age, last_book_ts=now-book_age, last_kline_15_ts=now-100)
    stream._refresh_data_health(now)
    assert (stream.state.data_health == "HEALTHY") is healthy
    stream.last_data_source = "BITGET_REST"
    stream._refresh_data_health(now)
    assert stream.state.data_health != "HEALTHY"


def test_backfill_cannot_replace_live_cvd_or_trade_freshness(monkeypatch):
    stream = BitgetMarketStream("BTCUSDT", None)
    stream.state.cvd, stream.state.last_trade_ts = 3, 999
    stream.recent_exec_ids = {"live"}
    async def fake_thread(*args):
        return [dict(execId="old", ts="100", size="1", side="sell")]
    monkeypatch.setattr("app.stream.asyncio.to_thread", fake_thread)
    asyncio.run(stream._backfill_trades())
    assert stream.state.cvd == 3 and stream.state.last_trade_ts == 999
    stream.recent_exec_ids.clear()
    stream.state.last_trade_ts = None
    asyncio.run(stream._backfill_trades())
    assert stream.state.cvd == -1 and stream.state.last_trade_ts is None


def test_silent_socket_is_closed_for_reconnect(monkeypatch):
    stream = BitgetMarketStream("BTCUSDT", None)
    stream.last_ws_packet_ms = int(time.time()*1000)-46000
    class Socket:
        closed = False
        async def close(self):
            self.closed = True
    async def no_sleep(*args):
        pass
    monkeypatch.setattr("app.stream.asyncio.sleep", no_sleep)
    socket = Socket()
    asyncio.run(stream._heartbeat(socket))
    assert socket.closed and "reconnecting" in stream.last_upstream_error


def test_flow_divergence_uses_matched_price_and_cvd_times():
    tape = [(i*10000,100000+i*10,100-i*.25,1) for i in range(31)]
    state = MarketState(flow_history=tape)
    assert compute_features(state).cvd_price_divergence == "BEARISH"
    # The same CVD slope over six rapid ticks lacks a five-minute observation.
    state.flow_history = [(i*1000,p,cvd,v) for i,(_,p,cvd,v) in enumerate(tape)]
    assert compute_features(state).cvd_price_divergence == "NONE"
    state.flow_history = tape[:3]+tape[10:]
    assert compute_features(state).cvd_price_divergence == "NONE"


def test_bitget_flow_history_is_bounded_and_expired():
    stream = BitgetMarketStream("BTCUSDT",None)
    now = int(time.time()*1000)
    stream.state.flow_history = [(now-1_000_000,100,0,1)]+[(now-6000+i,100,0,1) for i in range(6000)]
    stream._trim_windows(now)
    assert len(stream.state.flow_history) == 5000
    assert stream.state.flow_history[0][0] == now-5000


def test_public_channel_diagnostics_distinguish_acknowledgement_from_data():
    async def on_state(_):
        pass
    stream = BitgetMarketStream("BTCUSDT",on_state)
    asyncio.run(stream.handle(json.dumps(dict(event="subscribe",arg=dict(topic="books5")))))
    asyncio.run(stream.handle(b"binary packet"))
    diag = stream.feed_diagnostics()
    assert diag["subscriptions"]["books5"]["event"] == "subscribe"
    assert diag["packets"] == {} and diag["last_book_ts"] is None and diag["binary_packets"] == 1


def test_old_remote_predictions_do_not_resurrect_reset_session(monkeypatch,tmp_path):
    epoch = int(time.time()*1000)
    monkeypatch.setenv("DEMO_SESSION_START_MS",str(epoch))
    monkeypatch.setenv("LEARNING_STATE_FILE",str(tmp_path/"learning.json"))
    engine = StrategyEngine()
    row = dict(base_signal(),opened_ts=epoch-1,resolved_ts=epoch)
    engine.rehydrate_remote_history([row])
    engine.restore_external_active_signal(row)
    assert engine.daily_signal_count == 0 and engine.active_signals == {} and engine.last_resolved_ts == 0


def bar(index, o, h, l, c, volume=100, confirmed=True):
    return Candle(index*BAR_MS, (index+1)*BAR_MS-1, o, h, l, c, volume, confirmed)


def breakout_state(short=False):
    cs = [bar(i,100,102,98,100) for i in range(12)]
    cs += [bar(12,101,106,100,105,180), bar(13,103,104,101.8,103)]
    if short:
        cs = [Candle(c.start,c.end,200-c.open,200-c.low,200-c.high,200-c.close,c.volume,c.confirmed) for c in cs]
    return MarketState(candles_15=cs, last_price=97 if short else 103)


@pytest.mark.parametrize("short", [False, True])
def test_breakout_needs_confirmed_hold_volume_and_unextended_entry(short, monkeypatch):
    # Geometry test isolates the trigger; final signals still use normal gates.
    monkeypatch.setattr("app.strategy.compute_features", lambda _: MarketFeatures(atr_15=4))
    state = breakout_state(short)
    signal = detect_breakout_retest(state)
    assert signal and signal.direction == ("SHORT" if short else "LONG")
    state.candles_15[-1].confirmed = False
    assert detect_breakout_retest(state) is None
    state.candles_15[-1].confirmed = True
    state.last_price = 90 if short else 110
    assert detect_breakout_retest(state) is None
    state.last_price = 97 if short else 103
    state.candles_15[-2].volume = 100
    assert detect_breakout_retest(state) is None
    state.candles_15[-2].volume = 180
    state.candles_15[-1].close = 100
    assert detect_breakout_retest(state) is None


def test_volume_proxy_requires_complete_previous_day_and_touch_history():
    day = 10*DAY_MS
    previous = [Candle(day-DAY_MS+i*BAR_MS,day-DAY_MS+(i+1)*BAR_MS-1,100,102,98,100,100,True) for i in range(96)]
    current = Candle(day,day+BAR_MS-1,110,112,108,111,10,False)
    state = MarketState(candles_15=previous+[current],last_price=111)
    result = volume_context(state, day+10000)
    assert result["profile_status"] == "ESTIMATED" and result["exact_npoc"] is False
    assert result["untouched_poc"] is not None
    current.low = 99
    assert volume_context(state,day+10000)["untouched_poc"] is None
    state.candles_15 = previous
    assert volume_context(state,day+10000)["untouched_poc"] is None
    state.candles_15 = previous[1:]
    assert volume_context(state,day+10000)["previous_day_poc"] is None


def sample_signal():
    return Signal(id="room", direction="LONG", setup="MSS Continuation", entry=100000, stop=99500,
        target1=100800, target2=102000, rr=4, confidence=.9, grade="A", regime="TREND_UP",
        invalidation="test", thesis=[], evidence={}, timeframe="15m", trade_style="SWING", style_reason="test")


def test_nearby_major_resistance_blocks_optimistic_target():
    signal = sample_signal()
    assert not entry_room(signal,MarketState(),MarketFeatures(previous_day_high=100100))["allow"]
    assert entry_room(signal,MarketState(),MarketFeatures(previous_day_high=102000))["allow"]


def test_entry_room_includes_weekly_open_and_opposing_order_blocks():
    signal = sample_signal()
    weekly = MarketFeatures(weekly_open=100100)
    blocked = entry_room(signal, MarketState(), weekly)
    assert not blocked["allow"] and blocked["nearest_barrier"] == "weekly open"

    opposing = MarketFeatures(order_blocks={
        "1h": {"direction": "BEARISH", "mid": 100120},
        "4h": {"direction": "BULLISH", "mid": 100080},
    })
    blocked = entry_room(signal, MarketState(), opposing)
    assert not blocked["allow"] and "opposing order block" in blocked["nearest_barrier"]


def test_invalidated_order_block_is_not_returned_as_active_level():
    cs = [
        Candle(0, 899999, 100, 101, 99, 100, 10, True),
        Candle(900000, 1799999, 100, 102, 98, 99, 10, True),
        Candle(1800000, 2699999, 100, 104, 99, 103, 20, True),
        # Decisive close below the bullish base low invalidates that OB, but
        # the candle is green so it does not manufacture a bearish OB.
        Candle(2700000, 3599999, 95, 98, 94, 97, 15, True),
        Candle(3600000, 4499999, 97, 98, 96, 97.5, 10, True),
    ]
    assert _order_block_detail(cs)["direction"] == "NONE"


def test_uninvalidated_order_block_remains_available():
    cs = [
        Candle(0, 899999, 100, 101, 99, 100, 10, True),
        Candle(900000, 1799999, 100, 102, 98, 99, 10, True),
        Candle(1800000, 2699999, 100, 104, 99, 103, 20, True),
        Candle(2700000, 3599999, 102, 104, 101, 103, 15, True),
        Candle(3600000, 4499999, 103, 104, 102, 103.5, 10, True),
    ]
    detail = _order_block_detail(cs)
    assert detail["direction"] == "BULLISH"
    assert detail["status"] == "ACTIVE"


def test_aligned_structure_confirms_continuation_without_wave_vote(monkeypatch,tmp_path):
    now = int(time.time()*1000)
    monkeypatch.setenv("LEARNING_STATE_FILE", str(tmp_path/"learning.json"))
    engine = StrategyEngine()
    f = MarketFeatures(trend_15="UP",trend_60="UP",trend_240="UP",market_structure="BULLISH",
                       regime="TREND_UP",cvd_price_divergence="BULLISH",fvg_direction="BULLISH")
    monkeypatch.setattr("app.strategy.compute_features",lambda _:f)
    state = MarketState(data_health="HEALTHY",last_market_update_ts=now,last_trade_ts=now-9000,last_book_ts=now)
    signal = sample_signal()
    allowed,reason = engine._elite_decision_gate(signal,state)
    assert allowed,reason
    assert "HTF_STRUCTURE" in signal.evidence["decision_engine"]["confirmation_names"]
    assert "ELLIOTT" not in signal.evidence["decision_engine"]["confirmation_names"]


def test_paused_engine_does_not_consume_session_signal_quota(monkeypatch,tmp_path):
    monkeypatch.setenv("DEMO_EXECUTION_PAUSED","true")
    monkeypatch.setenv("LEARNING_STATE_FILE",str(tmp_path/"learning.json"))
    engine = StrategyEngine()
    before = engine.daily_signal_count
    assert engine.evaluate(MarketState()) is None
    assert engine.last_diagnostics["status"] == "PAUSED" and engine.daily_signal_count == before


def test_order_history_paginates_and_fails_on_repeated_cursor(monkeypatch):
    client = BitgetDemoClient("k","s","p")
    calls = []
    def page(_path,params):
        calls.append(params["cursor"])
        return dict(data=dict(list=[dict(orderId="10")],cursor="10")) if params["cursor"] is None else dict(data=dict(list=[],cursor=""))
    monkeypatch.setattr(client,"_get",page)
    assert len(client.orders_history(limit=1)) == 1 and calls == [None,"10"]
    monkeypatch.setattr(client,"_get",lambda *args:dict(data=dict(list=[dict(orderId="10")],cursor="10")))
    with pytest.raises(BitgetDemoError,match="incomplete"):
        client.orders_history(limit=1)


@pytest.mark.parametrize("hedge",[False,True])
def test_full_stop_payload_closes_the_existing_side_only(monkeypatch,hedge):
    client = BitgetDemoClient("k","s","p")
    monkeypatch.setattr(client,"account_settings",lambda:dict(holdMode="hedge_mode" if hedge else "one_way_mode"))
    captured = {}
    def post(path,payload):
        captured.update(path=path,payload=payload)
        return {}
    monkeypatch.setattr(client,"_post",post)
    client.place_full_stop("BTCUSDT","SHORT","101000","DTSL-own")
    p = captured["payload"]
    assert p["tpslMode"] == "full" and p["side"] == "buy" and "qty" not in p
    assert (p.get("posSide") == "short") is hedge
    assert (p.get("reduceOnly") == "yes") is not hedge

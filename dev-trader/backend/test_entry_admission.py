"""Regression coverage for the refresh/entry race reported by the demo user."""
import asyncio
import time

import pytest

from app.learning import AdaptiveLearning
from app.models import MarketState
from app.strategy import StrategyEngine
from test_execution import audit_executor, audit_signal


def test_admission_patch_keeps_exchange_order_identity_stable():
    from app.trade_identity import client_identity
    original = dict(audit_signal(), engine_revision="market-decision-v3")
    patched = dict(original, engine_revision="market-decision-v3.1")
    assert client_identity(original, 2.5) == client_identity(patched, 2.5)


@pytest.mark.parametrize("expire,broken", [(False, False), (True, False), (False, True)])
def test_signal_joins_running_refresh_and_revalidates(monkeypatch, tmp_path, expire, broken):
    executor = audit_executor(monkeypatch, tmp_path)
    clock = [time.time()]
    monkeypatch.setattr(time, "time", lambda: clock[0])
    signal = dict(audit_signal(), created_ts=int(clock[0] * 1000))
    submitted = []
    place = executor.client.place_market_order
    executor.client.place_market_order = lambda *args: (submitted.append(args), place(*args))[1]
    if broken:
        def failed_history(*args):
            raise TimeoutError("history unavailable")
        executor.client.orders_history = failed_history

    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()
        original_sync = executor._sync
        refreshes = []

        async def slow_refresh():
            refreshes.append(1)
            entered.set()
            await release.wait()
            return await original_sync()

        monkeypatch.setattr(executor, "_sync", slow_refresh)
        background = asyncio.create_task(executor.sync())
        await entered.wait()
        order = asyncio.create_task(executor.handle_signal(signal))
        await asyncio.sleep(0)
        assert not order.done() and not submitted
        if expire:
            clock[0] += 16
        release.set()
        result = await asyncio.wait_for(order, 2)
        await background
        assert len(refreshes) == 1  # reuse the completed verified snapshot
        return result

    result = asyncio.run(scenario())
    if expire or broken:
        assert result["skipped"] and not submitted
        assert "stale" in result["reason"] if expire else "not verified" in result["reason"]
    else:
        assert result["ok"] and len(submitted) == 1
        assert executor.data["last_decision"]["status"] == "SUBMITTED"


def test_refresh_cannot_interrupt_final_entry_gate(monkeypatch, tmp_path):
    executor = audit_executor(monkeypatch, tmp_path)
    original_size = executor._risk_size

    async def size_with_background_refresh(signal):
        assert executor._sync_lock.locked()
        assert await executor.sync() == []
        return await original_size(signal)

    monkeypatch.setattr(executor, "_risk_size", size_with_background_refresh)
    assert asyncio.run(executor.handle_signal(audit_signal()))["ok"]
    assert len(executor.data["trades"]) == 1


def test_reconciliation_wait_is_bounded_by_original_expiry(monkeypatch, tmp_path):
    executor = audit_executor(monkeypatch, tmp_path)

    async def scenario():
        await executor._sync_lock.acquire()
        try:
            signal = dict(audit_signal(), created_ts=int(time.time() * 1000) - 14950)
            return await asyncio.wait_for(executor.handle_signal(signal), .5)
        finally:
            executor._sync_lock.release()

    result = asyncio.run(scenario())
    assert result["skipped"] and "expired" in result["reason"]
    assert not executor.data["trades"]


def setup_strategy(monkeypatch, tmp_path):
    monkeypatch.setenv("BITGET_DEMO_TRADING", "true")
    monkeypatch.setenv("DEMO_SESSION_START_MS", "0")
    monkeypatch.setenv("LEARNING_STATE_FILE", str(tmp_path / "learning.json"))
    monkeypatch.setenv("DECISION_JOURNAL_FILE", str(tmp_path / "journal.db"))
    learner = AdaptiveLearning()
    learner.record_open(dict(audit_signal(), timeframe="5m"))
    return StrategyEngine(learner)


def test_skipped_plan_is_retired_durably_without_fake_profit(monkeypatch, tmp_path):
    from app import main
    strategy = setup_strategy(monkeypatch, tmp_path)
    executor = audit_executor(monkeypatch, tmp_path)
    # Persisted pre-fix failure: no order/trade was ever submitted.
    executor.data["last_decision"] = dict(signal_id="AUDIT", status="SKIPPED",
        reason="Exchange reconciliation is in progress; wait for a verified snapshot.")
    monkeypatch.setattr(main, "engine", strategy)
    monkeypatch.setattr(main, "execution", executor)
    main.reconcile_execution_truth()
    strategy._update_signal_lifecycle(MarketState(last_price=105000, data_health="HEALTHY"))
    assert strategy.active_signal is None and not strategy.active_signals
    assert strategy.signal_status == "NONE"
    assert strategy.learning.data["trades"][0]["status"] == "NOT_EXECUTED"
    assert "result_r" not in strategy.learning.data["trades"][0]
    assert not strategy.learning.data["profiles"]
    assert not strategy.learning.data["lessons"]
    assert not StrategyEngine(AdaptiveLearning()).active_signals
    assert not strategy.last_lifecycle_event


@pytest.mark.parametrize("status", ["OPEN", "ORDER_PENDING", "SUBMISSION_UNKNOWN", "RECONCILIATION_PENDING"])
def test_skipped_duplicate_never_retires_existing_exchange_exposure(monkeypatch, tmp_path, status):
    from app import main
    strategy = setup_strategy(monkeypatch, tmp_path)
    executor = audit_executor(monkeypatch, tmp_path)
    executor.data["trades"] = [dict(signal_id="AUDIT", execution_id="known", status=status)]
    executor.data["last_decision"] = dict(signal_id="AUDIT", status="SKIPPED", reason="duplicate")
    monkeypatch.setattr(main, "engine", strategy)
    monkeypatch.setattr(main, "execution", executor)
    main.reconcile_execution_truth()
    strategy.retire_unexecuted_signal("AUDIT", "duplicate")
    strategy._update_signal_lifecycle(MarketState(last_price=105000, data_health="HEALTHY"))
    assert strategy.active_signals["AUDIT"]["execution_status"] == status
    assert strategy.learning.data["trades"][0]["status"] == "ACTIVE"


def test_main_retires_new_skip_and_retains_current_diagnostics(monkeypatch, tmp_path):
    from app import main
    strategy = setup_strategy(monkeypatch, tmp_path)
    executor = audit_executor(monkeypatch, tmp_path)
    monkeypatch.setattr(main, "engine", strategy)
    monkeypatch.setattr(main, "execution", executor)
    # Price has passed the target: the old setup must never be chased.
    executor.client.market_ticker = lambda _: dict(lastPrice="105000")
    asyncio.run(main.execute_signal(audit_signal()))
    assert executor.data["last_decision"]["status"] == "SKIPPED"
    assert not executor.data["trades"]
    assert strategy.active_signal is None
    assert not strategy.learning.data["profiles"]

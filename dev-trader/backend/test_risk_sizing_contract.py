"""Exchange-mocked invariants for conservative sizing, without placing orders."""
import asyncio

import pytest

from app.bitget import BitgetDemoError
from app.risk import calculate_risk
from test_execution import audit_executor, audit_signal


@pytest.mark.parametrize("balance", [40, 100, 1000, 10000])
@pytest.mark.parametrize("distance", [100, 500, 3000])
@pytest.mark.parametrize("confidence", [.70, .99])
def test_sizing_never_raises_exposure_for_preferred_margin(monkeypatch, tmp_path, balance, distance, confidence):
    monkeypatch.delenv("BITGET_DEMO_MAX_PLANNED_LOSS_PCT", raising=False)
    executor = audit_executor(monkeypatch, tmp_path)
    executor.client.available_balance = lambda _: balance
    signal = dict(audit_signal(), stop=100000-distance, confidence=confidence)
    unit_risk = distance + (200000-distance) * .0006
    cap = balance * .005
    try:
        qty, risk, _ = asyncio.run(executor._risk_size(signal))
    except BitgetDemoError as exc:
        assert "risk guard" in str(exc)
        assert cap / unit_risk < .001  # Minimum valid exchange lot cannot fit.
    else:
        assert 0 < risk <= cap + 1e-9
        assert risk == pytest.approx(qty * unit_risk)
        margin = qty * signal["entry"] / executor.leverage
        target, _, maximum, _ = executor._confidence_margin_target(confidence)
        assert margin <= min(target, maximum, balance-executor.margin_reserve) + 1e-9
        assert qty * signal["entry"] <= executor.max_notional
        assert qty / .001 == pytest.approx(round(qty / .001))
    assert executor.max_daily == 3
    assert not executor.data["trades"]


@pytest.mark.parametrize("invalid", ["nan", "inf", "-inf", "0", "-1"])
def test_invalid_risk_configuration_fails_closed(monkeypatch, tmp_path, invalid):
    monkeypatch.setenv("BITGET_DEMO_MAX_PLANNED_LOSS_PCT", invalid)
    with pytest.raises(ValueError, match="finite and positive"):
        audit_executor(monkeypatch, tmp_path)


def test_risk_calculator_cannot_override_one_percent_hard_ceiling():
    result = calculate_risk(1000, 5, 100000, 99500, hard_cap_pct=5)
    assert result["applied_risk_pct"] == 1
    assert result["risk_amount"] == 10
    assert result["risk_capped"]


def test_final_balance_drop_blocks_submission_even_when_risk_fits(monkeypatch, tmp_path):
    executor = audit_executor(monkeypatch, tmp_path)
    calls = []
    executor.client.place_market_order = lambda *args: calls.append(args)
    original = executor._sizing_balance_and_risk_cap
    checks = 0

    async def shrinking_margin():
        nonlocal checks
        checks += 1
        if checks == 3:
            return 30.0, 5.0  # Only 5 USDT spendable; never sacrifice reserve.
        return await original()

    executor._sizing_balance_and_risk_cap = shrinking_margin
    result = asyncio.run(executor.handle_signal(audit_signal()))
    assert not result["ok"]
    assert "margin reserve" in result["reason"]
    assert not calls

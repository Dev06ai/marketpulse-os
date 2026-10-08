"""Property/regression testing from Hypothesis, never a runtime bot dependency."""
from __future__ import annotations

import math

from hypothesis import given, settings, strategies as st

from app.agent_orchestration import risk_guardian
from app.execution import DemoExecutionEngine
from app.bitget import BitgetDemoClient, BitgetTransientError, BitgetDemoError


@settings(max_examples=100, deadline=None)
@given(st.integers(min_value=20_000, max_value=200_000),
       st.integers(min_value=1, max_value=10_000),
       st.integers(min_value=1, max_value=40_000),
       st.sampled_from(["LONG","SHORT"]))
def test_guardian_never_passes_bad_rr_or_price_geometry(entry, stop_ticks, reward_ticks, direction):
    entry=float(entry)
    stop=entry-stop_ticks if direction=="LONG" else entry+stop_ticks
    target=entry+reward_ticks if direction=="LONG" else entry-reward_ticks
    if target<=0 or stop<=0:
        return
    source={"direction":direction, "entry":entry, "stop":stop,
            "target2":target, "grade":"A"}
    report=risk_guardian(source, selected=True, max_leverage=20, max_risk_pct=2)
    rr=reward_ticks/stop_ticks
    # Extra safety: a guardian cannot greenlight geometrically invalid
    # price plans or reward below 2.5 times loss.
    if rr < 2.5:
        assert "GROSS_RR_BELOW_2_5" in report["blockers"]
    if report["status"]=="PRECHECK_PASS":
        assert rr>=2.5 and stop>0 and target>0
    assert not report["execution_capable"]


@settings(max_examples=100, deadline=None)
@given(st.floats(min_value=0, max_value=5, allow_nan=False, allow_infinity=False),
       st.sampled_from([".001",".002",".005",".01"]))
def test_exchange_lot_rounding_never_increases_quantity(raw, quantum):
    config={"sizeMultiplier":quantum,"minTradeNum":quantum}
    actual=DemoExecutionEngine._normalize_qty(raw, config)
    # Decimal round-down cannot exceed requested lot size even with
    # floating-point inputs or exchange quantum mismatch.
    assert actual >= 0
    assert actual <= raw + 1e-9
    rounded=actual/float(quantum)
    assert abs(rounded-round(rounded))<1e-6


@settings(max_examples=70, deadline=None)
@given(st.floats(allow_nan=True,allow_infinity=True),
       st.sampled_from(["LONG","SHORT"]))
def test_nonfinite_and_negative_entry_parameters_cannot_approve(entry, direction):
    out=risk_guardian({
        "direction":direction, "entry":entry,
        "stop":100000, "target2":101000, "grade":"A"
    },selected=True)
    if not math.isfinite(entry) or entry<=0:
        assert out["status"]=="REJECT"
    assert not out["execution_capable"]


def test_get_retries_transient_reads_only(monkeypatch):
    client=BitgetDemoClient("k","s","p")
    attempts=[]
    def intermittently_broken(method,path,params=None,payload=None,private=True):
        attempts.append(method)
        if len(attempts)<3:
            raise BitgetTransientError("network timeout")
        return {"code":"00000","data":[]}
    monkeypatch.setattr(client,"_request",intermittently_broken)
    assert client._get("/api/v3/account/assets")["code"]=="00000"
    assert attempts==["GET","GET","GET"]


def test_post_is_never_retried_even_when_transport_is_ambiguous(monkeypatch):
    client=BitgetDemoClient("k","s","p")
    calls=[]
    def uncertain_response(method,path,params=None,payload=None,private=True):
        calls.append(method)
        raise BitgetTransientError("possible remote execution after timeout")
    monkeypatch.setattr(client,"_request",uncertain_response)
    try:
        client._post("/api/v3/trade/place-order",{"symbol":"BTCUSDT"})
    except BitgetDemoError:
        pass
    assert calls==["POST"]


def test_new_operational_metrics_contain_no_api_keys():
    from app.observability import record_eval, expose, record_smc
    record_eval("HEALTHY")
    record_smc(False)
    metrics=expose().decode()
    assert "kyvoriq_feed_healthy" in metrics
    assert "kyvoriq_smc_shadow_observations_total" in metrics
    assert "api_secret" not in metrics.lower()
    assert "BTCUSDT" not in metrics

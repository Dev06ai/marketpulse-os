"""Original master Phase 4/10/15 observation integrity regressions."""
import math
import pytest

from app.opportunity_scout import price_path_outcome
from app.calibration_observer import summarize_forward_cohorts
from test_scout_learning import fresh_path


START = 10_000_000
OBS = {"opened_ts": START, "reference_price": 100000, "direction": "LONG"}


@pytest.mark.parametrize("bad", [
    ("bad_time",100001.0), (START + 40000, "101000"),
    (START + 40000, float("nan")), (START + 40000, float("inf")),
    (START + 40000, -10.0), (True, 101000.0),
    None, (), {"time": START}, (START,),
])
def test_malformed_tick_cannot_be_used_as_scout_price_path(bad):
    result = price_path_outcome(OBS, fresh_path(START) + [bad])
    assert result == {"status": "UNVERIFIABLE", "why": "INVALID_PRICE_SAMPLES"}


def test_conflicting_ticks_at_identical_timestamp_block_hindsight_claim():
    path = fresh_path(START)
    collision = (path[10][0], path[10][1] + 1500)
    result = price_path_outcome(OBS, path + [collision])
    assert result == {"status": "UNVERIFIABLE", "why": "CONFLICTING_PRICE_SAMPLES"}


def test_exact_duplicate_tick_keeps_observation_consistent():
    path = fresh_path(START)
    result = price_path_outcome(OBS, path + [path[10]])
    assert result["status"] == "RESOLVED_PRICE_ONLY"
    assert result["price_samples"] == 61
    assert result["meaning"].endswith("NOT_AN_EXECUTABLE_TRADE")


def candidate(i, pnl=2.0):
    return ({"closed_ts": 1000 + i, "_net": pnl},
            {"adaptive_supervisor": {"profile": "REVERSAL"}})


@pytest.mark.parametrize("bad", [
    candidate(41,float("nan")), candidate(41,float("inf")),
    candidate(41,float("-inf")), candidate(41,True),
    ({"closed_ts":"bad", "_net":12}, {}),
    ({"closed_ts":None, "_net":12}, {}),
    (None, {}), ({}, None), None, [],
])
def test_corrupted_trade_review_cannot_improve_calibration_by_exclusion(bad):
    samples = [candidate(i) for i in range(40)] + [bad]
    result = summarize_forward_cohorts(samples, True)
    assert result["status"] == "INSUFFICIENT_VERIFIED_FORWARD_SAMPLE"
    assert result["input_records_complete"] is False
    assert result["rejected_records"] == 1
    assert result["strategy_changed"] is False


def test_valid_cohort_remains_descriptive_without_autotuning():
    result = summarize_forward_cohorts([candidate(i) for i in range(40)], True)
    assert result["status"] == "DESCRIPTIVE_FORWARD_HOLDOUT"
    assert result["auto_tuning_enabled"] is False
    assert result["profitability_proven"] is False

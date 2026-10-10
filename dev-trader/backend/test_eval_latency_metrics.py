"""No-secret, label-free strategy evaluation timing instrumentation."""
import math

from app.observability import record_eval_duration, strategy_eval_duration


def _sample(name: str) -> float:
    for sample in strategy_eval_duration.collect()[0].samples:
        if sample.name == name:
            return float(sample.value)
    raise AssertionError("prometheus latency sample missing")


def test_eval_latency_observed_without_identifying_trade():
    before = _sample("kyvoriq_strategy_eval_duration_seconds_count")
    record_eval_duration(.024)
    after = _sample("kyvoriq_strategy_eval_duration_seconds_count")
    assert after == before + 1
    assert all(not sample.labels for sample in strategy_eval_duration.collect()[0].samples)


def test_bad_and_future_invalid_measurements_ignored():
    before = _sample("kyvoriq_strategy_eval_duration_seconds_count")
    for value in [None, False, -1.0, float("nan"), float("inf"), "0.1"]:
        record_eval_duration(value)
    assert _sample("kyvoriq_strategy_eval_duration_seconds_count") == before

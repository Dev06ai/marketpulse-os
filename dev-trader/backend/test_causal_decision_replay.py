"""Causal decision replay regressions: never leak future or revisable open bars."""
from app.evaluation import replay_decisions


def candle(start, end, confirmed=True, **fields):
    return dict(start=start, end=end, open=100.0, high=110.0, low=90.0,
                close=101.0, volume=10.0, confirmed=confirmed, **fields)


def record(ts, rows, kind="DECISION"):
    return {"ts": ts, "kind": kind, "market": {"candles_5": rows, "candles_15": rows,
                                               "candles_60": rows}}


def test_replay_never_allows_future_or_unconfirmed_candles(monkeypatch):
    def inspect(state, ts):
        return {"ts": ts, "five": [(c.start, c.end) for c in state.candles_5],
                "fifteen": [(c.start, c.end) for c in state.candles_15],
                "hour": [(c.start, c.end) for c in state.candles_60]}
    monkeypatch.setattr("app.structure.structure_map", inspect)
    rows = [
        candle(10, 20, True),
        candle(21, 30, False),  # final OHLC of unconfirmed candle leaks future
        candle(31, 50, True),   # completed only after the decision
        candle(40, 99, False),  # future open candle
        candle(5, 40, True),    # end equals decision ts, not admissible
    ]
    output = replay_decisions([record(40, rows)])
    assert output["records"][0]["structure_map"] == {
        "ts": 40, "five": [(10, 20)], "fifteen": [(10, 20)], "hour": [(10, 20)]
    }
    assert output["profitability_backtest_available"] is False


def test_malformed_stored_rows_are_excluded_without_false_confirmation(monkeypatch):
    monkeypatch.setattr("app.structure.structure_map", lambda s, t: {
        "count": len(s.candles_15)})
    invalid = [
        None, 1, {"confirmed": True},
        candle(10, 20, True) | {"high": float("nan")},
        candle(11, 21, True) | {"low": 120.0},
        candle(12, 22, True) | {"volume": -1.0},
        candle(True, 25, True),
        candle(30, 20, True),
        candle(14, 24, True) | {"close": float("inf")},
    ]
    result = replay_decisions([record(40, invalid), record(40, [candle(10, 20)])])
    assert [r["structure_map"]["count"] for r in result["records"]] == [0, 1]


def test_invalid_decision_records_cannot_crash_audit(monkeypatch):
    monkeypatch.setattr("app.structure.structure_map", lambda state, ts: {"ts": ts})
    result = replay_decisions([None, {"kind": "DECISION", "ts": -1, "market": {}},
                               {"kind": "DECISION", "ts": 50, "market": None},
                               record(100, [candle(10, 20)]),
                               {"kind": "ALERT", "ts": 0}])
    assert result["skipped_invalid_decisions"] == 2
    assert len(result["records"]) == 1


def test_duplicate_confirmed_candle_versions_use_latest_record(monkeypatch):
    monkeypatch.setattr("app.structure.structure_map",
                        lambda state, ts: {"prices": [c.close for c in state.candles_60]})
    first = candle(10, 20)
    second = first | {"close": 105.0}
    result = replay_decisions([record(40, [first, second])])
    assert result["records"][0]["structure_map"]["prices"] == [105.0]

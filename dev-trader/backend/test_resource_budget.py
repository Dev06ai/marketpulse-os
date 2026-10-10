"""Regression checks for the 128 MiB / 0.25 vCPU hosting budget."""
import tracemalloc

from app.models import Candle, MarketState
from app.stream import BitgetMarketStream


def test_snapshot_copies_only_the_requested_history_and_isolates_profile():
    state = MarketState(symbol="BTCUSDT")
    state.flow_history = [(i, 100.0, float(i), 1.0) for i in range(30_000)]
    state.cvd_history = [(i, float(i)) for i in range(30_000)]
    state.trade_volume_profile = {"nested": {"revision": 4}}
    state.candles_5 = [Candle(0, 299999, 100, 101, 99, 100)]

    tracemalloc.start()
    try:
        result = state.snapshot(history=False)
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()

    # Prior asdict(state) deep-copied all 60,000 entries BEFORE slicing.
    assert peak < 2_000_000, f"snapshot allocated {peak} bytes"
    assert len(result["flow_history"]) == 120
    assert len(result["cvd_history"]) == 120
    assert isinstance(result["candles_5"][0], dict)
    assert len(state.flow_history) == 30_000
    result["trade_volume_profile"]["nested"]["revision"] = 99
    assert state.trade_volume_profile["nested"]["revision"] == 4


def test_bitget_window_pruning_is_batched_but_forced_for_oversized_bursts():
    stream = BitgetMarketStream("BTCUSDT", lambda state: None)
    now = 1_800_000
    stream.state.flow_history = [
        (now - 900_001, 100.0, 0.0, 1.0),
        (now - 100, 100.0, 0.0, 1.0),
    ]
    stream._trim_windows(now)
    assert len(stream.state.flow_history) == 1

    # Normal bursts do not need to reallocate 5,000-item buffers per packet.
    stream.state.flow_history.append((now - 899_900, 100.0, 0.0, 1.0))
    stream._trim_windows(now + 100)
    assert len(stream.state.flow_history) == 2

    stream._trim_windows(now + 1_100)
    assert len(stream.state.flow_history) == 1
    stream.state.flow_history = [(now + 1_150, 100.0, 0.0, 1.0)] * 5_600
    stream._trim_windows(now + 1_200)
    assert len(stream.state.flow_history) == 5_000

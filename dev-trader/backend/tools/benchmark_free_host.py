"""Deterministic offline sizing: representative history, no orders or credentials."""
import json
import math
import os
from pathlib import Path
import random
try:
    import resource
except ImportError:
    resource = None
import statistics
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def run():
    with tempfile.TemporaryDirectory() as directory:
        for variable, filename in (("DECISION_JOURNAL_FILE", "journal.sqlite3"),
                                   ("LEARNING_STATE_FILE", "learning.json"),
                                   ("BITGET_EXECUTION_STATE_FILE", "execution.json")):
            os.environ[variable] = directory + "/" + filename
        os.environ.update(BITGET_DEMO_TRADING="true", DEMO_EXECUTION_PAUSED="true",
                          PUSH_ENABLED="false", MARKETPULSE_CORE_URL="",
                          DECISION_JOURNAL_MAX_RECORDS="750", DECISION_JOURNAL_MAX_BLOB_MB="64")
        from app import main
        from app.models import Candle
        from app.transport import dashboard_payload, Subscription, event_key

        rng = random.Random(42)
        now = int(time.time()*1000)
        state = main.state
        for attr, interval, count in (("candles_5", 300000, 240), ("candles_15", 900000, 240),
                                      ("candles_60", 3600000, 720)):
            end = now // interval * interval
            rows = []
            for i in range(count):
                start = end - (count-i)*interval
                price = 90000 + 500*math.sin(i/17) + rng.uniform(-50, 50)
                rows.append(Candle(start, start+interval-1, price, price+100, price-100,
                                   price+10, rng.uniform(5, 20), True))
            setattr(state, attr, rows)
        state.last_price = state.candles_15[-1].close
        state.bid, state.ask = state.last_price-1, state.last_price+1
        state.received_ts = state.last_market_update_ts = state.exchange_ts = now
        state.last_book_ts = state.last_trade_ts = now
        state.ws_connected, state.data_health = True, "HEALTHY"
        state.flow_history = [(now-i*100, rng.uniform(-5, 5), rng.random(), rng.random()) for i in range(5000)]
        state.oi_window = [(now-i*1000, 100000+rng.uniform(-10, 10)) for i in range(120)]
        # Evaluate candidates without ever calling the exchange execution layer.
        os.environ["DEMO_EXECUTION_PAUSED"] = "false"
        durations = []
        for _ in range(20):
            start = time.perf_counter()
            main.engine.evaluate(state)
            durations.append((time.perf_counter()-start)*1000)
        average_ms = statistics.mean(durations)
        full = main.mobile_payload()
        compact = dashboard_payload(full)
        sizes = {name: len(json.dumps(payload, separators=(",", ":")).encode()) for name, payload in
                 (("legacy_state", full), ("dashboard_state", compact), ("market_tick", main.market_tick()))}
        # Same unchanged market/event for 60 seconds: background is event-only.
        alerts = main.current_alerts()
        key = event_key(alerts)
        sessions = [Subscription("dashboard"), Subscription("alerts")]
        total = 0
        for second in range(60):
            for session in sessions:
                kind = session.next_kind(second, key)
                if kind:
                    payload_size = {"dashboard": sizes["dashboard_state"],
                                    "market_tick": sizes["market_tick"],
                                    "alerts": len(json.dumps(alerts).encode())}[kind]
                    total += payload_size
                    session.delivered(kind, second, key)
        baseline = sizes["legacy_state"]*120
        main.engine.journal.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        journal_bytes = main.engine.journal.path.stat().st_size
        records = main.engine.journal.status()["records"]
        result = dict(offline=True, samples=20, average_evaluation_ms=round(average_ms, 2),
                      median_evaluation_ms=round(statistics.median(durations), 2),
                      p95_evaluation_ms=round(sorted(durations)[18], 2),
                      worst_evaluation_ms=round(max(durations), 2),
                      peak_rss_mib=(round(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/
                          (1024*1024 if sys.platform == "darwin" else 1024), 2) if resource else None),
                      payload_bytes=sizes, old_two_sockets_bytes_per_minute=baseline,
                      new_two_sockets_bytes_per_minute=total,
                      socket_savings_pct=round(100*(1-total/baseline), 2),
                      journal_bytes=journal_bytes, journal_records=records,
                      limitations="Synthetic history; excludes HTTP, protocol overhead, live events and exchange traffic. Not a host soak test.")
        print(json.dumps(result, indent=2))
        main.engine.journal.db.close()


if __name__ == "__main__":
    run()

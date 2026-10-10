"""KYVORIQ closed-demo-trade evidence, entirely offline and read-only.

Only confirmed exchange/demo execution records qualify, not simulated future bars,
radar price excursions, or unfilled alerts. This module never places trades.
"""
from __future__ import annotations

from dataclasses import dataclass
import json
import math
from pathlib import Path
from typing import Iterable

MIN_MEANINGFUL_SAMPLES = 30
EPS = 1e-6


@dataclass(frozen=True)
class ClosedDemoTrade:
    signal_id: str
    signaled_ms: int
    entered_ms: int
    exited_ms: int
    gross_pnl_usdt: float
    entry_fee_usdt: float
    exit_fee_usdt: float
    funding_usdt: float
    risk_usdt: float
    entry_confirmed: bool
    exit_confirmed: bool
    protective_stop_confirmed: bool

    @property
    def net_pnl_usdt(self) -> float:
        return self.gross_pnl_usdt - self.entry_fee_usdt - self.exit_fee_usdt + self.funding_usdt

    @property
    def net_r(self) -> float:
        return self.net_pnl_usdt / self.risk_usdt


def _finite_num(value: object, *, nonnegative: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("numeric field absent or invalid")
    result = float(value)
    if not math.isfinite(result) or (nonnegative and result < 0):
        raise ValueError("numeric field non-finite or negative")
    return result


def _timestamp(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError("timestamp must be a positive integer in milliseconds")
    return value


def parse_closed(record: object, *, as_of_ms: int) -> ClosedDemoTrade:
    if not isinstance(record, dict):
        raise ValueError("record must be an object")
    if record.get("venue") != "BITGET_DEMO" or record.get("source") != "EXCHANGE_CONFIRMED":
        raise ValueError("not a confirmed Bitget demo trade")
    signal_id = record.get("signal_id")
    if not isinstance(signal_id, str) or not (1 <= len(signal_id) <= 160):
        raise ValueError("missing or invalid signal identifier")
    timestamps = [_timestamp(record.get(k)) for k in ("signaled_ms", "entered_ms", "exited_ms")]
    if not (timestamps[0] <= timestamps[1] < timestamps[2] <= as_of_ms):
        raise ValueError("event chronology invalid or future outcome")
    for flag in ("entry_confirmed", "exit_confirmed", "protective_stop_confirmed"):
        if record.get(flag) is not True:
            raise ValueError(f"required execution proof missing: {flag}")
    gross = _finite_num(record.get("gross_pnl_usdt"))
    entry_fee = _finite_num(record.get("entry_fee_usdt"), nonnegative=True)
    exit_fee = _finite_num(record.get("exit_fee_usdt"), nonnegative=True)
    funding = _finite_num(record.get("funding_usdt"))
    risk = _finite_num(record.get("risk_usdt"))
    if risk <= 0:
        raise ValueError("risk must be positive")
    expected_net = gross - entry_fee - exit_fee + funding
    # Explicit net reconciliation is required to prevent claiming fictitious
    # net profits from incomplete fee/funding accounting.
    supplied_net = _finite_num(record.get("exchange_net_pnl_usdt"))
    if abs(expected_net - supplied_net) > max(EPS, abs(expected_net) * 1e-6):
        raise ValueError("exchange net PnL does not reconcile with fees/funding")
    return ClosedDemoTrade(signal_id, *timestamps, gross, entry_fee,
                           exit_fee, funding, risk, True, True, True)


def collect(records: Iterable[object], *, as_of_ms: int) -> dict:
    """Deduplicate, reject unverifiable records, and preserve reasons only.

    A duplicated signal ID contaminates BOTH records instead of silently
    choosing the more profitable occurrence.
    """
    all_rows = list(records)
    if not (0 < len(all_rows) <= 100_000):
        raise ValueError("evidence size must be between 1 and 100000")
    ids = [r.get("signal_id") for r in all_rows if isinstance(r, dict)]
    counts: dict[str, int] = {}
    for value in ids:
        if isinstance(value, str):
            counts[value] = counts.get(value, 0) + 1
    duplicates = {key for key, count in counts.items() if count > 1}
    accepted: list[ClosedDemoTrade] = []
    rejected: dict[str, int] = {}
    for record in all_rows:
        try:
            if isinstance(record, dict) and record.get("signal_id") in duplicates:
                raise ValueError("duplicate signal identifier")
            accepted.append(parse_closed(record, as_of_ms=as_of_ms))
        except (TypeError, ValueError) as exc:
            label = str(exc)
            rejected[label] = rejected.get(label, 0) + 1
    accepted.sort(key=lambda r: (r.exited_ms, r.signal_id))
    return {"trades": accepted, "rejected": rejected, "seen": len(all_rows)}


def summarize(trades: Iterable[ClosedDemoTrade], *, min_samples: int = MIN_MEANINGFUL_SAMPLES) -> dict:
    ordered = sorted(trades, key=lambda row: (row.exited_ms, row.signal_id))
    count = len(ordered)
    wins = sum(1 for x in ordered if x.net_pnl_usdt > 0)
    losses = sum(1 for x in ordered if x.net_pnl_usdt < 0)
    breakeven = count - wins - losses
    gross_wins = sum(x.net_pnl_usdt for x in ordered if x.net_pnl_usdt > 0)
    gross_losses = abs(sum(x.net_pnl_usdt for x in ordered if x.net_pnl_usdt < 0))
    equity = peak = worst_dd_usdt = net_r = peak_r = worst_dd_r = 0.0
    losing_streak = worst_streak = 0
    for row in ordered:
        equity += row.net_pnl_usdt
        net_r += row.net_r
        peak = max(0.0, peak, equity)
        peak_r = max(0.0, peak_r, net_r)
        worst_dd_usdt = max(worst_dd_usdt, peak - equity)
        worst_dd_r = max(worst_dd_r, peak_r - net_r)
        losing_streak = losing_streak + 1 if row.net_pnl_usdt < 0 else 0
        worst_streak = max(worst_streak, losing_streak)
    return {
        "trades": count, "wins": wins, "losses": losses, "breakeven": breakeven,
        "net_pnl_usdt": round(equity, 8),
        "total_net_r": round(net_r, 8),
        "fees_usdt": round(sum(x.entry_fee_usdt + x.exit_fee_usdt for x in ordered), 8),
        "funding_usdt": round(sum(x.funding_usdt for x in ordered), 8),
        "max_peak_to_trough_drawdown_usdt": round(worst_dd_usdt, 8),
        "max_peak_to_trough_drawdown_r": round(worst_dd_r, 8),
        "longest_losing_streak": worst_streak,
        "median_signal_to_entry_ms": (
            sorted(x.entered_ms - x.signaled_ms for x in ordered)[count // 2] if count else None),
        "sample_sufficient": count >= min_samples,
        "win_rate_pct": round(wins * 100 / count, 4) if count >= min_samples else None,
        "net_expectancy_r": round(net_r / count, 6) if count >= min_samples else None,
        "net_profit_factor": (round(gross_wins / gross_losses, 6)
                              if count >= min_samples and gross_losses > EPS else None),
        "limitations": "Exchange-confirmed demo fills only; historical observations are not forward forecasts."
    }


def evaluate(records: Iterable[object], *, as_of_ms: int, split_ms: int | None = None,
             min_samples: int = MIN_MEANINGFUL_SAMPLES) -> dict:
    if not isinstance(as_of_ms, int) or as_of_ms <= 0:
        raise ValueError("as_of_ms must be positive")
    if not 1 <= min_samples <= 100_000:
        raise ValueError("invalid min_samples")
    if split_ms is not None and (not isinstance(split_ms, int) or not 0 < split_ms <= as_of_ms):
        raise ValueError("invalid split_ms")
    collected = collect(records, as_of_ms=as_of_ms)
    trades = collected["trades"]
    report = {
        "schema_version": 1,
        "as_of_ms": as_of_ms,
        "source": "EXCHANGE_CONFIRMED_BITGET_DEMO_ONLY",
        "records_seen": collected["seen"],
        "accepted_trades": len(trades),
        "rejected_count": collected["seen"] - len(trades),
        "rejected_reason_counts": collected["rejected"],
        "all": summarize(trades, min_samples=min_samples),
        "no_profitability_claim": True,
    }
    if split_ms is not None:
        training = [t for t in trades if t.exited_ms < split_ms]
        test = [t for t in trades if t.signaled_ms >= split_ms]
        straddling = len(trades) - len(training) - len(test)
        report["chronological_split"] = {
            "cutoff_ms": split_ms,
            "train": summarize(training, min_samples=min_samples),
            "holdout": summarize(test, min_samples=min_samples),
            "boundary_excluded": straddling,
            "warning": "Holdout is truly out-of-sample ONLY if this cutoff and model were frozen before seeing holdout outcomes."
        }
    return report


def read_jsonl(path: Path, *, max_bytes: int = 20_000_000) -> list[object]:
    if path.stat().st_size > max_bytes:
        raise ValueError("file exceeds evidence size bound")
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def main(argv=None) -> int:
    """Evaluate offline evidence files; do not reach the network or place trades."""
    import argparse
    import time
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="Exchange-reconciled JSONL; keep this file private")
    parser.add_argument("--as-of-ms", type=int, default=None, help="Explicit evaluation cutoff (default: current UTC epoch ms)")
    parser.add_argument("--split-ms", type=int, default=None, help="Predeclared holdout start in UTC epoch ms")
    parser.add_argument("--min-samples", type=int, default=MIN_MEANINGFUL_SAMPLES)
    parser.add_argument("--output", type=Path, help="Optional summary JSON without signal identifiers")
    args = parser.parse_args(argv)
    as_of = args.as_of_ms if args.as_of_ms is not None else int(time.time() * 1000)
    report = evaluate(read_jsonl(args.input), as_of_ms=as_of, split_ms=args.split_ms,
                      min_samples=args.min_samples)
    output = json.dumps(report, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(output, encoding="utf-8")
    else:
        print(output, end="")
    return 0 if report["rejected_count"] == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())

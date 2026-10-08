"""Bounded local decision journal; persistence is reported, never assumed."""
from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import threading
import time
import zlib
from pathlib import Path

ENGINE_REVISION = "market-decision-v3.8"


class DecisionJournal:
    def __init__(self, path=None):
        self.path = Path(path or os.getenv("DECISION_JOURNAL_FILE","/tmp/dev_trader_decisions.sqlite3"))
        self.retention_days = max(1, int(os.getenv("DECISION_JOURNAL_RETENTION_DAYS", "30")))
        self.max_records = max(1, int(os.getenv("DECISION_JOURNAL_MAX_RECORDS", "10000")))
        self.max_blob_bytes = max(0, int(os.getenv("DECISION_JOURNAL_MAX_BLOB_MB", "0"))) * 1024 * 1024
        self.lock = threading.RLock()
        self.error = ""
        self.last_sample = 0
        self.last_key = ""
        self.last_tick_second = -1
        self.last_maintenance = 0
        self.ready = False
        try:
            self.path.parent.mkdir(parents=True,exist_ok=True)
            self.db = sqlite3.connect(str(self.path),check_same_thread=False,timeout=2)
            # Applied to new databases. Reclaim freed pages on bounded free volumes.
            self.db.execute("PRAGMA auto_vacuum=FULL")
            self.db.execute("PRAGMA journal_mode=WAL")
            self.db.execute("PRAGMA journal_size_limit=4194304")
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY, ts INTEGER, kind TEXT, data BLOB);
                CREATE INDEX IF NOT EXISTS decisions_ts ON decisions(ts);
                CREATE TABLE IF NOT EXISTS ticks(ts INTEGER PRIMARY KEY, price REAL);
            """)
            self.db.commit()
            self.ready = True
        except Exception as exc:
            self.error = type(exc).__name__

    def record(self, kind, payload, ts=None, identity=None):
        if not self.ready:
            return False
        ts = int(ts if ts is not None else time.time()*1000)
        body = dict(payload, engine_revision=ENGINE_REVISION)
        try:
            raw = json.dumps(body,separators=(",",":"),allow_nan=False,sort_keys=True)
            oid = identity or hashlib.sha256((kind+str(ts)+raw).encode()).hexdigest()
            compressed = zlib.compress(raw.encode())
            if self.max_blob_bytes and len(compressed) > self.max_blob_bytes:
                self.error = "RECORD_EXCEEDS_JOURNAL_BUDGET"
                return False
            with self.lock,self.db:
                self.db.execute("INSERT OR REPLACE INTO decisions VALUES(?,?,?,?)",
                                (oid,ts,kind,compressed))
                self._maintain(ts)
                if self.max_blob_bytes:
                    self.db.execute("""DELETE FROM decisions WHERE id IN (
                        SELECT id FROM (SELECT id, SUM(length(data)) OVER
                        (ORDER BY ts DESC, id DESC) AS bytes FROM decisions) WHERE bytes > ?)
                    """, (self.max_blob_bytes,))
            self.error = ""
            return True
        except Exception as exc:
            self.error = type(exc).__name__
            return False

    def observe(self, state, report, candidates):
        ts = int(report.get("ts") or time.time()*1000)
        selected = report.get("selected")
        key = json.dumps([report.get("status"),report.get("regime"),selected,
                          [(x.get("id"),x.get("allow"),x.get("reason")) for x in candidates]],sort_keys=True)
        # Capture changed decisions immediately, unchanged observations once/minute.
        if key == self.last_key and ts-self.last_sample < 60_000:
            return
        self.last_key,self.last_sample = key,ts
        snapshot = state.snapshot(history=True)
        self.record("DECISION",dict(report=report,candidates=candidates,market=snapshot),ts)

    def tick(self, ts, price):
        if not self.ready or not price or price <= 0:
            return
        second=int(ts)//1000
        if second==self.last_tick_second:
            return
        self.last_tick_second=second
        try:
            with self.lock,self.db:
                self.db.execute("INSERT OR REPLACE INTO ticks VALUES(?,?)",(int(ts)//1000*1000,float(price)))
                self._maintain(int(ts))
        except Exception as exc:
            self.error = type(exc).__name__

    def _maintain(self, ts):
        if ts-self.last_maintenance < 300_000:
            return
        self.last_maintenance = ts
        cutoff = ts-self.retention_days*86_400_000
        self.db.execute("DELETE FROM ticks WHERE ts < ?",(cutoff,))
        self.db.execute("DELETE FROM decisions WHERE ts < ?",(cutoff,))
        self.db.execute("DELETE FROM decisions WHERE id IN (SELECT id FROM decisions ORDER BY ts DESC LIMIT -1 OFFSET ?)", (self.max_records,))

    def records(self, limit=100, kind=None, since=0):
        if not self.ready:
            return []
        limit = max(1,min(500,int(limit)))
        query = "SELECT id,ts,kind,data FROM decisions WHERE ts>=?"
        args = [int(since)]
        if kind:
            query += " AND kind=?"; args.append(kind)
        query += " ORDER BY ts DESC LIMIT ?"; args.append(limit)
        try:
            with self.lock:
                return [dict(id=oid,ts=ts,kind=k,**json.loads(zlib.decompress(data)))
                        for oid,ts,k,data in self.db.execute(query,args).fetchall()]
        except Exception as exc:
            self.error=type(exc).__name__
            return []

    def prices(self, start, end):
        if not self.ready:
            return []
        with self.lock:
            return self.db.execute("SELECT ts,price FROM ticks WHERE ts>=? AND ts<=? ORDER BY ts",(start,end)).fetchall()

    def status(self):
        counts = (0,0,None,None)
        if self.ready:
            try:
                with self.lock:
                    n,first,last = self.db.execute("SELECT COUNT(*),MIN(ts),MAX(ts) FROM decisions").fetchone()
                    ticks = self.db.execute("SELECT COUNT(*) FROM ticks").fetchone()[0]
                    counts = n,ticks,first,last
            except Exception as exc:
                self.error=type(exc).__name__
        return dict(ready=self.ready,error=self.error,records=counts[0],price_samples=counts[1],
                    first_ts=counts[2],last_ts=counts[3],retention_days=self.retention_days,max_records=self.max_records,
                    max_blob_bytes=self.max_blob_bytes or None,
                    storage="LOCAL_SQLITE",durability="EPHEMERAL_UNLESS_PERSISTENT_VOLUME_CONFIGURED",
                    engine_revision=ENGINE_REVISION)


def performance_scorecard(trades):
    """Use exchange-resolved net results; planned or unresolved trades never win."""
    rows = [r for r in trades if r.get("status") == "CLOSED" and r.get("closed_ts")
            and r.get("net_profit_usdt") is not None]
    rows.sort(key=lambda r:float(r["closed_ts"]))
    groups = {}
    equity=peak=dd=0.0
    losses=max_losses=0
    for row in rows:
        net = float(row["net_profit_usdt"])
        equity += net; peak=max(peak,equity); dd=max(dd,peak-equity)
        losses=losses+1 if net < 0 else 0; max_losses=max(max_losses,losses)
        snapshot = row.get("signal_snapshot") or {}
        policy = (snapshot.get("evidence") or {}).get("playbook") or {}
        key = "|".join([str(policy.get("family") or row.get("setup") or "RECOVERED_UNKNOWN"),
                        str(snapshot.get("regime") or "UNKNOWN"),str(snapshot.get("engine_revision") or "LEGACY_OR_RECOVERED")])
        g=groups.setdefault(key,dict(trades=0,net_usdt=0.0,wins=0,total_r=0.0,fees_usdt=0.0))
        g["trades"]+=1;g["net_usdt"]+=net;g["wins"]+=int(net>0)
        g["total_r"]+=float(row.get("result_r") or 0)
        g["fees_usdt"]+=float(row.get("fees_usdt") or 0)
    for g in groups.values():
        g["net_expectancy_usdt"]=round(g["net_usdt"]/g["trades"],6)
        g["average_net_r"]=round(g["total_r"]/g["trades"],4)
        g["evidence_status"]="INSUFFICIENT" if g["trades"]<30 else "DESCRIPTIVE_ONLY_REQUIRES_OUT_OF_SAMPLE_VALIDATION"
    return dict(closed_trades=len(rows),net_usdt=round(equity,6),max_drawdown_usdt=round(dd,6),
                max_consecutive_losses=max_losses,groups=groups,
                profitability_proven=False,scope="RECONCILED_BOT_TRADES_WITH_RECORDED_CONTEXT")

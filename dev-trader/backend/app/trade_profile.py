"""Executed volume at price, with explicit session and connection coverage."""
import math
import os
from decimal import Decimal, ROUND_FLOOR

DAY_MS = 86_400_000


class TradeVolumeProfile:
    def __init__(self, venue="BITGET_USDT_FUTURES", width=None):
        self.venue=venue
        self.width=float(width if width is not None else os.getenv("PROFILE_BIN_USDT","25"))
        if not math.isfinite(self.width) or self.width <= 0:
            raise ValueError("Profile bin width must be positive and finite")
        self.sessions={}
        self.connected_since=None
        self.last_received=None
        self.seen={}
        self.revision=0

    def connect(self, now):
        self.connected_since=now
        self.last_received=now

    def gap(self, now):
        since=self.last_received if self.last_received is not None else now
        for day,p in self.sessions.items():
            if day <= now and day+DAY_MS > since:
                p["complete"]=False
        self.connected_since=None

    def ingest(self, exec_id, ts, price, size, received_ms):
        if exec_id in self.seen:
            return False
        if not exec_id or not all(math.isfinite(float(v)) for v in (price,size)) or price <= 0 or size <= 0 or ts > received_ms+5000:
            self.gap(received_ms)
            return False
        if self.connected_since is None:
            self.connect(received_ms)
        if self.last_received is not None and received_ms-self.last_received > 30_000:
            self.gap(received_ms)
            self.connect(received_ms)
        self.last_received=received_ms
        day=ts//DAY_MS*DAY_MS
        if received_ms-day >= 4*DAY_MS:
            return False
        profile=self.sessions.setdefault(day,dict(bins={},volume=0.0,price_volume=0.0,
            complete=self.connected_since <= day,first_ts=ts,last_ts=ts,
            low=price,high=price,count=0))
        if ts < self.connected_since:
            profile["complete"]=False
        bucket=int((Decimal(str(price))/Decimal(str(self.width))).to_integral_value(rounding=ROUND_FLOOR))
        profile["bins"][bucket]=profile["bins"].get(bucket,0.0)+size
        profile["volume"]+=size;profile["price_volume"]+=price*size
        profile["first_ts"]=min(profile["first_ts"],ts);profile["last_ts"]=max(profile["last_ts"],ts)
        profile["low"]=min(profile["low"],price);profile["high"]=max(profile["high"],price)
        profile["count"]+=1
        self.seen[exec_id]=ts
        self.revision+=1
        cutoff=received_ms//DAY_MS*DAY_MS-3*DAY_MS
        self.sessions={d:p for d,p in self.sessions.items() if d >= cutoff}
        if len(self.seen)>100_000:
            # IDs outside this retained window can never establish completeness.
            self.seen=dict(sorted(self.seen.items(),key=lambda x:x[1])[-50_000:])
        return True

    def snapshot(self, now):
        day=now//DAY_MS*DAY_MS
        current=self.sessions.get(day)
        previous=self.sessions.get(day-DAY_MS)
        result=dict(source="EXECUTED_TRADES",venue=self.venue,session="UTC_DAY",bin_width_usdt=self.width,
                    coverage_assurance="OBSERVED_CONNECTION_COVERAGE_NOT_EXCHANGE_AUDITED",
                    exact_npoc=False,profile_status="WARMING",previous_day_poc=None,untouched_poc=None,
                    session_vwap=None,observed_session_vwap=None,touch_history_complete=False,
                    revision=self.revision,previous_session_complete=False,current_session_complete=False)
        connected=self.connected_since is not None and self.last_received is not None and now-self.last_received <= 30_000
        if current and current["volume"] > 0:
            result["observed_session_vwap"]=current["price_volume"]/current["volume"]
            result["current_session_complete"]=current["complete"] and connected
            if result["current_session_complete"]:
                result["session_vwap"]=result["observed_session_vwap"]
        if previous and previous["volume"] > 0:
            bucket=max(previous["bins"],key=lambda b:(previous["bins"][b],-b))
            poc=(bucket+.5)*self.width
            result.update(previous_day_poc=poc,previous_session_complete=previous["complete"],
                          profile_status="COMPLETE" if previous["complete"] else "PARTIAL")
            if previous["complete"] and current and result["current_session_complete"]:
                result["touch_history_complete"]=True
                # Conservative: crossing the whole bin also invalidates untouched status.
                touched=current["low"] <= (bucket+1)*self.width and current["high"] >= bucket*self.width
                result["untouched_poc"]=None if touched else poc
                result["exact_npoc"]=True
        return result

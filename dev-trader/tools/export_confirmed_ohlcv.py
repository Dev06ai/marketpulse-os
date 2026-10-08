"""Export *confirmed* Bitget OHLCV for offline independent Freqtrade research.

Input is a JSON state snapshot with candles_5 / candles_15 / candles_60.
No exchange keys, order execution, or simulated profit is produced here.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from datetime import datetime,timezone
from pathlib import Path

INTERVALS={"5m":("candles_5",300_000),"15m":("candles_15",900_000),"1h":("candles_60",3_600_000)}


def rows_for_export(source: dict, interval: str) -> list[dict]:
    key, duration=INTERVALS[interval]
    rows=[]
    seen=set()
    for c in sorted(source.get(key) or [],key=lambda x:int(x.get("start") or 0)):
        try:
            start,end=int(c["start"]),int(c["end"])
            values=[float(c[k]) for k in ("open","high","low","close","volume")]
        except (TypeError,ValueError,OverflowError,KeyError):
            continue
        if (not c.get("confirmed") or start in seen or start<0
                or end-start+1!=duration or not all(math.isfinite(v) for v in values)
                or any(v<=0 for v in values[:4]) or values[4]<0
                or values[1]<max(values[0],values[3])
                or values[2]>min(values[0],values[3])):
            continue
        seen.add(start)
        rows.append({
            "date":datetime.fromtimestamp(start/1000,timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            "open":values[0],"high":values[1],"low":values[2],
            "close":values[3],"volume":values[4],
        })
    return rows


def export(input_file:Path,destination:Path,interval:str) -> int:
    payload=json.loads(input_file.read_text(encoding="utf-8"))
    if not isinstance(payload,dict):
        raise ValueError("Expected a JSON state object")
    rows=rows_for_export(payload,interval)
    if len(rows)<10:
        raise ValueError("At least ten confirmed OHLCV bars are required")
    destination.parent.mkdir(parents=True,exist_ok=True)
    with destination.open("w",encoding="utf-8",newline="") as fd:
        writer=csv.DictWriter(fd,fieldnames=["date","open","high","low","close","volume"])
        writer.writeheader()
        writer.writerows(rows)
    return len(rows)


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--input",type=Path,required=True)
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--timeframe",choices=sorted(INTERVALS),required=True)
    args=parser.parse_args()
    print(f"Exported {export(args.input,args.output,args.timeframe)} confirmed candles")

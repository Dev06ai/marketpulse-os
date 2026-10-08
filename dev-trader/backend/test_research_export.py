"""Safe off-host research export: never invent missing OHLCV candles."""
import runpy
from pathlib import Path

from app.models import Candle

TOOL=Path(__file__).resolve().parents[1].joinpath("tools","export_confirmed_ohlcv.py")
module=runpy.run_path(str(TOOL))


def test_confirmed_export_strips_incomplete_future_and_duplicates(tmp_path):
    rows=[
        {"start":i*900_000,"end":(i+1)*900_000-1,
         "open":100+i,"high":101+i,"low":99+i,
         "close":100+i,"volume":10,"confirmed":True}
        for i in range(15)
    ]
    source={"candles_15":rows+[dict(rows[-1],confirmed=False),
                                dict(rows[-1],start=16*900_000,end=17*900_000-1,high=999,confirmed=False)]}
    result=module["rows_for_export"](source,"15m")
    assert len(result)==15
    assert result[-1]["close"]==114
    assert result[-1]["date"].endswith(":00")


def test_future_and_malformed_bars_are_not_backfilled_as_real():
    src={"candles_5":[
        {"start":0,"end":299999,"open":100,"high":101,"low":99,"close":100,
         "volume":10,"confirmed":True},
        {"start":300000,"end":599999,"open":100,"high":float("nan"),"low":99,
         "close":100,"volume":10,"confirmed":True}
    ]}
    assert len(module["rows_for_export"](src,"5m"))==1

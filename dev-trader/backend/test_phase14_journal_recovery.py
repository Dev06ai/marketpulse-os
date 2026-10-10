"""Original phases 7/11/13/14: restart cannot erase ambiguous exposure."""
import json
from pathlib import Path

import pytest

from app.execution import DemoExecutionEngine
from test_execution import FakeLearning, FakeClient


def engine_at(monkeypatch,path):
    monkeypatch.setenv("BITGET_DEMO_TRADING","true")
    monkeypatch.setenv("BITGET_EXECUTION_STATE_FILE",str(path))
    bot=DemoExecutionEngine(FakeLearning())
    bot.client=FakeClient()
    return bot


@pytest.mark.parametrize("raw", [
    "{invalid",
    "[]",
    '{"trades":"accidentally a string"}',
    '{"trades":[null]}',
])
def test_existing_invalid_journal_never_silently_resets_risk(monkeypatch,tmp_path,raw):
    p=tmp_path/"history.json"
    p.write_text(raw,encoding="utf8")
    bot=engine_at(monkeypatch,p)
    assert bot.data["persistence_halt"]
    assert not bot.data["trades"]
    allowed,reason=bot._signal_allowed({"id":"new","grade":"A","direction":"LONG","confidence":.9,"rr":4})
    assert allowed is False and "history" in reason.lower()
    assert p.read_text(encoding="utf8")==raw


def test_clean_first_run_never_sets_persistence_halt(monkeypatch,tmp_path):
    bot=engine_at(monkeypatch,tmp_path/"fresh.json")
    assert not bot.data.get("persistence_halt")


def test_crash_recovered_intent_survives_second_restart(monkeypatch,tmp_path):
    p=tmp_path/"history.json"
    order={"client_oid":"DTDEMO-STABLE-123","execution_id":"DTDEMO-STABLE-123",
           "signal_id":"SFP-123","status":"SUBMISSION_UNKNOWN",
           "direction":"LONG","opened_ts":1}
    p.write_text(json.dumps({"trades":[],"pending_submission":order}))
    bot=engine_at(monkeypatch,p)
    assert len(bot.data["trades"])==1
    assert bot.data["trades"][0]["status"]=="SUBMISSION_UNKNOWN"
    assert bot.data["trades"][0]["client_oid"]=="DTDEMO-STABLE-123"
    disk=json.loads(p.read_text())
    assert disk["trades"][0]["client_oid"]=="DTDEMO-STABLE-123"
    assert "pending_submission" not in disk
    restarted=engine_at(monkeypatch,p)
    assert len(restarted.data["trades"])==1
    assert restarted.data["trades"][0]["status"]=="SUBMISSION_UNKNOWN"


def test_open_older_than_five_hundred_closed_trades_is_retained(monkeypatch,tmp_path):
    p=tmp_path/"history.json"
    rows=[{"status":"CLOSED","opened_ts":i} for i in range(600)]
    rows.append({"status":"OPEN","direction":"LONG","execution_id":"older-open",
                 "client_oid":"older-open","opened_ts":1_000_000})
    p.write_text(json.dumps({"trades":rows}))
    bot=engine_at(monkeypatch,p)
    assert sum(t["status"]=="CLOSED" for t in bot.data["trades"])==500
    assert any(t.get("execution_id")=="older-open" for t in bot.data["trades"])


def test_unreadable_intent_blocks_new_orders(monkeypatch,tmp_path):
    p=tmp_path/"history.json"
    raw={"trades":[],"pending_submission":"broken"}
    p.write_text(json.dumps(raw))
    bot=engine_at(monkeypatch,p)
    assert bot.data.get("persistence_halt")
    assert bot._signal_allowed({"id":"a"})[0] is False


def test_invalid_historical_created_timestamp_does_not_crash_daily_risk_check(monkeypatch,tmp_path):
    p=tmp_path/"history.json"
    p.write_text(json.dumps({"trades":[{"status":"CLOSED","opened_ts":"not-a-time"}]}))
    bot=engine_at(monkeypatch,p)
    assert bot._today_trades()==0


def test_background_save_refuses_to_destroy_unreadable_original(monkeypatch,tmp_path):
    p=tmp_path/"original.json"
    original='{"trades": [corrupt]}'
    p.write_text(original)
    bot=engine_at(monkeypatch,p)
    bot.data["last_sync_ts"]=9_999_999
    assert bot._save() is False
    assert p.read_text()==original

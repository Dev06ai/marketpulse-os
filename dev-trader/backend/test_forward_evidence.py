import pytest
from tools.forward_evidence import evaluate, parse_closed, summarize, collect, read_jsonl, wilson_interval

NOW = 1900000000000


def trade(i=1, gross=4.0, entry_fee=.1, exit_fee=.1, funding=0.0, risk=2.0, **kw):
    r={"venue":"BITGET_DEMO", "source":"EXCHANGE_CONFIRMED", "signal_id":f"s{i}",
       "signaled_ms":NOW-500000+i*10000, "entered_ms":NOW-490000+i*10000,
       "exited_ms":NOW-480000+i*10000, "gross_pnl_usdt":gross, "entry_fee_usdt":entry_fee,
       "exit_fee_usdt":exit_fee, "funding_usdt":funding, "risk_usdt":risk,
       "entry_confirmed":True, "exit_confirmed":True,"protective_stop_confirmed":True,
       "exchange_net_pnl_usdt":gross-entry_fee-exit_fee+funding}
    r.update(kw)
    return r


def test_closed_trade_net_accounts_for_fee_funding():
    x=parse_closed(trade(gross=4,funding=-1),as_of_ms=NOW)
    assert x.net_pnl_usdt==pytest.approx(2.8)
    assert x.net_r==pytest.approx(1.4)


def test_sample_gate_does_not_claim_winrate():
    r=evaluate([trade()],as_of_ms=NOW)
    assert r['all']['net_pnl_usdt']==pytest.approx(3.8)
    assert r['all']['win_rate_pct'] is None
    assert r['all']['sample_sufficient'] is False


@pytest.mark.parametrize('field,value', [('entry_fee_usdt',None),('gross_pnl_usdt',float('nan')),
 ('risk_usdt',0),('exchange_net_pnl_usdt',99),('entry_confirmed',False),
 ('protective_stop_confirmed',False),('source','PRICE_PATH_SIMULATED'),
 ('venue','BITGET_REAL'),('entered_ms',NOW+100),('exited_ms',NOW+1000),
 ('signaled_ms',NOW-100000),('signal_id','')])
def test_unverifiable_trade_is_rejected(field,value):
    assert evaluate([trade(**{field:value})],as_of_ms=NOW)['accepted_trades']==0


def test_duplicate_profit_and_loss_ids_both_quarantined():
    a,b=trade(1,gross=4),trade(1,gross=-8)
    r=evaluate([a,b],as_of_ms=NOW)
    assert r['accepted_trades']==0 and r['rejected_count']==2


def test_worst_drawdown_in_r_and_usdt():
    x=[trade(1,gross=10,entry_fee=0,exit_fee=0,risk=2),
       trade(2,gross=-4,entry_fee=0,exit_fee=0,risk=2),
       trade(3,gross=-3,entry_fee=0,exit_fee=0,risk=3)]
    r=evaluate(x,as_of_ms=NOW,min_samples=3)['all']
    assert r['max_peak_to_trough_drawdown_usdt']==7
    assert r['max_peak_to_trough_drawdown_r']==3
    assert r['longest_losing_streak']==2
    assert r['net_expectancy_r']==pytest.approx((5-2-1)/3)


def test_split_excludes_cross_boundary_and_blocks_hindsight_claim():
    x=[trade(1,signaled_ms=100,entered_ms=120,exited_ms=150),
       trade(2,signaled_ms=180,entered_ms=190,exited_ms=220),
       trade(3,signaled_ms=250,entered_ms=260,exited_ms=280)]
    r=evaluate(x,as_of_ms=NOW,split_ms=200,min_samples=1)['chronological_split']
    assert r['train']['trades']==1 and r['holdout']['trades']==1
    assert r['boundary_excluded']==1 and 'ONLY if' in r['warning']


def test_declared_but_missing_net_fees_disqualify():
    row=trade(); row.pop('exchange_net_pnl_usdt')
    assert evaluate([row],as_of_ms=NOW)['rejected_count']==1


def test_no_loss_returns_null_not_infinite_profit_factor():
    row=evaluate([trade()],as_of_ms=NOW,min_samples=1)['all']
    assert row['net_profit_factor'] is None


def test_empty_or_huge_jsonl_defended(tmp_path):
    p=tmp_path/'log.jsonl';p.write_text('{"a":1}\n')
    assert read_jsonl(p)==[{'a':1}]
    with pytest.raises(ValueError): read_jsonl(p,max_bytes=2)

def test_latency_median_and_tail_not_confused():
    rows=[trade(1,signaled_ms=100,entered_ms=110,exited_ms=130),
          trade(2,signaled_ms=200,entered_ms=240,exited_ms=260),
          trade(3,signaled_ms=300,entered_ms=600,exited_ms=630),
          trade(4,signaled_ms=700,entered_ms=1100,exited_ms=1130)]
    result=evaluate(rows,as_of_ms=NOW,min_samples=4)['all']
    assert result['median_signal_to_entry_ms']==170
    assert result['p95_signal_to_entry_ms']==400


def test_wilson_interval_for_small_sample_is_not_certain():
    lower,upper=wilson_interval(1,2)
    assert lower < 50 < upper
    assert wilson_interval(0,0) is None


def test_large_valid_subset_cannot_hide_rejected_trades():
    rows = [trade(i) for i in range(1, 31)]
    rows.append(trade(31, entry_confirmed=False))
    result = evaluate(rows, as_of_ms=NOW, min_samples=30)
    assert result["accepted_trades"] == 30 and result["rejected_count"] == 1
    assert result["input_records_complete"] is False
    assert result["exchange_history_completeness_verified"] is False
    assert result["all"]["net_pnl_usdt"] > 0
    assert result["all"]["sample_sufficient"] is False
    assert result["all"]["win_rate_pct"] is None
    assert result["all"]["net_expectancy_r"] is None
    assert result["all"]["net_profit_factor"] is None
    assert result["all"]["win_rate_wilson_95"] is None


def test_holdout_metrics_withheld_if_any_input_is_invalid():
    rows = [trade(i, signaled_ms=100+i*100, entered_ms=110+i*100,
                  exited_ms=120+i*100) for i in range(1, 33)]
    rows.append(trade(33, entry_fee_usdt=None))
    result = evaluate(rows, as_of_ms=NOW, split_ms=1700, min_samples=1)
    assert result["chronological_split"]["holdout"]["net_expectancy_r"] is None
    assert result["chronological_split"]["train"]["win_rate_pct"] is None


def test_overflowing_pnl_is_rejected_even_if_individual_fields_are_finite():
    row = trade(gross=1e308, entry_fee=0.0, exit_fee=0.0,
                funding=1e308, risk=2.0)
    assert evaluate([row], as_of_ms=NOW)["accepted_trades"] == 0


def test_valid_input_is_not_broker_coverage_attestation():
    result = evaluate([trade(i) for i in range(1, 31)], as_of_ms=NOW)
    assert result["input_records_complete"] is True
    assert result["exchange_history_completeness_verified"] is False
    assert result["all"]["sample_sufficient"] is True

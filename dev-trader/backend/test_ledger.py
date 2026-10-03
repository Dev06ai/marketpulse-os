from app.ledger import build_fill_ledger


def fill(exec_id, ts, side, trade_side, qty, pnl=0, fee=.1, **extra):
    return dict(execId=exec_id, createdTime=ts, symbol='BTCUSDT', side=side,
                tradeSide=trade_side, execQty=qty, execPrice=100000, execPnl=pnl,
                feeDetail=[dict(feeCoin='USDT', fee=fee)], **extra)


def test_fill_ledger_deduplicates_and_includes_entry_exit_fees_and_rebates():
    opening = fill('1', 1000, 'buy', 'open', .003, fee=.18, orderId='open')
    rows = [fill('2', 2000, 'sell', 'close', .001, pnl=1, fee=.06), opening,
            opening, fill('3', 3000, 'sell', 'close', .001, pnl=-2, fee=-.01)]
    ledger = build_fill_ledger(rows, [], 'BTCUSDT', 0, 4000, True)
    assert ledger['fill_count'] == 3
    assert ledger['fees_usdt'] == .23
    assert ledger['realized_after_fees_usdt'] == -1.23
    assert ledger['realized_drawdown_usdt'] == 1.99
    assert abs(ledger['remaining_lots'][0]['remaining_qty'] - .001) < 1e-10
    assert ledger['lot_attribution'] == 'FIFO_ESTIMATE'
    assert not ledger['funding_included']


def test_ledger_keeps_hedge_lots_separate_and_handles_close_before_window():
    rows = [fill('1', 1000, 'sell', 'open', .002),
            fill('2', 2000, 'buy', 'open', .003),
            fill('3', 3000, 'buy', 'close', .001),
            fill('4', 4000, 'sell', 'close', .005)]
    ledger = build_fill_ledger(rows, [], 'BTCUSDT', 0, 5000, True)
    assert len(ledger['remaining_lots']) == 1
    assert ledger['remaining_lots'][0]['direction'] == 'SHORT'
    assert ledger['unmatched_close_qty'] == .002


def test_ledger_filters_symbol_and_window_and_reports_bad_fees():
    rows = [fill('1', 1000, 'buy', 'open', .001),
            fill('2', 6000, 'buy', 'open', .001),
            dict(fill('3', 2000, 'buy', 'open', .001), symbol='ETHUSDT'),
            dict(fill('4', 3000, 'sell', 'close', .001), feeDetail=None)]
    ledger = build_fill_ledger(rows, [], 'BTCUSDT', 0, 5000, False)
    assert ledger['fill_count'] == 2
    assert not ledger['complete_window']
    assert not ledger['fee_accounting_complete']


def test_ledger_uses_hedge_position_side_when_trade_side_is_absent():
    rows = [fill('1', 1000, 'sell', '', .002, posSide='short'),
            fill('2', 2000, 'buy', '', .001, posSide='short')]
    ledger = build_fill_ledger(rows, [], 'BTCUSDT', 0, 3000, True)
    assert ledger['unmatched_close_qty'] == 0
    assert ledger['remaining_lots'][0]['remaining_qty'] == .001

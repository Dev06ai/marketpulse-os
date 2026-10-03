"""Exchange fill accounting. Lot attribution is explicitly an estimate."""
from __future__ import annotations
import math
from typing import Any


def number(value, default=0.0):
    try:
        result = float(value)
        return result if math.isfinite(result) else default
    except (TypeError, ValueError):
        return default


def build_fill_ledger(fills: list[dict], orders: list[dict], symbol: str, start_ts: int,
                      end_ts: int, complete: bool = False) -> dict[str, Any]:
    order_map = {str(r.get('orderId')): r for r in orders if isinstance(r, dict)}
    unique = {}
    for row in fills:
        if not isinstance(row, dict):
            complete = False
            continue
        if str(row.get('symbol', '')).upper() != symbol.upper():
            continue
        key = str(row.get('execId') or '')
        if key:
            unique[key] = row
        else:
            complete = False
    rows = sorted(unique.values(), key=lambda r: (number(r.get('createdTime')), str(r.get('execId'))))
    realized = fees = 0.0
    daily = {}
    curve = []
    lots = {'LONG': [], 'SHORT': []}
    unmatched_qty = 0.0
    fee_accounting_complete = True
    valid_count = 0
    for row in rows:
        qty = number(row.get('execQty'))
        price = number(row.get('execPrice'))
        ts = int(number(row.get('createdTime')))
        if qty <= 0 or price <= 0 or ts <= 0:
            complete = False
            continue
        if not start_ts <= ts <= end_ts:
            continue
        valid_count += 1
        pnl = number(row.get('execPnl'))
        details = row.get('feeDetail')
        if not isinstance(details, list):
            details = []
            fee_accounting_complete = False
        fee = 0.0
        for detail in details:
            if not isinstance(detail, dict):
                fee_accounting_complete = False
                continue
            amount = number(detail.get('fee'), None)
            if str(detail.get('feeCoin') or '').upper() == 'USDT' and amount is not None:
                # A negative fee is a rebate and must improve net P&L.
                fee += amount
            elif amount not in (None, 0.0):
                fee_accounting_complete = False
        realized += pnl
        fees += fee
        net = pnl - fee
        day = ts // 86400000 * 86400000
        daily[day] = daily.get(day, 0.0) + net
        curve.append({'ts': ts, 'net_usdt': round(realized - fees, 6)})
        order = order_map.get(str(row.get('orderId')), {})
        side = str(row.get('side') or order.get('side') or '').lower()
        trade_side = str(row.get('tradeSide') or order.get('tradeSide') or '').lower()
        close = 'close' in trade_side or str(order.get('reduceOnly')).upper() == 'YES'
        direction = str(row.get('posSide') or order.get('posSide') or '').upper()
        if not trade_side and direction in lots and side in {'buy', 'sell'}:
            close = (direction == 'LONG' and side == 'sell') or (direction == 'SHORT' and side == 'buy')
        if direction not in lots:
            direction = ('SHORT' if side == 'buy' else 'LONG') if close else ('LONG' if side == 'buy' else 'SHORT')
        if not close and 'open' not in trade_side and not (row.get('posSide') or order.get('posSide')):
            unmatched_qty += qty
            continue
        if not close:
            lots[direction].append({'order_id': str(row.get('orderId')), 'client_oid': row.get('clientOid') or order.get('clientOid'),
                'opened_ts': ts, 'entry_price': price, 'remaining_qty': qty})
        else:
            remaining = qty
            for lot in lots[direction]:
                used = min(remaining, lot['remaining_qty'])
                lot['remaining_qty'] -= used
                remaining -= used
                if remaining <= 1e-10:
                    break
            unmatched_qty += max(0.0, remaining)
    peak = drawdown = 0.0
    for point in curve:
        peak = max(peak, point['net_usdt'])
        drawdown = max(drawdown, peak - point['net_usdt'])
    return {
        'source': 'BITGET_EXECUTION_FILLS', 'symbol': symbol, 'window_start_ts': start_ts,
        'window_end_ts': end_ts, 'complete_window': bool(complete), 'fill_count': valid_count,
        'realized_gross_usdt': round(realized, 6), 'fees_usdt': round(fees, 6),
        'realized_after_fees_usdt': round(realized - fees, 6),
        'funding_included': False, 'transfers_included': False,
        'fee_accounting_complete': fee_accounting_complete,
        'realized_drawdown_usdt': round(drawdown, 6),
        'daily_net_usdt': {str(k): round(v, 6) for k, v in daily.items()},
        'curve': curve[-240:], 'lot_attribution': 'FIFO_ESTIMATE',
        'unmatched_close_qty': round(unmatched_qty, 10),
        'remaining_lots': [{**lot, 'direction': side} for side, entries in lots.items()
                           for lot in entries if lot['remaining_qty'] > 1e-10][-100:],
    }

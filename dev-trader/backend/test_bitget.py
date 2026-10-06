import base64
import hashlib
import hmac
import os

from app.bitget import BitgetDemoClient


def test_fills_history_paginates_and_does_not_claim_truncation_complete(monkeypatch):
    client = BitgetDemoClient('k', 's', 'p')
    pages = [{'data': {'list': [{}] * 100, 'cursor': 'next'}},
             {'data': {'list': [{}], 'cursor': 'last'}}]
    cursors = []
    def get(path, params):
        assert path == '/api/v3/trade/fills'
        cursors.append(params['cursor'])
        return pages[len(cursors)-1]
    monkeypatch.setattr(client, '_get', get)
    result = client.fills_history(1000, 2000)
    assert result['complete'] and len(result['rows']) == 101
    assert cursors == [None, 'next']
    monkeypatch.setattr(client, '_get', lambda *args: pages[0])
    assert not client.fills_history(1000, 2000, max_pages=1)['complete']


def test_account_metrics_distinguishes_equity_from_available(monkeypatch):
    client = BitgetDemoClient('k', 's', 'p')
    monkeypatch.setattr(client, 'account', lambda _: {'data': dict(usdtEquity='880',
        usdtUnrealisedPnl='-20', assets=[dict(coin='USDT', balance='900', available='840')])})
    metrics = client.account_metrics()
    assert metrics['equity_usdt'] == 880
    assert metrics['available_balance_usdt'] == 840
    assert metrics['account_unrealized_usdt'] == -20


def test_instrument_multipliers_are_normalized(monkeypatch):
    client = BitgetDemoClient('k', 's', 'p')
    monkeypatch.setattr(client, '_get', lambda *args: {'data': [dict(symbol='BTCUSDT',
        quantityPrecision='3', pricePrecision='1', minOrderQty='.001',
        quantityMultiplier='.002', priceMultiplier='.5')]})
    config = client.contract_config()
    assert config['sizeMultiplier'] == '.002'
    assert config['priceEndStep'] == '.5'


def test_demo_signature_matches_hmac_sha256():
    client = BitgetDemoClient(
        api_key="demo-key",
        api_secret="demo-secret",
        passphrase="demo-pass",
        base_url="https://api.bitget.com",
    )
    ts = 1730000000123
    signature = client.build_signature(
        ts,
        "GET",
        "/api/v3/account/assets",
        "coin=USDT",
        "",
    )
    expected_pre = (
        "1730000000123GET/api/v3/account/assets"
        "?coin=USDT"
    )
    expected = base64.b64encode(
        hmac.new(
            b"demo-secret",
            expected_pre.encode(),
            hashlib.sha256,
        ).digest()
    ).decode()
    assert signature == expected


def test_private_client_is_locked_without_demo_mode():
    old = os.environ.get("BITGET_DEMO_TRADING")
    os.environ["BITGET_DEMO_TRADING"] = "false"
    try:
        client = BitgetDemoClient("k", "s", "p")
        assert client.demo is False
        assert client.configured is False
    finally:
        if old is None:
            os.environ.pop("BITGET_DEMO_TRADING", None)
        else:
            os.environ["BITGET_DEMO_TRADING"] = old


def test_set_leverage_uses_uta_v3_symbol_and_isolated_side(monkeypatch):
    monkeypatch.setenv("BITGET_DEMO_TRADING", "true")
    client = BitgetDemoClient("k", "s", "p")
    sent = {}

    def fake_post(path, payload):
        sent["path"] = path
        sent["payload"] = payload
        return {"code": "00000", "data": "success"}

    monkeypatch.setattr(client, "_post", fake_post)
    result = client.set_leverage("BTCUSDT", "LONG", 20, "isolated")

    assert result["code"] == "00000"
    assert sent["path"] == "/api/v3/account/set-leverage"
    assert sent["payload"] == {
        "category": "USDT-FUTURES",
        "symbol": "BTCUSDT",
        "leverage": "20",
        "marginMode": "isolated",
        "posSide": "long",
    }


def test_set_leverage_crossed_does_not_send_position_side(monkeypatch):
    monkeypatch.setenv("BITGET_DEMO_TRADING", "true")
    client = BitgetDemoClient("k", "s", "p")
    sent = {}
    monkeypatch.setattr(client, "_post", lambda path, payload: sent.update(path=path, payload=payload) or {"code": "00000"})
    client.set_leverage("BTCUSDT", "SHORT", 20, "cross")
    assert sent["payload"]["marginMode"] == "crossed"
    assert "posSide" not in sent["payload"]


def test_uta_place_market_order_payload(monkeypatch):
    monkeypatch.setenv("BITGET_DEMO_TRADING", "true")
    client = BitgetDemoClient("k", "s", "p")
    sent = {}

    def fake_settings():
        return {"holdMode": "hedge_mode"}

    def fake_post(path, payload):
        sent["path"] = path
        sent["payload"] = payload
        return {"code": "00000", "data": {"orderId": "123"}}

    monkeypatch.setattr(client, "account_settings", fake_settings)
    monkeypatch.setattr(client, "_post", fake_post)

    client.place_market_order("BTCUSDT", "SHORT", "0.001", "84300", "82400", "DTDEMO-test")

    assert sent["path"] == "/api/v3/trade/place-order"
    assert sent["payload"]["category"] == "USDT-FUTURES"
    assert sent["payload"]["symbol"] == "BTCUSDT"
    assert sent["payload"]["side"] == "sell"
    assert sent["payload"]["posSide"] == "short"
    assert sent["payload"]["takeProfit"] == "82400"
    assert sent["payload"]["stopLoss"] == "84300"


def test_uta_close_market_order_payload(monkeypatch):
    monkeypatch.setenv("BITGET_DEMO_TRADING", "true")
    client = BitgetDemoClient("k", "s", "p")
    sent = {}

    def fake_settings():
        return {"holdMode": "one_way_mode"}

    def fake_post(path, payload):
        sent["path"] = path
        sent["payload"] = payload
        return {"code": "00000", "data": {"orderId": "close-123"}}

    monkeypatch.setattr(client, "account_settings", fake_settings)
    monkeypatch.setattr(client, "_post", fake_post)

    client.place_market_close("BTCUSDT", "LONG", "0.003", "DTDEMO-CLOSE-test")

    assert sent["path"] == "/api/v3/trade/place-order"
    assert sent["payload"]["category"] == "USDT-FUTURES"
    assert sent["payload"]["symbol"] == "BTCUSDT"
    assert sent["payload"]["side"] == "sell"
    assert sent["payload"]["qty"] == "0.003"
    assert sent["payload"]["reduceOnly"] == "yes"
    assert "posSide" not in sent["payload"]


def test_uta_close_market_order_hedge_mode(monkeypatch):
    monkeypatch.setenv("BITGET_DEMO_TRADING", "true")
    client = BitgetDemoClient("k", "s", "p")
    sent = {}

    def fake_settings():
        return {"holdMode": "hedge_mode"}

    def fake_post(path, payload):
        sent["payload"] = payload
        return {"code": "00000", "data": {"orderId": "close-456"}}

    monkeypatch.setattr(client, "account_settings", fake_settings)
    monkeypatch.setattr(client, "_post", fake_post)

    client.place_market_close("BTCUSDT", "SHORT", "0.004", "DTDEMO-CLOSE-test")

    assert sent["payload"]["side"] == "buy"
    assert sent["payload"]["posSide"] == "short"
    assert "reduceOnly" not in sent["payload"]


def test_public_market_ticker_uses_uta_market_endpoint(monkeypatch):
    client = BitgetDemoClient("k", "s", "p")
    seen = {}

    def fake_request(method, path, params=None, payload=None, private=True):
        seen["method"] = method
        seen["path"] = path
        seen["params"] = params
        seen["private"] = private
        return {
            "code": "00000",
            "data": [{"symbol": "BTCUSDT", "lastPrice": "100123.4"}],
        }

    monkeypatch.setattr(client, "_request", fake_request)

    ticker = client.market_ticker("BTCUSDT")

    assert ticker["lastPrice"] == "100123.4"
    assert seen["method"] == "GET"
    assert seen["path"] == "/api/v3/market/tickers"
    assert seen["params"]["category"] == "USDT-FUTURES"
    assert seen["params"]["symbol"] == "BTCUSDT"
    assert seen["private"] is False


def test_uta_position_fields_are_normalized_without_losing_originals():
    row = BitgetDemoClient._normalize_position(dict(posSide='long', avgPrice='100000',
        unrealisedPnl='-7', createdTime='10000', updatedTime='20000',
        closePriceAvg='99500', cumRealisedPnl='-2.5', openFeeTotal='-.3', closeFeeTotal='-.3'))
    assert row['holdSide'] == 'long'
    assert row['openPriceAvg'] == '100000'
    assert row['unrealizedPL'] == '-7'
    assert row['ctime'] == '10000' and row['utime'] == '20000'
    assert row['closeAvgPrice'] == '99500' and row['pnl'] == '-2.5'
    assert row['openFee'] == '-.3' and row['closeFee'] == '-.3'
    assert row['avgPrice'] == '100000'

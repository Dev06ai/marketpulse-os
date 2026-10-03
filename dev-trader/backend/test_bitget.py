import base64
import hashlib
import hmac
import os

from app.bitget import BitgetDemoClient


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

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
        "1730000000123GET/api/v2/mix/account/account"
        "?marginCoin=USDT&productType=USDT-FUTURES&symbol=BTCUSDT"
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

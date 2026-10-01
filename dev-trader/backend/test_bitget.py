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
        "/api/v2/mix/account/account",
        "marginCoin=USDT&productType=USDT-FUTURES&symbol=BTCUSDT",
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

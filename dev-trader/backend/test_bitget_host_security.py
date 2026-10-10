"""No credential exfiltration via Bitget base URL or signed redirects."""
import json
import pytest

from app.bitget import BitgetDemoClient, BitgetDemoError, _RejectExchangeRedirects


@pytest.mark.parametrize("base_url", [
    "http://api.bitget.com",
    "https://api.bitget.com.evil.invalid",
    "https://evil.invalid",
    "https://user:pass@api.bitget.com",
    "https://api.bitget.com/prefix",
    "https://api.bitget.com?forward=1",
    "https://api.bitget.com:8443",
    "ftp://api.bitget.com",
    "https://api.bitget.com:invalid",
])
def test_untrusted_host_fails_before_a_request_or_signature(monkeypatch,base_url):
    monkeypatch.setenv("BITGET_DEMO_TRADING","true")
    client=BitgetDemoClient("secret_key","secret_secret","secret_pass",base_url=base_url)
    outbound=[]
    monkeypatch.setattr("app.bitget.urllib.request.build_opener",
                        lambda *args: outbound.append(args))
    monkeypatch.setattr(client,"build_signature",
                        lambda *args: outbound.append("signed") or "signature")
    with pytest.raises(BitgetDemoError, match="Untrusted Bitget API origin"):
        client._request("GET","/api/v3/account/assets",private=True)
    assert outbound == []


def test_official_https_demo_requests_keep_paptrading_header(monkeypatch):
    monkeypatch.setenv("BITGET_DEMO_TRADING","true")
    client=BitgetDemoClient("demo_key","demo_secret","demo_pass",
                             base_url="https://api.bitget.com")
    captured=[]
    class Reply:
        def __enter__(self): return self
        def __exit__(self,*args): return False
        def read(self): return json.dumps({"code":"00000","data":{}}).encode()
    class FakeOpener:
        def open(self,request,timeout=None):
            captured.append((request.full_url,request.get_method(),request.headers))
            return Reply()
    monkeypatch.setattr("app.bitget.urllib.request.build_opener",lambda *args:FakeOpener())
    result=client._request("GET","/api/v3/account/assets",private=True)
    assert result["code"] == "00000"
    url, method, headers=captured[0]
    assert url == "https://api.bitget.com/api/v3/account/assets"
    assert method == "GET"
    assert headers.get("Paptrading") == "1"
    assert headers.get("Access-key") == "demo_key"


def test_redirect_handler_will_not_copy_signed_headers_to_other_host():
    import urllib.request
    request=urllib.request.Request(
        "https://api.bitget.com/api/v3/account/assets",
        headers={"ACCESS-KEY":"demo_key"},
    )
    handler=_RejectExchangeRedirects()
    assert handler.redirect_request(request,None,302,"redirect",{},
                                    "https://evil.invalid/collect") is None


def test_reject_untrusted_origin_even_on_public_quotes(monkeypatch):
    client=BitgetDemoClient("k","s","p",base_url="https://elsewhere.invalid")
    with pytest.raises(BitgetDemoError, match="Untrusted Bitget API origin"):
        client.market_ticker()

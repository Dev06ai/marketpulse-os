"""Real ASGI boundaries; tests never start lifespan or contact an exchange."""
import asyncio
import json

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import main
from app.api_security import BodyLimitMiddleware, MAX_HTTP_BODY_BYTES, PUBLIC_GET_PATHS
from app.transport import Subscription


@pytest.fixture
def owner(monkeypatch):
    secret = "example-security-regression-only-" + "a" * 40
    monkeypatch.setenv("KYVORIQ_API_OWNER_TOKEN", secret)
    main.pair_attempts.clear()
    yield secret
    main.pair_attempts.clear()


def test_every_nonpublic_route_defaults_to_denial(owner):
    client = TestClient(main.app)
    for route in main.app.routes:
        for method in getattr(route, "methods", set()):
            if method in {"GET", "HEAD"} and route.path not in PUBLIC_GET_PATHS:
                response = client.request(method, route.path)
                assert response.status_code == 401, (method, route.path)
                assert "no-store" in response.headers["cache-control"]
    assert client.post("/system-check/push", json={}).status_code == 401


def test_health_never_leaks_active_signal(owner, monkeypatch):
    monkeypatch.setattr(main.engine, "active_signal", {"id": "private-signal"})
    response = TestClient(main.app).get("/health")
    assert response.status_code == 200
    assert response.json()["signal"] is None
    assert "private-signal" not in response.text


def test_unprovisioned_private_routes_fail_closed(monkeypatch):
    monkeypatch.delenv("KYVORIQ_API_OWNER_TOKEN", raising=False)
    response = TestClient(main.app).get("/bootstrap")
    assert response.status_code == 503
    assert "execution" not in response.text


def test_malformed_pairing_does_not_echo_input_and_is_rate_limited(owner):
    client = TestClient(main.app)
    for _ in range(10):
        response = client.post("/auth/pair", json={"pairing_secret": {"value": owner}})
        assert response.status_code == 422
        assert owner not in response.text
        assert "no-store" in response.headers["cache-control"]
    assert client.post("/auth/pair", json={"pairing_secret": owner}).status_code == 429


@pytest.mark.parametrize("declared", [None, "1"])
def test_chunked_or_understated_body_never_reaches_handler(declared):
    messages = [
        {"type": "http.request", "body": b"x" * 32768, "more_body": True},
        {"type": "http.request", "body": b"y" * 32769, "more_body": False},
    ]
    sent = []
    called = []

    async def handler(scope, receive, send):
        called.append(True)

    async def receive():
        return messages.pop(0)

    async def send(message):
        sent.append(message)

    headers = [] if declared is None else [(b"content-length", declared.encode())]
    asyncio.run(BodyLimitMiddleware(handler)(
        {"type": "http", "method": "POST", "headers": headers}, receive, send))
    assert not called
    assert sent[0]["status"] == 413


def test_body_limit_preserves_valid_stream():
    chunks = [b'{"hello":', b'"world"}']
    messages = [{"type": "http.request", "body": chunk, "more_body": i == 0}
                for i, chunk in enumerate(chunks)]
    observed = []

    async def handler(scope, receive, send):
        observed.append(await receive())

    async def receive():
        return messages.pop(0)

    async def send(message):
        raise AssertionError("No middleware response for valid body")

    asyncio.run(BodyLimitMiddleware(handler)({"type": "http"}, receive, send))
    assert json.loads(observed[0]["body"]) == {"hello": "world"}
    assert not observed[0]["more_body"]


def test_declared_oversized_and_query_limit(owner):
    client = TestClient(main.app)
    assert client.post("/auth/pair", content="{}", headers={
        "Content-Length": str(MAX_HTTP_BODY_BYTES + 1)}).status_code == 413
    assert client.get("/health?x=" + "x" * 4096).status_code == 414


def test_websocket_requires_auth_and_rechecks_rotated_secret(owner, monkeypatch):
    client = TestClient(main.app)
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws"):
            pass
    with client.websocket_connect("/ws?profile=alerts", headers={
        "Authorization": "Bearer " + owner}) as ws:
        ws.receive_json()
        monkeypatch.setenv("KYVORIQ_API_OWNER_TOKEN", owner + "rotated")
        ws.send_json({"type": "keepalive"})
        with pytest.raises(WebSocketDisconnect) as err:
            ws.receive_json()
        assert err.value.code == 1008


def test_quiet_websocket_is_revoked_before_next_broadcast(owner, monkeypatch):
    class Socket:
        headers = {"authorization": "Bearer " + owner}
        closed = None

        async def close(self, code):
            self.closed = code

        async def send_text(self, text):
            raise AssertionError("Revoked socket received private data")

    async def run():
        ws = Socket()
        monkeypatch.setattr(main, "clients", {ws})
        monkeypatch.setattr(main, "subscriptions", {ws: Subscription("alerts")})
        monkeypatch.setattr(main, "client_failures", {})
        monkeypatch.setattr(main, "reconcile_execution_truth", lambda: None)
        monkeypatch.setattr(main, "SNAPSHOT", .5)
        monkeypatch.setenv("KYVORIQ_API_OWNER_TOKEN", owner + "rotated")
        task = asyncio.create_task(main.broadcast_loop())
        try:
            async def until_closed():
                while ws.closed is None:
                    await asyncio.sleep(.01)
            await asyncio.wait_for(until_closed(), 2)
            assert ws.closed == 1008
            assert ws not in main.clients and ws not in main.subscriptions
        finally:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
    asyncio.run(run())

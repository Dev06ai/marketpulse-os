"""Read-only host probe. Never loads API keys or submits orders."""
import argparse
import asyncio
import json
import urllib.request

import websockets


def get(origin, path):
    with urllib.request.urlopen(origin + path, timeout=12) as response:
        return json.load(response)


async def probe(origin, require_feed):
    health = await asyncio.to_thread(get, origin, "/health")
    assert health.get("ok") is True, "Backend HTTP health failed"
    checks = await asyncio.to_thread(get, origin, "/system-check")
    assert checks.get("backend_ok") is True, "Backend system check failed"
    # system-check only returns status. Trade credentials are never read here.
    socket_origin = origin.replace("https://", "wss://", 1).replace("http://", "ws://", 1)
    async with websockets.connect(socket_origin + "/ws?profile=dashboard", open_timeout=12) as ws:
        first = json.loads(await asyncio.wait_for(ws.recv(), 12))
        assert first.get("profile") == "dashboard" and "execution" in first
        await ws.send(json.dumps({"type": "keepalive"}))
        ack = False
        for _ in range(8):
            packet = json.loads(await asyncio.wait_for(ws.recv(), 3))
            if packet.get("type") == "ack":
                ack = True
                break
        assert ack, "Dashboard keepalive not acknowledged"
    async with websockets.connect(socket_origin + "/ws?profile=alerts", open_timeout=12) as ws:
        first = json.loads(await asyncio.wait_for(ws.recv(), 12))
        assert first.get("profile") == "alerts" and "execution" not in first
        await ws.send(json.dumps({"type": "keepalive"}))
        assert json.loads(await asyncio.wait_for(ws.recv(), 3))["type"] == "ack"
    bootstrap = await asyncio.to_thread(get, origin, "/bootstrap?profile=dashboard")
    assert "chart" in bootstrap
    if require_feed:
        heartbeat = await asyncio.to_thread(get, origin, "/heartbeat")
        age = (heartbeat.get("ages_ms") or {}).get("received_ms")
        assert heartbeat.get("market_ws") is True, "Host cannot maintain the exchange WebSocket"
        assert heartbeat.get("data_health") == "HEALTHY" and age is not None and 0 <= age < 8000
        assert bootstrap.get("upstream", {}).get("source") == "BITGET_WS"
        assert bootstrap["chart"]["candles"], "Historical chart is missing"
    print(json.dumps({"http": "PASS", "dashboard_ws": "PASS", "alerts_ws": "PASS",
                      "keepalive": "PASS", "bootstrap": "PASS",
                      "feed_verified": require_feed, "engine_revision": health.get("engine_revision")}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--require-feed", action="store_true")
    args = parser.parse_args()
    asyncio.run(probe(args.url.rstrip("/"), args.require_feed))

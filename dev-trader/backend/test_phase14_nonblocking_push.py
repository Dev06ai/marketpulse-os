"""FCM delivery must not delay market-state handling or demo execution."""
import asyncio
import threading
import time

from app import main


def test_slow_firebase_sender_does_not_block_market_event_loop(monkeypatch):
    monkeypatch.setattr(main.push,"ready",True)
    started,release=threading.Event(),threading.Event()
    sent=[]
    def blocked_send(payload):
        started.set()
        release.wait(timeout=5)
        sent.append(payload["key"])

    async def scenario():
        assert main.queue_push(blocked_send,{"key":"sfp-1"})
        assert await asyncio.to_thread(started.wait,.5)
        # The event loop can run decisions while Firebase is waiting remotely.
        progress=[]
        async def next_market_packet():
            progress.append("handled")
        await asyncio.wait_for(next_market_packet(),.2)
        assert progress==["handled"]
        release.set()
        await asyncio.wait_for(asyncio.gather(*list(main._push_delivery_tasks)),2)
    try:
        asyncio.run(scenario())
    finally:
        release.set()
    assert sent==["sfp-1"]
    assert not main._push_delivery_tasks


def test_secondary_notifications_are_ordered_and_duplicated_sources_do_not_block(monkeypatch):
    monkeypatch.setattr(main.push,"ready",True)
    delivered=[]
    def sender(payload):
        delivered.append(payload["key"])

    async def scenario():
        assert main.queue_push(sender,{"key":"signal"})
        assert main.queue_push(sender,{"key":"execution-confirmed"})
        assert main.queue_push(sender,{"key":"tp-1"})
        await asyncio.wait_for(asyncio.gather(*list(main._push_delivery_tasks)),2)
    asyncio.run(scenario())
    assert delivered==["signal","execution-confirmed","tp-1"]


def test_push_disabled_does_not_schedule_background_work(monkeypatch):
    monkeypatch.setattr(main.push,"ready",False)
    async def scenario():
        assert main.queue_push(lambda payload: None,{"key":"x"}) is False
        assert not main._push_delivery_tasks
    asyncio.run(scenario())

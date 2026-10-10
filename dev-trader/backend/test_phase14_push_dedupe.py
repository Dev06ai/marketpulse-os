"""Original Phase 12/14: high-signal FCM notifications without duplicates or secrets."""
from app import push


class FakeMessaging:
    def __init__(self):
        self.messages=[]
        self.fail_for=set()
    def Notification(self, **kwargs):
        return kwargs
    def Message(self, **kwargs):
        return kwargs
    def send(self, message):
        if message["token"] in self.fail_for:
            raise ValueError("private auth token SUPERSECRET")
        self.messages.append(message)
        return "accepted"


def configured(monkeypatch):
    monkeypatch.setenv("PUSH_ENABLED", "false")
    client=FakeMessaging()
    service=push.PushService()
    service.ready=True
    service.tokens.update({"phone-one","phone-two"})
    monkeypatch.setattr(push,"messaging",client)
    return service,client


def test_developing_opportunity_deduplicates_per_device(monkeypatch):
    service,client=configured(monkeypatch)
    event={"key":"sfp:daily-low:abc","title":"BTC SFP","body":"Watching reclaim"}
    service.send_opportunity(event)
    service.send_opportunity(event)
    assert len(client.messages)==2
    assert {m["token"] for m in client.messages}=={"phone-one","phone-two"}
    service.send_opportunity({**event,"key":"sfp:daily-low:xyz"})
    assert len(client.messages)==4


def test_failed_device_delivery_remains_retryable_and_error_is_redacted(monkeypatch):
    service,client=configured(monkeypatch)
    client.fail_for.add("phone-two")
    event={"key":"breakout:resistance-1","title":"BTC breakout","body":"Checking hold"}
    service.send_opportunity(event)
    assert len(client.messages)==1
    assert service.last_error=="FCM opportunity delivery failed: ValueError"
    assert "SUPERSECRET" not in service.last_error
    client.fail_for.clear()
    service.send_opportunity(event)
    assert len(client.messages)==2
    assert client.messages[-1]["token"]=="phone-two"


def test_trade_lifecycle_distinct_keys_are_never_suppressed(monkeypatch):
    service,client=configured(monkeypatch)
    base={"direction":"LONG","setup":"Bullish SFP","price":100000,
          "signal_id":"test-sfp"}
    service.send_trade_event({**base,"key":"OPEN:1","type":"EXECUTION_OPEN"})
    service.send_trade_event({**base,"key":"OPEN:1","type":"EXECUTION_OPEN"})
    service.send_trade_event({**base,"key":"TP1:1","type":"TP1_HIT"})
    service.send_trade_event({**base,"key":"CLOSE:1","type":"EXECUTION_CLOSED"})
    assert len(client.messages)==6


def test_signal_duplicate_suppression_does_not_block_distinct_signals(monkeypatch):
    service,client=configured(monkeypatch)
    signal={"id":"sig-1","direction":"SHORT","setup":"SFP","trade_style":"SWING",
            "entry":100000.0,"stop":101000.0,"target1":98000.0,
            "target2":97000.0,"rr":3.0,"evidence":{}}
    service.send_signal(signal)
    service.send_signal(signal)
    service.send_signal({**signal,"id":"sig-2"})
    assert len(client.messages)==4


def test_cache_is_bounded_and_clock_allows_expiry(monkeypatch):
    service,client=configured(monkeypatch)
    clock=[100000.0]
    monkeypatch.setattr(push.time,"monotonic",lambda:clock[0])
    event={"key":"level:one","title":"BTC level","body":"SFP watch"}
    service.send_opportunity(event)
    assert len(client.messages)==2
    clock[0]+=901
    service.send_opportunity(event)
    assert len(client.messages)==4
    for i in range(1100):
        service._notification_sent("phone-one","opportunity",str(i))
    assert len(service._sent_notifications)<=1024


def test_distinct_management_actions_on_same_signal_are_delivered(monkeypatch):
    service,client=configured(monkeypatch)
    signal={"id":"pos-1","evidence":{"position_management":{
        "from_direction":"LONG","to_direction":"LONG",
        "type":"STOP_ADJUSTMENT","status":"PROTECTION","action":"Tighten stop",
        "open_pnl_r":1.5,
    }}}
    service.send_signal(signal)
    service.send_signal(signal)
    signal["evidence"]["position_management"] = {
        **signal["evidence"]["position_management"], "action":"Exit invalidated position",
    }
    service.send_signal(signal)
    assert len(client.messages)==4

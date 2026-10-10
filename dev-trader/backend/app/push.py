import os,json,time
firebase_admin=credentials=messaging=None

class PushService:
    def __init__(self):
        global firebase_admin, credentials, messaging
        self.tokens=set(); self.ready=False
        self.last_test_ts=None; self.last_test_sent=0; self.last_error=None
        # In-process, per-device dedupe. A failed send is never cached.
        # Bounded memory: do not let arbitrary alert IDs exhaust free hosting.
        self._sent_notifications = {}
        if os.getenv("PUSH_ENABLED","false").lower()=="true" and os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON"):
            try:
                import firebase_admin
                from firebase_admin import credentials, messaging
                data=json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT_JSON"])
                if not firebase_admin._apps: firebase_admin.initialize_app(credentials.Certificate(data))
                self.ready=True
            except Exception as exc:
                self.last_error = "FCM initialization failed: " + type(exc).__name__
    def _should_notify(self, token, family, key, quiet_seconds):
        if not key:
            return True
        now = time.monotonic()
        cache_key = (token, family, str(key))
        previous = self._sent_notifications.get(cache_key)
        return previous is None or now - previous >= quiet_seconds

    def _notification_sent(self, token, family, key):
        if not key:
            return
        now = time.monotonic()
        if len(self._sent_notifications) >= 1024:
            # Purge old values first, then evict one oldest key if needed.
            self._sent_notifications = {
                k: v for k, v in self._sent_notifications.items()
                if now-v < 24*3600
            }
            if len(self._sent_notifications) >= 1024:
                oldest = min(self._sent_notifications, key=self._sent_notifications.get)
                self._sent_notifications.pop(oldest, None)
        self._sent_notifications[(token, family, str(key))] = now

    def register(self,token):
        if token: self.tokens.add(token)

    def status(self):
        return {
            "enabled": os.getenv("PUSH_ENABLED","false").lower()=="true",
            "firebase_ready": self.ready,
            "registered_tokens": len(self.tokens),
            "test_available": bool(self.ready and messaging),
            "last_test_ts": self.last_test_ts,
            "last_test_sent": self.last_test_sent,
            "last_error": self.last_error,
        }

    def send_test(self, token=None):
        if token:
            self.tokens.add(token)
        self.last_test_ts = __import__("time").time_ns() // 1_000_000
        self.last_test_sent = 0
        self.last_error = None
        if not (self.ready and messaging):
            self.last_error = "Firebase/FCM is not configured on the backend."
            return {"sent": 0, "ready": False, "error": self.last_error}
        errors = []
        for tok in list(self.tokens):
            try:
                messaging.send(messaging.Message(
                    token=tok,
                    notification=messaging.Notification(
                        title="Dev Trader System Check",
                        body="FCM test accepted by the backend."
                    ),
                    data={"type":"system_check","test_id":str(self.last_test_ts)}
                ))
                self.last_test_sent += 1
            except Exception as exc:
                errors.append(type(exc).__name__)
        if errors:
            self.last_error = "; ".join(errors[:3])
        return {"sent": self.last_test_sent, "ready": True, "error": self.last_error}

    def send_signal(self,signal):
        if not (self.ready and messaging): return
        management=signal.get("evidence", {}).get("position_management") or {}
        if management:
            title=f"MANAGE {management.get('from_direction','')} → {management.get('to_direction','')}"
            body=f"{management.get('status','REVERSAL')} • {management.get('open_pnl_direction','FLAT')} {management.get('open_pnl_r',0):.2f}R • {management.get('action','Reassess position')}"
        else:
            style = str(signal.get("trade_style", "SCALP")).upper()
            title=f"BTC {signal['direction']} • {style} • {signal['setup']}"
            body=f"{style} · Entry {signal['entry']:.2f} · SL {signal['stop']:.2f} · TP1 {signal['target1']:.2f} · TP2 {signal['target2']:.2f} · R:R {signal['rr']:.2f}"
        signal_id = str(signal.get("id") or "")
        # Management actions for the same position may legitimately change.
        # Dedupe ordinary repeated signals, not distinct protective actions.
        dedupe_key = (
            signal_id + ":" + str(management.get("type") or "") +
            ":" + str(management.get("status") or "") +
            ":" + str(management.get("action") or "")
        ) if management else signal_id
        for token in list(self.tokens):
            if not self._should_notify(token, "signal", dedupe_key, 900):
                continue
            try:
                messaging.send(messaging.Message(
                    token=token,
                    notification=messaging.Notification(title=title, body=body),
                    data={"type":"trade_signal","signal_id":signal_id,
                          "management_type": management.get("type","")}))
                self._notification_sent(token, "signal", dedupe_key)
            except Exception as exc:
                self.last_error="FCM signal delivery failed: " + type(exc).__name__

    def send_trade_event(self, event: dict):
        if not (self.ready and messaging):
            return
        event_type = str(event.get("type") or "TRADE_EVENT").upper()
        direction = str(event.get("direction") or "BTC").upper()
        setup = str(event.get("setup") or "setup")
        price = event.get("price")
        level = event.get("level")
        if event_type == "TP1_HIT":
            title = f"BTC {direction} • TP1 HIT"
        elif event_type == "TP2_HIT":
            title = f"BTC {direction} • TP2 HIT"
        elif event_type == "SL_HIT":
            title = f"BTC {direction} • STOP / INVALIDATION"
        else:
            title = f"BTC {direction} • {event_type.replace('_', ' ')}"
        body = f"{setup} • price {price:.2f}" if isinstance(price, (int, float)) else setup
        if isinstance(level, (int, float)):
            body += f" • level {level:.2f}"
        if event.get("note"):
            body += f" • {event['note']}"
        event_key = str(event.get("key") or "")
        for token in list(self.tokens):
            if not self._should_notify(token, "trade_event", event_key, 86400):
                continue
            try:
                messaging.send(messaging.Message(
                    token=token,
                    notification=messaging.Notification(title=title, body=body),
                    data={
                        "type": "trade_event",
                        "event_key": event_key,
                        "event_type": event_type,
                        "signal_id": str(event.get("signal_id") or ""),
                    },
                ))
                self._notification_sent(token, "trade_event", event_key)
            except Exception as exc:
                self.last_error="FCM trade event delivery failed: " + type(exc).__name__

    def send_opportunity(self, alert: dict):
        if not (self.ready and messaging):
            return
        title = str(alert.get("title") or "Dev Trader Opportunity")
        body = str(alert.get("body") or "Opportunity developing.")
        data = {"type": "opportunity_alert", "alert_key": str(alert.get("key") or "")}
        alert_key = str(alert.get("key") or "")
        for token in list(self.tokens):
            if not self._should_notify(token, "opportunity", alert_key, 900):
                continue
            try:
                messaging.send(messaging.Message(
                    token=token,
                    notification=messaging.Notification(title=title, body=body),
                    data=data,
                ))
                self._notification_sent(token, "opportunity", alert_key)
            except Exception as exc:
                self.last_error = "FCM opportunity delivery failed: " + type(exc).__name__

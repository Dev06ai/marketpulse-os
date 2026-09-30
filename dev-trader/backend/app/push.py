import os,json
try:
    import firebase_admin
    from firebase_admin import credentials,messaging
except Exception:
    firebase_admin=credentials=messaging=None

class PushService:
    def __init__(self):
        self.tokens=set(); self.ready=False
        self.last_test_ts=None; self.last_test_sent=0; self.last_error=None
        if os.getenv("PUSH_ENABLED","false").lower()=="true" and firebase_admin and os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON"):
            try:
                data=json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT_JSON"])
                if not firebase_admin._apps: firebase_admin.initialize_app(credentials.Certificate(data))
                self.ready=True
            except Exception as exc: print(f"FCM disabled: {exc}")
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
                errors.append(str(exc))
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
            title=f"BTC {signal['direction']} • {signal['setup']}"
            body=f"Entry {signal['entry']:.2f} · SL {signal['stop']:.2f} · R:R {signal['rr']:.2f}"
        for token in list(self.tokens):
            try:
                messaging.send(messaging.Message(
                    token=token,
                    notification=messaging.Notification(title=title, body=body),
                    data={"type":"trade_signal","signal_id":signal["id"],
                          "management_type": management.get("type","")}))
            except Exception as exc:
                self.last_error=str(exc)
                print(f"FCM send failed: {exc}")

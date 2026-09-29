import os,json
try:
    import firebase_admin
    from firebase_admin import credentials,messaging
except Exception:
    firebase_admin=credentials=messaging=None

class PushService:
    def __init__(self):
        self.tokens=set(); self.ready=False
        if os.getenv("PUSH_ENABLED","false").lower()=="true" and firebase_admin and os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON"):
            try:
                data=json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT_JSON"])
                if not firebase_admin._apps: firebase_admin.initialize_app(credentials.Certificate(data))
                self.ready=True
            except Exception as exc: print(f"FCM disabled: {exc}")
    def register(self,token):
        if token: self.tokens.add(token)
    def send_signal(self,signal):
        if not (self.ready and messaging): return
        for token in list(self.tokens):
            try:
                messaging.send(messaging.Message(
                    token=token,
                    notification=messaging.Notification(
                        title=f"BTC {signal['direction']} • {signal['setup']}",
                        body=f"Entry {signal['entry']:.2f} · SL {signal['stop']:.2f} · R:R {signal['rr']:.2f}"),
                    data={"type":"trade_signal","signal_id":signal["id"]}))
            except Exception as exc: print(f"FCM send failed: {exc}")

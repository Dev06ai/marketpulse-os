import base64
import hashlib
import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
UPDATES = PUBLIC / "updates"
PORT = int(os.environ.get("PORT", "10000"))
MAX_APK_BYTES = 50 * 1024 * 1024


def _safe_manifest():
    path = UPDATES / "latest.json"
    raw = path.read_bytes()
    if len(raw) > 32768:
        raise RuntimeError("manifest too large")
    data = json.loads(raw.decode("utf-8"))
    version = data.get("versionName", "")
    sha = str(data.get("sha256", "")).lower()
    apk_url = str(data.get("apkUrl", ""))
    if not version or len(sha) != 64:
        raise RuntimeError("invalid manifest")
    return raw, data, version, sha, apk_url


def _assembled_apk(version: str, expected_sha: str) -> bytes:
    folder = UPDATES / "apk_parts" / version
    parts = sorted(folder.glob("part*.b64"))
    if not parts:
        raise FileNotFoundError("release payload is not staged")
    encoded = b"".join(p.read_bytes().strip() for p in parts)
    payload = base64.b64decode(encoded, validate=True)
    if not payload or len(payload) > MAX_APK_BYTES:
        raise RuntimeError("invalid APK size")
    digest = hashlib.sha256(payload).hexdigest()
    if digest != expected_sha:
        raise RuntimeError("APK digest mismatch")
    return payload


class Handler(BaseHTTPRequestHandler):
    server_version = "NOVAUpdate/1.0"

    def _headers(self, code: int, content_type: str, length: int, cache: str):
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        self.end_headers()

    def _send(self, code: int, body: bytes, content_type: str, cache: str, head=False):
        self._headers(code, content_type, len(body), cache)
        if not head:
            self.wfile.write(body)

    def _handle(self, head=False):
        path = urlsplit(self.path).path
        try:
            if path == "/health":
                self._send(200, b"ok\n", "text/plain; charset=utf-8", "no-store", head)
                return
            if path == "/":
                body = (PUBLIC / "index.html").read_bytes()
                self._send(200, body, "text/html; charset=utf-8", "public, max-age=300", head)
                return
            if path == "/updates/latest.json":
                raw, _, _, _, _ = _safe_manifest()
                self._send(200, raw, "application/json; charset=utf-8", "no-store", head)
                return
            if path.startswith("/updates/NOVA-") and path.endswith(".apk"):
                raw, data, version, sha, apk_url = _safe_manifest()
                expected_path = f"/updates/NOVA-{version}.apk"
                if path != expected_path:
                    self._send(404, b"not found\n", "text/plain; charset=utf-8", "no-store", head)
                    return
                expected_host = self.headers.get("Host", "")
                expected_url = f"https://{expected_host}{expected_path}"
                if apk_url != expected_url:
                    raise RuntimeError("manifest APK URL does not match this service")
                payload = _assembled_apk(version, sha)
                self._send(200, payload, "application/vnd.android.package-archive", "public, max-age=31536000, immutable", head)
                return
            self._send(404, b"not found\n", "text/plain; charset=utf-8", "no-store", head)
        except Exception as exc:
            self.log_error("request failed: %s", exc)
            self._send(503, b"release unavailable\n", "text/plain; charset=utf-8", "no-store", head)

    def do_GET(self):
        self._handle(False)

    def do_HEAD(self):
        self._handle(True)

    def do_POST(self):
        self._send(405, b"method not allowed\n", "text/plain; charset=utf-8", "no-store")

    do_PUT = do_POST
    do_PATCH = do_POST
    do_DELETE = do_POST

    def log_message(self, fmt, *args):
        # Keep logs minimal; no request bodies, credentials or query-string contents are processed.
        super().log_message(fmt, *args)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"NOVA update service listening on {PORT}", flush=True)
    server.serve_forever()

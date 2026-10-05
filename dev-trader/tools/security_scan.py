#!/usr/bin/env python3
"""Fail CI if Dev Trader contains likely credentials or private keys.

The scanner deliberately reports only the file/commit and rule name. It never
prints the suspected secret value into CI logs.
"""
from __future__ import annotations

import argparse
import math
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

DIRECT_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("private-key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----")),
    ("aws-access-key", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("github-token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b")),
    ("github-fine-grained-token", re.compile(r"\bgithub_pat_[A-Za-z0-9_]{30,}\b")),
    ("stripe-secret", re.compile(r"\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b")),
    ("openai-secret", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b")),
    ("google-api-key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("sendgrid-key", re.compile(r"\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b")),
    ("slack-token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{20,}\b")),
    ("twilio-api-key", re.compile(r"\bSK[a-fA-F0-9]{32}\b")),
]

SENSITIVE_NAMES = {
    "BITGET_API_KEY", "BITGET_API_SECRET", "BITGET_API_PASSPHRASE",
    "OPENAI_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_API_KEY",
    "AWS_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "SENDGRID_API_KEY",
    "TWILIO_AUTH_TOKEN", "JWT_SECRET", "JWT_SIGNING_SECRET",
    "DATABASE_URL", "POSTGRES_URL", "POSTGRESQL_URL", "MONGODB_URI",
    "SUPABASE_SERVICE_ROLE_KEY", "FIREBASE_SERVICE_ACCOUNT_JSON",
    "CLIENT_SECRET", "OAUTH_CLIENT_SECRET", "PRIVATE_KEY",
    "DEV_TRADER_ACCESS_TOKEN", "DEV_TRADER_PAIRING_SECRET",
}

ASSIGNMENT = re.compile(
    r"(?P<name>" + "|".join(sorted(map(re.escape, SENSITIVE_NAMES), key=len, reverse=True)) +
    r")\s*(?:=|:)\s*[\"']?(?P<value>[^\"'\s,#}]{6,})",
    re.IGNORECASE,
)

PLACEHOLDER_WORDS = {
    "example", "placeholder", "changeme", "change-me", "replace-me", "replace_me",
    "your-key", "your_key", "your-secret", "your_secret", "dummy", "sample",
    "redacted", "not-a-secret", "none", "null", "false", "true",
}

SAFE_CODE_MARKERS = (
    "os.getenv", "os.environ", "getenv(", "system.getenv", "buildconfig.",
    "secrets.", "${{", "${", "process.env", "environ[", "environ.get",
)

TEXT_SUFFIXES = {
    ".py", ".kt", ".kts", ".java", ".js", ".ts", ".tsx", ".jsx", ".json",
    ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".sh", ".md", ".txt",
    ".xml", ".properties", ".gradle", ".html", ".css", ".env", "",
}

# Generated/binary/package content does not belong in the source scan.
SKIP_PARTS = {".git", "node_modules", "build", ".gradle", "__pycache__", ".pytest_cache"}


def run_git(*args: str) -> str:
    return subprocess.check_output(
        ["git", "-C", str(ROOT), *args], text=True, errors="replace",
        stderr=subprocess.DEVNULL,
    )


def entropy(value: str) -> float:
    if not value:
        return 0.0
    counts = {c: value.count(c) for c in set(value)}
    total = len(value)
    return -sum((n / total) * math.log2(n / total) for n in counts.values())


def placeholder(value: str) -> bool:
    v = value.strip().strip("\"'").lower()
    if not v:
        return True
    if any(marker in v for marker in SAFE_CODE_MARKERS):
        return True
    if v in PLACEHOLDER_WORDS:
        return True
    if any(word in v for word in ("placeholder", "changeme", "replace", "example", "redact", "dummy")):
        return True
    if set(v) <= {"x", "*", "-", "_", "."}:
        return True
    return False


def inspect_text(text: str) -> set[str]:
    hits: set[str] = set()
    for name, pattern in DIRECT_RULES:
        if pattern.search(text):
            hits.add(name)
    for match in ASSIGNMENT.finditer(text):
        value = match.group("value")
        if placeholder(value):
            continue
        # Literal credentials are usually long/high-entropy. The lower bound
        # still catches short exchange passphrases without flagging code refs.
        if len(value) >= 10 or entropy(value) >= 3.0:
            hits.add("literal-" + match.group("name").upper())
    return hits


def tracked_files() -> list[Path]:
    files: list[Path] = []
    for rel in run_git("ls-files", "-z").split("\0"):
        if not rel:
            continue
        p = ROOT / rel
        if any(part in SKIP_PARTS for part in p.parts):
            continue
        if p.suffix.lower() not in TEXT_SUFFIXES and p.name not in {"Dockerfile", ".gitignore"}:
            continue
        if p.exists() and p.is_file() and p.stat().st_size <= 2_000_000:
            files.append(p)
    return files


def scan_worktree() -> list[str]:
    findings: list[str] = []
    for path in tracked_files():
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        hits = inspect_text(text)
        if hits:
            findings.append(f"{path.relative_to(ROOT)} :: {', '.join(sorted(hits))}")
    return findings


def scan_history() -> list[str]:
    """Scan patch history without ever echoing a matched secret."""
    try:
        history = run_git(
            "log", "--all", "--no-ext-diff", "--no-color", "--format=@@COMMIT:%H", "-p"
        )
    except subprocess.CalledProcessError:
        return ["git-history :: unable to read history"]

    findings: list[str] = []
    commit = "unknown"
    current_file = "unknown"
    reported: set[tuple[str, str, str]] = set()
    for raw in history.splitlines():
        if raw.startswith("@@COMMIT:"):
            commit = raw.split(":", 1)[1][:12]
            continue
        if raw.startswith("+++ b/"):
            current_file = raw[6:]
            continue
        if not raw or raw[0] not in "+-" or raw.startswith(("+++", "---")):
            continue
        hits = inspect_text(raw[1:])
        for hit in hits:
            key = (commit, current_file, hit)
            if key in reported:
                continue
            reported.add(key)
            findings.append(f"commit {commit} :: {current_file} :: {hit}")
    return findings


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--history", action="store_true", help="also scan all reachable Git patch history")
    args = parser.parse_args()

    findings = scan_worktree()
    if args.history:
        findings.extend(scan_history())

    if findings:
        print("SECURITY SCAN FAILED. Potential secret material was detected.")
        print("Values are intentionally hidden; rotate any real credential before removing it from history.")
        for item in findings[:100]:
            print(" -", item)
        if len(findings) > 100:
            print(f" - ... and {len(findings) - 100} more finding(s)")
        return 1

    print("Security scan passed: no known secret signatures or literal sensitive assignments detected.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

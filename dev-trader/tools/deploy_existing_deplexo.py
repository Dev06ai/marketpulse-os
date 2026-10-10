"""Opt-in, fail-closed CI upload/redeploy of the EXISTING Deplexo ZIP app.

Uses only GitHub Actions secrets for authentication. NO credentials in code,
artifact logs, URLs, or ChatGPT. See dev-trader/DEPLEXO_GITHUB_CI_SETUP.md.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import UUID
from zipfile import ZipFile

BASE_URL = "https://deplexo.com/user/api/v1"
REQUIRED = {"Dockerfile", "app/main.py", "app/build-manifest.json", "requirements-core.txt"}


class DeploymentError(RuntimeError):
    pass


def verify_archive(path: Path, expected_commit: str | None = None) -> dict:
    if not path.is_file() or not 0 < path.stat().st_size <= 50 * 1024 * 1024:
        raise DeploymentError("Missing or oversized verified backend archive")
    with ZipFile(path) as z:
        if z.testzip() is not None:
            raise DeploymentError("Corrupt ZIP release artifact")
        members = z.namelist()
        if not REQUIRED.issubset(members):
            raise DeploymentError("Backend ZIP lacks required release files")
        if len(members) != len(set(members)):
            raise DeploymentError("Duplicate source paths in release ZIP")
        info = json.loads(z.read("app/build-manifest.json"))
        revision = str(info.get("source_commit") or "")
        if expected_commit and revision != expected_commit:
            raise DeploymentError("Release source commit does not equal workflow commit")
        if len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
            raise DeploymentError("Missing valid committed source identity")
        digest = hashlib.sha256()
        for name in sorted(members):
            if name == "app/build-manifest.json":
                continue
            digest.update(name.encode() + b"\0" + z.read(name) + b"\0")
        if digest.hexdigest() != info.get("content_sha256"):
            raise DeploymentError("Backend ZIP content digest verification failed")
    return {"source_commit": revision, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise DeploymentError("Deplexo API redirected; refusing to forward credentials")


def api_request(token: str, path: str, method: str = "GET", data: bytes | None = None,
                content_type: str = "application/json", extra_headers: dict | None = None):
    if not token:
        raise DeploymentError("Missing Deplexo API credential in GitHub Actions secret")
    if not path.startswith("/") or "://" in path:
        raise DeploymentError("Unexpected Deplexo API path")
    headers = {
        "Authorization": "Bearer " + token,
        "Accept": "application/json",
        "User-Agent": "KYVORIQ-Verified-CI/1.0",
    }
    if data is not None:
        headers["Content-Type"] = content_type
        headers["Content-Length"] = str(len(data))
    headers.update(extra_headers or {})
    req = Request(BASE_URL + path, data=data, headers=headers, method=method)
    try:
        with build_opener(NoRedirects()).open(req, timeout=45) as response:
            raw = response.read(2 * 1024 * 1024)
    except HTTPError as exc:
        raise DeploymentError("Deplexo rejected operation with HTTP " + str(exc.code)) from None
    except URLError:
        raise DeploymentError("Deplexo connection error; inspect the app before retrying") from None
    try:
        return json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise DeploymentError("Deplexo API returned invalid JSON") from exc


def valid_uuid(value: str) -> str:
    try:
        return str(UUID(str(value)))
    except ValueError as exc:
        raise DeploymentError("Invalid existing Deplexo application/deployment UUID") from exc


def deploy_existing_zip(path: Path, expected_commit: str, token: str, app_id: str):
    info = verify_archive(path, expected_commit)
    app_id = valid_uuid(app_id)
    # NOTE: This is strictly a source upload and update of an EXISTING app.
    # NEVER call POST /deploy: that would create a second app and volume.
    source_response = api_request(
        token, "/sources", "POST", path.read_bytes(), "application/zip",
        {"Content-Disposition": 'attachment; filename="KYVORIQ-deplexo-backend.zip"'},
    )
    source = source_response.get("source") if isinstance(source_response.get("source"), dict) else {}
    source_id = source_response.get("id") or source_response.get("sourceId") or source.get("id")
    if not source_id:
        raise DeploymentError("Upload succeeded without a source ID; inspect Deplexo before retrying")
    source_id = valid_uuid(source_id)
    deployed = api_request(
        token, "/apps/" + app_id + "/restart", "POST",
        json.dumps({"sourceId": source_id}).encode("utf-8"),
    )
    deploy_id = deployed.get("deploymentId") or deployed.get("id")
    if not deploy_id:
        raise DeploymentError("Redeploy result is ambiguous; inspect Deplexo before retrying")
    deploy_id = valid_uuid(deploy_id)
    print("Deplexo accepted EXISTING-app rollout:", deploy_id)
    deadline = time.monotonic() + 900
    while time.monotonic() < deadline:
        time.sleep(12)
        result = api_request(token, "/deployments/" + deploy_id + "/logs")
        details = result.get("deployment") if isinstance(result.get("deployment"), dict) else result
        state = str(details.get("status") or "").strip().lower()
        if state in {"success", "succeeded", "ready", "running", "deployed"}:
            print("Deplexo reports successful deployment of source:", info["source_commit"])
            return
        if state in {"failed", "error", "cancelled", "canceled"}:
            raise DeploymentError("Deplexo build/deployment failed; previous image may still be running")
    raise DeploymentError("Deployment verification timed out; inspect Deplexo before retrying")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--expected-commit", required=True)
    parser.add_argument("--deploy", action="store_true", help="Requires explicit CI opt-in and secrets")
    args = parser.parse_args()
    info = verify_archive(args.archive, args.expected_commit)
    print("Verified committed backend ZIP SHA-256:", info["sha256"])
    if args.deploy:
        deploy_existing_zip(args.archive, args.expected_commit,
                            os.getenv("DEPLEXO_TOKEN", ""), os.getenv("DEPLEXO_APP_ID", ""))
    else:
        print("Verification only. No Deplexo changes performed.")


if __name__ == "__main__":
    main()

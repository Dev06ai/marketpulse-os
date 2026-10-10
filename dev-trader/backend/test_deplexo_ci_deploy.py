"""CI rollout must never create another app, accept unverified source, or leak secrets."""
import hashlib
import importlib.util
import json
from pathlib import Path
from zipfile import ZipFile

import pytest

SOURCE = Path(__file__).resolve().parents[1] / "tools" / "deploy_existing_deplexo.py"
SPEC = importlib.util.spec_from_file_location("deplexo_ci", SOURCE)
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def make_archive(path: Path, commit="a"*40, alter=False):
    files = {
        "Dockerfile": b"FROM python:3.12-slim\n",
        "app/main.py": b"print('safe')\n",
        "requirements-core.txt": b"pytest\n",
    }
    digest = hashlib.sha256()
    for name, data in sorted(files.items()):
        digest.update(name.encode() + b"\0" + data + b"\0")
    manifest = {"source_commit": commit, "content_sha256": digest.hexdigest()}
    if alter:
        manifest["content_sha256"] = "0"*64
    files["app/build-manifest.json"] = json.dumps(manifest).encode()
    with ZipFile(path, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)


def test_verified_zip_requires_exact_commit_and_digest(tmp_path):
    p = tmp_path / "backend.zip"
    make_archive(p)
    assert module.verify_archive(p, "a"*40)["source_commit"] == "a"*40
    with pytest.raises(module.DeploymentError, match="source commit"):
        module.verify_archive(p, "b"*40)
    make_archive(p, alter=True)
    with pytest.raises(module.DeploymentError, match="digest verification"):
        module.verify_archive(p, "a"*40)


def test_broken_zip_and_invalid_target_are_rejected(tmp_path):
    p = tmp_path / "broken.zip"
    p.write_bytes(b"not a zip")
    with pytest.raises(Exception):
        module.verify_archive(p)
    with pytest.raises(module.DeploymentError, match="Invalid existing"):
        module.valid_uuid("../another-tenant")


def test_refuse_untrusted_api_path():
    with pytest.raises(module.DeploymentError, match="Unexpected"):
        module.api_request("fake", "https://malicious.example.invalid", "POST", b"{}")


def test_never_upload_if_credential_or_target_missing(tmp_path, monkeypatch):
    p = tmp_path / "backend.zip"
    make_archive(p)
    attempts = []
    monkeypatch.setattr(module, "api_request", lambda *a, **kw: attempts.append(a))
    with pytest.raises(module.DeploymentError, match="Invalid existing"):
        module.deploy_existing_zip(p, "a"*40, "fake", "")
    assert not attempts

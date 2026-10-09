"""Package only committed backend source, with an auditable source manifest.

Run the tests/security checks first. This tool refuses uncommitted backend edits.
It never reads .env files, runtime data, credentials or untracked source.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import zipfile

PREFIX = "dev-trader/backend/"
ROOT_FILES = {"Dockerfile", "requirements-core.txt", "requirements.txt", ".dockerignore", ".env.example"}


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args])


def package(root: Path, destination: Path) -> dict:
    commit = git(root, "rev-parse", "HEAD").decode().strip()
    dirty = git(root, "status", "--porcelain", "--untracked-files=all", "--", PREFIX)
    if dirty.strip():
        raise ValueError("Commit backend changes before packaging a release.")
    entries = {}
    for raw in git(root, "ls-tree", "-r", "-z", "HEAD", "--", PREFIX).split(b"\0"):
        if not raw:
            continue
        metadata, path = raw.split(b"\t", 1)
        relative = path.decode()[len(PREFIX):]
        if relative not in ROOT_FILES and not relative.startswith(("app/", "knowledge/")):
            continue
        if metadata.split()[0] != b"100644":
            raise ValueError("Release source must contain regular non-executable files only: " + relative)
        if relative == "app/build-manifest.json":
            continue
        entries[relative] = git(root, "show", commit + ":" + path.decode())
    if not {"Dockerfile", "app/main.py", "requirements-core.txt"} <= entries.keys():
        raise ValueError("Backend release is missing required root files.")
    digest = hashlib.sha256()
    for name, content in sorted(entries.items()):
        digest.update(name.encode() + b"\0" + content + b"\0")
    manifest = {"schema_version": 1, "source_commit": commit, "content_sha256": digest.hexdigest(),
                "digest_scope": "sorted archive paths and bytes, excluding this manifest; NUL separated"}
    entries["app/build-manifest.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in sorted(entries.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, content)
    with zipfile.ZipFile(destination) as archive:
        assert archive.testzip() is None
        assert "deplexo.yaml" not in archive.namelist()
    return dict(manifest, archive_sha256=hashlib.sha256(destination.read_bytes()).hexdigest(),
                file_count=len(entries), archive=str(destination.resolve()))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    print(json.dumps(package(root, args.output), indent=2))

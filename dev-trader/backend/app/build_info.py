"""Non-secret source identity stamped into a verified release archive."""
import json
from pathlib import Path
import re


def read_build_info(path: Path | None = None) -> dict:
    unknown = {"status": "UNATTESTED", "source_commit": None, "content_sha256": None}
    try:
        path = path or Path(__file__).with_name("build-manifest.json")
        if path.stat().st_size > 4096:
            return unknown
        data = json.loads(path.read_text(encoding="utf-8"))
        commit, digest = data.get("source_commit"), data.get("content_sha256")
        if (not isinstance(commit, str) or not re.fullmatch(r"[0-9a-f]{40}", commit)
                or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest)):
            return unknown
        return {"status": "RELEASE_MANIFEST", "source_commit": commit, "content_sha256": digest}
    except (OSError, ValueError, TypeError, AttributeError):
        return unknown


BUILD_INFO = read_build_info()

import json

import pytest

from app.build_info import read_build_info


def test_unstamped_source_never_claims_a_deployed_commit(tmp_path):
    assert read_build_info(tmp_path / "absent.json") == {
        "status": "UNATTESTED", "source_commit": None, "content_sha256": None}


@pytest.mark.parametrize("value", [[], {"source_commit": "HEAD"}, {"source_commit": 1}, "bad", None])
def test_malformed_release_metadata_stays_unknown(tmp_path, value):
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    assert read_build_info(path)["status"] == "UNATTESTED"


def test_public_identity_is_limited_to_valid_nonsecret_hashes(tmp_path):
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps({"source_commit": "a"*40, "content_sha256": "b"*64,
                                "unreviewed_field": "must not be exposed"}), encoding="utf-8")
    assert read_build_info(path) == {"status": "RELEASE_MANIFEST", "source_commit": "a"*40,
                                    "content_sha256": "b"*64}

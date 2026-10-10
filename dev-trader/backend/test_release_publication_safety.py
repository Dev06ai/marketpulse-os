"""KYVORIQ private-first releases must never publish an APK on ordinary pushes."""
from pathlib import Path


WORKFLOW = (Path(__file__).resolve().parents[2] /
            ".github" / "workflows" / "dev-trader.yml")


def _workflow_text():
    return WORKFLOW.read_text(encoding="utf-8")


def test_public_apk_publication_requires_explicit_manual_dispatch():
    text = _workflow_text()
    assert "publish_android:" in text
    assert "default: false" in text
    publish = text.split("  publish-release:", 1)[1]
    condition = next(line for line in publish.splitlines()
                     if line.strip().startswith("if:"))
    assert "github.event_name == 'workflow_dispatch'" in condition
    assert "inputs.publish_android == true" in condition
    assert "github.ref == 'refs/heads/dev-trader-v1'" in condition
    assert "needs.android.outputs.android_changed == 'true'" in condition
    assert "github.event_name != 'pull_request'" not in condition


def test_github_read_only_default_and_privileged_publish_exception():
    text = _workflow_text()
    default_permissions = text.split("\npermissions:", 1)[1].split("\njobs:", 1)[0]
    assert "contents: read" in default_permissions
    assert "contents: write" not in default_permissions
    publish = text.split("  publish-release:", 1)[1]
    assert "contents: write" in publish.split("    concurrency:", 1)[0]


def test_apk_manifest_update_remains_inside_explicit_release_job():
    publish = _workflow_text().split("  publish-release:", 1)[1]
    assert "gh release create" in publish
    assert "Publish verified update manifest" in publish
    assert "git push origin dev-trader-v1" in publish

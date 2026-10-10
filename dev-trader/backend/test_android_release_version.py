"""Release metadata contract: published APK tag and manifest must stay aligned."""
import importlib.util
from pathlib import Path
import pytest

MODULE = Path(__file__).resolve().parents[1] / "tools" / "android_release_version.py"
SPEC = importlib.util.spec_from_file_location("android_release_version", MODULE)
assert SPEC is not None and SPEC.loader is not None
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def gradle(code="133", name="0.21.8"):
    return (
        'versionCode = (providers.gradleProperty("devTraderVersionCode").orNull ?: "' + code + '").toInt()\n'
        'versionName = providers.gradleProperty("devTraderVersionName").orNull ?: "' + name + '"\n'
    )


def test_release_tag_and_url_match_gradle_defaults_and_published_manifest():
    result = module.release_metadata(gradle(), {"versionCode": 131})
    assert result["version_code"] == "133"
    assert result["version_name"] == "0.21.8"
    assert result["tag"] == "dev-trader-v0.21.8-133"
    assert result["apk_url"].endswith("/dev-trader-v0.21.8-133/app-release.apk")


@pytest.mark.parametrize("code,previous", [(131,131),(130,131),(133,133)])
def test_published_apk_version_cannot_be_reused_or_downgraded(code,previous):
    with pytest.raises(ValueError,match="must be greater"):
        module.release_metadata(gradle(str(code)),{"versionCode":previous})


@pytest.mark.parametrize("code,name", [
    ("abc","0.21.8"),("133","bad-version"),("-1","0.21.8"),
    ("133","0.21.8; echo hacked"),
])
def test_invalid_gradle_defaults_are_rejected(code,name):
    with pytest.raises(ValueError,match="Missing or invalid"):
        module.release_metadata(gradle(code,name),{"versionCode":131})


def test_invalid_or_missing_manifest_version_is_rejected():
    for manifest in ({}, {"versionCode": True}, {"versionCode": "131"}):
        with pytest.raises(ValueError,match="manifest lacks"):
            module.release_metadata(gradle(), manifest)


def test_current_repository_defaults_are_next_build_after_published():
    source = (MODULE.parents[1] / "android" / "app" / "build.gradle.kts").read_text()
    result = module.release_metadata(source, {"versionCode":131})
    assert result["tag"] == "dev-trader-v0.21.8-133"


def test_cli_writes_only_allowed_metadata_without_overwriting(tmp_path):
    source = tmp_path/"build.gradle.kts"
    source.write_text(gradle(),encoding="utf-8")
    published=tmp_path/"update.json"
    published.write_text('{"versionCode":131}',encoding="utf-8")
    output=tmp_path/"github_output"
    output.write_text("previous_flag=true\n",encoding="utf-8")
    assert module.main(["--gradle",str(source),"--current-manifest",str(published),
                        "--github-output",str(output)])==0
    result=output.read_text(encoding="utf-8")
    assert "previous_flag=true" in result
    assert "version_code=133\n" in result
    assert "tag=dev-trader-v0.21.8-133\n" in result
    assert "password" not in result.lower() and "owner_token" not in result.lower()

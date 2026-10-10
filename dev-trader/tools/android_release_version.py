"""Validate a *new* KYVORIQ Android release version before publication.

GitHub Actions obtains the version from the Gradle defaults used by both
debug and release builds, avoiding versionCode/tag/manifest disagreement.
Never modifies the published manifest or signs/publishes an APK itself.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


def release_metadata(gradle_text: str, current_manifest: dict) -> dict:
    def read_default(prop: str, pattern: str) -> str:
        found = re.search(
            r'providers\.gradleProperty\("' + re.escape(prop)
            + r'"\)\.orNull\s*\?:\s*"(' + pattern + r')"',
            gradle_text,
        )
        if not found:
            raise ValueError(f"Missing or invalid {prop} Gradle default")
        return found.group(1)

    code = int(read_default("devTraderVersionCode", r"[0-9]+"))
    name = read_default("devTraderVersionName", r"[0-9]+\.[0-9]+\.[0-9]+")
    previous = current_manifest.get("versionCode")
    if type(previous) is not int or previous < 1:
        raise ValueError("Published update manifest lacks a valid versionCode")
    if code <= previous:
        raise ValueError(
            f"Version code {code} must be greater than published {previous}; "
            "refusing to overwrite the previously released APK"
        )
    if code <= 0:
        raise ValueError("Invalid Android version code")
    tag = f"dev-trader-v{name}-{code}"
    return {
        "version_code": str(code),
        "version_name": name,
        "tag": tag,
        "apk_url": f"https://github.com/Dev06ai/marketpulse-os/releases/download/{tag}/app-release.apk",
        "notes": f"KYVORIQ {name} • verified Android reliability updates",
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gradle", type=Path, default=Path("dev-trader/android/app/build.gradle.kts"))
    parser.add_argument("--current-manifest", type=Path, default=Path("dev-trader/update.json"))
    parser.add_argument("--github-output", type=Path, required=True)
    args = parser.parse_args(argv)
    result = release_metadata(
        args.gradle.read_text(encoding="utf-8"),
        json.loads(args.current_manifest.read_text(encoding="utf-8")),
    )
    # The values consist solely of validated version literals and fixed text.
    with args.github_output.open("a", encoding="utf-8") as sink:
        for key, value in result.items():
            sink.write(f"{key}={value}\n")
    print(f"Validated new Android release: {result['tag']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Verify the *downloaded* KYVORIQ OTA APK against its immutable signed release.

Purely read-only. Does not access backend services, exchange APIs, credentials,
Firebase identities, subscriptions, or deployment operations.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import zipfile
from pathlib import Path

REPO = "Dev06ai/marketpulse-os"
PACKAGE = "com.devtrader.app"
SIGNER_SHA256 = "17e4c550aa235dae926058654f203ecae9d7b30b432bde9dc2c358e28360cbab"


def validated_release(manifest: dict, release: dict, apk: Path) -> tuple[int, str]:
    if type(manifest.get("enabled")) is not bool or manifest["enabled"] is not True:
        raise ValueError("OTA feed is not enabled; verify deliberate hold separately")
    version = manifest.get("versionCode")
    name = manifest.get("versionName")
    sha = manifest.get("sha256")
    if type(version) is not int or version < 1:
        raise ValueError("Invalid OTA versionCode")
    if not isinstance(name, str) or not re.fullmatch(r"\d+\.\d+\.\d+", name):
        raise ValueError("Invalid OTA versionName")
    if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{64}", sha):
        raise ValueError("Malformed OTA checksum")
    tag = f"dev-trader-v{name}-{version}"
    link = f"https://github.com/{REPO}/releases/download/{tag}/app-release.apk"
    if manifest.get("apkUrl") != link:
        raise ValueError("OTA destination does not match pinned GitHub release")
    if release.get("tag_name") != tag or release.get("draft") is not False:
        raise ValueError("Missing, draft, or unexpected OTA GitHub release")
    assets = [x for x in release.get("assets", [])
              if isinstance(x, dict) and x.get("name") == "app-release.apk"]
    if len(assets) != 1 or assets[0].get("browser_download_url") != link:
        raise ValueError("Release APK asset not uniquely identified")
    asset = assets[0]
    if not apk.is_file() or apk.stat().st_size < 100_000:
        raise ValueError("Downloaded APK missing or suspiciously small")
    if asset.get("size") != apk.stat().st_size:
        raise ValueError("Release metadata APK size mismatch")
    actual = hashlib.sha256(apk.read_bytes()).hexdigest()
    if actual != sha:
        raise ValueError("Downloaded APK differs from published updater checksum")
    if asset.get("digest") and asset["digest"] != f"sha256:{sha}":
        raise ValueError("GitHub asset digest differs from updater checksum")
    with zipfile.ZipFile(apk) as archive:
        if archive.testzip() is not None:
            raise ValueError("APK archive integrity failure")
        for item in archive.namelist():
            base = item.rsplit("/", 1)[-1].lower()
            if (base == "ui_preview.json" or base == ".env" or
                base.endswith((".jks", ".keystore", ".p12", ".pfx")) or
                "service-account" in base or "service_account" in base):
                raise ValueError("Unexpected sensitive/debug APK asset")
    return version, name


def validate_android_identity(apk: Path, version: int, name: str,
                              aapt: str, apksigner: str) -> None:
    badge = subprocess.check_output([aapt, "dump", "badging", str(apk)],
                                    text=True, timeout=30, stderr=subprocess.DEVNULL)
    match = re.search(
        r"^package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'",
        badge, re.MULTILINE,
    )
    if not match or match.groups() != (PACKAGE, str(version), name):
        raise ValueError("APK package/version does not match OTA manifest")
    certs = subprocess.check_output(
        [apksigner, "verify", "--print-certs", str(apk)],
        text=True, timeout=30, stderr=subprocess.DEVNULL)
    matched = re.findall(
        r"certificate SHA-256 digest:\s*([a-fA-F0-9]{64})", certs)
    if not matched or any(d.lower() != SIGNER_SHA256 for d in matched):
        raise ValueError("APK signature is invalid or signer changed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--release", required=True, type=Path)
    parser.add_argument("--apk", required=True, type=Path)
    parser.add_argument("--aapt", required=True)
    parser.add_argument("--apksigner", required=True)
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text())
    release = json.loads(args.release.read_text())
    version, name = validated_release(manifest, release, args.apk)
    validate_android_identity(args.apk, version, name, args.aapt, args.apksigner)
    print(f"OTA_RELEASE_SIGNATURE_AND_CHECKSUM_VERIFIED Build {version}")


if __name__ == "__main__":
    main()

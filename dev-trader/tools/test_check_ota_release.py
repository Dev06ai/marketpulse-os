"""Offline, synthetic checks for the OTA release metadata gate."""
import hashlib
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).with_name("check_ota_release.py")
spec = importlib.util.spec_from_file_location("check_ota_release", SCRIPT)
ota = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ota)


class OtaIntegrityTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.apk = Path(self.temp.name) / "app-release.apk"
        with zipfile.ZipFile(self.apk, "w", compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr("classes.dex", b"x" * 102_400)
            z.writestr("AndroidManifest.xml", b"not_real_test_fixture")
        sha = hashlib.sha256(self.apk.read_bytes()).hexdigest()
        url = f"https://github.com/{ota.REPO}/releases/download/dev-trader-v0.21.43-168/app-release.apk"
        self.manifest = dict(enabled=True, versionCode=168, versionName="0.21.43",
                             apkUrl=url, sha256=sha)
        self.release = dict(tag_name="dev-trader-v0.21.43-168", draft=False,
                            assets=[dict(name="app-release.apk", size=self.apk.stat().st_size,
                                         digest=f"sha256:{sha}", browser_download_url=url)])

    def test_valid_exact_metadata_and_zip(self):
        self.assertEqual(ota.validated_release(self.manifest, self.release, self.apk),
                         (168, "0.21.43"))

    def test_tampered_apk_rejected(self):
        self.apk.write_bytes(self.apk.read_bytes() + b"tamper")
        with self.assertRaisesRegex(ValueError, "size mismatch"):
            ota.validated_release(self.manifest, self.release, self.apk)

    def test_downgrade_link_or_foreign_asset_rejected(self):
        self.manifest["apkUrl"] = "https://example.org/update.apk"
        with self.assertRaisesRegex(ValueError, "destination"):
            ota.validated_release(self.manifest, self.release, self.apk)

    def test_bad_asset_digest_rejected(self):
        self.release["assets"][0]["digest"] = "sha256:" + "0" * 64
        with self.assertRaisesRegex(ValueError, "digest"):
            ota.validated_release(self.manifest, self.release, self.apk)

    def test_draft_release_rejected(self):
        self.release["draft"] = True
        with self.assertRaisesRegex(ValueError, "draft"):
            ota.validated_release(self.manifest, self.release, self.apk)

    def test_disabled_feed_never_claims_published(self):
        self.manifest["enabled"] = False
        with self.assertRaisesRegex(ValueError, "not enabled"):
            ota.validated_release(self.manifest, self.release, self.apk)

    def test_debug_assets_rejected_even_if_checksums_agree(self):
        with zipfile.ZipFile(self.apk, "a") as z:
            z.writestr("assets/ui_preview.json", '{"debug":true}')
        sha = hashlib.sha256(self.apk.read_bytes()).hexdigest()
        self.manifest["sha256"] = sha
        self.release["assets"][0].update(size=self.apk.stat().st_size, digest=f"sha256:{sha}")
        with self.assertRaisesRegex(ValueError, "sensitive/debug"):
            ota.validated_release(self.manifest, self.release, self.apk)


if __name__ == "__main__":
    unittest.main()

# NOVA release-channel security

NOVA's Android runtime is deliberately separated from this distribution branch. This branch is not a phone-control backend and exposes no remote command API.

## Trust anchors

- Android package: `dev.nova.companion`
- Current release: 0.2.3 / versionCode 6
- APK signer certificate SHA-256: `6cb06c508390aa4abfa096175109464e999c5eefe32e3b46738893972a6cdd0e`
- Current APK SHA-256: `ecd7168598d3f1d2ceb90c4742d4595d7d02c6ed3580f9d30dfec8b286641ce2`

## Update design

The live manifest is RSA-signed. NOVA 0.2.3 supports a hardened V3 update path that fetches only fixed-origin HTTPS text chunks, verifies signed metadata before use, reconstructs the APK locally, checks SHA-256, validates package/version/signer identity, and then hands the verified file to Android's user-mediated flow. There is no silent-install permission and no broad-storage permission.

A legacy V2 signature is retained in the manifest only to allow older compatible NOVA builds to discover and verify the current release.

## Key handling

Private signing keys and passwords are intentionally excluded from this branch and from public source archives. The repository contains only public release artifacts, signatures, checksums, and deterministic assembly automation.

## Runtime boundary

The Android app disables backup/device transfer and cleartext traffic, exports only its launcher activity, and does not request broad photo/video/storage, contacts, camera, location, Accessibility, usage-access, root, device-admin, exact-alarm, or package-install permissions.

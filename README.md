# NOVA standalone distribution

This branch is intentionally isolated from Dev Trader runtime code. It contains only NOVA's signed update-distribution assets and release automation. No signing keys, phone-control endpoints, trading credentials, databases, or Dev Trader services are present.

## Current release

- NOVA 0.2.3 (versionCode 6)
- Package: `dev.nova.companion`
- APK SHA-256: `ecd7168598d3f1d2ceb90c4742d4595d7d02c6ed3580f9d30dfec8b286641ce2`
- APK signer SHA-256: `6cb06c508390aa4abfa096175109464e999c5eefe32e3b46738893972a6cdd0e`
- Live manifest: `public/updates/latest.json`
- Immutable manifest: `public/updates/releases/0.2.3.json`

The update metadata is dual-signed for legacy V2 compatibility and NOVA's hardened V3 chunk updater. The V3 path uses fixed-origin HTTPS chunks, RSA-signed metadata, SHA-256 payload reconstruction, package/version/signer validation, and Android's user-mediated document/install flow.

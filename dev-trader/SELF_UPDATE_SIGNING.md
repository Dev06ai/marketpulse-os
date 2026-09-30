# Dev Trader self-update signing

The app checks the public update manifest at:

https://raw.githubusercontent.com/Dev06ai/marketpulse-os/dev-trader-v1/dev-trader/update.json

The release workflow publishes a signed APK plus a SHA-256 checksum to GitHub Releases.

Configure these GitHub Actions repository secrets once:

- DEV_TRADER_KEYSTORE_BASE64
- DEV_TRADER_KEYSTORE_PASSWORD
- DEV_TRADER_KEY_ALIAS
- DEV_TRADER_KEY_PASSWORD

Keep the private keystore out of the repository.

Release tags use this format:

`dev-trader-v0.2.1-7`

Android requires the same signing identity for an APK update. The currently installed debug build may therefore need a one-time migration install before continuous self-updates can work.

# KYVORIQ private offline audio bundle (Build 156)

The public source branch contains playback support **only**; no commercial recordings are committed here.

To build a private music-enabled APK, extract the owner-provided `KYVORIQ_Build156_All5_Private_Music_Assets.zip` at the Android repository root, preserving:

- `dev-trader/android/app/src/main/assets/music/track_01_bipolar.mp3` — bipolar X svj v12 car sounds (slowed), slot 1
- `dev-trader/android/app/src/main/assets/music/track_02_iris.mp3` — Iris, slot 2
- `dev-trader/android/app/src/main/assets/music/track_03_dark_beach.mp3` — Dark Beach (Slowed + Reverb), slot 3
- `dev-trader/android/app/src/main/assets/music/track_04_akai.mp3` — AKAI, slot 4
- `dev-trader/android/app/src/main/assets/music/track_05_written.mp3` — it was written (slowed + reverbed), slot 5

All five slots have owner-supplied private files. If a bundled asset is omitted, the file-picker fallback remains available and automatic next skips unavailable slots.

**Do not add these recordings to a public GitHub repository, workflow artifact, or publicly downloadable release without appropriate distribution rights.** Use a private build with the existing app signing key so it can update the installed application. Do not store or print the signing key in source code or logs.

For verification: run `gradle assembleDebug assembleDebugAndroidTest -PdevTraderVersionCode=156 -PdevTraderVersionName=0.21.31` and install the debug APK on an Android emulator; confirm playback, looping through all five included tracks, audio focus, and openFd() correctness. To sign a private release, use the trusted signing workflow and match the signing certificate of Build 155.

Media stays local. Playback only uses packaged assets or user-granted SAF URIs, no broad file/photo permissions. Art stays color-themed unless embedded cover art exists in the MP3 files.

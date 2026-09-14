# RASTA AI — release 1.0.18 (SIH26002 submission build)

| | |
| --- | --- |
| File | `release/RASTA-AI-1.0.18.apk` (32,289,189 bytes; `*.apk` is git-ignored, the file lives on the build laptop and in the submission package) |
| SHA256 | `5d374766c626dcf79c80e03162950c32e0d0fa1e1d904578197a22ed59c25cab` (`release/RASTA-AI-1.0.18.sha256`, verify with `sha256sum -c`) |
| Application label | RASTA AI |
| Package | `com.nxtlucifer.nerlogistics.driver.preview` |
| versionName / versionCode | 1.0.18 / 18 |
| minSdk / targetSdk | 24 / 36 (arm64-v8a) |
| Backend | `https://ner-intelligence.onrender.com` baked in at build time (`EXPO_PUBLIC_API_BASE_URL`); no localhost anywhere in the build |
| Built | 14 Sep 2026 14:55 IST, `bash .runtime/build-apk.sh 1.0.18` (Expo prebuild + Gradle `assembleRelease`, debug keystore; source at commit `0b89ddf`) |
| Certified | 14 Sep 2026 on the physical phone: driver login, manager login, both role switches, judge flow (`docs/terrain/HANDOFF.md` §7, `.runtime/evidence/phone-certify.json`) |
| Install | `adb install -r release/RASTA-AI-1.0.18.apk` (or copy to the phone and open) |
| Sign-in | one login screen; the server decides driver vs manager shell from the account role. Credentials are handed over separately, never in this repository |

Do not rebuild for the submission: this file is the certified build.

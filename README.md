# Trail Mapper

Trail-first mobile routing for Bloomington-Normal's Constitution Trail network.

## Stack

- Kotlin Multiplatform for shared Android/iOS code.
- Compose Multiplatform for shared UI.
- Android app entry point in `androidApp`.
- iOS app entry point in `iosApp`.
- Shared app and future routing code in `shared`.

This project uses the current recommended KMP shape: platform app entry points are separate from shared code. That keeps the Android app compatible with modern Android Gradle Plugin behavior and leaves the iOS app as a native Xcode entry point that consumes the shared Kotlin framework.

## Run

Generate the local routing assets before the first Android build, and refresh them on the cadence in [Refreshing generated assets](docs/routing-data-plan.md#refreshing-generated-assets). Generated data is ignored by Git. From PowerShell at the repository root:

```powershell
.\tools\fetch-mcgis-trails.ps1
.\tools\fetch-tigerweb-access-roads.ps1
python tools/fetch-verified-trail-additions.py
```

The last command fetches only the reviewed OSM paths listed in `data/verified-trail-additions.manifest.json`. It rejects upstream geometry, version or access changes until they receive a new review. The county base stays separate from these local additions. Android builds check that all three routing assets exist, including the access-road network, and name the command for any that are missing. They do not silently ship an app with missing routing data. Each fetch replaces its asset only after the new file is completely written, so a failed or interrupted run keeps the previous asset.

Android:

```bash
./gradlew :androidApp:assembleDebug
```

iOS:

Open `iosApp/TrailMapper.xcodeproj` on macOS with Xcode installed and run the `TrailMapper` scheme. iOS builds require macOS/Xcode even though the shared Gradle project can be edited on Windows.

## Google Cloud

- Create your own Google Cloud project and enable Maps SDK for Android and the Places API.
- Restrict an Android Maps SDK key to your signing certificate and package name.
- Add the key through ignored local config:

```properties
MAPS_API_KEY=your_android_maps_sdk_key
```

For command-line builds, set `ANDROID_HOME` in the environment. The local `local.properties` file intentionally stores only `MAPS_API_KEY` so Android lint does not scan a Windows SDK path.

## Project Shape

```text
androidApp/  Android application module
shared/      Kotlin Multiplatform library with shared Compose UI
iosApp/      SwiftUI app shell that embeds the shared framework
```

## Routing Direction

The routing engine should treat approved trail-map layers as the graph:

- trail branches
- park trails/connectors
- suggested shared roadways
- Route 66 connector segments
- proposed trails only when explicitly enabled

Unlisted roads should only be short access stubs between an address and the approved graph.

The current source-chain and extraction plan are documented in `docs/routing-data-plan.md`.

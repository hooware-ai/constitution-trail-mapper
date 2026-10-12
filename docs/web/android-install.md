# Android installation and Help

Android browser pages show a compact action at the header's right. Help is the last bottom navigation option. Planning retains a bottom Help action; route previews place Help beside Start in the same bottom dock, so a separate footer cannot cover Start. Active rides retain their existing Help entry in Ride details.

| State | Action |
| --- | --- |
| Detection pending | Disabled Checking action, same dimensions as the final button; three-second bound |
| Chrome supplies beforeinstallprompt | Install opens Chrome's prompt from the rider's tap; Chrome still asks for confirmation |
| Unsupported, failed, empty or slow installed-app detection, without a prompt | Install opens Chrome menu instructions, including the possibility of a shortcut and already-installed Home Screen guidance |
| This manifest is confirmed by getInstalledRelatedApps, or appinstalled fires | Open shows instructions to tap Trail Mapper on the Home Screen or in the app drawer |
| Standalone display, or non-Android browser | No header install action |

An absent prompt is not proof of installation. Detection matches this manifest's URL, not any installed web app or the separate native Android app. Confirmation takes priority over a late query or prompt failure. A dismissed/failed prompt is not reused.

The Open action is guidance, **not a verified direct launcher**. Installed-PWA detection exposes the manifest identity, not its Android WebAPK package. A generic HTTPS intent can resolve to Chrome, and its browser fallback can only navigate the browser; neither proves the installed app opened. This change sends no such intent and never labels a browser reload as an app launch. See [Chrome installed-app detection](https://developer.chrome.com/docs/capabilities/get-installed-related-apps) and [Android intent guidance](https://developer.chrome.com/docs/android/intents).

The manifest URL, start URL, scope and origin stay unchanged. The existing implicit identity remains based on start_url; no new id is introduced. The existing SVG design supplies 192- and 512-pixel PNGs and a self-related manifest entry. No service worker, account flow, routing, location policy or storage migration is added. Installation does not add offline maps or background GPS.

## Verification

Focused browser controls exercise prompt consumption/dismissal/failure, delayed confirmation, unknown/unsupported detection, exact self-app detection, standalone mode, desktop hiding, narrow and rotated screens, enlarged text, reduced motion, dialog accessibility and Help access during planning and rides.

On October 11 the attached Pixel 9 Pro displayed the local candidate in Chrome, including the header action and fifth Help tab. Tapping Install opened Chrome's real Install app prompt for the localhost candidate. The prompt was cancelled; no app was installed or uninstalled. This proves the prompt path on that phone, not a production-origin install lifecycle. Production installation, Home Screen splash/launch, standalone detection after installation, uninstall/reinstall and a direct Open launcher remain unverified. The Pixel's installed WebAPKs did not include Trail Mapper at the time of the read-only package-scope check.

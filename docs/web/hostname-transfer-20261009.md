# Existing-site hostname transfer

Jesse authorized renaming the existing Site to `constitution-trail-mapper.hooware.chatgpt.site`, with his browser data transferred as needed. This is not consent to discard a library. Do not mutate the slug until the Windows handoff below confirms locally preserved backups (or verified absence of app data in the actual browser profiles he uses). Cloud browser emptiness is irrelevant.

The app stores routes, places and recents in an origin-local library; planner preferences and draft state are in its session. Completed sessions and quarantined unreadable records are also origin-local. There is no account sync or separate settings store. Browser location permission, installed shortcuts and cookies are browser settings and cannot be transferred by this app. The new origin must ask for location permission normally. Runtime refresh is off; its cache/authority must not be transplanted.

## Windows handoff before rename

1. In each actual browser/profile Jesse uses, open the current private site and stop any ride. Close other app tabs, including installed app windows. Keep the site identity unchanged.
2. Read `tools/browser-transfer/transfer.js` from this exact release checkout and evaluate it in that page through the supported browser task. Call `trailMapperTransfer.capture()` **inside the browser**. Save the resulting JSON directly to a user-local file (for example `TrailMapper-browser-backup-20261009.json`), without printing its contents into chat or uploading it. It may contain private routes and ride history. Keep a separate file for each browser/profile. Do not clear old storage.
3. Read the saved file locally and compare its complete parsed value with a second capture from the same browser. Report only verification success, profile identification and key/item counts, never coordinates, route titles or backup contents. If capture refuses active rides/unknown keys, resolve locally before proceeding. If an unused profile cannot be inspected, report that uncertainty.
4. Send the cloud owner a preservation checkpoint, including which profiles were inspected and the local backup paths. This is the prerequisite for renaming; no private data needs to reach the cloud owner.

## After supported slug mutation completes

1. Open the new hostname in the same browser/profile, close other app tabs, then evaluate the same transfer script. Supply the locally read JSON to `trailMapperTransfer.restore(backup)` within the browser task, without logging it. Import before creating a new library. An empty new library created by visiting the app may conflict: **do not erase it blindly**; back it up and confirm locally it contains no user items before clearing that one empty app key and retrying. A nonempty conflicting library requires local reconciliation and remains untouched.
2. The transfer refuses unknown/duplicate keys, wrong origins and conflicting data. It verifies raw values and rolls back newly written keys on failure. Repeating the same import is safe. In-progress/carried ride recovery stays in the backup and is not resumed. Library, quarantine, planner session and completed sessions transfer byte-for-byte; normal app validation, recency expiry and strict current-data navigation checks still apply.
3. Reload, inspect Saved/Recent/Places and planner preferences. Compare stored raw values before reload; after reload, note ordinary expiry/normalization separately. Keep the backup and old browser storage until Jesse confirms the library is intact. Reinstall/update the shortcut as needed and grant location permission only through the normal user flow.
4. Independently check the old URL after the rename and report its actual behavior. No redirect guarantee or automatic cross-origin storage transfer is assumed.

The transfer script performs no network requests, installs no background work, and changes no sharing or source/deployment identity. This procedure is browser emulation evidence until the Windows task executes it on Jesse's real profile.

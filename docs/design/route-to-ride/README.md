# Route-to-ride redesign: decision log

Started September 28, 2026 for #3. First flow: #17, map-first route results with separate Recent and Saved. Deliverable issue: #19.

The prototype is an interactive canvas of phone screens. Its sources are in [`prototype/`](prototype/). `Main.dc.html` holds the whole flow; the other boards mount it with different settings. The files run inside the canvas runtime (`support.js`), not as plain HTML pages; its state logic is in the `Component` class at the end of `Main.dc.html`. The hosted canvas is a private Claude design artifact until shared. Google Stitch and Figma, suggested in #3, both need an account; this round didn't need either.

Nothing here changes the app yet. The screen issues (#4, #5, #6, #8, #11) implement it.

## The flow

Plan → planner → searching → **route preview** → navigation, with Save, Share and Edit on the preview.

| Step | Decision |
| --- | --- |
| Plan | Two full-width choices at the top: **Go somewhere** (filled, primary) and **Make an exercise loop** (outlined). A **Recent** section follows only when it has entries. Account is a secondary icon in the header. |
| Primary navigation | Bottom bar with **Plan**, **Saved**, **Explore** and **Updates**. Planners, the preview and navigation are full screen with no bar. Wider windows would use a navigation rail; that is not prototyped. |
| Point-to-point planner | Start and destination are one field pattern with swap beside them. Places come from search, saved places and the map. Proposed trails is a checkbox with its explanation, off by default. **Find route** is disabled until a destination is set. A failed search is shown inline on the form, with the reason and what to try, and is not recorded anywhere. |
| Exercise planner | The start is the same field pattern. Distance presets are 3, 5, 10 and 15 mi, plus a custom miles field validated for 0.5–100 mi with an inline hint. **Make loop** is disabled until the distance is valid. |
| Searching | The map shows behind a progress card: "Finding a route…" or "Making your loop…", then "Checking trails, street access and current closures.", with Cancel. Cancel returns to the planner with the draft intact. |
| **Route preview** | A successful search always opens here; nothing asks the rider to save first. The map fits the whole route. The bottom panel shows, in order: title, distance, time, the access or retraced share, closure status, proposed-trail flag, a map key, **Start navigation** (the only filled button), then **Save**, **Share**, **Edit** and **More**. More holds Directions, Reverse direction, and "Save destination as a place" (or "start" for a loop). |
| Save | One tap saves under the route's title. The button turns to **Saved**, and a snackbar says "Saved to Saved routes" with a **Rename** action. There is no dialog. Tapping Saved again offers **View**. |
| Share | Opens Android's share sheet with the map image. Returning leaves the preview unchanged. |
| Edit | Returns to the planner with the draft that produced the route: destination, or distance and preset. |
| Navigation | Stop returns to the same preview, saved or not. Off route, a point-to-point route offers **Reroute**; a loop offers **Rejoin the loop** and **Return to start** (the existing rerouting behavior). Full navigation design stays in #10. |

## Recent and Saved

**Saved** holds what the rider chose to keep: named routes, loops and places. **Recent** holds routes they planned or opened but did not save, so they can reopen one without bookmarking it.

### Placement: option A

- **A (chosen):** Plan shows the three most recent entries under the creation choices, with **See all**. Saved has a segmented control, **Saved · n** | **Recent · n**, holding the full list.
- **B:** Recent lives only in Saved's Recent tab, and Plan shows nothing.

A puts a just-planned route one tap from launch, where riders start ("ride that again"), while keeping creation first on the screen. Plan hides the Recent section when it is empty, so first use is unchanged. B keeps Plan quieter but hides recent routes behind two taps and a tab riders have no reason to look in. Both give Saved the complete list, so the only difference is Plan's section. A is easy to drop to B later if testing shows Plan getting crowded.

### Copy

| Place | Text |
| --- | --- |
| Plan section heading | Recent · See all |
| Recent row | Title, then "2.8 mi · Today, 9:12 AM"; a clock icon (Saved rows use a filled bookmark) |
| Recent tab caption | Recent routes stay on this phone. Trail Mapper keeps up to 20 for 30 days and never backs them up to your Google account. |
| Recent tab, empty | Routes you plan show up here until you save them. |
| Saved tab, empty | Nothing saved yet. Save a route from its map to keep it here. · [Plan a ride] |
| Recent row menu | Open · Save · Remove from recents (snackbar with Undo) |
| Saved row menu | Open (for a place, "Plan a route here") · Rename · Share · Delete (snackbar with Undo) |
| Clear | "Clear recents" → dialog "Clear 4 recent routes?" / "Saved routes and places aren't affected." / Cancel · Clear |
| Proposed trail | A "Uses a proposed trail" chip on rows; "Uses a proposed trail · not built yet" on the preview |

### History policy

1. **What is recorded:** a route that was successfully generated, and a recent that was reopened, which moves to the top. Failed searches, autocomplete queries, typed text and destinations alone are never recorded.
2. **No duplicates:** the same route (the same route key) appears once, at its latest use.
3. **Saving moves it:** a saved route leaves Recent; Saved is its home. Deleting a saved route does not put it back in Recent. Opening a saved route does not add a Recent entry. The two lists never share an item, so Clear recents cannot touch a saved one.
4. **Retention:** at most 20 entries. An entry is dropped 30 days after its last use. Riders can remove one entry or clear all.
5. **Where it lives:** in app-private storage on the device only. It is never synced through the optional Google sign-in, and it is excluded from Android backup. Today `allowBackup` includes every store; #20 decides the backup rules, and the privacy copy above depends on them.
6. **Stale routes:** opening any recent or saved route re-runs the current closure and advisory checks before the rider starts. The panel shows "Checking current closures…" and then either "Closures checked just now" or a warning: "A reported closure now affects this route" with **Recalculate** and **Review notice**, and the closure drawn on the map. Recalculate updates that entry in place, with **Undo** in the snackbar. History never implies a route is clear.

## Back and recreation

| From | Back goes to |
| --- | --- |
| Preview reached from a planner | That planner, draft intact |
| Preview opened from Plan's Recent | Plan |
| Preview opened from Saved or Recent | Saved, same tab |
| Navigation | Stop returns to the preview |
| Share sheet, menus, rename | Close the sheet; the preview is unchanged |

Process recreation must restore the screen, the planner draft and the open result. A result reopens from Recent or Saved by its route key, or is recalculated from the draft.

## Visual language used

These come from the app's existing Material colors (`App.kt`), not new brand values.

| Role | Value |
| --- | --- |
| Primary action, trail line | Trail green `#08725F`, white text |
| Selected container | `#CDEFE7` with `#093B33` text |
| Street access line | `#4D6888`, dashed |
| Retraced piece | Trail green with white dashes, labeled "Ridden twice" |
| Closure or off-route warning | Container `#FDEBD8`, text `#5A2A00`, action `#8A3D00`, map line `#E3690B` |
| Proposed trail | `#EFE7F8` chip with `#4B2A78` text; purple `#7851A9` stays reserved for proposed lines |
| Destructive | `#B3261E` |
| Muted text | `#4C5A56`, at least 4.5:1 on white |

Touch targets are at least 48 dp. Every icon-only button has a label, for example "More actions for Work commute". Saved and Recent are tabs with a selected state. The map keeps its attribution visible. The prototype's typeface, Atkinson Hyperlegible, was chosen for legibility outdoors. Implementation may keep the Material type scale; a font change would be a separate decision.

## Covered by the #17 acceptance

| Scenario | In the prototype |
| --- | --- |
| Success opens the full map with no save prompt, for both route types | Yes |
| Navigate and return to the preview without saving | Yes: Start navigation, then Stop |
| Two routes, save one: both recoverable and distinguishable | Yes: the saved one appears under Saved with a bookmark, the other under Recent with a clock, on Plan and in Saved |
| Save, rename, remove one recent, Clear recents, Back, share-return | Yes |
| Clearing recents keeps saved items | Yes: the lists never share an item |
| Relaunch, process recreation, large text, TalkBack | Implementation and device checks |
| Retention cap and privacy copy | Copy and policy decided here; the backup rules are #20 |
| Proposed trails flagged when used | Yes: on rows and on the preview |

## Left for the screen issues

- #5 and #6: the planner screens as specified above, including the inline no-route error.
- #8: the preview panel, map key, fit-route button and stale-closure states.
- #11: Saved with the Saved and Recent tabs, row menus, undo, and saved places.
- #4: the Plan screen and bottom navigation.
- A shared KMP `Recent` history policy (recording, dedupe, cap, expiry, move-on-save) with a platform store. Routing rules stay in shared code.
- Landscape, rail layout and large-text layouts still need prototypes before implementation.

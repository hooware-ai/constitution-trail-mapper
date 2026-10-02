# Web stack integration handoff and no-mutation checklist

Recorded 2026-10-01. **This document changes nothing:** no branch was merged, rebased, force-pushed, retargeted or deployed to produce it, and it does not authorize any of that. It tells an owner exactly what the open web stack contains, what it touches outside the web paths, how far native `main` has moved, and what to check before and after an integration so that **native changes already on `main` are preserved**. The facts below come from `git` and the GitHub API at the SHAs shown; re-run the commands in "Reproduce" before acting, because heads move.

## The stack, in order

Each PR is based on the one above it (the base is the branch, not `main`). Merging out of order, or squash-merging a middle PR, changes what the PRs below it contain.

| Order | PR  | Branch (base)                                                | Head      | What it adds                                                                                      |
| ----- | --- | ------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------------------- |
| 1     | #30 | `codex/web-app` (`main`)                                     | `97eee7d` | Kotlin-backed web planning and foreground navigation; **extracts shared routing logic to `sharedLogic`** |
| 2     | #73 | `claude/web-integration-71` (`codex/web-app`)                | `10ac737` | Integration candidate for reviewed web fixes                                                      |
| 3     | #74 | `claude/web-release-48` (`claude/web-integration-71`)        | `c83f379` | Reproducible release check, Kotlin core manifest, provenance (`web-release-check.yml`)            |
| 4     | #75 | `codex/web-data-47` (`claude/web-release-48`)                | `d50cb3a` | County-only dataset path and saved-route revalidation                                             |
| 5     | #76 | `claude/web-50-rider-help` (`codex/web-data-47`)             | `1945b69` | Rider-facing Help and about                                                                       |
| 6     | #77 | `codex/web-foundation-31` (`claude/web-50-rider-help`)       | `cd92778` | Local saved-library contract, Firestore rules, emulator tests (not deployed)                      |
| 7     | #78 | `codex/web-rules-ci-31` (`codex/web-foundation-31`)          | `12cb5f2` | Hosted Firestore-rules emulator gate (`web-firestore-rules.yml`)                                  |
| 8     | #79 | `codex/web-launch-acceptance-41` (`codex/web-rules-ci-31`)   | `d7c5428` | WebKit launch-acceptance coverage, matrix, operator checklist (`web-webkit.yml`)                  |
| 9     | #80 | `codex/web-guest-prep` (`codex/web-launch-acceptance-41`)    | `667da12` | Clickable OpenStreetMap credit, guest-first wording                                               |
| 10    | (this PR) | `codex/web-release-readiness` (`codex/web-guest-prep`) | see PR    | Header-policy unit test, axe sweep of every screen, safe map credit links, this handoff           |

**Side PRs that are not in the chain:** #70, #68, #66, #64, #58, #54, #53, #52 (each a single web fix based on `codex/web-app`) and #69 (`feature/share-preview`, based on `main`, **native**). They are not prerequisites of the stack above. Decide separately whether each is included in or superseded by #73 before integrating; do not assume.

`gh pr list --state open --json number,headRefName,baseRefName,headRefOid` reproduces this table.

## What the stack touches outside the web paths (native-affecting)

Everything outside `webApp/`, `docs/web/`, `.github/workflows/web-*` was counted against the merge base of `main` and the stack head (`36794d1`): **204 files.**

| Area                                        | Files | Nature                                                                                                                                              |
| ------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sharedLogic/src/**`                         | 187   | New module holding pure Kotlin routing and domain code. Across `shared/` and `sharedLogic/` the change list is **184 pure renames (R100) out of `shared/src`**, 2 near-pure renames (R090, R096), 2 additions and 1 modification (`shared/build.gradle.kts`). Package names are unchanged (`com.trailmapper.shared...`). |
| `webBridge/**`                               | 4     | Kotlin/JS bridge used by the web worker only                                                                                                        |
| Root and build files                         | 9     | `.gitignore`, `README.md`, `build.gradle.kts`, `settings.gradle.kts`, `gradle.properties`, `gradlew`, `kotlin-js-store/package-lock.json`, `sharedLogic/build.gradle.kts`, **`shared/build.gradle.kts`** (the one modified native-module file: it now depends on `sharedLogic`) |
| `tools/`, `data/`, `docs/google-account-routes.md` | 4 | Real-data extractor and its tests, the reviewed-trails manifest, one doc                                                                            |

`androidApp/` and `iosApp/` are **not** modified by the stack.

## Where native `main` has moved

`main` is at `9c31ae3`, **12 commits** past the web base `36794d1` (planner guidance and inline search problems #65, exercise-planner form #62, destination ranking #61, About hub #59, account sheet and sign-out #55/#57, saved library #37, Undo and Home status work). It changed **42 files: 41 under `shared/src` and 1 under `androidApp/src`.**

- **Path overlap with the stack's non-web files: none** (checked by intersecting both change lists).
- **Textual merge: clean.** `git merge-tree --write-tree origin/main origin/codex/web-guest-prep` exits 0 and writes tree `4022f71` with no conflicts. It does not touch any ref, index or working tree.
- **Compile-level: NOT verified.** A clean text merge does not prove the merged tree builds: native code on `main` may use symbols that the stack moved into `sharedLogic`. The package names did not change, which is why this is expected to resolve, but it has to be confirmed by building the merged tree (below). `main` has no hosted workflows, so no CI will do this for you.

## No-mutation checklist (for the owner; each step is theirs to authorize)

Before any integration:

1. Re-run the commands in "Reproduce" and confirm every head still matches this table; if one moved, re-review it.
2. Confirm each PR in the chain has been reviewed at its **current** head, and that its hosted checks passed there (Web release check, Web Firestore rules where it triggers, Web WebKit launch acceptance). A check that was path-filtered out did not run; that is not a pass.
3. Decide what happens to the side PRs listed above and to #69.
4. Do **not** force-push, rebase published branches, or squash a middle PR. To keep native work on `main`, bring `main` into the stack (a merge commit on the top branch), or merge the stack into `main` in order, so `main`'s 12 commits are kept as they are.

After integration, in a throwaway checkout of the merged tree (do not build in the working checkouts that exist today; run one Gradle build at a time):

5. `./gradlew :sharedLogic:jvmTest :sharedLogic:jsNodeTest :webBridge:jvmTest :webBridge:jsNodeTest :shared:testAndroidHostTest` (native shared tests must still pass with the moved code).
6. `./gradlew :androidApp:assembleDebug :androidApp:lintDebug` (the Android app must still compile against `sharedLogic`).
7. iOS: native iOS compilation needs macOS/Xcode and has not been verified by any of this work; record it as `NOT RUN` unless it is run.
8. `cd webApp && npm ci && npm run release:check` and `npm run test:webkit`, then the county suite (`npx playwright test -c playwright.county.config.ts`).
9. Check that `main`'s own behavior is intact: the native screens changed by the 12 commits (planner guide, account sheet, saved library) still behave as before, by running the native tests that cover them.

## What is deliberately not part of an integration

Nothing here changes `webApp/release/dataset*.json` approval flags or blockers, the dataset artifact, closures or geometry. Real-data composition, public-release approval, physical-device acceptance, hosting, the basemap reliability choice and the owner's deployment approval are separate gates (see [launch-acceptance.md](launch-acceptance.md)). Accounts and sync are deferred (guest-first launch) and #33 is paused. Data and feature **parity with native** (native carries 260 county features including 6 Proposed, 4 reviewed OSM ways and the `mclean-access-roads` set that the web build lacks) is a separate track with its own plan and review; integrating the stack does not change it.

## Reproduce

```
gh pr list --repo hooware-ai/constitution-trail-mapper --state open --json number,headRefName,baseRefName,headRefOid
git fetch origin
git merge-base origin/main origin/codex/web-guest-prep                      # 36794d1 at the time of writing
git diff --name-only <merge-base> origin/codex/web-guest-prep | grep -vE '^(webApp/|docs/web/|\.github/workflows/web-)'
git diff --name-only <merge-base> origin/main                               # what native main changed
git merge-tree --write-tree --name-only origin/main origin/codex/web-guest-prep   # dry run, mutates nothing
```

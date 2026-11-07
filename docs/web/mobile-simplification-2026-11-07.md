# Mobile planning simplification · November 7, 2026

## Goal
Reduce phone planning choices and scrolling without removing route types, saved data, map tools, notices, feedback, or safety checks.

## Research and decisions
- [Hick's law](https://lawsofux.com/hicks-law/): fewer competing choices. Main navigation is Plan, Saved, More instead of five equal destinations. Ride types retain one emphasized primary action.
- [Progressive disclosure, Nielsen Norman Group](https://www.nngroup.com/articles/progressive-disclosure/): show common controls first. Map key, route options, custom distance, and search explanations are available on demand. Explore, Trail updates and Help are clearly labeled in More.
- [Fitts's law](https://lawsofux.com/fittss-law/): larger targets and shorter travel. Mobile zoom targets are 44 pixels; endpoint Swap remains 48 pixels and no longer consumes a row. Existing primary buttons remain at least 48 pixels high.
- [Recognition rather than recall](https://www.nngroup.com/articles/recognition-and-recall/): visible navigation labels and endpoint names; enabled proposed routing is reflected in the options summary.
- [Law of proximity](https://lawsofux.com/law-of-proximity/): endpoints, swap and Find route form one compact group. On phones, inputs precede the contextual map. Dedicated map picking remains map-first.
- W3C [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [text resizing](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html), [contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) and [focus visibility](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) guide validation. 44 pixels is an enhanced design target, not WCAG AA's 24-pixel minimum. Laws are heuristics, not usability guarantees.

## Before and after
At a 400 × 604 CSS-pixel browser viewport, the original public planner's Find route began at y=796, below the first screen. The simplified review planner begins at y=439, visible without scrolling even with its extra review-data banner. This compares rendered interfaces at equal viewport sizes. Main navigation decreased from five choices to three. The full legend and unavailable proposed checkbox no longer interrupt initial planning.

Desktop keeps its side-by-side panel and map. Attribution, route warnings, known closures, estimated/unmapped-access navigation blocks, foreground-only guidance, privacy-default export, storage namespaces and public sharing are unchanged. No geometry, backend, credentials, notifications or native application changes.

## Verification
- TypeScript passes, including updated tests.
- Unit suite: 735 passed, 3 intentional skips, 0 failures.
- Existing Kotlin core recovered from the desktop and independently verified: exact source inputs 9c42720069b99ec5e21260877bc6c5dc70c90385f224e26d871ac9cf1fa0927f; output 48eb5c26fddb635b1872f563d14aa4fd935e6f4a01db064d49e5b7b07928390b. No manifest forged or release guard skipped.
- County and address verification pass; 444 county files byte-match v43. Address index unchanged: e41bd334bab3edbe19a4a4547149e9d390f2842dcba9a3a83ee8aa47bb950841.
- Independent review found two development regressions: summary missing from modal focus trap, and custom miles collapsing while typing preset prefixes. Both fixed with focused regression coverage.
- Browser suites updated for More and disclosures. Focused tests cover keyboard access, Back/Escape/focus, light/dark navigation, default-off proposed routes and custom-distance typing. Execution/hosted acceptance are recorded separately, not inferred from test additions.
- Physical Android/iPhone and outdoor GPS acceptance are not claimed.

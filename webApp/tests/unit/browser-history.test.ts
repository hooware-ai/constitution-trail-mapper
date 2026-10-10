import test from "node:test";
import assert from "node:assert/strict";
import {
  BrowserHistorySync,
  resolvePop,
  type HistoryLike,
  type HistoryState,
  type PopContext,
} from "../../src/platform/browserHistory";

const context = (patch: Partial<PopContext> = {}): PopContext => ({
  screen: "saved",
  overlayOpen: false,
  navigating: false,
  hasPreview: false,
  ...patch,
});
const entry = (screen: string, tm = 0, overlay = false): HistoryState =>
  overlay ? { tm, screen, overlay } : { tm, screen };

test("Back to a main screen goes there, and stepping onto the current screen changes nothing", () => {
  assert.deepEqual(resolvePop(context(), entry("plan"), "back"), {
    type: "go",
    screen: "plan",
  });
  assert.deepEqual(
    resolvePop(context({ screen: "plan" }), entry("plan"), "back"),
    {
      type: "stay",
    },
  );
});
test("an open dialog or chooser is dismissed by Back instead of leaving the screen", () => {
  assert.deepEqual(
    resolvePop(context({ overlayOpen: true }), entry("saved"), "back"),
    { type: "close-overlay" },
  );
});
test("an active ride is never stopped, paused or restarted by a history step", () => {
  for (const direction of ["back", "forward"] as const)
    assert.deepEqual(
      resolvePop(
        context({ screen: "navigation", navigating: true }),
        entry("preview"),
        direction,
      ),
      { type: "keep-navigating" },
    );
  // Forward onto a navigation entry from anywhere else does not restart it either.
  assert.deepEqual(
    resolvePop(context({ screen: "preview" }), entry("navigation"), "forward"),
    {
      type: "stay",
    },
  );
});
test("transient search and picker entries return to the planner, and overlays are not re-entered", () => {
  assert.deepEqual(
    resolvePop(context({ screen: "preview" }), entry("map-picker"), "back"),
    {
      type: "go",
      screen: "planner",
    },
  );
  assert.deepEqual(
    resolvePop(context({ screen: "planner" }), entry("searching"), "back"),
    {
      type: "stay",
    },
  );
  assert.deepEqual(resolvePop(context(), entry("saved", 3, true), "forward"), {
    type: "stay",
  });
});
test("Explore picker history returns to Explore without re-entering an unconfirmed selection", () => {
  for (const direction of ["back", "forward"] as const) {
    assert.deepEqual(
      resolvePop(
        context({ screen: "planner" }),
        entry("explore-picker"),
        direction,
      ),
      {
        type: "go",
        screen: "explore",
      },
    );
    assert.deepEqual(
      resolvePop(
        context({ screen: "explore" }),
        entry("explore-picker"),
        direction,
      ),
      {
        type: "stay",
      },
    );
  }
});
test("a preview entry without a preview (after reload) falls back instead of showing nothing", () => {
  assert.deepEqual(
    resolvePop(context({ screen: "planner" }), entry("preview"), "back"),
    {
      type: "go",
      screen: "plan",
    },
  );
  assert.deepEqual(
    resolvePop(context({ screen: "planner" }), entry("preview"), "forward"),
    {
      type: "stay",
    },
  );
  assert.deepEqual(
    resolvePop(
      context({ screen: "planner", hasPreview: true }),
      entry("preview"),
      "forward",
    ),
    { type: "go", screen: "preview" },
  );
});

test("a fallback that lands on the screen already shown changes nothing", () => {
  // Back onto a preview entry with no preview while Home is already displayed.
  assert.deepEqual(
    resolvePop(context({ screen: "plan" }), entry("preview"), "back"),
    {
      type: "stay",
    },
  );
  assert.deepEqual(
    resolvePop(context({ screen: "planner" }), entry("map-picker"), "back"),
    {
      type: "stay",
    },
  );
});

class FakeHistory implements HistoryLike {
  entries: unknown[] = [null];
  at = 0;
  get state() {
    return this.entries[this.at];
  }
  pushState(state: unknown) {
    this.entries = [...this.entries.slice(0, this.at + 1), state];
    this.at++;
  }
  replaceState(state: unknown) {
    this.entries[this.at] = state;
  }
  back() {
    if (this.at > 0) this.at--;
  }
  forward() {
    if (this.at < this.entries.length - 1) this.at++;
  }
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("entries carry only an ordinal, a screen name and an overlay flag", async () => {
  const history = new FakeHistory();
  const sync = new BrowserHistorySync(history, () => {});
  sync.start("plan");
  sync.push("planner");
  sync.push("planner", true);
  await settle();
  for (const state of history.entries)
    assert.deepEqual(
      Object.keys(state as object)
        .sort()
        .filter((key) => !["tm", "screen", "overlay"].includes(key)),
      [],
    );
  assert.equal(JSON.stringify(history.entries).includes("latitude"), false);
});
test("Back and Forward report their direction and keep the ordinal in step", async () => {
  const history = new FakeHistory();
  const pops: Array<[HistoryState, string]> = [];
  const sync = new BrowserHistorySync(history, (target, direction) =>
    pops.push([target, direction]),
  );
  sync.start("plan");
  sync.push("saved");
  sync.push("preview");
  await settle();
  history.back();
  sync.handlePop(history.state);
  history.forward();
  sync.handlePop(history.state);
  assert.deepEqual(
    pops.map(([target, direction]) => [target.screen, direction]),
    [
      ["saved", "back"],
      ["preview", "forward"],
    ],
  );
  assert.equal(sync.position, 2);
});
test("closing an overlay from the app pops its entry before the next push, without reporting a pop", async () => {
  const history = new FakeHistory();
  const pops: unknown[] = [];
  const sync = new BrowserHistorySync(history, (target) => pops.push(target));
  sync.start("planner");
  sync.push("planner", true);
  await settle();
  sync.popOverlay();
  sync.push("preview");
  await settle();
  // The app-initiated back arrives as a popstate event; it is consumed, not reported.
  sync.handlePop(history.state);
  await settle();
  assert.equal(pops.length, 0);
  assert.deepEqual(
    history.entries.map(
      (state) => (state as HistoryState | null)?.screen ?? null,
    ),
    ["planner", "preview"],
  );
  assert.equal(sync.position, 1);
});
test("a reload adopts the loaded entry's ordinal and labels it with the restored screen", () => {
  const history = new FakeHistory();
  history.entries = [
    { tm: 0, screen: "plan" },
    { tm: 1, screen: "preview" },
  ];
  history.at = 1;
  const sync = new BrowserHistorySync(history, () => {});
  sync.start("planner");
  assert.equal(sync.position, 1);
  assert.deepEqual(history.state, { tm: 1, screen: "planner" });
});

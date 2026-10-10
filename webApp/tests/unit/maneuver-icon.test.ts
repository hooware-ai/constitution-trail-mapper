import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ManeuverIcon } from "../../src/ManeuverIcon";

const render = (maneuver?: string) =>
  renderToStaticMarkup(createElement(ManeuverIcon, { maneuver }));

test("unknown or missing maneuver metadata never invents a direction", () => {
  for (const value of [undefined, "", "Unknown", "constructor", "__proto__"])
    assert.equal(render(value), "");
});

test("router turn directions are distinct and decorative", () => {
  for (const value of [
    "TurnLeft",
    "TurnRight",
    "Continue",
    "TurnAround",
    "Arrive",
  ]) {
    const icon = render(value);
    assert.match(icon, /aria-hidden="true"/);
    assert.match(icon, /focusable="false"/);
    assert.doesNotMatch(icon, /aria-label|<title/);
  }
  const path = (value: string) => render(value).match(/<path d="([^"]+)"/)?.[1];
  assert.equal(
    new Set(
      ["TurnLeft", "TurnRight", "Continue", "TurnAround", "Arrive"].map(path),
    ).size,
    5,
  );
});

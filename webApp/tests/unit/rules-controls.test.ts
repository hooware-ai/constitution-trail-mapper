import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { controls } from "../../tools/lib/rules-controls.mjs";

const rules = readFileSync(
  join(process.cwd(), "cloud", "firestore.rules"),
  "utf8",
);

test("every negative control still matches the committed rules and really changes them", () => {
  const names = new Set<string>();
  for (const control of controls) {
    assert.ok(!names.has(control.name), `duplicate control ${control.name}`);
    names.add(control.name);
    const weakened = control.change(rules);
    assert.notEqual(weakened, rules, `${control.name} changed nothing`);
    assert.ok(["tests-fail", "rules-rejected"].includes(control.detects));
  }
  // The set covers each security property the gate promises.
  for (const required of [
    "default-allow",
    "signed-out-allowed",
    "any-signed-in-user",
    "no-field-validation",
    "owner-spoofing-allowed",
    "no-revision-check",
    "client-timestamps-allowed",
    "unbounded-lists",
    "no-size-bounds",
    "malformed-rules",
  ])
    assert.ok(names.has(required), `missing control ${required}`);
});

test("a control that no longer matches the rules fails loudly instead of weakening nothing", () => {
  const drifted = rules.replace(
    "allow read, write: if false;",
    "allow read, write: if denied();",
  );
  const control = controls.find((c) => c.name === "default-allow")!;
  assert.throws(() => control.change(drifted), /update the control/);
});

test("the committed rules are untouched by the controls (they work on a copy)", () => {
  const before = readFileSync(
    join(process.cwd(), "cloud", "firestore.rules"),
    "utf8",
  );
  for (const control of controls) control.change(before);
  assert.equal(
    readFileSync(join(process.cwd(), "cloud", "firestore.rules"), "utf8"),
    before,
  );
});

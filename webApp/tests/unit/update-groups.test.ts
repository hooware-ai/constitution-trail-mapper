import test from "node:test";
import assert from "node:assert/strict";
import { groupUpdates } from "../../src/updateGroups";
import type { Update } from "../../src/types";
const entry = (id: string, category?: string): Update => ({
  id,
  category,
  title: id,
  details: "Unchanged report; reopening unconfirmed",
  status: "Recheck needed",
  sourceUrl: "https://example.test/notice",
});
test("authoritative categories separate conditions and references without dropping unknown notices", () => {
  const input = [
    entry("r", "Rules"),
    entry("c2", "Conditions"),
    entry("future", "Future"),
    entry("m", "Maps"),
    entry("c1", "Conditions"),
    entry("route", "Routes"),
    entry("missing"),
  ];
  const grouped = groupUpdates(input);
  assert.deepEqual(
    grouped.map((g) => [g.label, g.entries.map((e) => e.id)]),
    [
      ["Conditions", ["c2", "c1"]],
      ["Routes", ["route"]],
      ["Rules", ["r"]],
      ["Maps", ["m"]],
      ["Other published notices", ["future", "missing"]],
    ],
  );
  const result = grouped.flatMap((g) => g.entries);
  assert.equal(result.length, input.length);
  assert.equal(new Set(result).size, input.length);
  assert(input.every((e) => result.includes(e)));
  assert.equal(grouped[0].entries[0], input[1]);
});
test("empty data and absent categories produce no guessed conditions", () => {
  assert.deepEqual(groupUpdates([]), []);
  assert.deepEqual(
    groupUpdates([entry("lower", "conditions")]).map((g) => g.label),
    ["Other published notices"],
  );
});

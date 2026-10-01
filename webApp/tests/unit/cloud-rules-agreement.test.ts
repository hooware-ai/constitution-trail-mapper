import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DATASET_KINDS,
  ENGINE_CODEC,
  LIMITS,
  PLACE_SCHEMA,
  ROUTE_KINDS,
  ROUTE_SCHEMA,
  SUPPORTED_VERSIONS,
  TEXT_PATTERN,
} from "../../src/cloud/contract";

const rules = readFileSync(
  join(process.cwd(), "cloud", "firestore.rules"),
  "utf8",
);
const has = (fragment: string) =>
  assert.ok(
    rules.includes(fragment),
    `firestore.rules does not contain: ${fragment}`,
  );
const quoted = (values: readonly string[]) =>
  `[${values.map((v) => `'${v}'`).join(", ")}]`;

test("firestore.rules uses exactly the limits and constants of the TypeScript contract", () => {
  has(`isText(e.label, ${LIMITS.labelMax})`);
  has(`isText(e.address, ${LIMITS.addressMax})`);
  has(`isText(d.title, ${LIMITS.titleMax})`);
  has(`isText(d.label, ${LIMITS.labelMax})`);
  has(`isText(d.address, ${LIMITS.addressMax})`);
  has(
    `isText(s.id, ${LIMITS.datasetIdMax}) && isText(s.version, ${LIMITS.datasetVersionMax})`,
  );
  has(`d.geometry.size() <= ${LIMITS.geometryChars}`);
  has(`d.pointCount >= 2 && d.pointCount <= ${LIMITS.pointCountMax}`);
  has(`d.engine.size() <= ${LIMITS.engineBytes}`);
  has(`d.lengthMeters <= ${LIMITS.lengthMetersMax}`);
  has(`d.miles >= ${LIMITS.milesMin} && d.miles <= ${LIMITS.milesMax}`);
  has(`request.query.limit <= ${LIMITS.listLimitMax}`);
  has(`^[A-Za-z0-9_-]{${LIMITS.idMin},${LIMITS.idMax}}$`);
  has(`d.version in [${SUPPORTED_VERSIONS.join(", ")}]`);
  has(`d.schema == '${ROUTE_SCHEMA}'`);
  has(`d.schema == '${PLACE_SCHEMA}'`);
  has(`d.engineCodec == '${ENGINE_CODEC}'`);
  has(`d.kind in ${quoted(ROUTE_KINDS)}`);
  // Navigation is point-to-point and ExerciseLoop is a loop, in the rules as in the validators.
  has("d.kind == 'Navigation' && d.draft.mode == 'point'");
  has("d.kind == 'ExerciseLoop' && d.draft.mode == 'loop'");
  has(`s.kind in ${quoted(DATASET_KINDS)}`);
  // The text rule is the same pattern, written for the rules language.
  const pattern = TEXT_PATTERN.source.replace(/\\\//g, "/");
  has(`v.matches('${pattern}')`);
});

test("every field a route or place may carry is listed identically in the rules' allow-list", () => {
  const route = [
    "schema",
    "version",
    "id",
    "ownerUid",
    "routeKey",
    "title",
    "kind",
    "draft",
    "lengthMeters",
    "bounds",
    "geometry",
    "pointCount",
    "dataset",
    "createdAt",
    "updatedAt",
    "revision",
    "engineCodec",
    "engine",
  ];
  const place = [
    "schema",
    "version",
    "id",
    "ownerUid",
    "label",
    "address",
    "latitude",
    "longitude",
    "createdAt",
    "updatedAt",
    "revision",
  ];
  const flat = rules.replace(/\s+/g, " ");
  for (const list of [route, place])
    assert.ok(
      flat.includes(`hasOnly([ ${list.map((k) => `'${k}'`).join(", ")}`) ||
        flat.includes(`hasOnly([${list.map((k) => `'${k}'`).join(", ")}`),
      `rules allow-list differs from [${list.join(", ")}]`,
    );
});

test("the rules never hand a client a way around the contract", () => {
  // Default deny at the end, no broad allow, no public read, no wildcard auth shortcuts, no collection-group match.
  assert.match(
    rules,
    /match \/\{document=\*\*\} \{\s*allow read, write: if false;/,
  );
  assert.doesNotMatch(rules, /allow [^;]*if true/);
  assert.doesNotMatch(rules, /request\.auth\.token\.email/);
  assert.doesNotMatch(rules, /\/\{path=\*\*\}/);
  // Every allow on the saved collections requires the path account to be the signed-in account.
  const allows =
    rules.match(/allow (get|list|create|update|delete)[^;]*;/g) ?? [];
  assert.equal(allows.length, 10 + 1 /* the default-deny line */ - 1);
  for (const line of allows) assert.match(line, /isOwner\(uid\)|if false/);
});

// Shared self-authored package and actual compiled-core control cases; no production approval.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { coreEntry } from "../../tools/lib/core.mjs";
import { canonicalSha256 } from "../../tools/lib/canonical-json.mjs";
import { buildPackage } from "../../tools/lib/dataset-package.mjs";
import {
  reviewRefresh,
  snapshotIdentity,
  REVIEW_SCHEMA,
} from "../../tools/lib/reviewed-refresh.mjs";
import { makeCounty, DEFAULT_LIST } from "./county-fixture.mjs";
const before = Date.parse("2026-09-20T00:00:00Z"),
  after = Date.parse("2027-10-01T00:00:00Z");
const p = (latitude, longitude) => ({ latitude, longitude });
export async function reviewedRouterFixture({
  withAccess = false,
  approvedSynthetic = false,
} = {}) {
  const core = await import(pathToFileURL(coreEntry).href);
  const catalog = JSON.parse(
    core.dispatch(JSON.stringify({ op: "closureCatalog" })),
  );
  assert.equal(catalog.ok, true);
  const list = [
    ...DEFAULT_LIST,
    [
      "54:9100",
      "Synthetic closure approach",
      ["TrailBranches"],
      [
        [
          [-88.984202, 40.5065],
          [-88.984202, 40.507656],
        ],
      ],
    ],
    [
      "54:1305",
      "Synthetic compiled closure interval",
      ["TrailBranches"],
      [
        [
          [-88.984202, 40.507656],
          [-88.984155, 40.509023],
        ],
      ],
    ],
    [
      "54:9101",
      "Synthetic closure exit",
      ["TrailBranches"],
      [
        [
          [-88.984155, 40.509023],
          [-88.984155, 40.5105],
        ],
      ],
    ],
  ];
  const county = makeCounty({ list });
  const manifestBytes = Buffer.from(JSON.stringify(county.manifest));
  let access = null;
  if (withAccess) {
    const { makeAccessExtract, makeAccessManifest } = await import(
      "./access-fixture.mjs"
    );
    const inputText = JSON.stringify(makeAccessExtract());
    access = {
      inputText,
      manifestBytes: Buffer.from(JSON.stringify(makeAccessManifest(inputText))),
    };
  }
  const snapshot = {
    ...(await buildPackage({
      inputText: JSON.stringify(county.input),
      manifest: county.manifest,
      manifestBytes,
      approval: county.approval,
      access,
    })),
    manifestBytes,
    ...(access ? { accessManifestBytes: access.manifestBytes } : {}),
  };
  if (approvedSynthetic) {
    // Build a consistent approved package from self-authored test bytes only.
    Object.assign(
      snapshot,
      await buildPackage({
        inputText: JSON.stringify(county.input),
        manifest: county.manifest,
        manifestBytes,
        access,
        approval: {
          ...county.approval,
          approved: true,
          approvedBy: "SELF-AUTHORED TEST FIXTURE ONLY",
          approvedOn: "2026-01-01",
          approvedComposition: structuredClone(snapshot.record.composition),
          blockers: [],
        },
      }),
    );
  }
  snapshot.parts = Object.fromEntries(
    snapshot.accessFiles.map((part) => [part.file, part.body]),
  );
  const ledger = {
    schema: REVIEW_SCHEMA,
    dataset: snapshotIdentity(snapshot),
    closures: catalog.closures.map((c) => ({
      id: c.id,
      affectedIds: [c.featureId],
      compiledClosure: c,
      compiledSha256: canonicalSha256(c),
    })),
  };
  const report = reviewRefresh({
    baseline: snapshot,
    target: snapshot,
    ledger,
    candidates: [],
    decisions: [],
    policy: { reviewers: ["fixture-reviewer"], syntheticFixture: true },
    evidence: {},
  });
  const a = (path, equals) => ({ path, equals });
  const cases = [
    {
      id: "point",
      category: "point",
      saveAs: "rectangle",
      request: {
        op: "plan",
        start: p(40.5, -88.99),
        destination: p(40.52, -88.95),
        proposed: false,
        now: before,
      },
      assertions: [a(["canNavigate"], true)],
    },
    {
      id: "loop",
      category: "loop",
      request: {
        op: "plan",
        start: p(40.5, -88.99),
        miles: 3,
        proposed: false,
        now: before,
      },
      assertions: [a(["route", "kind"], "ExerciseLoop")],
    },
    {
      id: "detached",
      category: "disconnected",
      request: {
        op: "plan",
        start: p(40.5, -88.99),
        destination: p(40.55, -88.89),
        proposed: false,
        now: before,
      },
      assertions: [a(["canNavigate"], false)],
    },
    {
      id: "access",
      category: "unverified-access",
      request: {
        op: "plan",
        start: withAccess ? p(40.49753, -89) : p(40.499, -88.99),
        destination: p(40.52, -88.95),
        proposed: false,
        now: before,
      },
      assertions: [a(["canNavigate"], false)],
    },
    {
      id: "preclosure",
      category: "point",
      saveAs: "closed",
      request: {
        op: "plan",
        start: p(40.5065, -88.984202),
        destination: p(40.5105, -88.984155),
        proposed: false,
        now: before,
      },
      assertions: [a(["canNavigate"], true)],
    },
    {
      id: "closure-after-estimate",
      category: "closure",
      routeFrom: "closed",
      request: { op: "inspect", now: after },
      assertions: [
        a(["canNavigate"], false),
        a(["closures", "0", "id"], catalog.closures[0].id),
      ],
    },
    {
      id: "saved-current",
      category: "saved-route",
      routeFrom: "rectangle",
      request: { op: "inspect", now: after },
      assertions: [
        a(["network", "status"], "current"),
        a(["canNavigate"], true),
      ],
    },
  ];
  return { report, snapshot, cases, now: before, catalog, ledger };
}

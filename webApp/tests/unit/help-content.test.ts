import test from "node:test";
import assert from "node:assert/strict";
import {
  buildText,
  coverageOf,
  datasetText,
  extentText,
  featureMix,
  reportTemplate,
  riderFeedbackTemplate,
  withBrowserDetails,
  type BuildInfo,
} from "../../src/helpContent";
import type { Feature, Network } from "../../src/types";

const build: BuildInfo = {
  commit: "abc123def456",
  dirty: false,
  core: "e595f3e0ab51",
  dataset: "county",
  channel: "review",
};
const features: Feature[] = [
  {
    id: "54:1",
    name: "Private nickname trail",
    status: "Existing",
    roles: ["TrailBranches"],
    paths: [
      [
        { latitude: 40.4, longitude: -89.0 },
        { latitude: 40.5, longitude: -88.9 },
      ],
    ],
  },
];
const network = (mode: Network["mode"]): Network => ({
  features,
  closures: [],
  updates: [],
  freshnessMessage: "",
  mode,
  label: "label",
  datasetRecord:
    mode === "county"
      ? ({
          id: "mclean-reviewed-existing-trails",
          version: "2026-09-28.e9d359180641",
          content: { sha256: "e9d359180641".padEnd(64, "0") },
        } as never)
      : null,
});

test("coverage reports the loaded trails' extent and length, and nothing when none are loaded", () => {
  const coverage = coverageOf(features)!;
  assert.equal(coverage.trails, 1);
  assert.equal(coverage.south, 40.4);
  assert.equal(coverage.east, -88.9);
  assert.ok(coverage.km > 10 && coverage.km < 20, String(coverage.km));
  assert.equal(
    extentText(coverage),
    "40.40° N to 40.50° N, 89.00° W to 88.90° W",
  );
  assert.equal(coverageOf([]), null);
});

test("the build identity names the commit, core and data build, and flags uncommitted changes", () => {
  assert.equal(
    buildText(build),
    "abc123def456 · routing core e595f3e0ab51 · county data build · review channel",
  );
  assert.match(
    buildText({ ...build, dirty: true }),
    /with uncommitted changes/,
  );
  assert.doesNotMatch(buildText({ ...build, core: null }), /routing core/);
  assert.match(
    buildText({ ...build, dataset: "fixture" }),
    /synthetic review build/,
  );
});

test("dataset identity is described for each kind of data and before loading", () => {
  assert.match(
    datasetText(network("county")),
    /version 2026-09-28\.e9d359180641/,
  );
  assert.match(datasetText(network("fixture")), /Synthetic review network/);
  assert.match(datasetText(network("local")), /Private local review data/);
  assert.equal(datasetText(null), "Trail data has not loaded yet.");
});

test("a problem report carries the app and data version and nothing about the rider", () => {
  const text = reportTemplate({ build, network: network("county") });
  assert.match(text, /Build: abc123def456/);
  assert.match(text, /Data: mclean-reviewed-existing-trails/);
  // No coordinates, no place or feature names, no ids of saved items, no history, no account.
  assert.doesNotMatch(text, /-?\d{2,3}\.\d{3,}/);
  assert.doesNotMatch(text, /Private nickname|54:1|label/);
  assert.doesNotMatch(text, /account|email|@|userAgent|Mozilla/i);
  // It tells the rider to review it and keep their own details out.
  assert.match(text, /Read this before you send it/);
  assert.match(text, /Do not add your location/);
});

test("the optional browser line is added and removed exactly, without touching what the rider wrote", () => {
  const original = reportTemplate({ build, network: null }) + "\nMy own note";
  const added = withBrowserDetails(
    original,
    true,
    "TestBrowser 1 · window 400×800",
  );
  assert.ok(
    added.endsWith("Browser and screen: TestBrowser 1 · window 400×800"),
  );
  assert.ok(added.includes("My own note"));
  assert.equal(
    withBrowserDetails(added, true, "TestBrowser 1 · window 400×800"),
    added,
  );
  assert.equal(withBrowserDetails(added, false, ""), original);
});

test("voluntary feedback distinguishes planning from riding and asks about this-browser tasks without attaching rider data", () => {
  const current = network("county");
  // Feedback has no reason to inspect geometry, names, notices or history.
  for (const property of ["features", "closures", "updates", "label"])
    Object.defineProperty(current, property, {
      get() {
        throw new Error(`Feedback read ${property}`);
      },
    });
  const text = riderFeedbackTemplate({ build, network: current });
  assert.match(text, /save and reopen in this browser/);
  assert.match(text, /Planning or opening a route is not a completed ride/);
  assert.match(text, /first visit or a return visit/);
  assert.match(text, /What worked, and what got in your way/);
  assert.match(text, /Nothing is sent automatically/);
  assert.match(text, /Build: abc123def456/);
  assert.match(text, /Data: mclean-reviewed-existing-trails/);
  assert.doesNotMatch(
    text,
    /-?\d{2,3}\.\d{3,}|Private nickname|54:1|Mozilla|Browser and screen|sign in|sync/i,
  );
  assert.match(
    riderFeedbackTemplate({ build, network: null }),
    /Trail data has not loaded yet/,
  );
});

test("the feature mix counts existing, proposed and shared-roadway features from their own status and roles", () => {
  const some = (status: string, roles: string[]): Feature => ({
    id: `x:${Math.random()}`,
    name: null,
    status,
    roles,
    paths: [],
  });
  assert.deepEqual(
    featureMix([
      some("Existing", ["TrailBranches"]),
      some("Existing", ["SharedRoadways"]),
      some("Existing", ["TrailBranches", "SharedRoadways"]),
      some("Proposed", ["ProposedTrails", "SharedRoadways"]),
    ]),
    { existing: 3, proposed: 1, shared: 2 },
  );
  assert.deepEqual(featureMix([]), { existing: 0, proposed: 0, shared: 0 });
});

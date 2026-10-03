import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  ProposedError,
  admitProposed,
  committedProposedManifestFile,
  geometryHash,
} from "../../tools/lib/proposed-layer.mjs";
import {
  AdmissionError,
  buildPackage,
  checkPackage,
} from "../../tools/lib/dataset-package.mjs";
import { makeCounty } from "../support/county-fixture.mjs";
import { makeProposed, proposedPlace } from "../support/proposed-fixture.mjs";
import { DatasetError, parseDatasetRecord } from "../../src/dataset";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const admit = (p = makeProposed()) =>
  admitProposed(JSON.stringify(p.input), p.manifest);
const refused = (mutate: (p: ReturnType<typeof makeProposed>) => void) => {
  const p = makeProposed();
  mutate(p);
  assert.throws(() => admit(p), ProposedError);
};

// ---- the rights gate ---------------------------------------------------------------------------------------------

test("the committed manifest records the six segments as rights-blocked, and packaging them is refused with the evidence", () => {
  const manifest = JSON.parse(
    readFileSync(committedProposedManifestFile, "utf8"),
  );
  assert.equal(manifest.rights.status, "unresolved");
  assert.deepEqual(
    manifest.features.map((f: any) => f.id),
    ["54:1929", "54:1952", "54:2349", "54:3824", "54:4275", "54:4772"],
  );
  // No geometry travels in the manifest, only identities and hashes.
  assert.ok(
    manifest.features.every(
      (f: any) => !("paths" in f) && /^[0-9a-f]{64}$/.test(f.geometrySha256),
    ),
  );
  assert.throws(
    () => admitProposed("{}", manifest),
    (error: any) => {
      assert.ok(error instanceof ProposedError && error.blocked);
      assert.match(error.message, /rights-blocked \(unresolved\)/);
      assert.match(
        error.message,
        /arcgis\.com\/sharing\/rest\/content\/items\//,
      );
      assert.match(error.message, /54:1929, 54:1952/);
      return true;
    },
  );
});

test("a granted rights block must be complete, and anything but granted blocks", () => {
  const ok = admit();
  assert.equal(ok.facts.featureCount, 2);
  assert.equal(ok.facts.license, "Synthetic Open License 1.0");
  for (const field of [
    "basis",
    "evidenceUrl",
    "evidenceSha256",
    "grantedBy",
    "grantedOn",
    "license",
    "licenseUrl",
    "attribution",
  ])
    refused((p) => delete p.manifest.rights[field]);
  refused((p) => (p.manifest.rights.evidenceUrl = "http://example.test/x"));
  refused((p) => (p.manifest.rights.evidenceSha256 = "abc"));
  refused((p) => (p.manifest.rights.status = "pending"));
  refused((p) => (p.manifest.rights.status = "Granted"));
  refused((p) => delete p.manifest.rights);
  const blocked = makeProposed({ granted: false });
  assert.throws(
    () => admit(blocked),
    (error: any) => error instanceof ProposedError && error.blocked === true,
  );
});

// ---- admission: exactly what was reviewed, never invented ---------------------------------------------------------

test("only the reviewed segments are admitted, opt-in, with recomputed geometry hashes and the rights they were admitted under", () => {
  const { layer, facts } = admit();
  assert.equal(layer.id, "proposed-trails");
  assert.deepEqual(
    layer.features.map((f: any) => f.id),
    ["54:9999", "54:9998"],
  );
  // 54:9000 is in the extract but not the manifest: never taken.
  assert.ok(!layer.features.some((f: any) => f.id === "54:9000"));
  for (const feature of layer.features) {
    assert.equal(feature.status, "Proposed");
    assert.equal(feature.enabledByDefault, false);
    assert.ok(feature.routeRoles.includes("ProposedTrails"));
    assert.equal(
      feature.provenance.geometrySha256,
      geometryHash(feature.paths),
    );
    assert.equal(feature.provenance.license, "Synthetic Open License 1.0");
  }
  assert.deepEqual(facts.segmentIds, ["54:9999", "54:9998"]);
});

test("geometry that is missing, moved, mislabeled, malformed or enabled by default is refused whole", () => {
  refused((p) => p.input.layers[0].features.shift()); // a reviewed segment is missing
  refused((p) => (p.input.layers[0].features[0].paths[0][1][0] += 0.0001)); // moved, hash label unchanged
  refused((p) => (p.input.layers[0].features[0].status = "Existing"));
  refused((p) => (p.input.layers[0].features[0].paths = [[[0, 0]]])); // one point
  refused(
    (p) =>
      (p.input.layers[0].features[0].paths = [
        [
          [0, 0],
          [200, 0],
        ],
      ]),
  ); // longitude out of range
  refused((p) =>
    p.input.layers[0].features.push(clone(p.input.layers[0].features[0])),
  ); // duplicated
  refused((p) => (p.manifest.features[0].geometrySha256 = "nope"));
  refused((p) => p.manifest.features.push(clone(p.manifest.features[0])));
  refused((p) => (p.manifest.features = []));
  refused((p) => (p.manifest.features[0].id = "bad"));
  refused((p) => (p.manifest.schemaVersion = 2));
  // An extract that says a segment is on by default does not make it so.
  const p = makeProposed();
  p.input.layers[0].features[0].enabledByDefault = true;
  assert.equal(admit(p).layer.features[0].enabledByDefault, false);
});

// ---- packaging and audit ------------------------------------------------------------------------------------------

function packaged(
  proposed: ReturnType<typeof makeProposed> | null = makeProposed(),
) {
  const county = makeCounty();
  const manifestBytes = Buffer.from(JSON.stringify(county.manifest));
  const proposedManifestBytes = proposed
    ? Buffer.from(JSON.stringify(proposed.manifest))
    : null;
  return {
    county,
    manifestBytes,
    proposedManifestBytes,
    build: () =>
      buildPackage({
        inputText: JSON.stringify(county.input),
        manifest: county.manifest,
        manifestBytes,
        approval: county.approval,
        proposed: proposed
          ? {
              inputText: JSON.stringify(proposed.input),
              manifest: proposed.manifest,
              manifestBytes: proposedManifestBytes!,
            }
          : null,
      }),
  };
}

test("a package with the proposed layer counts it, keeps it a separate opt-in layer, drops admitted ids from the omitted list, and verifies", async () => {
  const p = packaged();
  const { record, body } = await p.build();
  assert.equal(record.content.featureCount, 7);
  assert.equal(record.content.layerCounts["proposed-trails"], 2);
  assert.equal(record.proposedLayer.featureCount, 2);
  assert.equal(record.proposedLayer.license, "Synthetic Open License 1.0");
  // 54:9999 was omitted before; now it is admitted through the gate and no longer omitted.
  assert.deepEqual(record.omitted.proposedFeatureIds, []);
  const without = await packaged(null).build();
  assert.deepEqual(without.record.omitted.proposedFeatureIds, [9999]);
  assert.equal(without.record.proposedLayer, undefined);
  assert.notEqual(record.content.sha256, without.record.content.sha256);
  const network = JSON.parse(body.toString("utf8"));
  assert.deepEqual(
    network.layers.map((l: any) => l.id),
    [8, "proposed-trails"],
  );
  checkPackage(
    record,
    body,
    p.manifestBytes,
    null,
    undefined,
    p.proposedManifestBytes,
  );
  // The runtime accepts the description.
  parseDatasetRecord(clone(record), "review");
});

test("packaging refuses a blocked or unreadable proposed request, and the audit refuses an altered layer or record", async () => {
  const blocked = makeProposed({ granted: false });
  await assert.rejects(
    packaged(blocked).build(),
    (error: any) =>
      error instanceof AdmissionError && /rights-blocked/.test(error.message),
  );
  const p = packaged();
  const { record, body } = await p.build();
  const check = (
    r: any,
    b: Buffer,
    m: Buffer | null = p.proposedManifestBytes,
  ) =>
    assert.throws(
      () => checkPackage(r, b, p.manifestBytes, null, undefined, m),
      AdmissionError,
    );
  check(record, body, null); // no manifest to check against
  const other = makeProposed();
  other.manifest.reviewedOn = "2027-01-01";
  check(record, body, Buffer.from(JSON.stringify(other.manifest)));
  const hidden = clone(record);
  delete hidden.proposedLayer;
  check(hidden, body); // a layer the record does not describe
  const moved = JSON.parse(body.toString("utf8"));
  moved.layers[1].features[0].paths[0][1][0] += 0.01;
  check(record, Buffer.from(JSON.stringify(moved)));
  const enabled = JSON.parse(body.toString("utf8"));
  enabled.layers[1].features[0].enabledByDefault = true;
  check(record, Buffer.from(JSON.stringify(enabled)));
  const lie = clone(record);
  lie.proposedLayer.segmentIds = ["54:1"];
  check(lie, body);
  const countWrong = clone(record);
  countWrong.content.featureCount = 5;
  check(countWrong, body);
});

test("the runtime refuses a malformed proposed-layer description", async () => {
  const { record } = await packaged().build();
  const bad = (change: (r: any) => void) => {
    const copy = clone(record);
    change(copy);
    assert.throws(
      () => parseDatasetRecord(copy, "review"),
      (error: any) =>
        error instanceof DatasetError && error.code === "data-corrupt",
    );
  };
  bad((r) => (r.proposedLayer.featureCount = 0));
  bad((r) => (r.proposedLayer.evidenceSha256 = "short"));
  bad((r) => (r.proposedLayer.licenseUrl = ""));
  bad((r) => (r.proposedLayer.segmentIds = "54:9999"));
});

// ---- the router: opt-in only, preview only ------------------------------------------------------------------------

const corePath = join(
  resolve(process.cwd(), ".."),
  "webBridge",
  "build",
  "dist",
  "js",
  "productionLibrary",
  "TrailMapper-webBridge.mjs",
);
const skip = existsSync(corePath)
  ? false
  : "the Kotlin core is not built (npm run build:core)";

test(
  "through the real router a packaged proposed segment is used only on opt-in, and such a route is never navigable",
  { skip },
  async () => {
    const p = packaged();
    const { body } = await p.build();
    const module: any = await import(
      pathToFileURL(corePath).href + "?proposed=1"
    );
    const call = (request: unknown) =>
      JSON.parse(module.dispatch(JSON.stringify(request)));
    const NOW = Date.parse("2026-10-01T15:00:00Z");
    const init = call({
      op: "initialize",
      trails: body.toString("utf8"),
      now: NOW,
    });
    assert.equal(init.ok, true);
    const start = { latitude: 40.5, longitude: -88.97 }; // the west trail's east end
    const without = call({
      op: "plan",
      start,
      destination: proposedPlace,
      proposed: false,
      now: NOW,
    });
    const withIt = call({
      op: "plan",
      start,
      destination: proposedPlace,
      proposed: true,
      now: NOW,
    });
    // Not opted in: the destination is off the network, so there is no navigable route and the proposed ids are unused.
    assert.ok(!without.route || without.canNavigate === false);
    assert.ok(
      !(without.route?.edges ?? []).some((e: any) =>
        ["54:9999", "54:9998"].includes(e.sourceFeatureId),
      ),
    );
    // Opted in: the route exists and uses the proposed segments, but it is a preview: it cannot start navigation.
    assert.ok(withIt.route, "an opted-in route is found");
    assert.ok(
      withIt.route.edges.some((e: any) =>
        ["54:9999", "54:9998"].includes(e.sourceFeatureId),
      ),
    );
    assert.equal(withIt.proposed, true);
    assert.equal(withIt.canNavigate, false);
  },
);

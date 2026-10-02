import test from "node:test";
import assert from "node:assert/strict";
import {
  SupplementError,
  admitSupplement,
  geometryHash,
} from "../../tools/lib/osm-supplement.mjs";
import {
  AdmissionError,
  buildPackage,
  checkPackage,
} from "../../tools/lib/dataset-package.mjs";
import { makeCounty } from "../support/county-fixture.mjs";
import { makeSupplement } from "../support/osm-fixture.mjs";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
type Supplement = ReturnType<typeof makeSupplement>;
const admit = (s: Supplement = makeSupplement()) =>
  admitSupplement(JSON.stringify(s.input), s.manifest);
const refused = (mutate: (s: Supplement) => void) => {
  const s = makeSupplement();
  mutate(s);
  assert.throws(() => admit(s), SupplementError);
};
const first = (s: Supplement) => s.input.layers[0].features[0];

test("the reviewed supplement is admitted with real geometry hashes, and states its exclusions", () => {
  const { layer, facts } = admit();
  assert.equal(layer.id, "verified-osm");
  assert.equal(layer.features.length, 2);
  assert.deepEqual(facts.wayIds, [880001, 880002]);
  assert.equal(facts.license, "Open Database License (ODbL) 1.0");
  assert.equal(facts.attribution, "© OpenStreetMap contributors");
  assert.equal(facts.excludedUntilVerified.length, 2);
  for (const feature of layer.features) {
    assert.equal(feature.status, "Existing");
    assert.equal(
      feature.provenance.geometrySha256,
      geometryHash(feature.paths[0]),
    );
  }
});

test("a way whose geometry differs from what was reviewed is refused, even if its stated hash is the reviewed one", () => {
  // A moved vertex with the OLD hash label left in place: the hash is recomputed, so the label proves nothing.
  refused((s) => {
    first(s).paths[0][1][0] += 0.0001;
  });
});

test("every kind of drift refuses the whole supplement", () => {
  refused((s) => s.input.layers[0].features.pop()); // a reviewed way is missing
  refused((s) => s.input.layers[0].features.push(clone(first(s)))); // duplicated
  refused((s) => {
    const extra = clone(first(s));
    extra.id = "verified-osm:way:999";
    s.input.layers[0].features.push(extra); // an unreviewed way
  });
  refused((s) => (first(s).provenance.version = 3));
  refused((s) => (first(s).provenance.sourceTags.surface = "gravel"));
  refused((s) => (first(s).provenance.sourceTags.bicycle = "no"));
  refused((s) => {
    (first(s).provenance.sourceTags as Record<string, string>).access =
      "private";
  });
  refused((s) => (first(s).provenance.sourceTags.highway = "construction"));
  refused((s) => (first(s).routeRoles = ["ProposedTrails"]));
  refused((s) => (first(s).status = "Proposed"));
  refused((s) => (first(s).provenance.license = "CC0"));
  refused((s) => (first(s).provenance.attribution = "someone"));
  refused((s) => (first(s).paths = [[[0, 0]]]));
  refused((s) => (s.input.layers[0].id = "other"));
  refused((s) => (first(s).provenance.geometrySha256 = "0".repeat(64)));
});

test("the manifest itself is checked: licence, version, duplicates, roles, hashes, and the carried exclusions", () => {
  refused((s) => (s.manifest.schemaVersion = 2));
  refused((s) => (s.manifest.license = "CC BY 4.0"));
  refused((s) => s.manifest.features.push(clone(s.manifest.features[0])));
  refused((s) => (s.manifest.features[0].routeRole = "ProposedTrails"));
  refused((s) => (s.manifest.features[0].geometrySha256 = "nope"));
  refused((s) => (s.manifest.features = []));
  // Exclusions must be carried: the known gaps have to stay gaps and say so.
  refused((s) => (s.manifest.excludedUntilVerified = []));
});

function packaged(options: { supplement?: boolean } = {}) {
  const county = makeCounty();
  const supplement = makeSupplement();
  const supplementManifestBytes = Buffer.from(
    JSON.stringify(supplement.manifest),
  );
  return {
    county,
    supplement,
    supplementManifestBytes,
    build: () =>
      buildPackage({
        inputText: JSON.stringify(county.input),
        manifest: county.manifest,
        manifestBytes: Buffer.from(JSON.stringify(county.manifest)),
        approval: county.approval,
        supplement:
          options.supplement === false
            ? null
            : {
                inputText: JSON.stringify(supplement.input),
                manifest: supplement.manifest,
                manifestBytes: supplementManifestBytes,
              },
      }),
  };
}

test("a package with the supplement describes it, counts it, keeps it a separate layer, and verifies", async () => {
  const p = packaged();
  const { record, body } = await p.build();
  assert.equal(record.content.featureCount, 7);
  assert.equal(record.content.layerCounts["verified-osm"], 2);
  assert.equal(record.supplements.length, 1);
  assert.equal(record.supplements[0].id, "osm-reviewed-ways");
  assert.deepEqual(record.supplements[0].wayIds, [880001, 880002]);
  assert.match(
    record.omitted.supplements,
    /Included as a separate layer: 2 reviewed OpenStreetMap paths/,
  );
  assert.match(record.omitted.supplements, /do not bridge it/);
  const network = JSON.parse(body.toString("utf8"));
  assert.deepEqual(
    network.layers.map((l: { id: unknown }) => l.id),
    [8, "verified-osm"],
  );
  checkPackage(
    record,
    body,
    Buffer.from(JSON.stringify(p.county.manifest)),
    p.supplementManifestBytes,
  );
  // Identity moves with the supplement: the same county without it is a different dataset.
  const without = await packaged({ supplement: false }).build();
  assert.notEqual(record.content.sha256, without.record.content.sha256);
  assert.equal(without.record.supplements, undefined);
  assert.equal(without.record.content.featureCount, 5);
});

test("the audit refuses a package whose supplement layer or description was altered", async () => {
  const p = packaged();
  const { record, body } = await p.build();
  const countyManifest = Buffer.from(JSON.stringify(p.county.manifest));
  const check = (
    r: unknown,
    b: Buffer,
    m: Buffer | null = p.supplementManifestBytes,
  ) =>
    assert.throws(
      () => checkPackage(r as never, b, countyManifest, m),
      AdmissionError,
    );
  // Without the reviewed manifest the supplement cannot be checked, so the package is refused.
  check(record, body, null);
  // A different reviewed manifest than the one the package was made from.
  const other = makeSupplement({ reviewedOn: "2027-01-01" });
  check(record, body, Buffer.from(JSON.stringify(other.manifest)));
  // A layer present that the record does not describe (and the reverse).
  const hidden = clone(record);
  delete hidden.supplements;
  check(hidden, body);
  const without = await packaged({ supplement: false }).build();
  check({ ...without.record, supplements: record.supplements }, without.body);
  // A tampered packaged geometry: the body hash no longer matches its record.
  const moved = JSON.parse(body.toString("utf8"));
  moved.layers[1].features[0].paths[0][1][0] += 0.01;
  check(record, Buffer.from(JSON.stringify(moved)));
  // The record lying about what the supplement is.
  const lie = clone(record);
  lie.supplements[0].wayIds = [1];
  check(lie, body);
  const unknown = clone(record);
  unknown.supplements[0].id = "mystery";
  check(unknown, body);
});

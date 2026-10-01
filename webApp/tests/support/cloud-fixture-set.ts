// The committed, SYNTHETIC interchange fixtures other platforms (and the later Android/iOS adapter checks, #35/#36) can
// load: valid records, and invalid ones paired with the error code a conforming reader must report. Generated from the
// builders, never edited by hand; tests/unit/cloud-fixtures.test.ts fails if they drift from the contract.
import { ROUTE_MUTATIONS, PLACE_MUTATIONS } from "./cloud-mutations";
import {
  PLACE_ID,
  ROUTE_ID,
  validPlaceRecord,
  validRouteRecord,
} from "./cloud-fixtures";

export const FIXTURE_NOTE =
  "Synthetic records for the Trail Mapper saved-library contract (docs/web/cloud-library-contract.md). Self-authored geometry, fixture dataset provenance, no real place, rider or county data.";

const jsonSafe = (value: unknown) => {
  try {
    return (
      JSON.stringify(value) !== undefined &&
      !JSON.stringify(value).includes("null,null")
    );
  } catch {
    return false;
  }
};

export async function buildFixtureSet(): Promise<Record<string, unknown>> {
  const files: Record<string, unknown> = {};
  files["route-point-to-point.json"] = await validRouteRecord("fixture-user-a");
  files["route-loop.json"] = await validRouteRecord("fixture-user-a", {
    id: "r_loop0123456789abcdef0123456789",
    kind: "ExerciseLoop",
  });
  files["route-no-engine.json"] = await validRouteRecord("fixture-user-a", {
    id: "r_noengine0123456789abcdef012345",
    engine: false,
  });
  files["place.json"] = validPlaceRecord("fixture-user-a", PLACE_ID);
  const invalid = [];
  for (const mutation of ROUTE_MUTATIONS) {
    if (mutation.ts === "ok") continue;
    const record: any = structuredClone(
      await validRouteRecord("fixture-user-a"),
    );
    mutation.change(record);
    // Mutations that build text of 240,000 characters or hold NaN are not portable fixtures; the table covers them.
    if (!jsonSafe(record) || JSON.stringify(record).length > 20_000) continue;
    invalid.push({
      type: "route",
      name: mutation.name,
      expect: mutation.ts,
      record,
    });
  }
  for (const mutation of PLACE_MUTATIONS) {
    if (mutation.ts === "ok") continue;
    const record: any = structuredClone(validPlaceRecord("fixture-user-a"));
    mutation.change(record);
    if (!jsonSafe(record)) continue;
    invalid.push({
      type: "place",
      name: mutation.name,
      expect: mutation.ts,
      record,
    });
  }
  files["invalid-records.json"] = { note: FIXTURE_NOTE, invalid };
  files["README.json"] = {
    note: FIXTURE_NOTE,
    contract: "trail-mapper.saved-route/1 and trail-mapper.saved-place/1",
    valid: [
      "route-point-to-point.json",
      "route-loop.json",
      "route-no-engine.json",
      "place.json",
    ],
    invalid:
      "invalid-records.json: each entry names the CloudRecordError code a reader must report; none may open partly",
    ids: { route: ROUTE_ID, place: PLACE_ID },
  };
  return files;
}

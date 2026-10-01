// Emulator-backed helpers for the Firestore rules tests. Everything runs against the LOCAL Firestore emulator started by
// tools/run-emulator-tests.mjs (FIRESTORE_EMULATOR_HOST) under the demo project id; no account, credential or real
// project is involved, and no production configuration is read.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { Bytes, Timestamp, serverTimestamp } from "firebase/firestore";
import type { PlaceRecord, RouteRecord } from "../../src/cloud/contract";

export const PROJECT_ID = "demo-trail-mapper";
export { assertFails, assertSucceeds };

export async function createEnvironment(): Promise<RulesTestEnvironment> {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host)
    throw new Error(
      "FIRESTORE_EMULATOR_HOST is not set: run these tests with `npm run test:rules` (it starts the local emulator).",
    );
  const [hostname, port] = host.split(":");
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: hostname,
      port: Number(port),
      // TRAIL_RULES_FILE lets the negative controls (tools/rules-negative-control.mjs) test a deliberately weakened copy
      // of the rules from a temporary directory; without it the committed rules are what is tested.
      rules: readFileSync(
        process.env.TRAIL_RULES_FILE ??
          join(process.cwd(), "cloud", "firestore.rules"),
        "utf8",
      ),
    },
  });
}

export type Db = ReturnType<RulesTestContext["firestore"]>;
export const as = (env: RulesTestEnvironment, uid: string): Db =>
  env.authenticatedContext(uid).firestore();
export const signedOut = (env: RulesTestEnvironment): Db =>
  env.unauthenticatedContext().firestore();

type Doc = Record<string, any>;
/** The document a client writes: server timestamps for the write's times and the engine as Firestore bytes. */
export function routeDocument(record: RouteRecord | Doc, revision = 1): Doc {
  const { engine, createdAt: _c, updatedAt: _u, ...rest } = record as Doc;
  return {
    ...rest,
    revision,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(engine !== undefined
      ? {
          engine:
            typeof engine === "string"
              ? Bytes.fromBase64String(engine)
              : Bytes.fromUint8Array(engine),
        }
      : {}),
  };
}
export function placeDocument(record: PlaceRecord | Doc, revision = 1): Doc {
  const { createdAt: _c, updatedAt: _u, ...rest } = record as Doc;
  return {
    ...rest,
    revision,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}
/** A stored document as it reads back, for update tests (a client timestamp is never accepted as a write time). */
export const clientTimestamp = () =>
  Timestamp.fromMillis(Date.parse("2020-01-01T00:00:00Z"));

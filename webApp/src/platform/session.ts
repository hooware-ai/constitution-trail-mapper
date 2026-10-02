import { emptyDraft, isDraft, type Draft, type Endpoint } from "../types";
import {
  RECENT_MAX_AGE_MS,
  type RouteRecord,
  type StoragePort,
  type StoreResult,
} from "./storage";
export const SESSION_KEY = "trail-mapper.web.session.v1";
export interface BrowserSession {
  version: 1;
  screen: "plan" | "planner" | "preview" | "saved" | "explore" | "updates";
  draft: Draft;
  selected: RouteRecord | null;
  savedTab: "saved" | "recent";
  origin: "plan" | "saved" | "planner";
  updatedAt: number;
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const validDraft = isDraft;
const validRecord = (value: unknown): value is RouteRecord =>
  object(value) &&
  typeof value.key === "string" &&
  typeof value.title === "string" &&
  typeof value.createdAt === "number" &&
  Number.isFinite(value.createdAt) &&
  typeof value.usedAt === "number" &&
  Number.isFinite(value.usedAt) &&
  object(value.route) &&
  (value.plannedKey === undefined ||
    (typeof value.plannedKey === "string" && value.plannedKey.length > 0)) &&
  validDraft(value.draft);
const keptDataset = (value: unknown): RouteRecord["dataset"] | undefined =>
  object(value) &&
  ["kind", "id", "version", "contentSha256"].every(
    (key) =>
      typeof value[key] === "string" && (value[key] as string).length > 0,
  )
    ? {
        kind: value.kind as string,
        id: value.id as string,
        version: value.version as string,
        contentSha256: value.contentSha256 as string,
      }
    : undefined;
const cleanEndpoint = (value: Endpoint | null): Endpoint | null =>
  value
    ? {
        label: value.label,
        latitude: value.latitude,
        longitude: value.longitude,
      }
    : null;
const cleanDraft = (value: Draft): Draft => ({
  mode: value.mode,
  start: cleanEndpoint(value.start),
  destination: cleanEndpoint(value.destination),
  miles: value.miles,
  proposed: value.proposed,
});
/** Only a resolved planner draft and the open result; autocomplete text and search history are excluded. */
export class BrowserSessionStore {
  constructor(
    private storage: StoragePort,
    private now: () => number = Date.now,
  ) {}
  read(): StoreResult<BrowserSession | null> {
    let raw: string | null;
    try {
      raw = this.storage.getItem(SESSION_KEY);
    } catch {
      return { ok: false, state: null, error: "unavailable" };
    }
    if (!raw) return { ok: true, state: null };
    try {
      const value: unknown = JSON.parse(raw);
      if (!object(value)) throw new Error();
      if (value.version !== 1)
        return { ok: false, state: null, error: "unsupported-version" };
      if (
        !["plan", "planner", "preview", "saved", "explore", "updates"].includes(
          String(value.screen),
        ) ||
        !validDraft(value.draft) ||
        !(value.selected === null || validRecord(value.selected)) ||
        !["saved", "recent"].includes(String(value.savedTab)) ||
        !["plan", "saved", "planner"].includes(String(value.origin)) ||
        typeof value.updatedAt !== "number" ||
        !Number.isFinite(value.updatedAt) ||
        value.updatedAt > this.now() + 5000
      )
        throw new Error();
      if (this.now() - value.updatedAt >= RECENT_MAX_AGE_MS) {
        this.storage.removeItem(SESSION_KEY);
        return { ok: true, state: null };
      }
      const session = value as unknown as BrowserSession;
      session.draft = {
        ...session.draft,
        miles: session.draft.miles === null ? NaN : session.draft.miles,
      };
      return { ok: true, state: session };
    } catch {
      return { ok: false, state: null, error: "corrupt" };
    }
  }
  write(value: BrowserSession): StoreResult<BrowserSession | null> {
    const current = this.read();
    if (!current.ok) return current;
    const keepDraft = value.screen === "planner" || value.screen === "preview";
    const state: BrowserSession = {
      version: 1,
      screen: value.screen,
      draft: keepDraft ? cleanDraft(value.draft) : emptyDraft(),
      selected:
        value.screen === "preview" && value.selected
          ? {
              key: value.selected.key,
              title: value.selected.title,
              createdAt: value.selected.createdAt,
              usedAt: value.selected.usedAt,
              route: value.selected.route,
              draft: cleanDraft(value.selected.draft as Draft),
              // Which data the route was planned on survives a reload, so it can still be exported truthfully.
              ...(keptDataset(value.selected.dataset)
                ? { dataset: keptDataset(value.selected.dataset) }
                : {}),
              // The direction a loop is being ridden in survives a reload (re-checked against a fresh reversal).
              ...(value.selected.plannedKey
                ? { plannedKey: value.selected.plannedKey }
                : {}),
            }
          : null,
      savedTab: value.savedTab,
      origin: value.origin,
      updatedAt: this.now(),
    };
    try {
      this.storage.setItem(SESSION_KEY, JSON.stringify(state));
      return { ok: true, state };
    } catch (error) {
      return {
        ok: false,
        state: current.state,
        error:
          object(error) && error.name === "QuotaExceededError"
            ? "quota"
            : "unavailable",
      };
    }
  }
}

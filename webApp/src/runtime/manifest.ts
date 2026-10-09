import {
  DatasetError,
  parseDatasetRecord,
  type DatasetRecord,
} from "../dataset";

export interface SourceFreshness {
  id: string;
  /** Unknown upstream publication stays null; retrieval and review never stand in for it. */
  publishedAtUtc: string | null;
  checkedAtUtc: string;
  reviewedAtUtc: string;
  staleAfterMs: number;
}
export interface ClosurePin {
  id: string;
  contentSha256: string;
}
export interface ReopeningEvidence {
  id: string;
  evidenceUrl: string;
  reviewedBy: string;
  reviewedAtUtc: string;
}
export interface RefreshManifest {
  schema: "trail-mapper.refresh/1";
  /** Monotonic admission sequence; rollback is a NEW reviewed release. */
  sequence: number;
  releasedAtUtc: string;
  dataset: DatasetRecord;
  sources: SourceFreshness[];
  /** Complete catalog of known closures, including retained unresolved notices. */
  closures: ClosurePin[];
  reopenings: ReopeningEvidence[];
}
const object = (x: unknown): x is Record<string, any> =>
  !!x && typeof x === "object" && !Array.isArray(x);
const nonempty = (x: unknown): x is string =>
  typeof x === "string" && x.trim().length > 0;
export const utcTime = (x: unknown): x is string =>
  typeof x === "string" &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(x) &&
  Number.isFinite(Date.parse(x));
const hash = (x: unknown): x is string =>
  typeof x === "string" && /^[a-f0-9]{64}$/.test(x);
const uniqueIds = (xs: Array<{ id: string }>) =>
  new Set(xs.map((x) => x.id)).size === xs.length;
const corrupt = (message: string): never => {
  throw new DatasetError("data-corrupt", message);
};

/** Refresh admission is stricter than private review boot: unapproved candidates are never runtime replacements. */
export function parseRefreshManifest(
  raw: unknown,
  now = Date.now(),
): RefreshManifest {
  if (!object(raw))
    return corrupt("The refresh description is unreadable. Retry the check.");
  if (raw.schema !== "trail-mapper.refresh/1")
    throw new DatasetError(
      "data-incompatible",
      "This refresh needs a different app build. Reload the page.",
    );
  if (
    !Number.isSafeInteger(raw.sequence) ||
    raw.sequence < 1 ||
    !utcTime(raw.releasedAtUtc) ||
    Date.parse(raw.releasedAtUtc) > now
  )
    return corrupt("The refresh release identity is invalid.");
  parseDatasetRecord(raw.dataset, "public");
  if (raw.dataset.approval.blockers.length)
    throw new DatasetError(
      "data-unapproved",
      "The refresh still has unresolved approval blockers.",
    );
  if (
    !Array.isArray(raw.sources) ||
    !raw.sources.length ||
    !raw.sources.every(
      (s: unknown) =>
        object(s) &&
        nonempty(s.id) &&
        (s.publishedAtUtc === null || utcTime(s.publishedAtUtc)) &&
        utcTime(s.checkedAtUtc) &&
        utcTime(s.reviewedAtUtc) &&
        Number.isSafeInteger(s.staleAfterMs) &&
        s.staleAfterMs > 0 &&
        Date.parse(s.checkedAtUtc) <= now &&
        Date.parse(s.reviewedAtUtc) <= now &&
        (s.publishedAtUtc === null || Date.parse(s.publishedAtUtc) <= now),
    ) ||
    !uniqueIds(raw.sources)
  )
    return corrupt("The per-source freshness policy is incomplete or invalid.");
  if (
    !Array.isArray(raw.closures) ||
    !raw.closures.every(
      (c: unknown) => object(c) && nonempty(c.id) && hash(c.contentSha256),
    ) ||
    !uniqueIds(raw.closures)
  )
    return corrupt("The known closure catalog is incomplete or invalid.");
  if (
    !Array.isArray(raw.reopenings) ||
    !raw.reopenings.every(
      (r: unknown) =>
        object(r) &&
        nonempty(r.id) &&
        typeof r.evidenceUrl === "string" &&
        /^https:\/\/[^\s]+$/.test(r.evidenceUrl) &&
        nonempty(r.reviewedBy) &&
        utcTime(r.reviewedAtUtc) &&
        Date.parse(r.reviewedAtUtc) <= now,
    ) ||
    !uniqueIds(raw.reopenings)
  )
    return corrupt("The reopening review evidence is invalid.");
  // Detach from caller-owned objects, including source policy and approval fields.
  return structuredClone(raw) as RefreshManifest;
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function assertSafeSuccessor(
  previous: RefreshManifest,
  next: RefreshManifest,
): void {
  if (next.sequence < previous.sequence)
    return corrupt(
      "An older release was returned. Keep the accepted data and retry.",
    );
  if (
    next.sequence === previous.sequence &&
    canonical(previous) !== canonical(next)
  )
    return corrupt(
      "The same release sequence describes different data. Keep the accepted data and retry.",
    );
  const closures = new Map(next.closures.map((c) => [c.id, c.contentSha256]));
  for (const c of previous.closures) {
    if (closures.get(c.id) === c.contentSha256) continue;
    // A changed geometry/message can reduce exclusion just as disappearance can. Both need explicit review.
    const evidence = next.reopenings.find((r) => r.id === c.id);
    if (
      !evidence ||
      Date.parse(evidence.reviewedAtUtc) < Date.parse(previous.releasedAtUtc)
    )
      return corrupt(
        `Known closure ${c.id} changed without a current authoritative reopening review. Keep the accepted closure.`,
      );
  }
  for (const source of previous.sources)
    if (!next.sources.some((s) => s.id === source.id))
      return corrupt(
        `Source ${source.id} disappeared from the freshness policy. Keep the accepted data.`,
      );
}
export const staleSources = (
  manifest: RefreshManifest,
  now: number,
): string[] =>
  manifest.sources
    .filter(
      (s) =>
        now < Date.parse(s.checkedAtUtc) ||
        now - Date.parse(s.checkedAtUtc) >= s.staleAfterMs ||
        now < Date.parse(s.reviewedAtUtc) ||
        now - Date.parse(s.reviewedAtUtc) >= s.staleAfterMs,
    )
    .map((s) => s.id);

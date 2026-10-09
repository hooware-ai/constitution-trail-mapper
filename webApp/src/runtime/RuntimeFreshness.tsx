import { useEffect, useState } from "react";
import type { RuntimeFreshness } from "./freshness";

/** Add beside existing Data/credits/closure warnings; never replace those notices with this status. */
export function RuntimeFreshnessStatus<T>({
  runtime,
  appBuild,
}: {
  runtime: RuntimeFreshness<T>;
  appBuild: string;
}) {
  const [, render] = useState(0);
  useEffect(() => runtime.subscribe(() => render((n) => n + 1)), [runtime]);
  const state = runtime.snapshot;
  const manifest = runtime.accepted?.manifest;
  const staleKey = state.staleSources.join("|");
  // A UI clock updates freshness at evidence expiry; it never triggers a network check.
  useEffect(() => {
    if (!manifest) return;
    const now = Date.now();
    const deadlines = manifest.sources
      .flatMap((source) =>
        [Date.parse(source.checkedAtUtc), Date.parse(source.reviewedAtUtc)].map(
          (time) => time + source.staleAfterMs,
        ),
      )
      .filter((time) => time > now);
    if (!deadlines.length) return;
    const timer = setTimeout(
      () => render((n) => n + 1),
      Math.min(Math.min(...deadlines) - now, 2147483647),
    );
    return () => clearTimeout(timer);
  }, [manifest, staleKey]);
  const status = state.offline
    ? "Offline — accepted data retained"
    : state.error
      ? "Data check failed — accepted data retained"
      : state.staleSources.length
        ? "Source evidence is stale"
        : state.requiresCheck
          ? "Check required before Start"
          : "Reviewed data checked";
  return (
    <section aria-labelledby="runtime-freshness-heading">
      <h2 id="runtime-freshness-heading">Map freshness</h2>
      <p role="status" aria-live="polite" aria-atomic="true">
        {state.checking ? "Checking reviewed data…" : status}
        {state.pendingSequence !== null
          ? " A reviewed update is waiting. Your active ride has not changed; stop safely and review the route before starting again."
          : ""}
      </p>
      {state.error && <p role="alert">{state.error}</p>}
      {state.cacheError && <p role="alert">{state.cacheError}</p>}
      <dl>
        <dt>App build</dt>
        <dd>{appBuild}</dd>
        <dt>Accepted dataset release</dt>
        <dd>
          {manifest
            ? `${manifest.dataset.version} · ${manifest.releasedAtUtc}`
            : "No accepted release"}
        </dd>
        <dt>Successful runtime check</dt>
        <dd>
          {state.successfulCheckAt === null
            ? "Not yet checked in this tab"
            : new Date(state.successfulCheckAt).toISOString()}
        </dd>
        {state.failedCheckAt !== null && (
          <>
            <dt>Last failed check</dt>
            <dd>{new Date(state.failedCheckAt).toISOString()}</dd>
          </>
        )}
      </dl>
      {manifest?.sources.map((source) => (
        <div key={source.id}>
          <h3>
            {source.id}
            {state.staleSources.includes(source.id) ? " — stale" : ""}
          </h3>
          <dl>
            <dt>Source publication</dt>
            <dd>{source.publishedAtUtc ?? "Unknown"}</dd>
            <dt>Source check</dt>
            <dd>{source.checkedAtUtc}</dd>
            <dt>Human review</dt>
            <dd>{source.reviewedAtUtc}</dd>
            <dt>Stale after</dt>
            <dd>{source.staleAfterMs / 3600000} hours since check or review</dd>
          </dl>
        </div>
      ))}
      <p>
        Checks run when this page opens, resumes or reconnects, before Start,
        and when you check manually. Live conditions remain unverified. Follow
        posted closures and signs.
      </p>
      <button
        type="button"
        disabled={state.checking}
        onClick={() => void runtime.check("manual")}
      >
        {state.checking ? "Checking data…" : "Check data again"}
      </button>
    </section>
  );
}

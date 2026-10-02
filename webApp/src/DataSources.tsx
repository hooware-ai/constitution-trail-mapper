import type { Network } from "./types";
import { SafeLink } from "./components";

const day = (iso: string) => iso.slice(0, 10);

/**
 * What data the routes are planned on, who supplied it under which license, what was changed and what is missing.
 * Extraction time and review date are shown as what they are; neither is presented as the source's own freshness.
 */
export function DataSources({
  network,
  level = 2,
}: {
  network: Network;
  /** Heading level of the section title, so it nests correctly inside a dialog. */
  level?: 2 | 3;
}) {
  const Title = `h${level}` as "h2" | "h3";
  const Sub = `h${level + 1}` as "h3" | "h4";
  const record = network.datasetRecord;
  if (network.mode === "fixture")
    return (
      <section className="data-sources" aria-label="Trail data">
        <Title>Trail data</Title>
        <p>
          Synthetic review geometry created for Trail Mapper (CC0). It is not
          real infrastructure and is never approved for a ride.
        </p>
      </section>
    );
  if (!record)
    return (
      <section className="data-sources" aria-label="Trail data">
        <Title>Trail data</Title>
        <p>
          Private local review data. It has no recorded identity, license
          evidence or approval, so it is for developer review only.
        </p>
      </section>
    );
  const { source, omitted, approval, content } = record;
  return (
    <section className="data-sources" aria-label="Trail data">
      <Title>Trail data</Title>
      <p>
        {record.label} · version <code>{record.version}</code>
      </p>
      <p>{source.attribution}</p>
      <p>
        License: <SafeLink href={source.licenseUrl}>{source.license}</SafeLink>{" "}
        · source item{" "}
        <SafeLink href={source.licenseEvidenceUrl}>license evidence</SafeLink>
      </p>
      <p>
        <strong>Changes made:</strong> {source.changes}
      </p>
      <p>
        Feature set reviewed on {source.reviewedOn}. Extracted{" "}
        {day(source.extractedAtUtc)}; the county may have changed the data since
        and this app does not know when it last did.
      </p>
      <p>
        {content.featureCount} existing trail features
        {record.supplements?.length
          ? ` (${record.supplements.reduce((n, part) => n + part.featureCount, 0)} of them reviewed OpenStreetMap paths, below)`
          : ""}
        . {source.disclaimer}
      </p>
      {record.supplements?.map((part) => (
        <p key={part.id}>
          <strong>Reviewed OpenStreetMap paths:</strong> {part.featureCount}{" "}
          paths reviewed on {part.reviewedOn}, kept as their own layer.{" "}
          {part.attribution} · License:{" "}
          <SafeLink href={part.licenseUrl}>{part.license}</SafeLink>.
        </p>
      ))}
      {record.proposedLayer && (
        <p>
          <strong>Proposed trails (preview only):</strong>{" "}
          {record.proposedLayer.featureCount} planned segments, shown and routed
          only when you opt in, and never offered for navigation.{" "}
          {record.proposedLayer.attribution} · License:{" "}
          <SafeLink href={record.proposedLayer.licenseUrl}>
            {record.proposedLayer.license}
          </SafeLink>
          .
        </p>
      )}
      {record.access && (
        <p>
          <strong>Road access:</strong> {record.access.base.featureCount} base
          road features load with the trail data;{" "}
          {record.access.index.localFeatureCount} service roads load only for
          the area around a trip&apos;s start and destination. Sources: U.S.
          Census Bureau TIGER/Line roads and{" "}
          <SafeLink href="https://www.openstreetmap.org/copyright">
            OpenStreetMap contributors (ODbL)
          </SafeLink>
          . Where no road connects a point to a trail, access is shown as a
          labeled gap, never an invented connection.
        </p>
      )}
      <Sub>What is not included</Sub>
      <ul>
        {omitted.proposedFeatureIds.length > 0 && (
          <li>
            {omitted.proposedFeatureIds.length} proposed trail geometries whose
            redistribution basis is unresolved.
          </li>
        )}
        <li>{omitted.supplements}</li>
        {!record.access && <li>{omitted.accessRoads}</li>}
      </ul>
      {approval.approved ? (
        <p>
          Approved for release by {approval.approvedBy} on {approval.approvedOn}
          .
        </p>
      ) : (
        <>
          <p role="note">
            <strong>Review candidate.</strong> This data is not approved for
            public release.
          </p>
          {__TRAIL_CHANNEL__ === "review" && approval.blockers.length > 0 && (
            <ul>
              {approval.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="caption">
        Data identity <code>{content.sha256.slice(0, 12)}</code> · routes you
        save remember it and are checked against the data loaded now before you
        ride.
      </p>
    </section>
  );
}

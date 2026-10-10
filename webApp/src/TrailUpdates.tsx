import { useId, useRef } from "react";
import type { Update } from "./types";
import { groupUpdates } from "./updateGroups";
import { SafeLink } from "./components";

/** Presentation of published metadata only; never infers corridor or advisory associations. */
export function TrailUpdates({ updates }: { updates: Update[] }) {
  const id = useId(),
    headings = useRef<Record<string, HTMLHeadingElement | null>>({});
  const groups = groupUpdates(updates);
  const section = (group: (typeof groups)[number], reference: boolean) => {
    const Heading = reference ? "h3" : "h2";
    const CardHeading = reference ? "h4" : "h3";
    return (
      <section
        key={group.label}
        className="update-category"
        aria-labelledby={`${id}-category-${groups.indexOf(group)}`}
        data-update-category={group.label}
      >
        <Heading
          id={`${id}-category-${groups.indexOf(group)}`}
          tabIndex={-1}
          ref={(element) => {
            headings.current[group.label] = element;
          }}
        >
          {group.label}
        </Heading>
        {group.entries.map((update) => (
          <article key={update.id} data-update-id={update.id}>
            <p className="update-status">{update.status}</p>
            <CardHeading>{update.title}</CardHeading>
            <p>{update.details}</p>
            <SafeLink href={update.source?.url ?? update.sourceUrl}>
              {update.source?.title ?? "Read official source"}
            </SafeLink>
          </article>
        ))}
      </section>
    );
  };
  const references = groups.filter((group) =>
    ["Routes", "Rules", "Maps"].includes(group.label),
  );
  return (
    <div className="updates-list">
      {groups.length > 0 && (
        <div
          className="update-category-jumps"
          role="group"
          aria-label="Jump to notice category"
        >
          {groups.map((group) => (
            <button
              type="button"
              key={group.label}
              onClick={() => {
                const heading = headings.current[group.label];
                if (!heading) return;
                const header = document.querySelector("header");
                const position = header && getComputedStyle(header).position;
                const pinnedBottom =
                  header && (position === "sticky" || position === "fixed")
                    ? Math.max(0, header.getBoundingClientRect().bottom)
                    : 0;
                heading.style.scrollMarginTop = `${pinnedBottom + 12}px`;
                heading.scrollIntoView({ block: "start" });
                heading.focus({ preventScroll: true });
              }}
            >
              {group.label}{" "}
              <span className="caption">({group.entries.length})</span>
            </button>
          ))}
        </div>
      )}
      {groups
        .filter((group) => group.label === "Conditions")
        .map((group) => section(group, false))}
      {references.length > 0 && (
        <section
          className="update-references"
          aria-labelledby={`${id}-references`}
        >
          <h2 id={`${id}-references`}>Reference resources</h2>
          <p className="caption">
            Route, rules and map notices, grouped by their published category.
          </p>
          {references.map((group) => section(group, true))}
        </section>
      )}
      {groups
        .filter((group) => group.label === "Other published notices")
        .map((group) => section(group, false))}
      {groups.length === 0 && (
        <p>No published notices are available in this dataset.</p>
      )}
    </div>
  );
}

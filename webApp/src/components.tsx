import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Draft, Endpoint, Network, Point } from "./types";
import { places, searchPlaces } from "./search";
import type { PlaceRecord, RouteRecord } from "./platform/storage";
export interface DialogNotice {
  kind: "error" | "success";
  message: string;
}
export function Modal({
  title,
  children,
  onClose,
  notice,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  /** Feedback for the action just taken; the page behind a modal dialog is inert, so it must live here. */
  notice?: DialogNotice | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    close = useRef(onClose),
    id = useId();
  close.current = onClose;
  useEffect(() => {
    const d = dialog.current,
      previous = document.activeElement as HTMLElement | null;
    if (!d) return;
    d.showModal();
    const cancel = (e: Event) => {
      e.preventDefault();
      close.current();
    };
    d.addEventListener("cancel", cancel);
    return () => {
      d.removeEventListener("cancel", cancel);
      d.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      aria-labelledby={id}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const items = [
          ...dialog.current!.querySelectorAll<HTMLElement>(
            'button:not(:disabled),input:not(:disabled),select,a[href],[tabindex="0"]',
          ),
        ];
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }}
    >
      <div className="dialog-heading">
        <h2 id={id}>{title}</h2>
        <button
          className="icon-button"
          aria-label={"Close " + title}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {/* Both regions always exist so a message added later is announced. */}
      <div
        role="alert"
        className={notice?.kind === "error" ? "warning" : undefined}
      >
        {notice?.kind === "error" ? notice.message : null}
      </div>
      <div
        role="status"
        className={notice?.kind === "success" ? "success-note" : undefined}
      >
        {notice?.kind === "success" ? notice.message : null}
      </div>
      {children}
    </dialog>
  );
}
export const reviewPlaces: Endpoint[] = [
  {
    label: "Review trailhead · East",
    address: "Synthetic north–south trail · not a real destination",
    latitude: 40.51,
    longitude: -88.95,
  },
  {
    label: "Review trailhead · South",
    address: "Synthetic east–west trail · not a real destination",
    latitude: 40.49,
    longitude: -88.95,
  },
  {
    label: "Review trailhead · West",
    address: "Synthetic western branch · not a real destination",
    latitude: 40.49,
    longitude: -88.99,
  },
];
export function PlaceChooser({
  field,
  start,
  saved,
  fixture,
  onChoose,
  onMap,
  onLocation,
  onClose,
}: {
  field: "start" | "destination";
  start: Point | null;
  saved: PlaceRecord[];
  fixture: boolean;
  onChoose: (p: Endpoint) => void;
  onMap: () => void;
  onLocation: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const options = searchPlaces(query, start, [
    ...saved,
    ...(fixture ? [...reviewPlaces, ...places] : places),
  ]);
  return (
    <Modal title={"Choose " + field} onClose={onClose}>
      <label className="field">
        Search places
        <input
          autoFocus
          placeholder="Search places"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </label>
      <p className="muted">
        Choose a result to resolve its location. Typed text is never saved.
      </p>
      <div className="actions">
        <button onClick={onLocation}>Use current location</button>
        <button onClick={onMap}>Pick on map</button>
      </div>
      <ul className="place-results">
        {options.map((p, index) => (
          <li key={p.label + index}>
            <button className="route-row" onClick={() => onChoose(p)}>
              <strong>{p.label}</strong>
              <span>{p.address ?? "Saved place"}</span>
            </button>
          </li>
        ))}
      </ul>
      {!options.length && (
        <p>
          No matching place. This search only knows {places.length} public
          places and the places you saved. Use Pick on map, Use current location
          or a saved place instead.
        </p>
      )}
      <p className="caption">
        Not an address or business search: only {places.length} public places
        near Bloomington–Normal{fixture ? " (plus review trailheads)" : ""} and
        your saved places, searched on this device.{" "}
        {start
          ? "Results near your selected start are shown first."
          : "Start has no resolved coordinate, so results are not ordered by distance."}
      </p>
    </Modal>
  );
}
export function EndpointField({
  label,
  value,
  onClick,
}: {
  label: string;
  value: Endpoint | null;
  onClick: () => void;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <button
        className="endpoint-field"
        aria-label={label + ": " + (value?.label ?? "Choose a place")}
        onClick={onClick}
      >
        <strong>{value?.label ?? "Choose a place"}</strong>
        <small>
          {value ? "Location selected · change" : "Search, saved places or map"}
        </small>
      </button>
    </div>
  );
}
export function RouteRow({
  record,
  onOpen,
  children,
}: {
  record: RouteRecord;
  onOpen: () => void;
  children?: ReactNode;
}) {
  const draft = record.draft as Partial<Draft>;
  return (
    <li className="route-list-item">
      <button className="route-row" onClick={onOpen}>
        <strong>{record.title}</strong>
        <span>
          {draft.mode === "loop" ? "Exercise loop" : "Point-to-point"} ·{" "}
          {new Date(record.usedAt).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          })}
        </span>
      </button>
      {children && <div className="row-actions">{children}</div>}
    </li>
  );
}
export function Legend({ verified = false }: { verified?: boolean }) {
  return (
    <div className="legend" aria-label="Map key">
      <span>
        <i className="trail" />
        Trail
      </span>
      <span>
        <i className="park" />
        Park connector
      </span>
      <span>
        <i className="access" />
        Street access
      </span>
      <span>
        <i className="shared" />
        Shared roadway
      </span>
      {verified && (
        <span>
          <i className="verified" />
          Verified addition
        </span>
      )}
      <span>
        <i className="proposed" />
        Proposed · not built
      </span>
      <span>
        <i className="closed" />
        Trail closed
      </span>
    </div>
  );
}
export function SafeLink({
  href,
  children,
}: {
  href: string | undefined;
  children: ReactNode;
}) {
  if (!href || !/^https?:\/\//i.test(href)) return <span>{children}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children} ↗
    </a>
  );
}

/**
 * The opt-in for proposed (planned, unbuilt) trails. It says plainly when the loaded data carries none: a switch that
 * does nothing would be a false promise, and the reason is shown instead of silently hiding the coverage that is missing.
 */
export function ProposedChoice({
  network,
  checked,
  onChange,
  label,
  description,
}: {
  network: Network | null;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
}) {
  const available = !!network?.features.some((f) => f.status === "Proposed");
  const omitted =
    network?.datasetRecord?.omitted.proposedFeatureIds.length ?? 0;
  const why = available
    ? description
    : omitted > 0
      ? `This data has no proposed trails: ${omitted} proposed ${omitted === 1 ? "segment is" : "segments are"} left out because the right to share ${omitted === 1 ? "it" : "them"} is not settled.`
      : "This data set has no proposed trails.";
  return (
    <label className="checkbox">
      <input
        type="checkbox"
        checked={available && checked}
        disabled={!available}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        <small>{why}</small>
      </span>
    </label>
  );
}

/** Native's direction control for an exercise loop: which way it is being ridden, and a switch. */
export function DirectionControl({
  reversed,
  busy,
  onReverse,
}: {
  reversed: boolean;
  busy: boolean;
  onReverse: () => void;
}) {
  return (
    <div className="direction-control">
      <span>{reversed ? "Riding in reverse" : "Planned direction"}</span>
      <button disabled={busy} onClick={onReverse}>
        Reverse direction
      </button>
    </div>
  );
}

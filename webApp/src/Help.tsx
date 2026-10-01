import { useEffect, useMemo, useRef, useState } from "react";
import { DataSources } from "./DataSources";
import { Modal, SafeLink, type DialogNotice } from "./components";
import { places } from "./search";
import {
  REPORT_URL,
  buildText,
  coverageOf,
  datasetText,
  extentText,
  reportTemplate,
  withBrowserDetails,
  type BuildInfo,
} from "./helpContent";
import type { Network } from "./types";

/**
 * Help and about: what the app does today, in the order a rider needs it. Everything here describes behaviour that is
 * implemented now; anything account-dependent is stated as not available rather than described as if it worked.
 */
export function HelpDialog({
  network,
  build,
  onClose,
}: {
  network: Network | null;
  build: BuildInfo;
  onClose: () => void;
}) {
  const [view, setView] = useState<"help" | "report">("help");
  const [notice, setNotice] = useState<DialogNotice | null>(null);
  const coverage = useMemo(
    () => coverageOf(network?.features ?? []),
    [network],
  );
  const mode = network?.mode;
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);
  // Switching views moves focus to the new view's heading so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
  }, [view]);
  return (
    <Modal
      title={view === "help" ? "Help and about" : "Report a problem"}
      notice={notice}
      onClose={onClose}
    >
      {view === "help" ? (
        <div className="help">
          <h3 ref={heading} tabIndex={-1} className="visually-hidden">
            Help topics
          </h3>
          <nav aria-label="Help topics">
            <ul className="help-contents">
              {[
                ["help-safety", "Before you ride"],
                ["help-coverage", "Where it works"],
                ["help-map", "What the map shows"],
                ["help-search", "Finding places"],
                ["help-privacy", "Your data and privacy"],
                ["help-sources", "Data sources and licenses"],
                ["help-build", "About this build"],
                ["help-report", "Report a problem"],
              ].map(([id, label]) => (
                <li key={id}>
                  <a
                    href={"#" + id}
                    onClick={(event) => {
                      event.preventDefault();
                      const target = document.getElementById(id);
                      target?.scrollIntoView({ block: "start" });
                      target?.focus();
                    }}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <section aria-labelledby="help-safety" className="help-critical">
            <h3 id="help-safety" tabIndex={-1}>
              Before you ride
            </h3>
            <ul>
              <li>
                <strong>
                  Guidance works only while this page stays open and visible.
                </strong>{" "}
                If you switch tabs, lock the screen or leave the page, guidance
                pauses. The browser does not allow reliable background tracking,
                and there are no offline maps or offline navigation. Adding the
                page to your home screen does not change this.
              </li>
              <li>
                Routes are suggestions from the data below, not an official map
                and not a guarantee that a path is open, safe or passable. Obey
                posted signs and local rules.
              </li>
              <li>
                Closure information is a notice list bundled with the app, not a
                live feed.{" "}
                {network?.freshnessMessage ?? "It has not loaded yet."} Check
                the official source and signs on the trail.
              </li>
            </ul>
          </section>

          <section aria-labelledby="help-coverage">
            <h3 id="help-coverage" tabIndex={-1}>
              Where it works
            </h3>
            {mode === "county" && coverage ? (
              <p>
                Bloomington–Normal and nearby McLean County, Illinois. The
                loaded data holds {coverage.trails} existing trail features
                (about {coverage.km} km) between {extentText(coverage)}. The app
                can only route on those trails; it has no road network.
              </p>
            ) : mode === "fixture" ? (
              <p>
                This build shows a small made-up network so the app can be
                reviewed. It is not real infrastructure. Do not ride it.
              </p>
            ) : mode === "local" ? (
              <p>
                This is private local review data on this computer, for
                developers. It is not a public dataset.
              </p>
            ) : (
              <p>Trail data has not loaded yet.</p>
            )}
            <p>
              Outside the loaded trails there is nothing to route on, even where
              the map shows streets.
            </p>
          </section>

          <section aria-labelledby="help-map">
            <h3 id="help-map" tabIndex={-1}>
              What the map shows
            </h3>
            <dl>
              <dt>Trail and park connector</dt>
              <dd>
                A mapped, existing path in the loaded data. Mapped does not mean
                open today.
              </dd>
              <dt>Unverified connection</dt>
              <dd>
                A link the route needs between two places that the data does not
                confirm. It is shown as two end markers, never as a line, and
                navigation stays off until the route is fully mapped.
              </dd>
              <dt>Street access and shared roadway</dt>
              <dd>
                {mode === "county"
                  ? "The county data has no street or shared-roadway information, so the app never joins a trail to a street by itself; it shows an unverified connection instead."
                  : "Estimated links to streets, and roads shared with traffic. Estimated access is shown so you can judge it; the app does not treat it as a verified path."}
              </dd>
              <dt>Proposed · not built</dt>
              <dd>
                Planned paths that may not exist. They are hidden unless you
                turn them on, and a route that uses them cannot be navigated.
              </dd>
              <dt>Trail closed</dt>
              <dd>
                A closure from the bundled notice list. Routes avoid it where
                they can, and a route it affects cannot be navigated.
              </dd>
            </dl>
          </section>

          <section aria-labelledby="help-search">
            <h3 id="help-search" tabIndex={-1}>
              Finding places
            </h3>
            <p>
              Place search is not an address or business search. It looks only
              in {places.length} public places near Bloomington–Normal and in
              places you saved, on this device, and sends nothing you type
              anywhere. If your place is not listed, use{" "}
              <strong>Pick on map</strong>,{" "}
              <strong>Use current location</strong> or choose a place you saved.
            </p>
          </section>

          <section aria-labelledby="help-privacy">
            <h3 id="help-privacy" tabIndex={-1}>
              Your data and privacy
            </h3>
            <ul>
              <li>
                <strong>Stored in this browser only:</strong> routes you save,
                recent routes, places you save, the screen and planner draft you
                were on, and the ride in progress (so a reload can restore it).
                Saved routes and places contain the locations you chose. The app
                has no accounts and uploads none of this.
              </li>
              <li>
                <strong>Location:</strong> the browser asks permission only when
                you choose Use current location or start navigation. Your
                position is used on this device to plan and guide and is not
                sent by the app anywhere.
              </li>
              <li>
                <strong>Removing it:</strong> Saved shows Delete for each saved
                route and place and Clear recents; stopping a ride clears its
                recovery data. To remove everything, clear this site&apos;s data
                in your browser settings.
              </li>
              <li>
                <strong>Sharing and files:</strong> Share sends only the app
                address and the ride length. A route file download removes the
                areas around your start and destination unless you tick the box
                to include exact endpoints; the file always names its data
                sources.
              </li>
              <li>
                <strong>Requests the app makes:</strong> to this site, for the
                app and its trail data. Nothing else, unless you turn on{" "}
                <strong>Street basemap (online)</strong>
                {mode === "fixture"
                  ? " (not offered in the synthetic review build)"
                  : ""}
                : then the browser asks tile.openstreetmap.org for map images of
                the area you view, which shows that host your IP address and
                this site&apos;s address. It is off by default. There is no
                analytics, advertising or tracking.
              </li>
              <li>
                <strong>Accounts and sync:</strong> not available. Saved items
                stay in this browser. Sign-in and cloud sync are not part of the
                app today; if they are added, this page will say exactly what
                they upload before you can use them.
              </li>
            </ul>
          </section>

          <section aria-labelledby="help-sources">
            <h3 id="help-sources" tabIndex={-1}>
              Data sources and licenses
            </h3>
            {network ? (
              <DataSources network={network} level={3} />
            ) : (
              <p>Trail data has not loaded yet.</p>
            )}
            <p>
              Street map images, when turned on, are ©{" "}
              <SafeLink href="https://www.openstreetmap.org/copyright">
                OpenStreetMap contributors
              </SafeLink>
              . The {places.length} searchable public places use published
              facility coordinates; their sources are listed in the project
              documentation (docs/web/place-catalog.md).
            </p>
          </section>

          <section aria-labelledby="help-build">
            <h3 id="help-build" tabIndex={-1}>
              About this build
            </h3>
            <dl>
              <dt>Build</dt>
              <dd>{buildText(build)}</dd>
              <dt>Trail data</dt>
              <dd>{datasetText(network)}</dd>
              <dt>Phones and browsers</dt>
              <dd>
                Tested so far only with automated browser emulation. It has not
                been verified on physical iPhone Safari or Android Chrome, so
                behaviour on your phone may differ. Location needs a secure
                (https) page.
              </dd>
            </dl>
          </section>

          <section aria-labelledby="help-report">
            <h3 id="help-report" tabIndex={-1}>
              Report a problem
            </h3>
            <p>
              Write a short report you can review before sending. The app adds
              only its version, never your location, routes, place names or
              history.
            </p>
            <button
              onClick={() => {
                setNotice(null);
                setView("report");
              }}
            >
              Write a problem report
            </button>
          </section>
        </div>
      ) : (
        <ReportView
          network={network}
          build={build}
          heading={heading}
          setNotice={setNotice}
          back={() => {
            setNotice(null);
            setView("help");
          }}
        />
      )}
    </Modal>
  );
}

function ReportView({
  network,
  build,
  heading,
  setNotice,
  back,
}: {
  network: Network | null;
  build: BuildInfo;
  heading: React.RefObject<HTMLHeadingElement | null>;
  setNotice: (notice: DialogNotice | null) => void;
  back: () => void;
}) {
  const [text, setText] = useState(() => reportTemplate({ build, network }));
  const [browser, setBrowser] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const details = `${navigator.userAgent} · window ${window.innerWidth}×${window.innerHeight}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setNotice({
        kind: "success",
        message: "Report copied. Paste it where you send your report.",
      });
    } catch {
      area.current?.select();
      setNotice({
        kind: "error",
        message:
          "Your browser did not allow copying. The text is selected: copy it yourself.",
      });
    }
  }
  return (
    <div className="help report">
      <button onClick={back}>← Back to help</button>
      <h3 ref={heading} tabIndex={-1}>
        Review your report
      </h3>
      <p className="help-critical">
        Nothing is sent from this page. The text below is only what you see;
        edit or delete any of it. Do not add your location, routes, saved place
        names or personal details.
      </p>
      <label className="field">
        Report text
        <textarea
          ref={area}
          rows={14}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={browser}
          onChange={(event) => {
            setBrowser(event.target.checked);
            setText((value) =>
              withBrowserDetails(value, event.target.checked, details),
            );
          }}
        />
        <span>
          Add my browser and window size
          <small>
            Optional. It appears in the text above so you can remove it.
          </small>
        </span>
      </label>
      <div className="actions">
        <button className="primary" onClick={() => void copy()}>
          Copy report
        </button>
        <a
          className="button-link"
          href={REPORT_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open the public issue form ↗
        </a>
      </div>
      <p className="caption">
        There is no private support inbox yet. The link opens the project&apos;s
        issue tracker on GitHub, where anything you post is public and needs a
        GitHub account.
      </p>
    </div>
  );
}

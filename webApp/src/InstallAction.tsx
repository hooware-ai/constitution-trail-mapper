import { useEffect, useRef, useState } from "react";
import { Modal } from "./components";

interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}
type InstallNavigator = Navigator & {
  getInstalledRelatedApps?: () => Promise<
    { platform: string; url?: string; id?: string }[]
  >;
};

export function InstallAction() {
  const [android, setAndroid] = useState(false),
    [standalone, setStandalone] = useState(false),
    [status, setStatus] = useState<"checking" | "unknown" | "installed">(
      "checking",
    ),
    [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false),
    [guide, setGuide] = useState<"install" | "open" | null>(null),
    prompt = useRef<InstallPrompt | null>(null),
    confirmed = useRef(false),
    mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    if (!/Android/i.test(navigator.userAgent)) {
      return () => {
        mounted.current = false;
      };
    }
    setAndroid(true);
    const display = window.matchMedia("(display-mode: standalone)");
    const mode = () => setStandalone(display.matches);
    mode();
    display.addEventListener("change", mode);
    let disposed = false,
      installed = false;
    const markInstalled = () => {
      installed = true;
      confirmed.current = true;
      prompt.current = null;
      setReady(false);
      setBusy(false);
      setStatus("installed");
      setGuide(null);
    };
    const before = (event: Event) => {
      event.preventDefault();
      if (installed) return;
      prompt.current = event as InstallPrompt;
      setReady(true);
      setStatus("unknown");
    };
    window.addEventListener("beforeinstallprompt", before);
    window.addEventListener("appinstalled", markInstalled);
    // A missing prompt or failed/slow detection is unknown, never proof of installation.
    const timer = window.setTimeout(
      () =>
        setStatus((current) => (current === "checking" ? "unknown" : current)),
      3000,
    );
    const nav = navigator as InstallNavigator,
      manifest = document.querySelector<HTMLLinkElement>(
        'link[rel="manifest"]',
      );
    if (nav.getInstalledRelatedApps && manifest) {
      void Promise.resolve()
        .then(() => nav.getInstalledRelatedApps!())
        .then(
          (apps) => {
            if (disposed || installed) return;
            if (
              apps.some((app) => {
                try {
                  return (
                    app.platform === "webapp" &&
                    Boolean(app.url) &&
                    new URL(app.url!, location.href).href === manifest.href
                  );
                } catch {
                  return false;
                }
              })
            )
              markInstalled();
            else setStatus("unknown");
          },
          () => {
            if (!disposed && !installed) setStatus("unknown");
          },
        );
    } else setStatus("unknown");
    return () => {
      disposed = true;
      mounted.current = false;
      window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", before);
      window.removeEventListener("appinstalled", markInstalled);
      display.removeEventListener("change", mode);
    };
  }, []);

  async function install() {
    const event = prompt.current;
    if (!event) {
      setGuide("install");
      return;
    }
    // Chrome permits this event to be used once, only from the rider's tap.
    prompt.current = null;
    setReady(false);
    setBusy(true);
    try {
      await event.prompt();
      await event.userChoice;
    } catch {
      if (mounted.current && !confirmed.current) setGuide("install");
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  if (!android || standalone) return null;
  return (
    <>
      <button
        className="install-button"
        disabled={status === "checking" || busy}
        aria-haspopup={status === "installed" || !ready ? "dialog" : undefined}
        aria-label={
          status === "installed"
            ? "Open Trail Mapper from Home Screen"
            : undefined
        }
        title={
          status === "installed"
            ? "How to open installed Trail Mapper"
            : ready
              ? "Install Trail Mapper"
              : "How to install Trail Mapper"
        }
        onClick={() =>
          status === "installed" ? setGuide("open") : void install()
        }
      >
        {status === "checking"
          ? "Checking…"
          : busy
            ? "Installing…"
            : status === "installed"
              ? "Open"
              : "Install"}
      </button>
      {guide && (
        <Modal
          title={
            guide === "open" ? "Open Trail Mapper" : "Install Trail Mapper"
          }
          onClose={() => setGuide(null)}
        >
          {guide === "open" ? (
            <p>
              Trail Mapper is installed. Open it by tapping Trail Mapper on your
              Home Screen or in your app drawer. Chrome does not provide a
              reliable app-launch button on this page.
            </p>
          ) : (
            <>
              <p>
                In Android Chrome, open the ⋮ menu, choose{" "}
                <strong>Add to Home screen</strong>, then{" "}
                <strong>Install</strong> if offered. Chrome may offer a shortcut
                instead. Confirm the choice in Chrome.
              </p>
              <p>
                If you already installed Trail Mapper, open it from your Home
                Screen or app drawer. This browser could not confirm its
                installation.
              </p>
            </>
          )}
          <p>
            Installation uses this same site and browser-local routes. It does
            not add offline maps or background location.
          </p>
          <button className="wide" onClick={() => setGuide(null)}>
            Got it
          </button>
        </Modal>
      )}
    </>
  );
}

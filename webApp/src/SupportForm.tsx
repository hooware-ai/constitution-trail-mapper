import { useEffect, useRef, useState } from "react";
type Kind = "feedback" | "feature_request";
type Pending = { id: string; kind: Kind; message: string };
const key = (kind: Kind) => "trail-mapper.pending-support.v1." + kind;
const memory = new Map<Kind, Pending>();
function pending(kind: Kind): Pending | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(key(kind)) || "null");
    return p?.kind === kind &&
      typeof p.message === "string" &&
      /^[a-f0-9-]{36}$/i.test(p.id)
      ? p
      : memory.get(kind) || null;
  } catch {
    return memory.get(kind) || null;
  }
}
export function SupportForm({ kind, back }: { kind: Kind; back: () => void }) {
  const [saved] = useState(() => pending(kind));
  const [message, setMessage] = useState(saved?.message || "");
  const [attempted, setAttempted] = useState(!!saved);
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [receipt, setReceipt] = useState("");
  const id = useRef(saved?.id || crypto.randomUUID()),
    lock = useRef(false),
    controller = useRef<AbortController | null>(null),
    alive = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null),
    trap = useRef<HTMLInputElement>(null);
  useEffect(() => {
    alive.current = true;
    heading.current?.focus();
    return () => {
      alive.current = false;
      controller.current?.abort();
    };
  }, []);
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || receipt) return;
    const text = message.trim();
    if (text.length < 10 || text.length > 4000) {
      setStatus("Please write 10 to 4,000 characters.");
      return;
    }
    if (
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text) ||
      Array.from(text).some(
        (c) =>
          c.length === 1 &&
          c.charCodeAt(0) >= 0xd800 &&
          c.charCodeAt(0) <= 0xdfff,
      )
    ) {
      setStatus(
        "Please remove unsupported control characters from your message.",
      );
      return;
    }
    lock.current = true;
    setBusy(true);
    setAttempted(true);
    setStatus("Submitting…");
    const value = { id: id.current, kind, message: text };
    memory.set(kind, value);
    try {
      sessionStorage.setItem(key(kind), JSON.stringify(value));
    } catch {}
    const abort = new AbortController();
    controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...value, website: trap.current?.value || "" }),
        signal: abort.signal,
      });
      if (!alive.current) return;
      if (!response.ok) {
        if ([400, 403, 404, 409, 413, 415].includes(response.status)) {
          memory.delete(kind);
          try {
            sessionStorage.removeItem(key(kind));
          } catch {}
          id.current = crypto.randomUUID();
          setAttempted(false);
          setStatus(
            response.status === 400
              ? "Your message was rejected. Please edit it and submit again."
              : response.status === 413
                ? "Your message is too large. Please shorten it and submit again."
                : response.status === 409
                  ? "This receipt is already in use. Review your message before submitting it as a new request."
                  : "The server rejected this submission. Please try later or use Project contact in Help.",
          );
          return;
        }
        setStatus(
          response.status === 429
            ? "The submission limit has been reached. Please try again later. Your message has not been confirmed saved."
            : "Your submission was not confirmed saved. Please retry; the same receipt ID prevents duplicate submissions.",
        );
        return;
      }
      const result = await response.json();
      if (result.saved !== true || result.receipt !== id.current)
        throw Error("Invalid receipt");
      if (!alive.current) return;
      memory.delete(kind);
      try {
        sessionStorage.removeItem(key(kind));
      } catch {}
      setReceipt(result.receipt);
      setStatus("Submitted privately to the Trail Mapper project. Thank you.");
    } catch {
      if (alive.current)
        setStatus(
          "We could not confirm whether your submission was saved. Retry this same message; its receipt ID prevents duplicates.",
        );
    } finally {
      clearTimeout(timer);
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <div className="help support-form">
      <button onClick={back} disabled={busy}>
        ← Back to help
      </button>
      <h3 ref={heading} tabIndex={-1}>
        {kind === "feedback" ? "Send feedback" : "Request a feature"}
      </h3>
      <p>
        Only the message you submit goes to the private project collection. No
        account or email is required. Please leave out your location, routes and
        personal details. Submissions are kept privately for project review.
      </p>
      {receipt ? (
        <>
          <p role="status">{status}</p>
          <p>
            Receipt: <code>{receipt}</code>
          </p>
        </>
      ) : (
        <form onSubmit={(event) => void send(event)}>
          <label className="field">
            {kind === "feedback" ? "Feedback" : "Feature request"}
            <textarea
              required
              minLength={10}
              maxLength={4000}
              rows={7}
              value={message}
              readOnly={attempted}
              disabled={busy}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
          <p className="caption">
            10–4,000 characters. We use your network address for spam limits
            without storing it directly.
          </p>
          <div hidden aria-hidden="true">
            <label>
              Website
              <input
                ref={trap}
                name="website"
                tabIndex={-1}
                autoComplete="off"
              />
            </label>
          </div>
          <button type="submit" className="primary wide" disabled={busy}>
            {busy
              ? "Submitting…"
              : attempted
                ? "Retry submission"
                : kind === "feedback"
                  ? "Submit feedback"
                  : "Submit feature request"}
          </button>
          <p role="status" aria-live="polite">
            {status}
          </p>
          {attempted && !busy && (
            <p className="caption">
              This message stays in this tab for retry. It is locked to preserve
              the same submission and avoid duplicates.
            </p>
          )}
        </form>
      )}
    </div>
  );
}

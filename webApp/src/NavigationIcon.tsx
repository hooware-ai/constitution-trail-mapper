/** Decorative UI marks inherit the control's contrast-tested colour, rather than an OS emoji palette. */
export function NavigationIcon({
  name,
}: {
  name: "plan" | "saved" | "explore" | "updates" | "help";
}) {
  return (
    <svg
      className="navigation-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "plan" && <path d="M5 19 19 5M7 5h12v12" />}
      {name === "saved" && (
        <path d="M12 20 4.5 12.5C-1 7 6 1 12 7c6-6 13 0 7.5 5.5Z" />
      )}
      {name === "explore" && <path d="m12 3 9 9-9 9-9-9Z" />}
      {name === "updates" && (
        <>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="4" />
        </>
      )}
      {name === "help" && (
        <>
          <path d="M8 8a4 4 0 1 1 6 3.5c-1.5.8-2 1.5-2 3" />
          <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}

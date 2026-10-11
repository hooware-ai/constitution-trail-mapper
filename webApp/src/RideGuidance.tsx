import { useEffect, useRef, useState, type ReactNode } from "react";

// Scrollable text must remain reachable in engines that do not automatically
// put scroll containers in the keyboard order. Do not add a stop when it fits.
export function RideGuidance({
  phase,
  children,
}: {
  phase: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const overflow = getComputedStyle(element).overflowY;
      setScrollable(
        (overflow === "auto" || overflow === "scroll") &&
          element.clientHeight > 0 &&
          element.scrollHeight > element.clientHeight + 1,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return (
    <div
      ref={ref}
      className={"guidance ride-guidance " + phase}
      role="region"
      aria-label="Ride guidance"
      aria-live="polite"
      tabIndex={scrollable ? 0 : -1}
    >
      {children}
    </div>
  );
}

import { useLayoutEffect, useState } from "react";

// The scrolling region must retain a real viewport at large text sizes. Intrinsic
// min-content sizing includes all of its text, so measure only the fixed controls.
export function useRideDockLayout() {
  const [dock, setDock] = useState<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!dock) return;
    const directions = dock.querySelector<HTMLElement>(".ride-directions")!;
    const actions = dock.querySelector<HTMLElement>(".ride-actions")!;
    let previous = "";
    const measure = () => {
      const dockStyle = getComputedStyle(dock);
      const actionsStyle = getComputedStyle(actions);
      const bodyMinimum = 44 + directions.getBoundingClientRect().height;
      const dockMinimum =
        bodyMinimum +
        actions.getBoundingClientRect().height +
        parseFloat(actionsStyle.marginTop) +
        parseFloat(dockStyle.paddingTop) +
        parseFloat(dockStyle.paddingBottom);
      const next = `${bodyMinimum}/${dockMinimum}`;
      if (next === previous) return;
      previous = next;
      dock.style.setProperty("--ride-body-min-height", `${bodyMinimum}px`);
      dock.style.setProperty("--ride-dock-min-height", `${dockMinimum}px`);
      // Let short portrait guidance use the remaining space before the dock
      // grows its optional scroll viewport beyond the reserved 44 pixels.
      dock.parentElement!.style.setProperty(
        "--ride-dock-min-height",
        `${dockMinimum}px`,
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(directions);
    observer.observe(actions);
    window.addEventListener("resize", measure);
    // Measure synchronously before paint, including the first navigation frame.
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [dock]);
  return setDock;
}

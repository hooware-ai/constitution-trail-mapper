import { useCallback, useLayoutEffect, useState, type RefObject } from "react";

// The short landscape preview (styles.css) puts the route panel beside the map and sticks the Start dock to the bottom
// of the scrolling panel. With very large text the panel is too short for that: the dock leaves too little room for
// the controls above Start. This chooses between the sticky dock and the normal flow from the measured panel and
// dock including its occupied padding, and keeps the panel's bottom scroll padding equal to the dock's actual height (including its safe-area padding)
// and the panel padding beneath it, so a control scrolled into view stops above the dock rather than beneath it.
const SHORT_LANDSCAPE = "(max-height: 500px) and (min-width: 500px)";
const ATTRIBUTE = "data-start-dock";
const GAP = 12;

/** Returns the callback ref for the Start dock; the policy runs while it is mounted and is removed when it unmounts. */
export function usePreviewDockLayout(
  workspaceRef: RefObject<HTMLElement | null>,
  panelRef: RefObject<HTMLElement | null>,
) {
  const [dock, setDock] = useState<HTMLElement | null>(null);
  const dockRef = useCallback((element: HTMLElement | null) => {
    setDock(element);
  }, []);

  useLayoutEffect(() => {
    const workspace = workspaceRef.current,
      panel = panelRef.current;
    if (!dock || !workspace || !panel) return;
    const media = window.matchMedia(SHORT_LANDSCAPE);
    let frame = 0;
    const controls = () =>
      [
        ...panel.querySelectorAll<HTMLElement>(
          "button, input, select, textarea, a[href], summary",
        ),
      ].filter((control) =>
        Boolean(
          control.compareDocumentPosition(dock) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      );

    // Neither the attribute nor the padding changes the panel's or the dock's size, so writing them cannot feed back
    // into the next measurement; writes are skipped when nothing changed.
    const measure = () => {
      frame = 0;
      if (!media.matches) {
        workspace.removeAttribute(ATTRIBUTE);
        panel.style.removeProperty("scroll-padding-bottom");
        panel.style.removeProperty("scroll-padding-top");
        dock.style.removeProperty("--start-dock-after");
        return;
      }
      const rem = parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      const panelHeight = panel.getBoundingClientRect().height,
        dockHeight = dock.getBoundingClientRect().height;
      // The dock also covers the panel's bottom inset. Reserve a gap above that occupied space: if this leaves less
      // room for a whole preceding control, normal flow avoids overlap and keeps each control independently reachable.
      const inset = parseFloat(getComputedStyle(panel).paddingBottom) || 0;
      const reserved = Math.ceil(dockHeight + inset) + GAP;
      const controlHeight = Math.max(
        0,
        ...controls().map((control) => control.getBoundingClientRect().height),
      );
      const flow =
        panelHeight <= 9 * rem || panelHeight - reserved < controlHeight + GAP;
      const mode = flow ? "flow" : "sticky";
      if (workspace.getAttribute(ATTRIBUTE) !== mode)
        workspace.setAttribute(ATTRIBUTE, mode);
      // Native scrolling of Start must also leave room for the blocked reason beneath its button in flow mode.
      const button = dock.querySelector("button");
      const after = button
        ? Math.max(
            0,
            Math.ceil(
              dock.getBoundingClientRect().bottom -
                button.getBoundingClientRect().bottom,
            ),
          ) + GAP
        : 0;
      const afterValue = `${after}px`;
      if (dock.style.getPropertyValue("--start-dock-after") !== afterValue)
        dock.style.setProperty("--start-dock-after", afterValue);
      // When a flow dock fits as a whole, compensate only the measured centering deficit above a scroll to its reason. Otherwise
      // the reason can be centred while the two-line Start immediately above it is clipped by the panel's top edge.
      const reasonTop =
        flow &&
        dock.querySelector("#start-reason") &&
        dockHeight + 2 * GAP <= panelHeight &&
        button
          ? `${Math.max(GAP, Math.ceil(dockHeight + button.getBoundingClientRect().height - panelHeight) + GAP)}px`
          : "";
      if (panel.style.getPropertyValue("scroll-padding-top") !== reasonTop) {
        if (reasonTop) panel.style.setProperty("scroll-padding-top", reasonTop);
        else panel.style.removeProperty("scroll-padding-top");
      }
      const padding = flow ? "" : `${reserved}px`;
      if (panel.style.getPropertyValue("scroll-padding-bottom") !== padding) {
        if (padding) panel.style.setProperty("scroll-padding-bottom", padding);
        else panel.style.removeProperty("scroll-padding-bottom");
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    // Sizes (including the dock's text wrapping or a new blocked reason) are re-measured on the next frame, outside the
    // ResizeObserver callback; a root font size change after load resizes the dock and is also watched directly.
    const resize = new ResizeObserver(schedule);
    resize.observe(workspace);
    resize.observe(panel);
    resize.observe(dock);
    let observedControls = new Set<Element>();
    const bindControls = () => {
      const current = new Set<Element>(controls());
      for (const control of observedControls)
        if (!current.has(control)) resize.unobserve(control);
      for (const control of current)
        if (!observedControls.has(control)) resize.observe(control);
      observedControls = current;
    };
    bindControls();
    const panelContent = new MutationObserver(() => {
      bindControls();
      schedule();
    });
    // Content changes can mount or wrap a target without changing the fixed-height panel. Ignore attributes so our
    // own scroll padding and dock mode cannot cause an observer loop.
    panelContent.observe(panel, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    const rootStyle = new MutationObserver(schedule);
    rootStyle.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    window.addEventListener("resize", schedule);
    media.addEventListener("change", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      rootStyle.disconnect();
      panelContent.disconnect();
      window.removeEventListener("resize", schedule);
      media.removeEventListener("change", schedule);
      workspace.removeAttribute(ATTRIBUTE);
      panel.style.removeProperty("scroll-padding-bottom");
      panel.style.removeProperty("scroll-padding-top");
      dock.style.removeProperty("--start-dock-after");
    };
  }, [dock, workspaceRef, panelRef]);

  return dockRef;
}

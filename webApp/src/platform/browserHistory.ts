/**
 * Browser Back/Forward for the single-page app. History entries carry only an ordinal, a screen name and an
 * overlay flag: never endpoints, labels, geometry or a changed URL, so nothing private reaches the address
 * bar, the history list or a shared link.
 */
export interface HistoryState {
  tm: number;
  screen: string;
  overlay?: boolean;
}
export interface HistoryLike {
  readonly state: unknown;
  pushState(state: unknown, unused: string): void;
  replaceState(state: unknown, unused: string): void;
  back(): void;
}
export type PopDirection = "back" | "forward";
export interface PopContext {
  screen: string;
  overlayOpen: boolean;
  /** A ride is being followed on screen. */
  navigating: boolean;
  /** A route preview exists to return to. */
  hasPreview: boolean;
}
export type PopAction =
  /** Back dismisses the open dialog/chooser instead of leaving the screen. */
  | { type: "close-overlay" }
  /** Never stop, pause or restart a ride from a history step: stay and tell the rider. */
  | { type: "keep-navigating" }
  /** Nothing safe to show for that entry: keep the current screen. */
  | { type: "stay" }
  | { type: "go"; screen: string };
export const isHistoryState = (value: unknown): value is HistoryState =>
  !!value &&
  typeof value === "object" &&
  Number.isInteger((value as HistoryState).tm) &&
  typeof (value as HistoryState).screen === "string";

/** What a Back/Forward step should do, given what is on screen now and what the entry recorded. */
export function resolvePop(
  context: PopContext,
  target: HistoryState,
  direction: PopDirection,
): PopAction {
  if (context.overlayOpen) return { type: "close-overlay" };
  if (context.navigating) return { type: "keep-navigating" };
  // Entries for dialogs, choosers and a ride are never re-entered by stepping forward or after reload.
  if (target.overlay) return { type: "stay" };
  if (target.screen === "navigation") return { type: "stay" };
  // Transient screens return to the planner they came from.
  if (target.screen === "searching" || target.screen === "map-picker")
    return context.screen === "planner"
      ? { type: "stay" }
      : { type: "go", screen: "planner" };
  if (target.screen === "preview" && !context.hasPreview)
    return direction === "back"
      ? { type: "go", screen: "plan" }
      : { type: "stay" };
  if (target.screen === context.screen) return { type: "stay" };
  return { type: "go", screen: target.screen };
}

/** Serialises history operations so a pop that undoes an overlay never races the next push. */
export class BrowserHistorySync {
  private index = 0;
  private queue: Promise<void> = Promise.resolve();
  private release: (() => void) | null = null;
  constructor(
    private history: HistoryLike,
    private onPop: (target: HistoryState, direction: PopDirection) => void,
  ) {}
  /** Adopt the entry the page loaded with (a reload keeps its state) and label it with the real screen. */
  start(screen: string): void {
    const current = this.history.state;
    this.index = isHistoryState(current) ? current.tm : 0;
    this.history.replaceState(
      { tm: this.index, screen } satisfies HistoryState,
      "",
    );
  }
  get position(): number {
    return this.index;
  }
  push(screen: string, overlay = false): void {
    this.enqueue(() => {
      const state: HistoryState = overlay
        ? { tm: this.index + 1, screen, overlay: true }
        : { tm: this.index + 1, screen };
      this.history.pushState(state, "");
      this.index = state.tm;
    });
  }
  /** Relabel the current entry to match what is really on screen. */
  replace(screen: string): void {
    this.enqueue(() => {
      this.history.replaceState(
        { tm: this.index, screen } satisfies HistoryState,
        "",
      );
    });
  }
  /** Drop an overlay entry after the app closed it itself. */
  popOverlay(): void {
    this.enqueue(
      () =>
        new Promise<void>((resolve) => {
          // If no pop ever arrives (nothing earlier to go back to) do not stall later history steps.
          const timer = setTimeout(() => {
            this.release = null;
            resolve();
          }, 1000);
          this.release = () => {
            clearTimeout(timer);
            resolve();
          };
          this.history.back();
        }),
    );
  }
  handlePop(state: unknown): void {
    if (this.release) {
      const done = this.release;
      this.release = null;
      if (isHistoryState(state)) this.index = state.tm;
      done();
      return;
    }
    if (!isHistoryState(state)) return;
    const direction: PopDirection = state.tm < this.index ? "back" : "forward";
    this.index = state.tm;
    this.onPop(state, direction);
  }
  private enqueue(step: () => void | Promise<void>): void {
    this.queue = this.queue.then(step).catch(() => {});
  }
}

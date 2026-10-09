export type WakeLockStatus =
  | "unsupported"
  | "inactive"
  | "requesting"
  | "held"
  | "denied"
  | "released";
export interface WakeLockHandle {
  released: boolean;
  release(): Promise<void>;
  addEventListener(
    type: "release",
    callback: () => void,
    options?: { once?: boolean },
  ): void;
}
export interface WakeLockPort {
  request(type: "screen"): Promise<WakeLockHandle>;
}
/** Wake lock improves foreground use only. It cannot keep a background tab navigating. */
export class ForegroundWakeLock {
  status: WakeLockStatus;
  private generation = 0;
  private active = false;
  private visible = true;
  private handle: WakeLockHandle | null = null;
  private listeners = new Set<(status: WakeLockStatus) => void>();
  constructor(private port?: WakeLockPort) {
    this.status = port ? "inactive" : "unsupported";
  }
  subscribe(listener: (status: WakeLockStatus) => void): () => void {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }
  private publish(status: WakeLockStatus): void {
    this.status = status;
    this.listeners.forEach((listener) => listener(status));
  }
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (active && this.visible) void this.acquire();
    else this.release();
  }
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (visible && this.active) void this.acquire();
    else this.release();
  }
  /** An explicit retry can follow a denied request; denial never retries in a loop. */
  retry(): void {
    if (
      this.active &&
      this.visible &&
      this.status !== "requesting" &&
      this.status !== "held"
    )
      void this.acquire();
  }
  private async acquire(): Promise<void> {
    if (!this.port) {
      this.publish("unsupported");
      return;
    }
    const generation = ++this.generation;
    this.publish("requesting");
    try {
      const handle = await this.port.request("screen");
      if (generation !== this.generation || !this.active || !this.visible) {
        await handle.release();
        return;
      }
      if (handle.released) {
        this.publish("released");
        return;
      }
      this.handle = handle;
      handle.addEventListener(
        "release",
        () => {
          if (generation !== this.generation || this.handle !== handle) return;
          this.handle = null;
          this.publish("released");
        },
        { once: true },
      );
      this.publish("held");
    } catch {
      if (generation === this.generation) this.publish("denied");
    }
  }
  private release(): void {
    ++this.generation;
    const handle = this.handle;
    this.handle = null;
    if (handle && !handle.released) void handle.release().catch(() => {});
    this.publish(this.port ? "inactive" : "unsupported");
  }
  dispose(): void {
    this.active = false;
    this.release();
    this.listeners.clear();
  }
}

type Pending = {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type WorkerPort = Pick<
  Worker,
  "postMessage" | "terminate" | "onmessage" | "onerror"
>;
export const ROUTING_UNAVAILABLE_MESSAGE =
  "Route planning stopped unexpectedly. Your places and current route are safe. Restart route planning, or reload the page if it keeps happening.";
/** The worker died; requests are refused until `recover()` starts a working replacement. */
export class RoutingUnavailableError extends Error {
  constructor(message = ROUTING_UNAVAILABLE_MESSAGE) {
    super(message);
    this.name = "RoutingUnavailableError";
  }
}
/** Routing has an interruptible process boundary: cancellation terminates synchronous graph work. */
export class RoutingClient {
  private worker: WorkerPort;
  private serial = 0;
  private generation = 0;
  private pending = new Map<number, Pending>();
  private bootRequest: Record<string, unknown> | null = null;
  private ready: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private unavailable: RoutingUnavailableError | null = null;
  private recovering: Promise<unknown> | null = null;
  /** Notified when the client enters or leaves the terminally-failed state. */
  onUnavailableChange: ((unavailable: boolean) => void) | null = null;
  constructor(
    private createWorker: () => WorkerPort = () =>
      new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    private timeoutMs = 120000,
  ) {
    this.worker = this.spawn();
  }
  /** True after a terminal worker failure until `recover()` succeeds. */
  get isUnavailable() {
    return this.unavailable !== null;
  }
  private spawn() {
    const worker = this.createWorker();
    worker.onmessage = ({ data }: MessageEvent) => {
      if (worker !== this.worker) return;
      const p = this.pending.get(data.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(data.id);
      if (
        data.result.ok === false ||
        (data.result.route === null && data.result.error)
      )
        p.reject(
          Object.assign(
            new Error(data.result.error ?? "No safe route was found."),
            data.result.code ? { code: data.result.code as string } : {},
          ),
        );
      else p.resolve(data.result);
    };
    worker.onerror = () => {
      // A superseded worker (cancelled, recovered or disposed) must not fail its replacement.
      if (worker !== this.worker || this.disposed) return;
      this.terminalFailure();
    };
    return worker;
  }
  /**
   * After the first successful boot: every later boot of this client (restart or cancellation) loads exactly the data
   * the page started with instead of asking the site what is current.
   */
  pinDataset(record: unknown) {
    if (this.bootRequest)
      this.bootRequest = { ...this.bootRequest, pinned: record };
  }
  async call<T = any>(request: Record<string, unknown>): Promise<T> {
    if (this.disposed) throw new Error("Routing has been closed.");
    if (request.op === "boot") {
      this.bootRequest = request;
      if (this.unavailable) return this.recover() as Promise<T>;
      this.ready = this.send(request);
      return this.ready as Promise<T>;
    }
    if (this.unavailable) throw this.unavailable;
    const generation = this.generation;
    await this.ready;
    if (generation !== this.generation) throw new Error("Search cancelled.");
    if (this.unavailable) throw this.unavailable;
    return this.send(request);
  }
  private send<T = any>(request: Record<string, unknown>): Promise<T> {
    if (this.disposed)
      return Promise.reject(new Error("Routing has been closed."));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(
            "Route search took too long. Try a nearer point or a shorter loop.",
          ),
        );
        // Boot itself can fail offline: do not recursively retry it.
        if (request.op !== "boot") void this.cancel().catch(() => {});
        else {
          this.worker.terminate();
          this.fail(
            new Error("Routing initialization timed out. Reload to try again."),
          );
        }
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, request });
    });
  }
  /** Rehydrate the selected dataset after killing the old worker; subsequent calls await readiness. */
  cancel(): Promise<unknown> {
    if (this.disposed) return Promise.resolve();
    // A failed worker is only ever replaced by an explicit recover().
    if (this.unavailable) return this.recovering ?? Promise.resolve();
    ++this.generation;
    this.worker.terminate();
    this.fail(new Error("Search cancelled."));
    this.ready = this.startWorker();
    this.ready.catch((error) => {
      if (error instanceof RoutingUnavailableError) this.markUnavailable();
    });
    return this.ready;
  }
  /**
   * Explicit, rider-initiated replacement of a terminally failed worker. Never called automatically,
   * so a persistent fault cannot loop. Routing stays unavailable (and requests are refused) until the
   * replacement has finished initializing; if that fails or times out the rider can simply try again.
   */
  recover(): Promise<unknown> {
    if (this.disposed) return Promise.resolve();
    if (this.recovering) return this.recovering;
    if (!this.unavailable) return this.ready;
    ++this.generation;
    this.worker.terminate();
    const attempt = this.startWorker().then(
      (booted) => {
        this.recovering = null;
        this.unavailable = null;
        this.onUnavailableChange?.(false);
        return booted;
      },
      (error) => {
        this.recovering = null;
        this.markUnavailable();
        throw error;
      },
    );
    this.recovering = attempt;
    this.ready = attempt;
    void attempt.catch(() => {});
    return attempt;
  }
  private startWorker(): Promise<unknown> {
    try {
      this.worker = this.spawn();
    } catch {
      return Promise.reject(new RoutingUnavailableError());
    }
    const booted = this.bootRequest
      ? this.send(this.bootRequest)
      : Promise.resolve();
    void booted.catch(() => {});
    return booted;
  }
  private markUnavailable() {
    if (this.unavailable) return;
    this.unavailable = new RoutingUnavailableError();
    this.onUnavailableChange?.(true);
  }
  private terminalFailure() {
    this.worker.terminate();
    const first = !this.unavailable;
    this.unavailable ??= new RoutingUnavailableError();
    this.fail(this.unavailable);
    if (first) this.onUnavailableChange?.(true);
  }
  private fail(error: Error) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  dispose() {
    this.disposed = true;
    this.worker.terminate();
    this.fail(new Error("Search cancelled."));
  }
}

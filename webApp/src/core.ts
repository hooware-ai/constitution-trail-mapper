type Pending = {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type WorkerPort = Pick<
  Worker,
  "postMessage" | "terminate" | "onmessage" | "onerror"
>;
/** Routing has an interruptible process boundary: cancellation terminates synchronous graph work. */
export class RoutingClient {
  private worker: WorkerPort;
  private serial = 0;
  private generation = 0;
  private pending = new Map<number, Pending>();
  private bootRequest: Record<string, unknown> | null = null;
  private ready: Promise<unknown> = Promise.resolve();
  private disposed = false;
  constructor(
    private createWorker: () => WorkerPort = () =>
      new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }),
    private timeoutMs = 120000,
  ) {
    this.worker = this.spawn();
  }
  private spawn() {
    const worker = this.createWorker();
    worker.onmessage = ({ data }: MessageEvent) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(data.id);
      if (
        data.result.ok === false ||
        (data.result.route === null && data.result.error)
      )
        p.reject(new Error(data.result.error ?? "No safe route was found."));
      else p.resolve(data.result);
    };
    worker.onerror = () =>
      this.fail(
        "Routing could not start. Rebuild the shared Kotlin core, then reload.",
      );
    return worker;
  }
  async call<T = any>(request: Record<string, unknown>): Promise<T> {
    if (this.disposed) throw new Error("Routing has been closed.");
    if (request.op === "boot") {
      this.bootRequest = request;
      this.ready = this.send(request);
      return this.ready as Promise<T>;
    }
    const generation = this.generation;
    await this.ready;
    if (generation !== this.generation) throw new Error("Search cancelled.");
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
          this.fail("Routing initialization timed out. Reload to try again.");
        }
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ id, request });
    });
  }
  /** Rehydrate the selected dataset after killing the old worker; subsequent calls await readiness. */
  cancel(): Promise<unknown> {
    if (this.disposed) return Promise.resolve();
    ++this.generation;
    this.worker.terminate();
    this.fail("Search cancelled.");
    this.worker = this.spawn();
    this.ready = this.bootRequest
      ? this.send(this.bootRequest)
      : Promise.resolve();
    void this.ready.catch(() => {});
    return this.ready;
  }
  private fail(message: string) {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    this.pending.clear();
  }
  dispose() {
    this.disposed = true;
    this.worker.terminate();
    this.fail("Search cancelled.");
  }
}

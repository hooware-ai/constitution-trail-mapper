import { test } from "node:test";
import assert from "node:assert/strict";
import { RoutingClient } from "../../src/core";
class FakeWorker {
  onmessage: ((e: any) => void) | null = null;
  onerror: any = null;
  terminated = false;
  sent: any[] = [];
  postMessage(message: any) {
    this.sent.push(message);
    if (message.request.op === "boot")
      queueMicrotask(() =>
        this.onmessage?.({
          data: { id: message.id, result: { ok: true, featureCount: 2 } },
        }),
      );
  }
  terminate() {
    this.terminated = true;
  }
  answer(result: any) {
    const message = this.sent.at(-1);
    this.onmessage?.({ data: { id: message.id, result } });
  }
}
test("cancel stops CPU worker, rejects old work and rehydrates before accepting new planning", async () => {
  const workers: FakeWorker[] = [];
  const client = new RoutingClient(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w as any;
  });
  await client.call({ op: "boot", local: false });
  const stale = client.call({ op: "plan" });
  await Promise.resolve();
  const rejected = assert.rejects(stale, /cancelled/);
  await client.cancel();
  await rejected;
  assert.equal(workers[0].terminated, true);
  assert.equal(workers[1].sent[0].request.op, "boot");
  const fresh = client.call({ op: "plan" });
  await Promise.resolve();
  workers[1].answer({ ok: true, route: { test: true } });
  assert.deepEqual((await fresh).route, { test: true });
  client.dispose();
});
test("null no-route outcome rejects instead of entering recents", async () => {
  const worker = new FakeWorker();
  const client = new RoutingClient(() => worker as any);
  await client.call({ op: "boot" });
  const failure = client.call({ op: "plan" });
  await Promise.resolve();
  worker.answer({
    ok: true,
    route: null,
    error: "No safe route avoids closure",
  });
  await assert.rejects(failure, /closure/);
  client.dispose();
});

test("cancelling before a queued call posts cannot leak abandoned work into the replacement", async () => {
  const workers: FakeWorker[] = [];
  const client = new RoutingClient(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w as any;
  });
  await client.call({ op: "boot" });
  const abandoned = client.call({ op: "plan" });
  const failed = assert.rejects(abandoned, /cancelled/);
  await client.cancel();
  await failed;
  assert.deepEqual(
    workers[1].sent.map((x) => x.request.op),
    ["boot"],
  );
  client.dispose();
});
test("boot timeout terminates the worker and never starts an automatic retry", async () => {
  const workers: FakeWorker[] = [];
  const client = new RoutingClient(() => {
    const w = new FakeWorker();
    w.postMessage = (message: any) => {
      w.sent.push(message);
    };
    workers.push(w);
    return w as any;
  }, 5);
  await assert.rejects(client.call({ op: "boot" }), /too long/);
  assert.equal(workers[0].terminated, true);
  assert.equal(workers.length, 1);
  client.dispose();
});

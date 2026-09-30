import { test } from "node:test";
import assert from "node:assert/strict";
import { RoutingClient, RoutingUnavailableError } from "../../src/core";
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
  crash() {
    this.onerror?.(new Event("error"));
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

const tracked = (timeoutMs = 120000) => {
  const workers: FakeWorker[] = [];
  const client = new RoutingClient(() => {
    const w = new FakeWorker();
    workers.push(w);
    return w as any;
  }, timeoutMs);
  return { workers, client };
};
test("an idle terminal error refuses new work immediately instead of posting to the dead worker", async () => {
  const { workers, client } = tracked();
  await client.call({ op: "boot" });
  workers[0].crash();
  assert.equal(client.isUnavailable, true);
  assert.equal(workers[0].terminated, true);
  await assert.rejects(client.call({ op: "plan" }), RoutingUnavailableError);
  assert.equal(workers[0].sent.length, 1);
  assert.equal(workers.length, 1);
  client.dispose();
});
test("a terminal error rejects the pending request with the unavailable error and does not retry automatically", async () => {
  const { workers, client } = tracked();
  await client.call({ op: "boot" });
  const pending = client.call({ op: "plan" });
  await Promise.resolve();
  const rejected = assert.rejects(pending, RoutingUnavailableError);
  workers[0].crash();
  await rejected;
  assert.equal(workers.length, 1);
  client.dispose();
});
test("recover starts a replacement, re-boots it and the next call succeeds without the request timeout", async () => {
  const { workers, client } = tracked();
  const changes: boolean[] = [];
  client.onUnavailableChange = (down) => changes.push(down);
  await client.call({ op: "boot", local: true });
  workers[0].crash();
  await client.recover();
  assert.equal(client.isUnavailable, false);
  assert.equal(workers.length, 2);
  assert.deepEqual(workers[1].sent[0].request, { op: "boot", local: true });
  const fresh = client.call({ op: "plan" });
  await Promise.resolve();
  workers[1].answer({ ok: true, route: { fresh: true } });
  assert.deepEqual((await fresh).route, { fresh: true });
  assert.deepEqual(changes, [true, false]);
  client.dispose();
});
test("a call made while recovery boots is refused and the recovery fails if the replacement also crashes", async () => {
  const workers: FakeWorker[] = [];
  const client = new RoutingClient(() => {
    const w = new FakeWorker();
    // Only the first worker answers boot; the replacement stays silent, then crashes.
    if (workers.length > 0) w.postMessage = (m: any) => void w.sent.push(m);
    workers.push(w);
    return w as any;
  });
  await client.call({ op: "boot" });
  workers[0].crash();
  const recovering = client.recover();
  const waiting = client.call({ op: "plan" });
  const both = Promise.all([
    assert.rejects(recovering, RoutingUnavailableError),
    assert.rejects(waiting, RoutingUnavailableError),
  ]);
  workers[1].crash();
  await both;
  assert.equal(client.isUnavailable, true);
  assert.equal(workers.length, 2);
  await assert.rejects(client.call({ op: "plan" }), RoutingUnavailableError);
  client.dispose();
});
test("a late error from a superseded worker cannot fail its healthy replacement", async () => {
  const { workers, client } = tracked();
  await client.call({ op: "boot" });
  await client.cancel();
  workers[0].crash();
  assert.equal(client.isUnavailable, false);
  const fresh = client.call({ op: "plan" });
  await Promise.resolve();
  workers[1].answer({ ok: true, route: { fine: true } });
  assert.deepEqual((await fresh).route, { fine: true });
  client.dispose();
});
test("a no-route result is a normal rejection, not a terminal worker failure", async () => {
  const { workers, client } = tracked();
  await client.call({ op: "boot" });
  const failure = client.call({ op: "plan" });
  await Promise.resolve();
  workers[0].answer({ ok: false, error: "No safe route." });
  await assert.rejects(failure, /No safe route/);
  assert.equal(client.isUnavailable, false);
  client.dispose();
});
test("a boot-time terminal error rejects boot in rider language and can be recovered", async () => {
  const workers: FakeWorker[] = [];
  const client = new RoutingClient(() => {
    const w = new FakeWorker();
    if (workers.length === 0) w.postMessage = (m: any) => void w.sent.push(m);
    workers.push(w);
    return w as any;
  });
  const boot = client.call({ op: "boot" });
  await Promise.resolve();
  const rejected = assert.rejects(boot, (error: Error) => {
    assert.ok(error instanceof RoutingUnavailableError);
    assert.doesNotMatch(error.message, /Kotlin|rebuild/i);
    return true;
  });
  workers[0].crash();
  await rejected;
  await client.recover();
  assert.equal(client.isUnavailable, false);
  client.dispose();
});

test("a failed replacement boot keeps routing unavailable and a later rider attempt starts a third worker", async () => {
  const workers: FakeWorker[] = [];
  const changes: boolean[] = [];
  const client = new RoutingClient(() => {
    const w = new FakeWorker();
    if (workers.length === 1)
      // The first replacement boots with an ordinary error (for example the data fetch failed).
      w.postMessage = (message: any) => {
        w.sent.push(message);
        queueMicrotask(() =>
          w.onmessage?.({
            data: {
              id: message.id,
              result: { ok: false, error: "data failed" },
            },
          }),
        );
      };
    workers.push(w);
    return w as any;
  });
  client.onUnavailableChange = (down) => changes.push(down);
  await client.call({ op: "boot" });
  workers[0].crash();
  await assert.rejects(client.recover(), /data failed/);
  assert.equal(client.isUnavailable, true);
  assert.equal(workers.length, 2);
  // Still refused while unavailable, and another rider-triggered attempt is possible.
  await assert.rejects(client.call({ op: "plan" }), RoutingUnavailableError);
  await client.recover();
  assert.equal(client.isUnavailable, false);
  assert.equal(workers.length, 3);
  assert.deepEqual(changes, [true, false]);
  client.dispose();
});
test("a replacement boot that times out is terminated and retryable", async () => {
  const workers: FakeWorker[] = [];
  const client = new RoutingClient(() => {
    const w = new FakeWorker();
    if (workers.length === 1)
      w.postMessage = (message: any) => void w.sent.push(message);
    workers.push(w);
    return w as any;
  }, 5);
  await client.call({ op: "boot" });
  workers[0].crash();
  await assert.rejects(client.recover(), /too long/);
  assert.equal(workers[1].terminated, true);
  assert.equal(client.isUnavailable, true);
  await client.recover();
  assert.equal(client.isUnavailable, false);
  assert.equal(workers.length, 3);
  client.dispose();
});
test("no request is accepted while a replacement is still initializing", async () => {
  const workers: FakeWorker[] = [];
  const client = new RoutingClient(() => {
    const w = new FakeWorker();
    if (workers.length === 1)
      w.postMessage = (message: any) => void w.sent.push(message);
    workers.push(w);
    return w as any;
  });
  await client.call({ op: "boot" });
  workers[0].crash();
  const recovering = client.recover();
  assert.equal(client.recover(), recovering);
  await assert.rejects(client.call({ op: "plan" }), RoutingUnavailableError);
  assert.equal(workers[1].sent.length, 1);
  workers[1].onmessage?.({
    data: { id: workers[1].sent[0].id, result: { ok: true } },
  });
  await recovering;
  assert.equal(client.isUnavailable, false);
  client.dispose();
});

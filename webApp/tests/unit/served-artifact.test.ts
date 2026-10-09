import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type RequestListener } from "node:http";
import { verifyServedProvenance } from "../../tools/lib/served-artifact.mjs";

const expected = Buffer.from('{"source":{"commit":"current"}}');
async function server(handler: RequestListener) {
  const instance = createServer(handler);
  await new Promise<void>((resolve) =>
    instance.listen(0, "127.0.0.1", resolve),
  );
  const address = instance.address();
  assert(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      instance.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        instance.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

test("matching selected artifact provenance passes through a real loopback server", async () => {
  const paths: Array<string | undefined> = [];
  const host = await server((request, response) => {
    paths.push(request.url);
    response.end(expected);
  });
  try {
    await verifyServedProvenance(host.url, expected);
    assert.deepEqual(paths, ["/provenance.json"]);
  } finally {
    await host.close();
  }
});

test("a valid older provenance or byte change refuses instead of accepting a stale server", async () => {
  for (const body of [
    Buffer.from('{"source":{"commit":"older"}}'),
    Buffer.concat([expected, Buffer.from("\n")]),
  ]) {
    const host = await server((_, response) => response.end(body));
    try {
      await assert.rejects(
        verifyServedProvenance(host.url, expected),
        /Served provenance differs/,
      );
    } finally {
      await host.close();
    }
  }
});

test("missing provenance refuses even if the error body matches local bytes", async () => {
  const host = await server((_, response) => {
    response.writeHead(404);
    response.end(expected);
  });
  try {
    await assert.rejects(
      verifyServedProvenance(host.url, expected),
      (error: Error) =>
        /Cannot verify/.test(error.message) &&
        String(error.cause).includes("HTTP 404"),
    );
  } finally {
    await host.close();
  }
});

test("redirected provenance refuses without contacting the redirect destination", async () => {
  let targetRequests = 0;
  const target = await server((_, response) => {
    targetRequests++;
    response.end(expected);
  });
  const host = await server((_, response) => {
    response.writeHead(302, { Location: target.url + "/provenance.json" });
    response.end();
  });
  try {
    await assert.rejects(
      verifyServedProvenance(host.url, expected),
      /Cannot verify/,
    );
    assert.equal(targetRequests, 0);
  } finally {
    await host.close();
    await target.close();
  }
});

test("an unresponsive provenance endpoint times out and refuses", async () => {
  const host = await server(() => {});
  try {
    await assert.rejects(
      verifyServedProvenance(host.url, expected, { timeoutMs: 30 }),
      /Cannot verify/,
    );
  } finally {
    await host.close();
  }
});

test("a provenance response that sends headers but stalls its body also times out", async () => {
  const host = await server((_, response) => {
    response.writeHead(200);
    response.flushHeaders();
  });
  try {
    await assert.rejects(
      verifyServedProvenance(host.url, expected, { timeoutMs: 30 }),
      /Cannot verify/,
    );
  } finally {
    await host.close();
  }
});

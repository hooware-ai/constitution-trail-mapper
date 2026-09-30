import { test, expect, type Response } from "@playwright/test";
import { createHash } from "node:crypto";

// Runs only against a county-mode artifact (TRAIL_EXPECT_DATASET=county): the dataset files are served with the
// right headers, the app loads them without foreign requests, and the recorded provenance names exactly them.
test.skip(
  process.env.TRAIL_EXPECT_DATASET !== "county",
  "county artifact tests run against a county build only",
);

test("the dataset record is revalidated on every load while the hash-named network is immutable", async ({
  page,
  request,
  baseURL,
}) => {
  const responses: Response[] = [];
  const origins = new Set<string>();
  const consoleErrors: string[] = [];
  page.on("response", (response) => responses.push(response));
  page.on("request", (r) => origins.add(new URL(r.url()).origin));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  await page.goto("/");
  await expect(page.locator(".review-banner")).not.toContainText("Synthetic");
  await expect(
    page.getByRole("button", { name: /Go somewhere/ }),
  ).toBeVisible();
  const record = await (await request.get("/data/dataset.json")).json();
  const describe = responses.find((r) =>
    r.url().endsWith("/data/dataset.json"),
  );
  const network = responses.find((r) =>
    r.url().endsWith(`/data/${record.content.file}`),
  );
  expect(describe?.headers()["cache-control"]).toBe("no-cache");
  expect(describe?.headers()["content-type"]).toContain("application/json");
  expect(network?.headers()["cache-control"]).toBe(
    "public, max-age=31536000, immutable",
  );
  expect(network?.headers()["content-type"]).toContain("application/json");
  expect(
    [...origins].filter((origin) => origin !== new URL(baseURL!).origin),
  ).toEqual([]);
  expect(
    responses
      .filter((r) => r.status() >= 400)
      .map((r) => `${r.status()} ${r.url()}`),
  ).toEqual([]);
  expect(consoleErrors).toEqual([]);
  // What was served is what the record says it is.
  const served = Buffer.from(
    await (await request.get(`/data/${record.content.file}`)).body(),
  );
  expect(createHash("sha256").update(served).digest("hex")).toBe(
    record.content.sha256,
  );
  expect(served.length).toBe(record.content.bytes);
});

test("provenance names the county dataset, its manifest and content, and states approval truthfully", async ({
  request,
}) => {
  const provenance = await (await request.get("/provenance.json")).json();
  const record = await (await request.get("/data/dataset.json")).json();
  expect(provenance.dataset.kind).toBe("county");
  expect(provenance.dataset.contentSha256).toBe(record.content.sha256);
  expect(provenance.dataset.sourceManifestSha256).toBe(
    record.source.manifestSha256,
  );
  expect(provenance.dataset.reviewedOn).toBe(record.source.reviewedOn);
  // The extraction time is recorded as such; it is not offered as the source's freshness.
  expect(provenance.dataset.extractedAtUtc).toBe(record.source.extractedAtUtc);
  expect(provenance.dataset.approved).toBe(record.approval.approved);
  if (!provenance.dataset.approved)
    expect(provenance.publicRelease.allowed).toBe(false);
  const shipped = provenance.files.map((file: { path: string }) => file.path);
  expect(shipped).toContain("data/dataset.json");
  expect(shipped).toContain(`data/${record.content.file}`);
  // No fixture data and no private source input is part of a county artifact.
  expect(shipped.join(" ")).not.toMatch(/review-network|normalized/);
});

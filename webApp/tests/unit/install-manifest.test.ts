import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Android installation keeps the existing implicit root identity and adds a self relationship", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../../public/manifest.webmanifest", import.meta.url),
      "utf8",
    ),
  );
  const url =
    "https://constitution-trail-mapper.hooware.chatgpt.site/manifest.webmanifest";
  assert.equal(new URL(manifest.start_url, url).href, new URL("/", url).href);
  assert.equal(manifest.id, undefined); // Preserve Chrome's existing start_url-based identity.
  assert.equal(manifest.scope, "./");
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(manifest.related_applications, [
    { platform: "webapp", url: "./manifest.webmanifest" },
  ]);
  assert.notEqual(manifest.prefer_related_applications, true);
});

test("install icons are real PNGs at both Chrome-required dimensions", () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL("../../public/manifest.webmanifest", import.meta.url),
      "utf8",
    ),
  );
  for (const size of [192, 512]) {
    const entry = manifest.icons.find(
      (icon: { sizes: string }) => icon.sizes === size + "x" + size,
    );
    assert.ok(entry);
    assert.equal(entry.type, "image/png");
    const png = readFileSync(
      new URL("../../public/" + entry.src, import.meta.url),
    );
    assert.deepEqual(
      [...png.subarray(0, 8)],
      [137, 80, 78, 71, 13, 10, 26, 10],
    );
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});

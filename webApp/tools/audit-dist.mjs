import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
async function walk(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
      ),
    )
  ).flat();
}
const files = await walk("dist");
const prohibited =
  /mcgis-trails\.normalized|mclean-access-roads\.normalized|verified-trail-additions\.normalized|AIza[0-9A-Za-z_-]{30}|BEGIN (RSA |EC )?PRIVATE KEY/;
for (const file of files) {
  if (prohibited.test(file) || prohibited.test(await readFile(file, "utf8")))
    throw new Error("Publication-sensitive content in " + file);
}
console.log(
  "Distribution audit passed: no generated county/access assets or credential patterns. Fixture-only build.",
);

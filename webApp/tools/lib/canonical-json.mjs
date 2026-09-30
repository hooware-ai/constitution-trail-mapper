// Rebuilds the exact canonical JSON the reviewed-evidence hashes were computed over.
//
// tools/fetch-web-review-data.py hashes `json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`.
// A JavaScript number cannot tell 1 from 1.0 and prints small values differently, so hashing parsed numbers would not
// reproduce those digests. JSON.parse can hand a reviver each number's SOURCE TEXT; the extractor's output was written
// with the same float formatting the digest used, so keeping the source token reproduces the hashed bytes exactly.
import { createHash } from "node:crypto";

class Num {
  constructor(source) {
    this.source = source;
  }
}

/** Parses JSON text, replacing every number with a token that remembers how it was written. */
export function parseWithNumbers(text) {
  return JSON.parse(text, (_key, value, context) =>
    typeof value === "number" ? new Num(context.source) : value,
  );
}

/** The ordinary value: tokens become numbers. */
export function toPlain(tree) {
  if (tree instanceof Num) return Number(tree.source);
  if (Array.isArray(tree)) return tree.map(toPlain);
  if (tree && typeof tree === "object")
    return Object.fromEntries(
      Object.entries(tree).map(([key, value]) => [key, toPlain(value)]),
    );
  return tree;
}

const codePointOrder = (a, b) => {
  const left = [...a],
    right = [...b];
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = left[i].codePointAt(0) - right[i].codePointAt(0);
    if (difference) return difference;
  }
  return left.length - right.length;
};

/** Python's sort_keys/compact/ensure_ascii=False serialization of a tree from parseWithNumbers. */
export function canonical(tree) {
  if (tree instanceof Num) return tree.source;
  if (Array.isArray(tree)) return `[${tree.map(canonical).join(",")}]`;
  if (tree && typeof tree === "object")
    return `{${Object.keys(tree)
      .sort(codePointOrder)
      .map((key) => `${JSON.stringify(key)}:${canonical(tree[key])}`)
      .join(",")}}`;
  return JSON.stringify(tree);
}

export const sha256Text = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");

/** Canonical digest of a plain value, as the extractor would compute it if it had written the value with JSON.stringify. */
export const canonicalSha256 = (value) =>
  sha256Text(canonical(parseWithNumbers(JSON.stringify(value))));

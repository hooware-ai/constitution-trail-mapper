// The deliberately weakened variants of cloud/firestore.rules used by tools/rules-negative-control.mjs. Pure text
// transformations of a COPY: the committed rules are never changed. Each pattern must match exactly as many times as
// stated, so a change to the rules that no longer matches fails loudly instead of silently weakening nothing.

/** Replace `pattern` exactly `count` times, or stop: the rules changed and the control must be rewritten. */
const replace =
  (pattern, replacement, count = 1) =>
  (text) => {
    const found =
      text.match(new RegExp(pattern.source, pattern.flags + "g"))?.length ?? 0;
    if (found !== count)
      throw new Error(
        `Control pattern ${pattern} matched ${found} times, expected ${count}: update the control.`,
      );
    return text.replace(
      new RegExp(pattern.source, pattern.flags + "g"),
      replacement,
    );
  };

export const controls = [
  {
    name: "default-allow",
    why: "everything not listed is readable and writable",
    change: replace(
      /allow read, write: if false;/,
      "allow read, write: if true;",
    ),
    detects: "tests-fail",
  },
  {
    name: "signed-out-allowed",
    why: "anyone, signed in or not, passes the ownership check",
    change: replace(
      /return signedIn\(\) && request\.auth\.uid == uid;/,
      "return true;",
    ),
    detects: "tests-fail",
  },
  {
    name: "any-signed-in-user",
    why: "any signed-in account can touch any other account's records",
    change: replace(
      /return signedIn\(\) && request\.auth\.uid == uid;/,
      "return signedIn();",
    ),
    detects: "tests-fail",
  },
  {
    name: "no-field-validation",
    why: "routes are accepted whatever they contain",
    change: replace(
      /function validRoute\(d, uid, routeId\) \{\s*return /,
      "function validRoute(d, uid, routeId) { return true || ",
    ),
    detects: "tests-fail",
  },
  {
    name: "owner-spoofing-allowed",
    why: "a record may name a different owner than the account writing it",
    change: replace(/&& d\.ownerUid == uid/, "", 2),
    detects: "tests-fail",
  },
  {
    name: "no-revision-check",
    why: "a stale writer can overwrite a newer revision",
    change: replace(
      /&& request\.resource\.data\.revision == resource\.data\.revision \+ 1/,
      "",
      2,
    ),
    detects: "tests-fail",
  },
  {
    name: "client-timestamps-allowed",
    why: "clients can choose their own update times",
    change: replace(
      /&& request\.resource\.data\.updatedAt == request\.time/,
      "",
      4,
    ),
    detects: "tests-fail",
  },
  {
    name: "unbounded-lists",
    why: "a list needs no limit",
    change: replace(
      / && request\.query\.limit != null && request\.query\.limit <= 200/,
      "",
      2,
    ),
    detects: "tests-fail",
  },
  {
    name: "no-size-bounds",
    why: "geometry and engine payloads may be any size",
    change: (text) =>
      replace(
        /d\.geometry\.size\(\) <= 240000/,
        "true",
      )(replace(/d\.engine\.size\(\) <= 640000/, "true")(text)),
    detects: "tests-fail",
  },
  {
    name: "malformed-rules",
    why: "the rules file does not even compile",
    change: (text) => text + "\nthis is not valid rules syntax }}}\n",
    detects: "rules-rejected",
  },
];

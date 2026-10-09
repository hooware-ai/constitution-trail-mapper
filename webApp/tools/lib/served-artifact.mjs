/** The test server must identify the selected local artifact, including when reuse was explicitly requested.
 * This compares provenance bytes; artifact audit and the smoke tests still verify content and approval.
 */
export async function verifyServedProvenance(
  baseURL,
  expected,
  { timeoutMs = 5000 } = {},
) {
  const url = new URL("/provenance.json", baseURL);
  let response;
  let served;
  try {
    response = await fetch(url, {
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    served = Buffer.from(await response.arrayBuffer());
  } catch (cause) {
    throw new Error(
      `Cannot verify served artifact provenance at ${url}. Check the selected test server.`,
      { cause },
    );
  }
  if (!Buffer.from(expected).equals(served))
    throw new Error(
      "Served provenance differs from the selected local artifact. Stop the stale test server or select its matching artifact with TRAIL_DIST_DIR before testing.",
    );
}

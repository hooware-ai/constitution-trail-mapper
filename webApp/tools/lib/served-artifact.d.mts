export function verifyServedProvenance(
  baseURL: string | URL,
  expected: Uint8Array,
  options?: { timeoutMs?: number },
): Promise<void>;

/**
 * Tarball integrity, exactly as the npm registry computes and serves it.
 *
 * `dist.integrity` is a W3C Subresource Integrity string over the tarball
 * bytes; npm standardized on sha512. `dist.shasum` is the legacy hex sha1
 * the registry still emits and older clients still verify.
 */

/** `sha512-<base64(sha512(bytes))>` */
export function sriSha512(bytes: Uint8Array): string {
  return `sha512-${Buffer.from(new Bun.SHA512().update(bytes).digest()).toString("base64")}`;
}

/** Lowercase hex sha1, npm's legacy `dist.shasum`. */
export function shasum(bytes: Uint8Array): string {
  return Buffer.from(new Bun.SHA1().update(bytes).digest()).toString("hex");
}

export interface Integrity {
  integrity: string;
  shasum: string;
}

export function computeIntegrity(bytes: Uint8Array): Integrity {
  return { integrity: sriSha512(bytes), shasum: shasum(bytes) };
}

/** W3C SRI's recognized algorithms, weakest to strongest. */
const SRI_ALGORITHMS = [
  ["sha256", Bun.SHA256],
  ["sha384", Bun.SHA384],
  ["sha512", Bun.SHA512],
] as const;

/**
 * Does `sri` prove `bytes`? `sri` is parsed as W3C SRI §3.3 (a
 * whitespace-separated list of `<algo>-<base64>` tokens, padding
 * optional, trailing `?options` ignored), and — like `ssri.checkData`
 * and W3C SRI §3.3.4 — only the strongest recognized algorithm present
 * is checked: accepted iff any token for that algorithm matches.
 */
export function checkIntegrity(sri: string, bytes: Uint8Array): boolean {
  const byAlgo = new Map<string, string[]>();
  for (const token of sri.trim().split(/\s+/)) {
    const dash = token.indexOf("-");
    if (dash <= 0) continue;
    const algo = token.slice(0, dash);
    const digest = token.slice(dash + 1).replace(/\?.*$/, "").replace(/=+$/, "");
    (byAlgo.get(algo) ?? byAlgo.set(algo, []).get(algo)!).push(digest);
  }
  for (const [algo, Hasher] of [...SRI_ALGORITHMS].reverse()) {
    const digests = byAlgo.get(algo);
    if (digests === undefined) continue;
    const actual = Buffer.from(new Hasher().update(bytes).digest()).toString("base64").replace(/=+$/, "");
    return digests.includes(actual);
  }
  return false;
}

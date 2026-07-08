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

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

// Scalar RFC 4648 §5 base64url reference (no padding), independent of any
// native base64 implementation. `bun_base64::encode_url_safe` (simdutf's
// base64_url mode) must agree with this for every input.
const URL_SAFE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
function base64UrlReference(bytes: Uint8Array): string {
  let out = "";
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      URL_SAFE_ALPHABET[(n >> 18) & 63] +
      URL_SAFE_ALPHABET[(n >> 12) & 63] +
      URL_SAFE_ALPHABET[(n >> 6) & 63] +
      URL_SAFE_ALPHABET[n & 63];
  }
  const remainder = bytes.length - i;
  if (remainder === 1) {
    const n = bytes[i] << 16;
    out += URL_SAFE_ALPHABET[(n >> 18) & 63] + URL_SAFE_ALPHABET[(n >> 12) & 63];
  } else if (remainder === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += URL_SAFE_ALPHABET[(n >> 18) & 63] + URL_SAFE_ALPHABET[(n >> 12) & 63] + URL_SAFE_ALPHABET[(n >> 6) & 63];
  }
  return out;
}

// Deterministic pseudo-random bytes so failures reproduce.
function fillDeterministic(bytes: Uint8Array): Uint8Array {
  let state = 0x12345678;
  for (let i = 0; i < bytes.length; i++) {
    // xorshift32
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[i] = state & 0xff;
  }
  return bytes;
}

describe("URL-safe base64 encoding", () => {
  test("Buffer.prototype.toString('base64url') reference vectors", () => {
    expect(Buffer.alloc(0).toString("base64url")).toBe("");
    expect(Buffer.from("A").toString("base64url")).toBe("QQ");
    expect(Buffer.from("Man").toString("base64url")).toBe("TWFu");
    // No padding, unlike toString("base64")
    expect(Buffer.from("Woman").toString("base64")).toBe("V29tYW4=");
    expect(Buffer.from("Woman").toString("base64url")).toBe("V29tYW4");
    // '-' and '_' where the standard alphabet has '+' and '/'
    const bytes = Buffer.from([0xff, 0xff, 0xbe, 0xff, 0xef, 0xbf, 0xfb, 0xef, 0xff]);
    expect(bytes.toString("base64")).toBe("//++/++/++//");
    expect(bytes.toString("base64url")).toBe("__--_--_--__");
  });

  test("matches the scalar reference for every length 0..=513", () => {
    // Covers all three mod-3 phases many times over with pseudo-random bytes.
    const bytes = fillDeterministic(new Uint8Array(513));
    for (let len = 0; len <= bytes.length; len++) {
      const slice = bytes.subarray(0, len);
      expect(Buffer.from(slice).toString("base64url")).toBe(base64UrlReference(slice));
    }
  });

  test("large inputs whose encoding exceeds 32 KiB are byte-exact", () => {
    // Buffer.toString("base64url") switches to an external-string strategy for
    // outputs >= 32 KiB; both branches must produce identical bytes.
    for (const len of [32 * 1024, 32 * 1024 + 1, 32 * 1024 + 2]) {
      const bytes = fillDeterministic(new Uint8Array(len));
      expect(Buffer.from(bytes).toString("base64url")).toBe(base64UrlReference(bytes));
    }
  });

  test("node:crypto Hash.digest('base64url')", () => {
    const raw = createHash("sha256").update("bun").digest();
    expect(createHash("sha256").update("bun").digest("base64url")).toBe(base64UrlReference(raw));
  });

  test("Bun.CryptoHasher digest('base64url')", () => {
    const raw = new Bun.CryptoHasher("sha256").update("bun").digest();
    expect(new Bun.CryptoHasher("sha256").update("bun").digest("base64url")).toBe(
      base64UrlReference(new Uint8Array(raw)),
    );
  });
});

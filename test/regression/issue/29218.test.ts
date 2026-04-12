// https://github.com/oven-sh/bun/issues/29218
//
// First slice of the WICG "Modern Algorithms in the Web Cryptography API"
// specification: SHA-3 fixed-output hashes (SHA3-256 / SHA3-384 / SHA3-512)
// exposed through `crypto.subtle.digest`, plus the new synchronous feature
// detection method `crypto.subtle.supports(operation, algorithm)`.
//
// Spec: https://wicg.github.io/webcrypto-modern-algos/
import { describe, expect, test } from "bun:test";

const te = new TextEncoder();

function hex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

describe("crypto.subtle SHA-3", () => {
  // NIST FIPS 202 / Cryptographic Algorithm Validation Program test vectors
  // for the empty message and for the ASCII string "abc".
  // https://csrc.nist.gov/projects/cryptographic-algorithm-validation-program/secure-hashing
  const vectors = {
    "SHA3-256": {
      empty: "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a",
      abc: "3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532",
    },
    "SHA3-384": {
      empty: "0c63a75b845e4f7d01107d852e4c2485c51a50aaaa94fc61995e71bbee983a2ac3713831264adb47fb6bd1e058d5f004",
      abc: "ec01498288516fc926459f58e2c6ad8df9b473cb0fc08c2596da7cf0e49be4b298d88cea927ac7f539f1edf228376d25",
    },
    "SHA3-512": {
      empty:
        "a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26",
      abc: "b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0",
    },
  } as const;

  for (const [alg, vec] of Object.entries(vectors)) {
    test(`${alg} digests the empty string to the FIPS 202 test vector`, async () => {
      const out = await crypto.subtle.digest(alg, new Uint8Array(0));
      expect(hex(out)).toBe(vec.empty);
    });

    test(`${alg} digests "abc" to the FIPS 202 test vector`, async () => {
      const out = await crypto.subtle.digest(alg, te.encode("abc"));
      expect(hex(out)).toBe(vec.abc);
    });

    test(`${alg} digests a long message longer than one Keccak rate`, async () => {
      // Longer than the largest SHA-3 rate (72 bytes for SHA3-512) to exercise
      // multi-block absorption inside the sponge.
      const buf = new Uint8Array(1024);
      for (let i = 0; i < buf.length; i++) buf[i] = i & 0xff;
      const out = await crypto.subtle.digest(alg, buf);

      const expectedLen = { "SHA3-256": 32, "SHA3-384": 48, "SHA3-512": 64 }[alg as keyof typeof vectors];
      expect(out.byteLength).toBe(expectedLen);

      // Stability: hashing the same input twice must produce identical output.
      const again = await crypto.subtle.digest(alg, buf);
      expect(hex(again)).toBe(hex(out));
    });
  }

  test("SHA-3 digest accepts a dictionary algorithm identifier", async () => {
    const out = await crypto.subtle.digest({ name: "SHA3-256" }, te.encode("abc"));
    expect(hex(out)).toBe(vectors["SHA3-256"].abc);
  });

  test("SHA-3 digest is case-insensitive on the algorithm name", async () => {
    const out = await crypto.subtle.digest("sha3-256", te.encode("abc"));
    expect(hex(out)).toBe(vectors["SHA3-256"].abc);
  });

  test("unknown SHA-3 variant is rejected with NotSupportedError", async () => {
    // SHA3-224 is defined by FIPS 202 but is intentionally not exposed by the
    // WICG spec, so it must be rejected rather than silently accepted.
    await expect(crypto.subtle.digest("SHA3-224", te.encode("abc"))).rejects.toMatchObject({
      name: "NotSupportedError",
    });
  });
});

describe("crypto.subtle.supports", () => {
  test("is a function of length 2", () => {
    expect(typeof crypto.subtle.supports).toBe("function");
    expect(crypto.subtle.supports.length).toBe(2);
  });

  test("returns true for supported (operation, algorithm) pairs", () => {
    // Classic Web Crypto algorithms that existed before this slice must
    // continue to report true, so supports() is a safe feature-detect for
    // everything Bun exposes.
    expect(crypto.subtle.supports("digest", "SHA-256")).toBe(true);
    expect(crypto.subtle.supports("digest", "SHA-384")).toBe(true);
    expect(crypto.subtle.supports("digest", "SHA-512")).toBe(true);
    expect(crypto.subtle.supports("generateKey", { name: "AES-GCM", length: 256 })).toBe(true);
    expect(crypto.subtle.supports("importKey", "AES-GCM")).toBe(true);
    expect(crypto.subtle.supports("wrapKey", { name: "AES-KW" })).toBe(true);
  });

  test("reports true for SHA3-256/384/512 digest", () => {
    expect(crypto.subtle.supports("digest", "SHA3-256")).toBe(true);
    expect(crypto.subtle.supports("digest", "SHA3-384")).toBe(true);
    expect(crypto.subtle.supports("digest", "SHA3-512")).toBe(true);
  });

  test("accepts dictionary-form algorithm identifiers", () => {
    expect(crypto.subtle.supports("digest", { name: "SHA3-256" })).toBe(true);
    expect(crypto.subtle.supports("digest", { name: "SHA-256" })).toBe(true);
  });

  test("returns false for unknown algorithms", () => {
    expect(crypto.subtle.supports("digest", "MD5")).toBe(false);
    expect(crypto.subtle.supports("digest", "not-a-real-algorithm")).toBe(false);
    expect(crypto.subtle.supports("digest", { name: "nope" })).toBe(false);
  });

  test("returns false for unknown operations", () => {
    expect(crypto.subtle.supports("not-a-real-op", "SHA-256")).toBe(false);
  });

  test("returns false for KEM operations that are not yet implemented", () => {
    // encapsulateKey/Bits and decapsulateKey/Bits come with ML-KEM in a
    // later slice of the WICG spec. They must report false for now so that
    // callers can progressively adopt them.
    expect(crypto.subtle.supports("encapsulateKey", "ML-KEM-768")).toBe(false);
    expect(crypto.subtle.supports("encapsulateBits", "ML-KEM-768")).toBe(false);
    expect(crypto.subtle.supports("decapsulateKey", "ML-KEM-768")).toBe(false);
    expect(crypto.subtle.supports("decapsulateBits", "ML-KEM-768")).toBe(false);
  });

  test("returns false (not a throw) for malformed algorithm input", () => {
    // supports() must never throw, even for obviously bad input — that is
    // the point of a synchronous feature-detect method.
    expect(crypto.subtle.supports("digest", null as any)).toBe(false);
    expect(crypto.subtle.supports("digest", 42 as any)).toBe(false);
    expect(crypto.subtle.supports("digest", [] as any)).toBe(false);
  });

  test("throws when called with fewer than two arguments", () => {
    // The only way supports() is allowed to throw is when JavaScript itself
    // rejects the call (missing required arguments), mirroring every other
    // SubtleCrypto method.
    // @ts-expect-error
    expect(() => crypto.subtle.supports()).toThrow();
    // @ts-expect-error
    expect(() => crypto.subtle.supports("digest")).toThrow();
  });
});

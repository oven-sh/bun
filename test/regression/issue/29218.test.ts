// https://github.com/oven-sh/bun/issues/29218
//
// First slice of the WICG "Modern Algorithms in the Web Cryptography API"
// specification: SHA-3 fixed-output hashes (SHA3-256 / SHA3-384 / SHA3-512)
// exposed through `crypto.subtle.digest`, plus the new synchronous feature
// detection method `SubtleCrypto.supports(operation, algorithm)`.
//
// Spec: https://wicg.github.io/webcrypto-modern-algos/
//
// Test coverage mirrors the intent of the Web Platform Tests that ship with
// the spec (WebCryptoAPI/digest/sha3.tentative.https.any.js and
// WebCryptoAPI/idlharness.*). Digest vectors are the NIST FIPS 202
// Cryptographic Algorithm Validation Program vectors used by those WPTs, and
// the `supports()` cases exercise the progressive-enhancement semantics that
// the modern-algos spec defines in its "supports" algorithm.
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

const te = new TextEncoder();

function hex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

// Map the Web Crypto SHA-3 algorithm name to the name Node.js's OpenSSL
// bindings use, so we can cross-check SubtleCrypto output against a second
// independent implementation of the same primitive.
const nodeAlg = {
  "SHA3-256": "sha3-256",
  "SHA3-384": "sha3-384",
  "SHA3-512": "sha3-512",
} as const;

describe("crypto.subtle SHA-3", () => {
  // NIST FIPS 202 test vectors for the empty message and for the ASCII
  // string "abc". These are the same vectors the WPT uses.
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

    test(`${alg} digests a multi-block message identically to node:crypto`, async () => {
      // 1024 bytes is longer than every SHA-3 sponge rate (the largest rate
      // is SHA3-256's 136 bytes; SHA3-512 uses the smallest rate at 72
      // bytes), so this input is guaranteed to span multiple blocks for all
      // three variants and exercise multi-block absorption. Cross-check
      // against node:crypto (which uses OpenSSL) instead of hard-coding a
      // hex string, so both implementations must agree.
      const buf = new Uint8Array(1024);
      for (let i = 0; i < buf.length; i++) buf[i] = i & 0xff;

      const out = await crypto.subtle.digest(alg, buf);
      const reference = createHash(nodeAlg[alg as keyof typeof nodeAlg])
        .update(buf)
        .digest();
      expect(hex(out)).toBe(reference.toString("hex"));

      const expectedLen = { "SHA3-256": 32, "SHA3-384": 48, "SHA3-512": 64 }[alg as keyof typeof vectors];
      expect(out.byteLength).toBe(expectedLen);
    });

    test(`${alg} is deterministic across calls`, async () => {
      const buf = te.encode("the quick brown fox jumps over the lazy dog");
      const a = await crypto.subtle.digest(alg, buf);
      const b = await crypto.subtle.digest(alg, buf);
      expect(hex(a)).toBe(hex(b));
    });
  }

  test("SHA-3 digest accepts a dictionary algorithm identifier", async () => {
    const out = await crypto.subtle.digest({ name: "SHA3-256" }, te.encode("abc"));
    expect(hex(out)).toBe("3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532");
  });

  test("SHA-3 digest is case-insensitive on the algorithm name", async () => {
    const out = await crypto.subtle.digest("sha3-256", te.encode("abc"));
    expect(hex(out)).toBe("3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532");
  });

  test("unknown SHA-3 variant is rejected with NotSupportedError", async () => {
    // SHA3-224 is defined by FIPS 202 but is intentionally not exposed by the
    // WICG spec, so it must be rejected rather than silently accepted.
    await expect(crypto.subtle.digest("SHA3-224", te.encode("abc"))).rejects.toMatchObject({
      name: "NotSupportedError",
    });
  });

  test("SHA-3 is rejected as a hash sub-algorithm for HMAC/RSA/ECDSA", async () => {
    // SHA-3 is implemented only as a top-level `digest` operation in this
    // slice of the WICG spec. It is not yet wired into OpenSSL's digest
    // dispatcher, CryptoKeyHMAC::getKeyLengthFromHash(), or structured
    // clone, so accepting it as a hash sub-algorithm for HMAC/RSA/ECDSA
    // would create broken CryptoKey instances that crash at sign() or
    // postMessage() time. Reject up front until those paths are wired.
    //
    // For HMAC and RSA-PSS the hash is supplied at key creation time, so
    // importKey()/generateKey() is where the rejection lives. For ECDSA
    // the hash is supplied at sign()/verify() time, so we generate a real
    // P-256 key pair first (which must still succeed) and then assert
    // that sign() rejects when a SHA-3 hash is requested.
    const ecdsaPair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    expect(ecdsaPair.privateKey).toBeDefined();

    for (const alg of ["SHA3-256", "SHA3-384", "SHA3-512"]) {
      await expect(
        crypto.subtle.importKey("raw", new Uint8Array(32), { name: "HMAC", hash: alg }, true, ["sign"]),
      ).rejects.toMatchObject({ name: "NotSupportedError" });
      await expect(crypto.subtle.generateKey({ name: "HMAC", hash: alg }, true, ["sign"])).rejects.toMatchObject({
        name: "NotSupportedError",
      });
      await expect(
        crypto.subtle.generateKey(
          { name: "RSA-PSS", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: alg },
          true,
          ["sign"],
        ),
      ).rejects.toMatchObject({ name: "NotSupportedError" });
      await expect(
        crypto.subtle.sign({ name: "ECDSA", hash: alg }, ecdsaPair.privateKey, te.encode("msg")),
      ).rejects.toMatchObject({ name: "NotSupportedError" });
    }
  });

  // The full (algorithm × input-size) matrix shipped by WPT's
  // WebCryptoAPI/digest/sha3.tentative.https.any.js, ported to hex. If you
  // need to verify these bytes against upstream, compare to:
  // https://github.com/web-platform-tests/wpt/blob/master/WebCryptoAPI/digest/sha3.tentative.https.any.js
  //
  // The WPT file exercises four source payloads per algorithm:
  //   - empty:  0 bytes
  //   - short:  16 bytes (one sample block)
  //   - medium: 85 bytes
  //   - long:   85 * 1024 bytes (multi-block)
  // Each digest must match to the byte.
  test("SHA-3 matches every vector from the WPT sha3.tentative digest suite", async () => {
    const sourceData = {
      empty: new Uint8Array(0),
      short: new Uint8Array([21, 110, 234, 124, 193, 76, 86, 203, 148, 219, 3, 10, 74, 157, 149, 255]),
      medium: new Uint8Array([
        182, 200, 249, 223, 100, 140, 208, 136, 183, 15, 56, 231, 65, 151, 177, 140, 184, 30, 30, 67, 80, 213, 11,
        204, 184, 251, 90, 115, 121, 200, 123, 178, 227, 214, 237, 84, 97, 237, 30, 159, 54, 243, 64, 163, 150, 42,
        68, 107, 129, 91, 121, 75, 75, 212, 58, 68, 3, 80, 32, 119, 178, 37, 108, 200, 7, 131, 127, 58, 172, 209,
        24, 235, 75, 156, 43, 174, 184, 151, 6, 134, 37, 171, 172, 161, 147,
      ]),
      long: new Uint8Array(0), // filled in below
    };
    const longBuf = new Uint8Array(1024 * sourceData.medium.byteLength);
    for (let i = 0; i < 1024; i++) longBuf.set(sourceData.medium, i * sourceData.medium.byteLength);
    sourceData.long = longBuf;

    const wptVectors = {
      "SHA3-256": {
        empty: "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a",
        short: "3059af7aa33b517084e8ad7bbc4fb208a44c28ef32b4698d103dd540e4f91aa1",
        medium: "1fa7cd1da74cd8046417508c8314e74a9a4a9d38f9f18e6cb215b8c891a0a80e",
        long: "b2cfc61e0386cdaef5e10a2be189891f5ef52a7624bfcd8edc893acc64fec600",
      },
      "SHA3-384": {
        empty: "0c63a75b845e4f7d01107d852e4c2485c51a50aaaa94fc61995e71bbee983a2ac3713831264adb47fb6bd1e058d5f004",
        short: "54b8f0e4cf4974de740098f66b3024479b01631315a6773606c33eadc32556a6e778e08f0225ae79265aec666cb2390b",
        medium: "437b7d8b68b250b5c1739ea4cc86db2033879dfb18de292c9c50d9c193a4c79a08a6cae3f4e483c2795ea5d1ef7e69d2",
        long: "3b39c4c97ad87613305d0ccc987181713e2d5e84b1f9760011bcce0c297499005bdce8a3d2409b5ad0164f32bb8778d0",
      },
      "SHA3-512": {
        empty:
          "a69f73cca23a9ac5c8b567dc185a756e97c982164fe25859e0d1dcc1475c80a615b2123af1f5f94c11e3e9402c3ac558f500199d95b6d3e301758586281dcd26",
        short:
          "2dd2e07a62e6ad0498ba84f313c4d4024cb46001f78f75db336b0d4d8bd2a9ec152c4ad20878735d82ba0872ecf59608ef3ced2b2a8669427e7da31e362333d8",
        medium:
          "e640a21909536640369e9b0a48931c5cb2efcbc91fecf247306bc96a0e4ca33307cb8e1b9af367946dd01c243f3907508d04f1692a3161df1f898de8ee25febe",
        long: "bd262cecf565c338032de5ba0138f0aacfe7dde83d272d0d37d952829ed25de1a1342d98659ef7d2fa4aca7ce2b1aa0784d8fc1dcbf81bcec7a7431a3da36bf7",
      },
    } as const;

    for (const [alg, sizes] of Object.entries(wptVectors)) {
      for (const [size, expected] of Object.entries(sizes)) {
        const input = sourceData[size as keyof typeof sourceData];
        const got = await crypto.subtle.digest(alg, input);
        expect(hex(got)).toBe(expected);
      }
    }
  });
});

describe("SubtleCrypto.supports", () => {
  test("is a function of length 2", () => {
    expect(typeof SubtleCrypto.supports).toBe("function");
    expect(SubtleCrypto.supports.length).toBe(2);
  });

  test("returns true for classic algorithms that existed before this slice", () => {
    // Every algorithm Bun already supported must continue to report true so
    // that supports() is a safe feature-detect for the whole API surface.
    expect(SubtleCrypto.supports("digest", "SHA-1")).toBe(true);
    expect(SubtleCrypto.supports("digest", "SHA-256")).toBe(true);
    expect(SubtleCrypto.supports("digest", "SHA-384")).toBe(true);
    expect(SubtleCrypto.supports("digest", "SHA-512")).toBe(true);
    expect(SubtleCrypto.supports("generateKey", { name: "AES-GCM", length: 256 })).toBe(true);
    expect(SubtleCrypto.supports("importKey", "AES-GCM")).toBe(true);
    expect(SubtleCrypto.supports("importKey", "PBKDF2")).toBe(true);
    expect(
      SubtleCrypto.supports("deriveBits", {
        name: "HKDF",
        hash: "SHA-256",
        salt: new Uint8Array(),
        info: new Uint8Array(),
      }),
    ).toBe(true);
  });

  test("returns true for SHA-3 digest", () => {
    expect(SubtleCrypto.supports("digest", "SHA3-256")).toBe(true);
    expect(SubtleCrypto.supports("digest", "SHA3-384")).toBe(true);
    expect(SubtleCrypto.supports("digest", "SHA3-512")).toBe(true);
  });

  test("accepts dictionary-form algorithm identifiers", () => {
    expect(SubtleCrypto.supports("digest", { name: "SHA3-256" })).toBe(true);
    expect(SubtleCrypto.supports("digest", { name: "SHA-256" })).toBe(true);
  });

  describe("mirrors dispatch-time fallback", () => {
    test("wrapKey with AES-KW uses the dedicated WrapKey path", () => {
      expect(SubtleCrypto.supports("wrapKey", "AES-KW")).toBe(true);
      expect(SubtleCrypto.supports("wrapKey", { name: "AES-KW" })).toBe(true);
    });

    test("wrapKey with an encryption algorithm is reported via the Encrypt fallback", () => {
      // wrapKey() in the real implementation tries WrapKey normalization
      // and, on NotSupportedError, falls back to Encrypt normalization so
      // that AES-GCM/CBC/CTR/CFB and RSA-OAEP can be used as wrapping
      // algorithms. supports() must mirror that fallback or it reports
      // false for operations that actually succeed.
      expect(SubtleCrypto.supports("wrapKey", { name: "AES-GCM", iv: new Uint8Array(12) })).toBe(true);
      expect(SubtleCrypto.supports("wrapKey", { name: "AES-CBC", iv: new Uint8Array(16) })).toBe(true);
      expect(SubtleCrypto.supports("wrapKey", { name: "AES-CTR", counter: new Uint8Array(16), length: 64 })).toBe(true);
      expect(SubtleCrypto.supports("wrapKey", { name: "RSA-OAEP" })).toBe(true);
    });

    test("unwrapKey with a decryption algorithm is reported via the Decrypt fallback", () => {
      // Symmetric to the wrapKey case, with Decrypt as the fallback.
      expect(SubtleCrypto.supports("unwrapKey", "AES-KW")).toBe(true);
      expect(SubtleCrypto.supports("unwrapKey", { name: "AES-GCM", iv: new Uint8Array(12) })).toBe(true);
      expect(SubtleCrypto.supports("unwrapKey", { name: "AES-CBC", iv: new Uint8Array(16) })).toBe(true);
      expect(SubtleCrypto.supports("unwrapKey", { name: "RSA-OAEP" })).toBe(true);
    });

    test("wrapKey/unwrapKey reject algorithms that are neither WrapKey nor en/decryptable", () => {
      expect(SubtleCrypto.supports("wrapKey", "HKDF")).toBe(false);
      expect(SubtleCrypto.supports("wrapKey", "PBKDF2")).toBe(false);
      expect(SubtleCrypto.supports("wrapKey", "SHA-256")).toBe(false);
      expect(SubtleCrypto.supports("unwrapKey", "HKDF")).toBe(false);
      expect(SubtleCrypto.supports("unwrapKey", "SHA-256")).toBe(false);
    });
  });

  describe("exportKey", () => {
    test("reports true for exportable algorithms", () => {
      // Matches isSupportedExportKey() in SubtleCrypto.cpp. Note that
      // Bun registers AES-CFB under the "AES-CFB-8" name, matching the
      // original WebKit spelling.
      for (const alg of [
        "AES-GCM",
        "AES-CBC",
        "AES-CTR",
        "AES-CFB-8",
        "AES-KW",
        "HMAC",
        "ECDSA",
        "ECDH",
        "Ed25519",
        "X25519",
      ]) {
        expect(SubtleCrypto.supports("exportKey", alg)).toBe(true);
      }
    });

    test("reports false for key-derivation algorithms that are not exportable", () => {
      // HKDF and PBKDF2 normalize as importable but isSupportedExportKey()
      // excludes them, and the real exportKey() rejects with
      // NotSupportedError. supports() must match that behaviour so
      // progressive-enhancement callers do not hit false positives.
      expect(SubtleCrypto.supports("exportKey", "HKDF")).toBe(false);
      expect(SubtleCrypto.supports("exportKey", "PBKDF2")).toBe(false);
    });

    test("reports false for hash-only algorithms", () => {
      expect(SubtleCrypto.supports("exportKey", "SHA-256")).toBe(false);
      expect(SubtleCrypto.supports("exportKey", "SHA3-256")).toBe(false);
    });

    test("reports false for unknown algorithms", () => {
      expect(SubtleCrypto.supports("exportKey", "bogus")).toBe(false);
      expect(SubtleCrypto.supports("exportKey", { name: "bogus" })).toBe(false);
    });
  });

  test("returns false for unknown algorithms", () => {
    expect(SubtleCrypto.supports("digest", "MD5")).toBe(false);
    expect(SubtleCrypto.supports("digest", "not-a-real-algorithm")).toBe(false);
    expect(SubtleCrypto.supports("digest", { name: "nope" })).toBe(false);
  });

  test("returns false for unknown operations", () => {
    expect(SubtleCrypto.supports("not-a-real-op", "SHA-256")).toBe(false);
  });

  test("returns false for modern-algos operations that are not yet implemented", () => {
    // encapsulateKey/Bits, decapsulateKey/Bits, and getPublicKey are new
    // surface introduced by the WICG spec. They must report false for now
    // so callers can progressively adopt them; they will flip to true in
    // follow-up PRs as each algorithm lands.
    expect(SubtleCrypto.supports("encapsulateKey", "ML-KEM-768")).toBe(false);
    expect(SubtleCrypto.supports("encapsulateBits", "ML-KEM-768")).toBe(false);
    expect(SubtleCrypto.supports("decapsulateKey", "ML-KEM-768")).toBe(false);
    expect(SubtleCrypto.supports("decapsulateBits", "ML-KEM-768")).toBe(false);
    expect(SubtleCrypto.supports("getPublicKey", "RSA-PSS")).toBe(false);
    expect(SubtleCrypto.supports("getPublicKey", "Ed25519")).toBe(false);
    // getPublicKey is conceptually asymmetric-only; even if it were
    // implemented, symmetric algorithms must never report true.
    expect(SubtleCrypto.supports("getPublicKey", "AES-GCM")).toBe(false);
    expect(SubtleCrypto.supports("getPublicKey", "HMAC")).toBe(false);
  });

  test("returns false (not a throw) for malformed algorithm input", () => {
    // supports() must never throw for any well-formed call, even with
    // obviously bad input — that is the point of a synchronous
    // feature-detect method.
    expect(SubtleCrypto.supports("digest", null as any)).toBe(false);
    expect(SubtleCrypto.supports("digest", 42 as any)).toBe(false);
    expect(SubtleCrypto.supports("digest", [] as any)).toBe(false);
    expect(SubtleCrypto.supports("exportKey", null as any)).toBe(false);
    expect(SubtleCrypto.supports("exportKey", {} as any)).toBe(false);
  });

  test("throws when called with fewer than two arguments", () => {
    // The only way supports() is allowed to throw is when JavaScript itself
    // rejects the call (missing required arguments), mirroring every other
    // SubtleCrypto method.
    // @ts-expect-error
    expect(() => SubtleCrypto.supports()).toThrow();
    // @ts-expect-error
    expect(() => SubtleCrypto.supports("digest")).toThrow();
  });

  test("supports() answers match what the underlying method would do", async () => {
    // End-to-end cross-check: for each (op, alg) pair that supports()
    // reports true, the real method must not throw NotSupportedError for
    // well-formed input. This is the property the modern-algos spec relies
    // on for progressive enhancement.
    const buf = te.encode("hello");
    for (const alg of ["SHA-1", "SHA-256", "SHA-384", "SHA-512", "SHA3-256", "SHA3-384", "SHA3-512"]) {
      expect(SubtleCrypto.supports("digest", alg)).toBe(true);
      const out = await crypto.subtle.digest(alg, buf);
      expect(out).toBeInstanceOf(ArrayBuffer);
    }

    // And the negative: every op/alg pair that reports false must actually
    // reject at runtime.
    expect(SubtleCrypto.supports("digest", "MD5")).toBe(false);
    await expect(crypto.subtle.digest("MD5", buf)).rejects.toMatchObject({ name: "NotSupportedError" });

    expect(SubtleCrypto.supports("exportKey", "HKDF")).toBe(false);
    // importKey for HKDF to get an actual CryptoKey, then exportKey must reject.
    const hkdfKey = await crypto.subtle.importKey("raw", buf, "HKDF", false, ["deriveBits"]);
    await expect(crypto.subtle.exportKey("raw", hkdfKey)).rejects.toMatchObject({ name: "NotSupportedError" });
  });
});

import { spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

// This is consistent with what Node.js does, probably for polyfills to continue to work.
it("crypto.subtle setter should not throw", () => {
  const subtle = globalThis.crypto.subtle;
  // @ts-expect-error
  expect(() => (globalThis.crypto.subtle = 123)).not.toThrow();
  expect(globalThis.crypto.subtle).toBe(subtle);
});

describe("Web Crypto", () => {
  // https://github.com/oven-sh/bun/issues/3795
  it("keeps event loop alive", () => {
    const { stdout, exitCode } = spawnSync({
      cmd: [bunExe(), import.meta.resolveSync("./keeps-alive-fixture.js")],
      env: bunEnv,
    });

    const lines = stdout.toString().trim().split("\n").sort();
    const results = [
      "2ef7bde608ce5404e97d5f042f95f89f1c232871",
      "6b3e626d70787e3dc3f0bca509a7e1e5f6802643fde54a18d4353aa9b24ccb2fb874bbc8a70ff587df2bd6ed41471f82",
      "7dc2af5ef620a4b1c8871371526b664512b82193",
      "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069",
      "861844d6704e8573fec34d967e20bcfef3d424cf48be04e6dc08f2bd58c729743371015ead891cc3cf1c9d34b49264b510751b1ff9e537937bc46b5d6ff4ecc8",
      "bf6873609ce720ec489bb2f5ae116716058c06cda7dc9a7e1dadee90da98e71aee22519505af61adbecd5b94bbefa855c2ede623e8b383bb179b150e25861441",
      "bfd76c0ebbd006fee583410547c1887b0292be76d582d96c242d2a792723e3fd6fd061f9d5cfd13b8f961358e6adba4a",
      "e1061f7858d68c3818ec9967ea1f7bf8e3c65f5603af95004bdfcb64b9ea4148",
    ];

    expect(exitCode).toBe(0);
    expect(lines).toStrictEqual(results);
  });

  it("has globals", () => {
    expect(crypto.subtle !== undefined).toBe(true);
    expect(CryptoKey.name).toBe("CryptoKey");
    expect(SubtleCrypto.name).toBe("SubtleCrypto");
  });
  it("should encrypt and decrypt", async () => {
    const key = await crypto.subtle.generateKey(
      {
        name: "AES-GCM",
        length: 256,
      },
      true,
      ["encrypt", "decrypt"],
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode("Hello World!");
    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
      },
      key,
      data,
    );
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv,
      },
      key,
      encrypted,
    );
    expect(new TextDecoder().decode(decrypted)).toBe("Hello World!");
  });

  it("should verify and sign", async () => {
    async function importKey(secret: string) {
      return await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
      );
    }

    async function signResponse(message: string, secret: string) {
      const key = await importKey(secret);
      const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));

      // Convert ArrayBuffer to Base64
      return btoa(String.fromCharCode(...new Uint8Array(signature)));
    }

    async function verifySignature(message: string, signature: string, secret: string) {
      const key = await importKey(secret);

      // Convert Base64 to Uint8Array
      const sigBuf = Uint8Array.from(atob(signature), c => c.charCodeAt(0));

      return await crypto.subtle.verify("HMAC", key, sigBuf, new TextEncoder().encode(message));
    }

    const msg = `hello world`;
    const SECRET = "secret";
    const signature = await signResponse(msg, SECRET);

    const isSigValid = await verifySignature(msg, signature, SECRET);
    expect(isSigValid).toBe(true);
  });

  describe("unwrapKey JWK error handling", () => {
    // Setup: AES-GCM key that can encrypt arbitrary bytes and also unwrap keys.
    // We encrypt payloads that decrypt to invalid JWK data so the JWK parse path
    // inside SubtleCrypto::unwrapKey fails.
    async function setup(payload: Uint8Array) {
      const keyData = new Uint8Array(32).fill(1);
      const iv = new Uint8Array(12).fill(2);
      const key = await crypto.subtle.importKey("raw", keyData, { name: "AES-GCM" }, false, [
        "encrypt",
        "decrypt",
        "wrapKey",
        "unwrapKey",
      ]);
      const wrapped = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload);
      return { key, iv, wrapped };
    }

    it("rejects when wrapped bytes are not valid JSON", async () => {
      const { key, iv, wrapped } = await setup(new TextEncoder().encode("not json {{{"));
      const err = await crypto.subtle
        .unwrapKey("jwk", wrapped, key, { name: "AES-GCM", iv }, { name: "AES-GCM" }, true, ["encrypt", "decrypt"])
        .then(
          () => null,
          e => e,
        );
      expect(err).toBeInstanceOf(DOMException);
      expect(err.name).toBe("DataError");
    });

    // Previously this promise never settled: the error from JsonWebKey
    // dictionary conversion escaped as an uncaught exception and the
    // DeferredPromise was left in m_pendingPromises forever.
    it("rejects when wrapped bytes are valid JSON but not a valid JWK", async () => {
      const { key, iv, wrapped } = await setup(new TextEncoder().encode(JSON.stringify({ foo: "bar" })));
      const err = await crypto.subtle
        .unwrapKey("jwk", wrapped, key, { name: "AES-GCM", iv }, { name: "AES-GCM" }, true, ["encrypt", "decrypt"])
        .then(
          () => null,
          e => e,
        );
      expect(err).toBeInstanceOf(DOMException);
      expect(err.name).toBe("DataError");
    });

    it("does not leak DeferredPromise in m_pendingPromises on JWK parse errors", async () => {
      // Each leaked entry in m_pendingPromises holds a Ref<DeferredPromise>. On
      // the dictionary-conversion error path the promise was never rejected, so
      // DeferredPromise never removed itself from JSDOMGlobalObject's
      // guardedObjects set and the JSPromise stayed alive. Count live Promise
      // cells in the JSC heap to detect the leak.
      const fixture = /* js */ `
        const { heapStats } = require("bun:jsc");
        const keyData = new Uint8Array(32).fill(1);
        const iv = new Uint8Array(12).fill(2);
        const key = await crypto.subtle.importKey("raw", keyData, { name: "AES-GCM" }, false, [
          "encrypt", "decrypt", "wrapKey", "unwrapKey",
        ]);
        const wrapped = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv },
          key,
          new TextEncoder().encode(JSON.stringify({ foo: "bar" })),
        );
        async function once() {
          await crypto.subtle
            .unwrapKey("jwk", wrapped, key, { name: "AES-GCM", iv }, { name: "AES-GCM" }, true, ["encrypt", "decrypt"])
            .catch(() => {});
        }
        const batch = () => Promise.all(Array.from({ length: 50 }, once));
        for (let i = 0; i < 4; i++) await batch();
        Bun.gc(true);
        await Bun.sleep(1);
        Bun.gc(true);
        const before = heapStats().objectTypeCounts.Promise ?? 0;
        for (let i = 0; i < 40; i++) await batch();
        Bun.gc(true);
        await Bun.sleep(1);
        Bun.gc(true);
        await Bun.sleep(1);
        Bun.gc(true);
        const after = heapStats().objectTypeCounts.Promise ?? 0;
        console.log(JSON.stringify({ before, after, growth: after - before }));
        process.exit(0);
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--smol", "-e", fixture],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const { before, after, growth } = JSON.parse(stdout.trim());
      // 2000 failing calls; previously each leaked ~3 Promise cells that were
      // kept alive via guardedObjects, so growth was in the thousands.
      expect(growth).toBeLessThan(200);
      expect(exitCode).toBe(0);
      void before;
      void after;
    }, 60_000);
  });
});

describe("oversized inputs", () => {
  // Every SubtleCrypto entry point copies its BufferSource argument into a
  // WTF::Vector<uint8_t>, whose capacity is capped below the maximum legal
  // ArrayBuffer size. Inputs above the cap must reject the promise instead of
  // aborting the process. Run in a subprocess so the ~2GiB allocation does not
  // bloat the test runner; the buffer is never written so RSS stays small.
  it("rejects >2 GiB inputs instead of aborting", async () => {
    const script = `
      let big;
      try {
        big = new Uint8Array(2 ** 31);
      } catch {
        console.log("SKIP");
        process.exit(0);
      }

      const aesKey = await crypto.subtle.importKey("raw", new Uint8Array(32).fill(1), { name: "AES-GCM" }, false, [
        "encrypt",
        "decrypt",
        "unwrapKey",
      ]);
      const hmacKey = await crypto.subtle.importKey(
        "raw",
        new Uint8Array(32).fill(2),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"],
      );
      const cbcKey = await crypto.subtle.importKey("raw", new Uint8Array(32).fill(5), { name: "AES-CBC" }, false, [
        "encrypt",
      ]);
      const hkdfKey = await crypto.subtle.importKey("raw", new Uint8Array(32).fill(6), "HKDF", false, ["deriveBits"]);
      const iv = new Uint8Array(12).fill(3);

      const results = {};
      const record = (label, promise) =>
        promise.then(
          () => (results[label] = "resolved"),
          e => (results[label] = e.name),
        );

      await record("digest", crypto.subtle.digest("SHA-256", big));
      await record("encrypt", crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, big));
      await record("decrypt", crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, big));
      await record("sign", crypto.subtle.sign("HMAC", hmacKey, big));
      await record("verify data", crypto.subtle.verify("HMAC", hmacKey, new Uint8Array(32), big));
      await record("verify signature", crypto.subtle.verify("HMAC", hmacKey, big, new Uint8Array(32)));
      await record("importKey", crypto.subtle.importKey("raw", big, { name: "AES-GCM" }, false, ["encrypt"]));
      await record(
        "unwrapKey",
        crypto.subtle.unwrapKey("raw", big, aesKey, { name: "AES-GCM", iv }, { name: "AES-GCM" }, false, ["encrypt"]),
      );

      // BufferSource members of the algorithm dictionaries are copied into
      // Vectors by the parameter classes' lazy accessors, not by the entry
      // points, so they need their own guard.
      await record(
        "encrypt additionalData",
        crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: big }, aesKey, new Uint8Array(16)),
      );
      await record("encrypt iv", crypto.subtle.encrypt({ name: "AES-CBC", iv: big }, cbcKey, new Uint8Array(16)));
      await record(
        "deriveBits salt",
        crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: big, info: new Uint8Array(0) }, hkdfKey, 256),
      );
      // publicExponent is a WebIDL BigInteger (Uint8Array), not a BufferSource.
      await record(
        "generateKey publicExponent",
        crypto.subtle.generateKey({ name: "RSA-OAEP", modulusLength: 2048, publicExponent: big, hash: "SHA-256" }, true, [
          "encrypt",
          "decrypt",
        ]),
      );

      // Normal-sized inputs must keep working in the same process.
      await crypto.subtle.digest("SHA-256", new Uint8Array(16));
      const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, new Uint8Array(16).fill(4));
      const roundTrip = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ciphertext));
      results["small round-trip"] = roundTrip.every(b => b === 4) ? "ok" : "mismatch";

      console.log(JSON.stringify(results));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    if (stdout.trim() !== "SKIP") {
      expect(JSON.parse(stdout)).toEqual({
        "digest": "OperationError",
        "encrypt": "OperationError",
        "decrypt": "OperationError",
        "sign": "OperationError",
        "verify data": "OperationError",
        "verify signature": "OperationError",
        "importKey": "OperationError",
        "unwrapKey": "OperationError",
        "encrypt additionalData": "OperationError",
        "encrypt iv": "OperationError",
        "deriveBits salt": "OperationError",
        "generateKey publicExponent": "OperationError",
        "small round-trip": "ok",
      });
    }
    expect(exitCode).toBe(0);
  });
});

describe("Ed25519", () => {
  describe("generateKey", () => {
    it("should return CryptoKeys without namedCurve in algorithm field", async () => {
      const { publicKey, privateKey } = (await crypto.subtle.generateKey("Ed25519", true, [
        "sign",
        "verify",
      ])) as CryptoKeyPair;
      expect(publicKey.algorithm!.name).toBe("Ed25519");
      // @ts-ignore
      expect(publicKey.algorithm!.namedCurve).toBe(undefined);
      expect(privateKey.algorithm!.name).toBe("Ed25519");
      // @ts-ignore
      expect(privateKey.algorithm!.namedCurve).toBe(undefined);
    });
  });
});

describe("ChaCha20-Poly1305 and AKP review fixes", () => {
  it("structuredClone of ChaCha20-Poly1305 and AKP keys throws DataCloneError", async () => {
    // Node clones these; until real clone support lands, DataCloneError
    // replaces the RELEASE_ASSERT abort the serializer used to hit.
    const chacha = await crypto.subtle.importKey("raw-secret", new Uint8Array(32), "ChaCha20-Poly1305", true, [
      "encrypt",
      "decrypt",
    ]);
    const ml = (await crypto.subtle.generateKey("ML-DSA-65", true, ["sign", "verify"])) as CryptoKeyPair;
    for (const key of [chacha, ml.privateKey, ml.publicKey]) {
      let err: Error | undefined;
      try {
        structuredClone(key);
      } catch (e) {
        err = e as Error;
      }
      expect(err).toBeInstanceOf(DOMException);
      expect(err!.name).toBe("DataCloneError");
    }
  });

  it("encapsulateBits and encapsulateKey enumerate results in Node's order", async () => {
    // Node v26.3.0: encapsulateBits results are sharedKey-first while
    // encapsulateKey results are ciphertext-first.
    const bitsPair = (await crypto.subtle.generateKey("ML-KEM-768", true, [
      "encapsulateBits",
      "decapsulateBits",
    ])) as CryptoKeyPair;
    const bits = await crypto.subtle.encapsulateBits({ name: "ML-KEM-768" }, bitsPair.publicKey);
    expect(Object.keys(bits)).toEqual(["sharedKey", "ciphertext"]);
    const keyPair = (await crypto.subtle.generateKey("ML-KEM-768", true, [
      "encapsulateKey",
      "decapsulateKey",
    ])) as CryptoKeyPair;
    const res = await crypto.subtle.encapsulateKey({ name: "ML-KEM-768" }, keyPair.publicKey, "HKDF", false, [
      "deriveBits",
    ]);
    expect(Object.keys(res)).toEqual(["ciphertext", "sharedKey"]);
  });

  it("deriveKey can derive a ChaCha20-Poly1305 key", async () => {
    const base = await crypto.subtle.importKey("raw", new Uint8Array(32), "HKDF", false, ["deriveKey"]);
    const derived = await crypto.subtle.deriveKey(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(8), info: new Uint8Array(0) },
      base,
      { name: "ChaCha20-Poly1305" },
      true,
      ["encrypt", "decrypt"],
    );
    expect(derived.algorithm.name).toBe("ChaCha20-Poly1305");
    const iv = new Uint8Array(12);
    const ct = await crypto.subtle.encrypt({ name: "ChaCha20-Poly1305", iv }, derived, new Uint8Array([1, 2, 3]));
    const pt = await crypto.subtle.decrypt({ name: "ChaCha20-Poly1305", iv }, derived, ct);
    expect(new Uint8Array(pt)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("rejects a ChaCha20-Poly1305 iv that is not 12 bytes with Node's message", async () => {
    const key = await crypto.subtle.importKey("raw-secret", new Uint8Array(32), "ChaCha20-Poly1305", true, [
      "encrypt",
      "decrypt",
    ]);
    for (const size of [0, 11, 16]) {
      await expect(
        crypto.subtle.encrypt({ name: "ChaCha20-Poly1305", iv: new Uint8Array(size) }, key, new Uint8Array(4)),
      ).rejects.toThrow("algorithm.iv must contain exactly 12 bytes");
    }
    const ct = await crypto.subtle.encrypt(
      { name: "ChaCha20-Poly1305", iv: new Uint8Array(12) },
      key,
      new Uint8Array(4),
    );
    await expect(crypto.subtle.decrypt({ name: "ChaCha20-Poly1305", iv: new Uint8Array(16) }, key, ct)).rejects.toThrow(
      "algorithm.iv must contain exactly 12 bytes",
    );
  });

  it("importKey('raw') still rejects for ChaCha20-Poly1305 like Node", async () => {
    const err = await crypto.subtle.importKey("raw", new Uint8Array(32), "ChaCha20-Poly1305", true, ["encrypt"]).then(
      () => null,
      e => e,
    );
    expect(err).toBeInstanceOf(DOMException);
    expect(err.name).toBe("NotSupportedError");
  });

  it("wrapKey and unwrapKey accept raw-public for Ed25519 public keys", async () => {
    const kek = await crypto.subtle.importKey("raw", new Uint8Array(32), "AES-KW", false, ["wrapKey", "unwrapKey"]);
    const pair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
    const wrapped = await crypto.subtle.wrapKey("raw-public", pair.publicKey, kek, "AES-KW");
    expect(wrapped.byteLength).toBeGreaterThan(0);
    const unwrapped = await crypto.subtle.unwrapKey("raw-public", wrapped, kek, "AES-KW", "Ed25519", true, ["verify"]);
    const a = new Uint8Array(await crypto.subtle.exportKey("raw-public", unwrapped));
    const b = new Uint8Array(await crypto.subtle.exportKey("raw-public", pair.publicKey));
    expect(a).toEqual(b);
  });

  // One case per branch of SubtleCrypto::getPublicKey: AKP (ML-DSA/ML-KEM),
  // RSA, EC, and the Ed25519/X25519 owned-EVP_PKEY path. X25519 public keys
  // carry no usages in Node v26.3.0, so its pubUsages is empty.
  const getPublicKeyCases: [string, AlgorithmIdentifier, KeyUsage[], KeyUsage[]][] = [
    ["ML-DSA-65", "ML-DSA-65", ["sign", "verify"], ["verify"]],
    ["ML-KEM-768", "ML-KEM-768", ["encapsulateBits", "decapsulateBits"], ["encapsulateBits"]],
    [
      "RSA-PSS",
      { name: "RSA-PSS", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      ["sign", "verify"],
      ["verify"],
    ],
    ["ECDSA P-256", { name: "ECDSA", namedCurve: "P-256" }, ["sign", "verify"], ["verify"]],
    ["Ed25519", "Ed25519", ["sign", "verify"], ["verify"]],
    ["X25519", "X25519", ["deriveBits"], []],
  ];
  it.each(getPublicKeyCases)("getPublicKey round-trips the %s public key", async (_label, alg, usages, pubUsages) => {
    const pair = (await crypto.subtle.generateKey(alg, true, usages)) as CryptoKeyPair;
    const pub = await crypto.subtle.getPublicKey(pair.privateKey, pubUsages);
    expect(pub.type).toBe("public");
    expect(pub.usages).toEqual(pubUsages);
    const a = new Uint8Array(await crypto.subtle.exportKey("spki", pub));
    const b = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
    expect(a).toEqual(b);
  });

  it("generateKey reports Node's unsupported-usage messages", async () => {
    await expect(crypto.subtle.generateKey({ name: "AES-CBC", length: 256 }, true, ["sign"])).rejects.toThrow(
      "Unsupported key usage for an AES key",
    );
    await expect(
      crypto.subtle.generateKey(
        { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true,
        ["sign"],
      ),
    ).rejects.toThrow("Unsupported key usage for a RSA key");
  });

  // The KEM usage spellings must stay invalid for every RSA variant: these
  // cases fail if CryptoKeyUsageKemMask is dropped from the RSA predicates.
  const kemUsages = ["encapsulateKey", "encapsulateBits", "decapsulateKey", "decapsulateBits"] as const;
  it.each(["RSASSA-PKCS1-v1_5", "RSA-OAEP", "RSA-PSS"].flatMap(name => kemUsages.map(usage => [name, usage] as const)))(
    "generateKey rejects the KEM usage %s/%s for RSA keys",
    async (name, usage) => {
      await expect(
        crypto.subtle.generateKey(
          { name, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
          true,
          [usage as KeyUsage],
        ),
      ).rejects.toThrow("Unsupported key usage for a RSA key");
    },
  );

  it.each(kemUsages)("generateKey rejects RSAES-PKCS1-v1_5 with the KEM usage %s", async usage => {
    // RSAES rejects before the usage check with its deprecation notice.
    await expect(
      crypto.subtle.generateKey(
        { name: "RSAES-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
        true,
        [usage as KeyUsage],
      ),
    ).rejects.toThrow("RSAES-PKCS1-v1_5 support is deprecated");
  });
});

// https://github.com/oven-sh/bun/issues/32613
describe("AES-KW wrapKey/unwrapKey with jwk format", () => {
  // The serialized JWK is rarely a multiple of 8 bytes, which AES-KW (RFC 3394)
  // requires. Bun used to reject these with OperationError; it now pads the JWK
  // JSON with trailing spaces, matching Node.js.
  it.each(["SHA-256", "SHA-384", "SHA-512"])("round-trips an HMAC %s key", async hash => {
    const hmacKey = await crypto.subtle.generateKey({ name: "HMAC", hash }, true, ["sign", "verify"]);
    const wrappingKey = await crypto.subtle.generateKey({ name: "AES-KW", length: 256 }, true, [
      "wrapKey",
      "unwrapKey",
    ]);
    const originalJwk = (await crypto.subtle.exportKey("jwk", hmacKey)) as JsonWebKey;

    const wrapped = await crypto.subtle.wrapKey("jwk", hmacKey, wrappingKey, "AES-KW");

    const unwrapped = await crypto.subtle.unwrapKey(
      "jwk",
      wrapped,
      wrappingKey,
      "AES-KW",
      { name: "HMAC", hash },
      true,
      ["sign", "verify"],
    );
    const roundTrippedJwk = (await crypto.subtle.exportKey("jwk", unwrapped)) as JsonWebKey;
    expect(roundTrippedJwk.kty).toBe("oct");
    expect(roundTrippedJwk.k).toBe(originalJwk.k);
  });

  it("does not apply jwk padding to raw-format keys", async () => {
    const wrappingKey = await crypto.subtle.generateKey({ name: "AES-KW", length: 256 }, true, [
      "wrapKey",
      "unwrapKey",
    ]);

    // A 32-byte key is already a multiple of 8; wrapped output is key + 8 bytes.
    const alignedKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const wrapped = await crypto.subtle.wrapKey("raw", alignedKey, wrappingKey, "AES-KW");
    expect(wrapped.byteLength).toBe(40);

    // A raw key whose length is not a multiple of 8 must still be rejected: the
    // jwk whitespace padding must not leak into the raw branch. A 56-bit HMAC
    // key exports to 7 raw bytes, which AES-KW cannot wrap.
    const unalignedKey = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256", length: 56 }, true, [
      "sign",
      "verify",
    ]);
    expect((await crypto.subtle.exportKey("raw", unalignedKey)).byteLength).toBe(7);
    const err = await crypto.subtle.wrapKey("raw", unalignedKey, wrappingKey, "AES-KW").then(
      () => null,
      e => e,
    );
    expect(err).toBeInstanceOf(DOMException);
    expect(err.name).toBe("OperationError");
  });

  it("unwraps an AES-KW jwk blob produced by Node.js", async () => {
    // Fixed wrapping key + HMAC SHA-512 key wrapped by Node.js, proving interop.
    const wrappingKey = await crypto.subtle.importKey(
      "raw",
      Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex"),
      "AES-KW",
      false,
      ["unwrapKey"],
    );
    const wrapped = Buffer.from(
      "8bb2ba91c19d8e05a8c07a4634bacc1fb3eac4725a5c206452865a3d034cc8d1cad992b8d6e45cea1369d2a3073306ab8f2fe826e71da572dc404a9662a05fdd759dcfd4fea26f8b980d87d4871ed12b3b681bb090f29ee19d0def9c708a462ab29789f59c1b68861877667fd39a3e20bae77eb0f6581ad758cd4a70b1659dd5005db7405b88cd1a15aa1397c3dbde2b11a61a84d467881375cb5a779cdcab00e4faabba1121e450",
      "hex",
    );
    const unwrapped = await crypto.subtle.unwrapKey(
      "jwk",
      wrapped,
      wrappingKey,
      "AES-KW",
      { name: "HMAC", hash: "SHA-512" },
      true,
      ["sign", "verify"],
    );
    const jwk = (await crypto.subtle.exportKey("jwk", unwrapped)) as JsonWebKey;
    expect(jwk.kty).toBe("oct");
    expect(jwk.k).toBe("AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4_QA");
  });
});

// The WebIDL for deriveBits is `optional unsigned long? length = null`: `null` (and an
// omitted/undefined argument) mean "the whole secret", while `0` asks for zero bits.
// Bun used to treat `0` as the null sentinel and hand back the entire ECDH/X25519 shared
// secret, and never zeroed the unused trailing bits of the last byte for lengths that
// are not a multiple of 8. https://w3c.github.io/webcrypto/#SubtleCrypto-method-deriveBits
describe("SubtleCrypto.deriveBits length", () => {
  // Fixed P-256 pair so every value below is a known answer; all expectations in this
  // block were produced by Node.js v26 against the same keys.
  const ecPriv: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: "bq-02N-hB7K4namaV9F4R30CuRDUhO_JlwjUS10Ns1o",
    y: "Q2YhmQFI9uq8U1ZzzlmPy25Zar2wWz_jZh7I5QhAeW8",
    d: "XVoo_2zmaH8lEJOdQMkGgMOIibOecvksDPBRXnhAKo8",
  };
  const ecPub: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: "3DyR3pdz7BDZtoAVvm4Mn55Ashdl84LCJB9kcUI3IrQ",
    y: "r6xDaTpWl7d958Y4HMq6OR4F8PLe1wl7m41I2ZX1yoU",
  };
  const ecSecret = "a2a0e8fbdc79f55e5178ee9850f05069d47876abbc1d4db453e6523e6574a17b";
  const enc = new TextEncoder();
  const hex = (b: ArrayBuffer) => Buffer.from(b).toString("hex");
  const probe = (p: Promise<ArrayBuffer>) => p.then(hex, e => e.name);

  async function importEcPair() {
    const [priv, pub] = await Promise.all([
      crypto.subtle.importKey("jwk", ecPriv, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits", "deriveKey"]),
      crypto.subtle.importKey("jwk", ecPub, { name: "ECDH", namedCurve: "P-256" }, false, []),
    ]);
    return { name: "ECDH" as const, public: pub, priv };
  }

  it("declares length as optional", () => {
    expect(crypto.subtle.deriveBits.length).toBe(2);
  });

  it("ECDH: distinguishes a null/omitted length from a zero length", async () => {
    const { priv, ...alg } = await importEcPair();
    expect({
      null: await probe(crypto.subtle.deriveBits(alg, priv, null)),
      undefined: await probe(crypto.subtle.deriveBits(alg, priv, undefined)),
      omitted: await probe(crypto.subtle.deriveBits(alg, priv)),
      zero: await probe(crypto.subtle.deriveBits(alg, priv, 0)),
      exact: await probe(crypto.subtle.deriveBits(alg, priv, 256)),
      tooLong: await probe(crypto.subtle.deriveBits(alg, priv, 257)),
    }).toEqual({
      null: ecSecret,
      undefined: ecSecret,
      omitted: ecSecret,
      zero: "",
      exact: ecSecret,
      tooLong: "OperationError",
    });
  });

  it("ECDH: zeroes the unused trailing bits when length is not a multiple of 8", async () => {
    const { priv, ...alg } = await importEcPair();
    const results: Record<number, string> = {};
    for (const length of [1, 3, 9, 17, 33, 255]) {
      results[length] = await probe(crypto.subtle.deriveBits(alg, priv, length));
    }
    expect(results).toEqual({
      1: "80",
      3: "a0",
      9: "a280",
      17: "a2a080",
      33: "a2a0e8fb80",
      255: "a2a0e8fbdc79f55e5178ee9850f05069d47876abbc1d4db453e6523e6574a17a",
    });
  });

  it("HKDF/PBKDF2: a zero length yields zero bytes, a null length is an error", async () => {
    const [hk, pb] = await Promise.all([
      crypto.subtle.importKey("raw", enc.encode("secret"), "HKDF", false, ["deriveBits"]),
      crypto.subtle.importKey("raw", enc.encode("secret"), "PBKDF2", false, ["deriveBits"]),
    ]);
    const hkAlg = { name: "HKDF", hash: "SHA-256", salt: enc.encode("salt"), info: enc.encode("info") };
    const pbAlg = { name: "PBKDF2", hash: "SHA-256", salt: enc.encode("salt"), iterations: 10 };
    // A zero iteration count is an OperationError even when zero bits are requested;
    // the zero-length path must still run the algorithm's parameter validation.
    const pbIter0 = { ...pbAlg, iterations: 0 };
    expect({
      "hkdf 0": await probe(crypto.subtle.deriveBits(hkAlg, hk, 0)),
      "hkdf null": await probe(crypto.subtle.deriveBits(hkAlg, hk, null)),
      "hkdf 7": await probe(crypto.subtle.deriveBits(hkAlg, hk, 7)),
      "hkdf 16": await probe(crypto.subtle.deriveBits(hkAlg, hk, 16)),
      "pbkdf2 0": await probe(crypto.subtle.deriveBits(pbAlg, pb, 0)),
      "pbkdf2 null": await probe(crypto.subtle.deriveBits(pbAlg, pb, null)),
      "pbkdf2 7": await probe(crypto.subtle.deriveBits(pbAlg, pb, 7)),
      "pbkdf2 16": await probe(crypto.subtle.deriveBits(pbAlg, pb, 16)),
      "pbkdf2 iterations 0 length 0": await probe(crypto.subtle.deriveBits(pbIter0, pb, 0)),
      "pbkdf2 iterations 0 length 256": await probe(crypto.subtle.deriveBits(pbIter0, pb, 256)),
    }).toEqual({
      "hkdf 0": "",
      "hkdf null": "OperationError",
      "hkdf 7": "OperationError",
      "hkdf 16": "f6d2",
      "pbkdf2 0": "",
      "pbkdf2 null": "OperationError",
      "pbkdf2 7": "OperationError",
      "pbkdf2 16": "2fb1",
      "pbkdf2 iterations 0 length 0": "OperationError",
      "pbkdf2 iterations 0 length 256": "OperationError",
    });
  });

  // deriveKey(derivedKeyType: HKDF) has no inherent key length, so the entire shared
  // secret must become the imported HKDF key; a derivedKeyType with a concrete length
  // (AES-GCM 256) must still flow that length through.
  it("deriveKey still derives the whole secret for length-less derived key types", async () => {
    const { priv, ...alg } = await importEcPair();
    const hkdfKey = await crypto.subtle.deriveKey(alg, priv, { name: "HKDF", hash: "SHA-256" }, false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: enc.encode("salt"), info: enc.encode("info") },
      hkdfKey,
      256,
    );
    expect(hex(bits)).toBe("823ff972ada0b090c2f03e1704d01d95bbf67629f44af00b23f5ab2c9e307afc");

    const aesKey = await crypto.subtle.deriveKey(alg, priv, { name: "AES-GCM", length: 256 }, true, ["encrypt"]);
    expect(hex(await crypto.subtle.exportKey("raw", aesKey))).toBe(ecSecret);
  });
});

describe("X25519 JWK import", () => {
  const x25519Public: JsonWebKey = {
    kty: "OKP",
    crv: "X25519",
    x: "hSDwCYkwp1R0i33ctD73Wg2_Og0mOBr06uFD1q1y5Go",
  };
  const x25519Private: JsonWebKey = {
    ...x25519Public,
    d: "dwdtCnMYpX08FsFyUbJmRd9ML4frwJkqsXf7pR25LCo",
  };
  const outcome = (jwk: JsonWebKey, extractable: boolean, usages: KeyUsage[]) =>
    crypto.subtle.importKey("jwk", jwk, "X25519", extractable, usages).then(
      key => (key instanceof CryptoKey ? "imported" : "other"),
      e => e.name,
    );

  it("rejects a JWK whose kty is not OKP", async () => {
    expect({
      wrongKty: await outcome({ ...x25519Public, kty: "EC" }, true, []),
      okp: await outcome({ ...x25519Public, ext: true }, true, []),
    }).toEqual({ wrongKty: "DataError", okp: "imported" });
  });

  it("rejects a JWK whose key_ops does not include the requested usages", async () => {
    expect({
      missingUsage: await outcome({ ...x25519Private, key_ops: ["deriveKey"] }, true, ["deriveBits"]),
      supersetOfUsages: await outcome({ ...x25519Private, key_ops: ["deriveBits", "deriveKey"], ext: true }, true, [
        "deriveBits",
      ]),
    }).toEqual({ missingUsage: "DataError", supersetOfUsages: "imported" });
  });

  it("rejects a JWK with ext set to false when extractable is requested", async () => {
    expect({
      extFalse: await outcome({ ...x25519Public, ext: false }, true, []),
      extTrue: await outcome({ ...x25519Public, ext: true }, true, []),
    }).toEqual({ extFalse: "DataError", extTrue: "imported" });
  });
});

// Ed25519 and X25519 share the 1.3.101.* OID prefix and differ only in the last
// byte, so importing one as the other must report the type mismatch rather than
// the generic "Invalid keyData" the prefix-only check gave.
describe("OKP spki/pkcs8 cross-curve import", () => {
  const rejection = (p: Promise<unknown>) =>
    p.then(
      () => "imported",
      e => `${e.name}: ${e.message}`,
    );

  it("Ed25519 key imported as X25519 reports 'Invalid key type'", async () => {
    const ed = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const spki = await crypto.subtle.exportKey("spki", ed.publicKey);
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", ed.privateKey);
    expect({
      spki: await rejection(crypto.subtle.importKey("spki", spki, "X25519", true, [])),
      pkcs8: await rejection(crypto.subtle.importKey("pkcs8", pkcs8, "X25519", true, ["deriveBits"])),
    }).toEqual({ spki: "DataError: Invalid key type", pkcs8: "DataError: Invalid key type" });
  });

  it("X25519 key imported as Ed25519 reports 'Invalid key type'", async () => {
    const x = await crypto.subtle.generateKey("X25519", true, ["deriveBits"]);
    const spki = await crypto.subtle.exportKey("spki", x.publicKey);
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", x.privateKey);
    expect({
      spki: await rejection(crypto.subtle.importKey("spki", spki, "Ed25519", true, ["verify"])),
      pkcs8: await rejection(crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", true, ["sign"])),
    }).toEqual({ spki: "DataError: Invalid key type", pkcs8: "DataError: Invalid key type" });
  });

  // OKP keys encode a one-element AlgorithmIdentifier (parameters MUST be absent), so
  // the EC importer's two-element guard bailed without reaching the OID check and
  // reported the generic "Invalid keyData" instead of the type mismatch.
  it("OKP key imported as ECDSA/ECDH reports 'Invalid key type'", async () => {
    const ed = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
    const spki = await crypto.subtle.exportKey("spki", ed.publicKey);
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", ed.privateKey);
    expect({
      ecdsaSpki: await rejection(
        crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]),
      ),
      ecdhSpki: await rejection(crypto.subtle.importKey("spki", spki, { name: "ECDH", namedCurve: "P-256" }, true, [])),
      ecdsaPkcs8: await rejection(
        crypto.subtle.importKey("pkcs8", pkcs8, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]),
      ),
    }).toEqual({
      ecdsaSpki: "DataError: Invalid key type",
      ecdhSpki: "DataError: Invalid key type",
      ecdsaPkcs8: "DataError: Invalid key type",
    });
  });
});

// importKey's empty-usages guard got Node's message; the same predicate in
// generateKey, deriveKey's inner import and unwrapKey's inner import still
// carried the empty-message SyntaxError.
describe("empty usages on a private or secret key", () => {
  const rejection = (p: Promise<unknown>) =>
    p.then(
      () => "resolved",
      e => `${e.name}: ${e.message}`,
    );

  it("generateKey reports 'Usages cannot be empty when creating a key.'", async () => {
    expect({
      secret: await rejection(crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [])),
      pair: await rejection(crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [])),
    }).toEqual({
      secret: "SyntaxError: Usages cannot be empty when creating a key.",
      pair: "SyntaxError: Usages cannot be empty when creating a key.",
    });
  });

  it("deriveKey and unwrapKey report the importKey message", async () => {
    const pb = await crypto.subtle.importKey("raw", new Uint8Array(16), "PBKDF2", false, ["deriveKey"]);
    const pbkdf2 = { name: "PBKDF2", salt: new Uint8Array(8), iterations: 1, hash: "SHA-256" };
    const kw = await crypto.subtle.generateKey({ name: "AES-KW", length: 256 }, true, ["wrapKey", "unwrapKey"]);
    const hm = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, true, ["sign"]);
    const wrapped = await crypto.subtle.wrapKey("raw", hm, kw, "AES-KW");
    expect({
      deriveKey: await rejection(crypto.subtle.deriveKey(pbkdf2, pb, { name: "AES-GCM", length: 256 }, false, [])),
      unwrapKey: await rejection(
        crypto.subtle.unwrapKey("raw", wrapped, kw, "AES-KW", { name: "HMAC", hash: "SHA-256" }, false, []),
      ),
    }).toEqual({
      deriveKey: "SyntaxError: Usages cannot be empty when importing a secret key.",
      unwrapKey: "SyntaxError: Usages cannot be empty when importing a secret key.",
    });
  });
});

// X25519 deriveBits is a line-for-line parallel of ECDH's; ECDH got Node's
// mismatch messages but the X25519 twin was left with the empty-message
// InvalidAccessError. The cfrg vendored test only covers this under X448.
it("X25519 deriveBits with an ECDH public key reports 'key algorithm mismatch'", async () => {
  const x = await crypto.subtle.generateKey("X25519", false, ["deriveBits"]);
  const ec = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const rejection = (p: Promise<unknown>) =>
    p.then(
      () => "resolved",
      e => `${e.name}: ${e.message}`,
    );
  expect({
    x25519WithEcdhPublic: await rejection(
      crypto.subtle.deriveBits({ name: "X25519", public: ec.publicKey }, x.privateKey, 256),
    ),
    ecdhWithX25519Public: await rejection(
      crypto.subtle.deriveBits({ name: "ECDH", namedCurve: "P-256", public: x.publicKey }, ec.privateKey, 256),
    ),
  }).toEqual({
    x25519WithEcdhPublic: "InvalidAccessError: key algorithm mismatch",
    ecdhWithX25519Public: "InvalidAccessError: key algorithm mismatch",
  });
});

// The RSA importKey usage guards are the same shape as ECDSA/Ed25519's, which
// got Node's message; the RSA parallels carried the empty-message SyntaxError.
// RSAES-PKCS1-v1_5 is deprecated in Bun and blocked at normalize, so untested.
it("RSA importKey with an unsupported usage names the algorithm", async () => {
  const { publicKey } = await crypto.subtle.generateKey(
    { name: "RSA-PSS", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const spki = await crypto.subtle.exportKey("spki", publicKey);
  const rejection = (p: Promise<unknown>) =>
    p.then(
      () => "resolved",
      e => `${e.name}: ${e.message}`,
    );
  expect({
    pss: await rejection(
      crypto.subtle.importKey("spki", spki, { name: "RSA-PSS", hash: "SHA-256" }, true, ["encrypt"]),
    ),
    rsassa: await rejection(
      crypto.subtle.importKey("spki", spki, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, true, ["encrypt"]),
    ),
    oaep: await rejection(crypto.subtle.importKey("spki", spki, { name: "RSA-OAEP", hash: "SHA-256" }, true, ["sign"])),
  }).toEqual({
    pss: "SyntaxError: Unsupported key usage for an RSA-PSS key",
    rsassa: "SyntaxError: Unsupported key usage for an RSASSA-PKCS1-v1_5 key",
    oaep: "SyntaxError: Unsupported key usage for an RSA-OAEP key",
  });
});

// CryptoKey.usages and the JWK key_ops it is built from are ordered by the
// KeyUsage enum in https://w3c.github.io/webcrypto/#dfn-KeyUsage, not
// alphabetically, and not by the order the caller passed them in.
describe("CryptoKey.usages ordering", () => {
  it("normalizes to KeyUsage enum order regardless of input order", async () => {
    const forward = await crypto.subtle.importKey("raw", new Uint8Array(32), { name: "AES-CBC" }, true, [
      "encrypt",
      "decrypt",
    ]);
    const reversed = await crypto.subtle.importKey("raw", new Uint8Array(32), { name: "AES-CBC" }, true, [
      "decrypt",
      "encrypt",
    ]);
    expect(forward.usages).toEqual(["encrypt", "decrypt"]);
    expect(reversed.usages).toEqual(["encrypt", "decrypt"]);
  });

  it("orders deriveKey before deriveBits", async () => {
    const { privateKey } = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
      "deriveKey",
    ]);
    expect(privateKey.usages).toEqual(["deriveKey", "deriveBits"]);
  });

  it("orders sign before verify", async () => {
    const key = await crypto.subtle.importKey("raw", new Uint8Array(32), { name: "HMAC", hash: "SHA-256" }, true, [
      "verify",
      "sign",
    ]);
    expect(key.usages).toEqual(["sign", "verify"]);
  });

  it("applies the same order to JWK key_ops", async () => {
    const key = await crypto.subtle.importKey("raw", new Uint8Array(32), { name: "AES-CBC" }, true, [
      "decrypt",
      "encrypt",
    ]);
    const jwk = await crypto.subtle.exportKey("jwk", key);
    expect(jwk.key_ops).toEqual(["encrypt", "decrypt"]);
  });

  it("orders wrapKey/unwrapKey after encrypt/decrypt on an RSA-OAEP pair", async () => {
    const { publicKey, privateKey } = await crypto.subtle.generateKey(
      { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["unwrapKey", "decrypt", "wrapKey", "encrypt"],
    );
    expect(publicKey.usages).toEqual(["encrypt", "wrapKey"]);
    expect(privateKey.usages).toEqual(["decrypt", "unwrapKey"]);
  });
});

// getRandomValues takes integer-typed views only; every other ArrayBufferView-ish
// argument raises TypeMismatchError rather than being filled.
describe("crypto.getRandomValues argument types", () => {
  const integerViews = [
    ["Int8Array", () => new Int8Array(4)],
    ["Uint8Array", () => new Uint8Array(4)],
    ["Uint8ClampedArray", () => new Uint8ClampedArray(4)],
    ["Int16Array", () => new Int16Array(4)],
    ["Uint16Array", () => new Uint16Array(4)],
    ["Int32Array", () => new Int32Array(4)],
    ["Uint32Array", () => new Uint32Array(4)],
    ["BigInt64Array", () => new BigInt64Array(4)],
    ["BigUint64Array", () => new BigUint64Array(4)],
  ] as const;

  for (const [name, make] of integerViews) {
    it(`accepts ${name}`, () => {
      const view = make();
      expect(crypto.getRandomValues(view)).toBe(view);
    });
  }

  const rejected = [
    ["Float16Array", () => new Float16Array(4)],
    ["Float32Array", () => new Float32Array(4)],
    ["Float64Array", () => new Float64Array(4)],
    ["DataView", () => new DataView(new ArrayBuffer(4))],
    ["ArrayBuffer", () => new ArrayBuffer(4)],
    ["SharedArrayBuffer", () => new SharedArrayBuffer(4)],
    ["plain object", () => ({})],
  ] as const;

  for (const [name, make] of rejected) {
    it(`rejects ${name} with TypeMismatchError`, () => {
      expect(() => crypto.getRandomValues(make() as any)).toThrow(
        expect.objectContaining({
          name: "TypeMismatchError",
          message: "The data argument must be an integer-type TypedArray",
        }),
      );
    });
  }
});

describe("exception scope discipline", () => {
  // BUN_JSC_validateExceptionChecks=1 aborts on the first unchecked throw scope, so the
  // fixture (every SubtleCrypto op, success and normalize-failure) only produces the full
  // transcript when every call site is disciplined. Two cases also fail without the option.
  it("every subtle.* path survives BUN_JSC_validateExceptionChecks", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), import.meta.resolveSync("./exception-scope-fixture.ts")],
      env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // `exitCode` and the transcript length are what fail when a scope goes unchecked;
    // `uncheckedScopes` just surfaces the offending pair from the validator's stderr
    // report so the diff names the call site instead of only showing a truncated log.
    const uncheckedScopes = stderr
      .split("\n")
      .map(line => line.trim())
      .filter(line => line.startsWith("This scope can throw") || line.startsWith("But the exception was unchecked"));
    expect({ transcript: stdout.trimEnd().split("\n"), uncheckedScopes, exitCode }).toEqual({
      transcript: [
        "encrypt ok = RESOLVED",
        "encrypt bogus = REJECTED NotSupportedError: Unrecognized algorithm name",
        "encrypt thrower = REJECTED Error: boom",
        "decrypt ok = RESOLVED",
        "decrypt bogus = REJECTED NotSupportedError: Unrecognized algorithm name",
        "sign ok = RESOLVED",
        "sign bogus = REJECTED NotSupportedError: Unrecognized algorithm name",
        "verify ok = RESOLVED",
        "verify bogus = REJECTED NotSupportedError: Unrecognized algorithm name",
        "digest ok = RESOLVED",
        "digest bogus = REJECTED NotSupportedError: Unrecognized algorithm name",
        "digest thrower = REJECTED Error: boom",
        "generateKey ok = RESOLVED",
        "generateKey bogus = REJECTED NotSupportedError: Unrecognized algorithm name",
        "generateKey nested bogus hash = REJECTED NotSupportedError: Unrecognized algorithm name",
        "generateKey thrower = REJECTED Error: boom",
        "deriveKey ok = RESOLVED",
        "deriveKey bogus algorithm = REJECTED NotSupportedError: Unrecognized algorithm name",
        "deriveKey bogus derived type = REJECTED NotSupportedError: Unrecognized algorithm name",
        "deriveKey importable but no key length = REJECTED NotSupportedError: Unrecognized algorithm name",
        "deriveBits ok = RESOLVED",
        "deriveBits bogus = REJECTED NotSupportedError: Unrecognized algorithm name",
        "importKey ok = RESOLVED",
        "importKey bogus = REJECTED NotSupportedError: Unrecognized algorithm name",
        "importKey nested bogus hash = REJECTED NotSupportedError: Unrecognized algorithm name",
        "importKey thrower = REJECTED Error: boom",
        "exportKey raw = RESOLVED",
        "exportKey jwk = RESOLVED",
        "wrapKey raw = RESOLVED",
        "wrapKey jwk = RESOLVED",
        "wrapKey via encrypt = RESOLVED",
        "wrapKey bogus = REJECTED NotSupportedError: Unrecognized algorithm name",
        "wrapKey thrower = REJECTED Error: boom",
        "wrapKey jwk with throwing Object.prototype.toJSON = REJECTED Error: poisoned toJSON",
        "unwrapKey raw = RESOLVED",
        "unwrapKey jwk = RESOLVED",
        "unwrapKey via decrypt = RESOLVED",
        "unwrapKey jwk not json = REJECTED DataError: WrappedKey cannot be converted to a JSON object",
        "unwrapKey bogus unwrap algorithm = REJECTED NotSupportedError: Unrecognized algorithm name",
        "unwrapKey bogus unwrapped type = REJECTED NotSupportedError: Unrecognized algorithm name",
      ],
      uncheckedScopes: [],
      exitCode: 0,
    });
  });
});

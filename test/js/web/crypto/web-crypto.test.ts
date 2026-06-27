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

  // W3C WebCrypto: JsonWebKey.kty is not a required dictionary member; each
  // algorithm's import key operation rejects a missing/wrong kty with DataError.
  describe("importKey jwk with missing kty rejects with DataError", () => {
    const cases: Array<[string, object, object, KeyUsage[]]> = [
      ["AES-GCM", { k: "AAECAwQFBgcICQoLDA0ODw" }, { name: "AES-GCM" }, ["encrypt"]],
      ["HMAC", { k: "AAECAwQFBgcICQoLDA0ODw" }, { name: "HMAC", hash: "SHA-256" }, ["sign"]],
      ["RSA-OAEP", { n: "AQAB", e: "AQAB" }, { name: "RSA-OAEP", hash: "SHA-256" }, ["encrypt"]],
      ["ECDSA", { crv: "P-256", x: "", y: "" }, { name: "ECDSA", namedCurve: "P-256" }, ["verify"]],
      ["Ed25519", { crv: "Ed25519", x: "" }, { name: "Ed25519" }, ["verify"]],
    ];
    it.each(cases)("%s", async (_name, jwk, alg, usages) => {
      const err = await crypto.subtle.importKey("jwk", jwk as JsonWebKey, alg, true, usages).then(
        () => null,
        e => e,
      );
      expect(err).toBeInstanceOf(DOMException);
      expect(err.name).toBe("DataError");
    });
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

    // Previously this promise never settled: the exception from JsonWebKey
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

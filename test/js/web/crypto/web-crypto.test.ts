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

    // Previously this promise never settled: the TypeError from JsonWebKey
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
      expect(err).toBeInstanceOf(TypeError);
      expect(err.message).toContain("kty");
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

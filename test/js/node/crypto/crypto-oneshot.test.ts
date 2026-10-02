import { describe, expect, test } from "bun:test";
import crypto from "crypto";
import { readFileSync } from "fs";
import { path } from "../test/common/fixtures";

describe("crypto.hash", () => {
  test("throws for invalid arguments", () => {
    ([undefined, null, true, 1, () => {}, {}] as const).forEach(invalid => {
      expect(() => crypto.hash(invalid, "test")).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    });

    [undefined, null, true, 1, () => {}, {}].forEach(invalid => {
      expect(() => crypto.hash("sha1", invalid)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    });

    [null, true, 1, () => {}, {}].forEach(invalid => {
      expect(() => crypto.hash("sha1", "test", invalid)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    });

    expect(() => crypto.hash("sha1", "test", "not an encoding")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_VALUE",
      }),
    );
  });
  const input = readFileSync(path("utf8_test_text.txt"));
  [
    "blake2b256",
    "blake2b512",
    "blake2s256",
    "ripemd160",
    "rmd160",
    "md4",
    "md5",
    "sha1",
    "sha128",
    "sha224",
    "sha256",
    "sha384",
    "sha512",
    "sha-1",
    "sha-224",
    "sha-256",
    "sha-384",
    "sha-512",
    "sha-512/224",
    "sha-512_224",
    "sha-512224",
    "sha512-224",
    "sha-512/256",
    "sha-512_256",
    "sha-512256",
    "sha512-256",
    "sha384",
    "sha3-224",
    "sha3-256",
    "sha3-384",
    "sha3-512",
    "shake128",
    "shake256",
  ].forEach(method => {
    test(`output matches crypto.createHash(${method})`, () => {
      for (const outputEncoding of ["buffer", "hex", "base64", undefined]) {
        const oldDigest = crypto
          .createHash(method)
          .update(input)
          .digest(outputEncoding || "hex");
        const digestFromBuffer = crypto.hash(method, input, outputEncoding);
        expect(digestFromBuffer).toEqual(oldDigest);

        const digestFromString = crypto.hash(method, input.toString(), outputEncoding);
        expect(digestFromString).toEqual(oldDigest);
      }
    });
  });
});

describe("crypto.verify", () => {
  // BoringSSL supports ripemd160/md4 as hash functions (so getHashes() lists them and
  // createHash() works) but not as RSA PKCS#1 v1.5 signature digests. verify() used to
  // swallow that failure into a plain `false`, while sign() with the same digest threw.
  describe.each(["ripemd160", "md4"])("throws for %s with RSA PKCS#1", digest => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const data = Buffer.from("advertised but unsignable");
    const sig = Buffer.alloc(256);
    const expected = expect.objectContaining({ code: "ERR_OSSL_UNKNOWN_ALGORITHM_TYPE" });

    test("advertises the digest for hashing", () => {
      expect(crypto.getHashes()).toContain(digest);
      expect(crypto.createHash(digest).update(data).digest("hex")).toMatch(/^[0-9a-f]+$/);
    });

    test("sign() and verify() both throw", () => {
      expect(() => crypto.sign(digest, data, privateKey)).toThrow(expected);
      expect(() => crypto.verify(digest, data, publicKey, sig)).toThrow(expected);
    });

    test("createVerify().verify() throws", () => {
      expect(() => crypto.createVerify(digest).update(data).verify(publicKey, sig)).toThrow(expected);
    });

    test("createSign().sign() throws with an error code", () => {
      let caught: any;
      try {
        crypto.createSign(digest).update(data).sign(privateKey);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeDefined();
      expect(caught.code).toBe("ERR_OSSL_UNKNOWN_ALGORITHM_TYPE");
    });

    test("async verify() delivers an error", async () => {
      const { promise, resolve } = Promise.withResolvers<{ err: any; result: any }>();
      crypto.verify(digest, data, publicKey, sig, (err, result) => resolve({ err, result }));
      const { err, result } = await promise;
      expect(err).toEqual(expected);
      expect(result).toBeUndefined();
    });

    test("RSA-PSS is unaffected", () => {
      const pss = { key: privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING };
      const pssPub = { key: publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING };
      const pssSig = crypto.sign(digest, data, pss);
      expect(crypto.verify(digest, data, pssPub, pssSig)).toBe(true);
      expect(crypto.verify(digest, data, pssPub, Buffer.alloc(256))).toBe(false);
    });
  });

  test("sha256 with RSA PKCS#1 still verifies end-to-end", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const data = Buffer.from("round trip");
    const sig = crypto.sign("sha256", data, privateKey);
    expect(crypto.verify("sha256", data, publicKey, sig)).toBe(true);
    expect(crypto.verify("sha256", data, publicKey, Buffer.alloc(256))).toBe(false);
    expect(crypto.createVerify("sha256").update(data).verify(publicKey, sig)).toBe(true);
  });

  test("uses the signature bytes provided at call time", () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const data = Buffer.from("data to sign");
    const signature = crypto.sign("sha256", data, privateKey);
    expect(crypto.verify("sha256", data, publicKey, signature)).toBe(true);

    const publicPem = publicKey.export({ type: "spki", format: "pem" });
    let passphraseReads = 0;
    const verified = crypto.verify(
      "sha256",
      data,
      {
        key: publicPem,
        format: "pem",
        get passphrase() {
          passphraseReads++;
          signature.fill(0);
          return undefined;
        },
      },
      signature,
    );
    expect(passphraseReads).toBe(1);
    expect(verified).toBe(true);
  });
});

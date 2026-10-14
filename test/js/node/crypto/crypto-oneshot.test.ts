import { describe, expect, test } from "bun:test";
import crypto from "crypto";
import { readFileSync } from "fs";
import { path } from "../test/common/fixtures";

describe("crypto.hash", () => {
  test("throws for invalid arguments", () => {
    ([undefined, null, true, 1, () => {}, {}] as const).forEach(invalid => {
      // @ts-expect-error
      expect(() => crypto.hash(invalid, "test")).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    });

    [undefined, null, true, 1, () => {}, {}].forEach(invalid => {
      // @ts-expect-error
      expect(() => crypto.hash("sha1", invalid)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    });

    [null, true, 1, () => {}, {}].forEach(invalid => {
      // @ts-expect-error
      expect(() => crypto.hash("sha1", "test", invalid)).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_TYPE",
        }),
      );
    });

    // @ts-expect-error
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
      for (const outputEncoding of ["buffer", "hex", "base64", undefined] as BufferEncoding[]) {
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

// Node reads the bytes of `data` and `signature` in native code, after its JS layer has read the
// key options. A getter on those options can change or detach the buffer before that.
describe("crypto.sign and crypto.verify read their buffers after the key option getters run, like Node", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
  const publicPem = publicKey.export({ type: "spki", format: "pem" });
  const keyWithGetter = (key: string | Buffer, onRead: () => void) => ({
    key,
    format: "pem" as const,
    get passphrase() {
      onRead();
      return undefined;
    },
  });

  test("verify: signature changed by the getter", () => {
    const data = Buffer.from("data to sign");
    const signature = crypto.sign("sha256", data, privateKey);
    expect(crypto.verify("sha256", data, publicKey, signature)).toBe(true);

    let passphraseReads = 0;
    const key = keyWithGetter(publicPem, () => {
      passphraseReads++;
      signature.fill(0);
    });
    const verified = crypto.verify("sha256", data, key, signature);
    expect(passphraseReads).toBe(1);
    expect(verified).toBe(false);
  });

  test("verify: signature detached by the getter", () => {
    const data = Buffer.from("data to sign");
    const signature = new Uint8Array(crypto.sign("sha256", data, privateKey));
    const key = keyWithGetter(publicPem, () => void signature.buffer.transfer());
    expect(crypto.verify("sha256", data, key, signature)).toBe(false);
  });

  test("verify: data changed by the getter", () => {
    const data = new Uint8Array(32).fill(7);
    const signature = crypto.sign("sha256", new Uint8Array(32).fill(9), privateKey);
    const key = keyWithGetter(publicPem, () => void data.fill(9));
    expect(crypto.verify("sha256", data, key, signature)).toBe(true);
  });

  test("verify: data detached by the getter", () => {
    const data = new Uint8Array(32).fill(7);
    const signature = crypto.sign("sha256", new Uint8Array(0), privateKey);
    const key = keyWithGetter(publicPem, () => void data.buffer.transfer());
    expect(crypto.verify("sha256", data, key, signature)).toBe(true);
  });

  test("sign: data changed by the getter", () => {
    const data = new Uint8Array(32).fill(7);
    const signature = crypto.sign(
      "sha256",
      data,
      keyWithGetter(privatePem, () => void data.fill(9)),
    );
    expect({
      changed: crypto.verify("sha256", new Uint8Array(32).fill(9), publicKey, signature),
      original: crypto.verify("sha256", new Uint8Array(32).fill(7), publicKey, signature),
    }).toEqual({ changed: true, original: false });
  });

  test("sign: data detached by the getter", () => {
    const data = new Uint8Array(32).fill(7);
    const signature = crypto.sign(
      "sha256",
      data,
      keyWithGetter(privatePem, () => void data.buffer.transfer()),
    );
    expect({
      empty: crypto.verify("sha256", new Uint8Array(0), publicKey, signature),
      original: crypto.verify("sha256", new Uint8Array(32).fill(7), publicKey, signature),
    }).toEqual({ empty: true, original: false });
  });
});

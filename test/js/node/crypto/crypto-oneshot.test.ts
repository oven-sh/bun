import { describe, expect, test } from "bun:test";
import crypto from "crypto";
import { readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { path } from "../test/common/fixtures";

describe("crypto.hash", () => {
  test("knows utf-16le by the name node gives it", () => {
    const digest = crypto.createHash("sha1").update("abc").digest();
    expect(crypto.hash("sha1", "abc", "utf-16le" as any)).toBe(digest.toString("utf16le"));
    expect(new Bun.CryptoHasher("sha1").update("abc", "utf-16le" as any).digest("hex")).toBe(
      crypto.createHash("sha1").update(Buffer.from("abc", "utf16le")).digest("hex"),
    );
  });

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

    [null, true, 1, () => {}, NaN, Symbol(0)].forEach(invalid => {
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

  test("says what is wrong like Node", () => {
    const hash = crypto.hash as (...args: unknown[]) => unknown;
    expect(hash).toHaveLength(3);
    expect(() => hash("nope", "x")).toThrow(
      expect.objectContaining({ name: "Error", message: "Digest method nope is not supported" }),
    );
    expect(() => hash("sha256", new ArrayBuffer(1))).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message:
          'The "input" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received an instance of ArrayBuffer',
      }),
    );
    expect(() => hash("sha256", "x", "nope")).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_VALUE",
        message: "The argument 'outputEncoding' is invalid. Received 'nope'",
      }),
    );
    expect(() => hash("sha256", "x", { outputEncoding: 5 })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });

  test("checks its input itself", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `ArrayBuffer.isView = () => true;
        const { hash } = require("node:crypto");
        for (const input of [{}, 5, [], new ArrayBuffer(8), null]) {
          for (const options of [undefined, { outputLength: 0 }]) {
            try {
              console.log(hash(options ? "shake128" : "sha256", input, options));
            } catch (e) {
              console.log(e.code);
            }
          }
        }
        // What is replaced later is not asked.
        ArrayBuffer.isView = () => false;
        String.prototype.toLowerCase = () => "buffer";
        console.log(hash("sha1", Buffer.from("abc")));
        try {
          hash("sha1", "abc", "nope");
        } catch (e) {
          console.log(e.code);
        }`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "ERR_INVALID_ARG_TYPE\n".repeat(10) + "a9993e364706816aba3e25717850c26c9cd0d89d\nERR_INVALID_ARG_VALUE\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test("takes an options object", () => {
    const digest = crypto.createHash("sha256").update("x").digest();
    expect(crypto.hash("sha256", "x", {})).toBe(digest.toString("hex"));
    expect(crypto.hash("sha256", "x", { outputEncoding: "base64" })).toBe(digest.toString("base64"));
    expect(crypto.hash("sha256", "x", { outputEncoding: "buffer" })).toEqual(digest);
    expect(crypto.hash("sha256", "x", { outputLength: 32 })).toBe(digest.toString("hex"));

    // It is an object without options, not a place to put the digest.
    const bytes = new Uint8Array(32);
    expect(crypto.hash("sha256", "x", bytes as any)).toBe(digest.toString("hex"));
    expect(bytes).toEqual(new Uint8Array(32));
  });

  test("outputLength", () => {
    const long = crypto.hash("shake128", "x", { outputLength: 100 });
    expect(crypto.hash("sha256", long)).toBe("7bcaed54dcf612d4659d3f9635c9cc8eb472abf78c9b1214f94efb95b53686e5");
    for (const outputLength of [1, 5, 16, 64, 65]) {
      expect(crypto.hash("shake128", "x", { outputLength })).toBe(long.slice(0, outputLength * 2));
      expect(crypto.hash("shake128", "x", { outputLength, outputEncoding: "buffer" })).toEqual(
        crypto.createHash("shake128", { outputLength }).update("x").digest(),
      );
    }
    expect(crypto.hash("shake256", "x", { outputLength: 1 })).toBe("c8");
    expect(crypto.hash("shake256", "x", { outputLength: 0 })).toBe("");
    expect(crypto.hash("shake256", "x", { outputLength: 0, outputEncoding: "buffer" })).toEqual(Buffer.alloc(0));

    for (const algorithm of ["sha256", "blake2s256"]) {
      expect(() => crypto.hash(algorithm, "x", { outputLength: 5 })).toThrow(
        expect.objectContaining({
          name: "Error",
          message: `Output length 5 is invalid for ${algorithm}, which does not support XOF`,
        }),
      );
    }
    expect(() => crypto.hash("shake128", "x", { outputLength: -1 })).toThrow(
      expect.objectContaining({ code: "ERR_OUT_OF_RANGE" }),
    );
    expect(() => crypto.hash("shake128", "x", { outputLength: "5" as any })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
  });

  test.concurrent.each([
    ['crypto.hash("shake128", "x")', 1],
    ['crypto.hash("SHAKE-256", "x", "hex")', 1],
    ['crypto.hash("shake256", "x", {})', 1],
    ['crypto.createHash("shake128")', 1],
    ['crypto.createHash("shake128"); crypto.hash("shake256", "x"); crypto.createHash("shake256", {})', 1],
    [
      'crypto.hash("shake128", "x", { outputLength: 16 }); crypto.createHash("shake256", { outputLength: 32 }).copy()',
      0,
    ],
    ['crypto.hash("sha256", "x"); crypto.createHash("sha3-256")', 0],
  ])("%s warns %d times that SHAKE wants an outputLength", async (script, times) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `const crypto = require("node:crypto"); ${script};`],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    expect(
      stderr.split(
        "[DEP0198] DeprecationWarning: Creating SHAKE128/256 digests without an explicit options.outputLength is deprecated.",
      ),
    ).toHaveLength(times + 1);
    expect(exitCode).toBe(0);
  });

  test("does not drop the options of cSHAKE", () => {
    for (const options of [{ customization: "a" }, { functionName: "a" }]) {
      expect(() => crypto.hash("shake128", "x", { outputLength: 8, ...options } as any)).toThrow(
        "Digest options are not supported",
      );
      expect(() => crypto.createHash("shake128", { outputLength: 8, ...options } as any)).toThrow(
        "Digest method not supported",
      );
    }
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

describe("crypto.verify", () => {
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
      } as crypto.VerifyPublicKeyInput,
      signature,
    );
    expect(passphraseReads).toBe(1);
    expect(verified).toBe(true);
  });
});

import { setSyntheticAllocationLimitForTesting } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import crypto from "crypto";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isASAN } from "harness";
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

    [null, true, 1, () => {}].forEach(invalid => {
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

  // The expected digests and errors are what node v26.12.1 gives, except where a comment says what node does.
  describe("options object", () => {
    const hex = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    const thrownBy = (call: () => unknown) => {
      try {
        call();
      } catch (error: any) {
        return { name: error.name, code: error.code, message: error.message };
      }
      throw new Error("did not throw");
    };
    /** For what the types of node refuse. */
    const hash = crypto.hash as (algorithm: unknown, data: unknown, options?: unknown) => string | Buffer;

    test("outputEncoding", () => {
      expect(crypto.hash("sha256", "abc", {})).toBe(hex);
      expect(crypto.hash("sha256", "abc", { outputEncoding: undefined })).toBe(hex);
      expect(hash("sha256", "abc", { outputEncoding: null })).toBe(hex);
      expect(crypto.hash("sha256", "abc", { outputEncoding: "hex" })).toBe(hex);
      expect(crypto.hash("sha256", "abc", { outputEncoding: "base64" })).toBe(
        "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=",
      );
      expect(hash("sha256", "abc", { outputEncoding: "BASE64" })).toBe("ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=");
      const buffer = crypto.hash("sha256", "abc", { outputEncoding: "buffer" });
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer).toEqual(Buffer.from(hex, "hex"));
      // https://github.com/nodejs/node/blob/v26.12.1/lib/internal/util.js#L313
      expect(hash("sha256", "abc", { outputEncoding: "" })).toBe(Buffer.from(hex, "hex").toString("utf8"));
      // For SHAKE without `outputLength`, node prints DEP0198. From v27 it throws: https://github.com/nodejs/node/pull/64000
      expect(crypto.hash("shake128", "abc", {})).toBe("5881092dd818bf5cf8a3ddb793fbcba7");
      expect(crypto.hash("shake256", "abc", {})).toBe(
        "483366601360a8771c6863080cc4114d8db44530f8f1e1ee4f94ea37e78b5739",
      );
    });

    test("an object of any class is read", () => {
      class Options {
        get outputEncoding() {
          return "base64";
        }
      }
      const withoutPrototype = Object.assign(Object.create(null), { outputLength: 8 });
      expect(hash("sha256", "abc", new Options())).toBe("ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=");
      expect(hash("shake128", "abc", withoutPrototype)).toBe("5881092dd818bf5c");
      expect(hash("shake128", "abc", new Proxy({ outputLength: 8 }, {}))).toBe("5881092dd818bf5c");
      expect(hash("sha256", "abc", new Map())).toBe(hex);
    });

    test("outputLength of shake128 and shake256", () => {
      expect(crypto.hash("shake128", "abc", { outputLength: 8 })).toBe("5881092dd818bf5c");
      expect(crypto.hash("SHAKE128", "abc", { outputLength: 8, outputEncoding: "base64url" })).toBe("WIEJLdgYv1w");
      expect(crypto.hash("shake256", "abc", { outputLength: 16 })).toBe("483366601360a8771c6863080cc4114d");
      expect(crypto.hash("shake128", "abc", { outputLength: 65 })).toBe(
        "5881092dd818bf5cf8a3ddb793fbcba74097d5c526a6d35f97b83351940f2cc8" +
          "44c50af32acd3f2cdd066568706f509bc1bdde58295dae3f891a9a0fca5783789a",
      );
      expect(crypto.hash("shake256", "abc", { outputLength: 100, outputEncoding: "base64" })).toBe(
        "SDNmYBNgqHccaGMIDMQRTY20RTD48eHuT5TqN+eLVznVoVvvGGpThsdXRMBSfh+qn4cm5GKhKk/rBr2IAedR5BOFFBIE8ymXn9MEehPFZXckraZN" +
          "JHAVezzcKIYglE14283b2Q==",
      );
      expect(crypto.hash("shake128", "abc", { outputLength: 0 })).toBe("");
      expect(hash("shake128", "abc", { outputLength: -0 })).toBe("");
      const empty = crypto.hash("shake128", "abc", { outputLength: 0, outputEncoding: "buffer" });
      expect(Buffer.isBuffer(empty)).toBe(true);
      expect(empty).toEqual(Buffer.alloc(0));

      const encodings = ["hex", "base64", "base64url", "latin1", "binary", "ascii", "utf8", "ucs2", "utf16le"] as const;
      for (const algorithm of ["shake128", "shake256"]) {
        for (const outputLength of [1, 16, 32, 63, 64, 65, 168, 1000, 100_000]) {
          const expected = crypto.createHash(algorithm, { outputLength }).update(input).digest();
          const label = `${algorithm} ${outputLength}`;
          const buffer = crypto.hash(algorithm, input, { outputLength, outputEncoding: "buffer" });
          expect(Buffer.isBuffer(buffer), label).toBe(true);
          expect(buffer, label).toEqual(expected);
          expect(crypto.hash(algorithm, input, { outputLength }), label).toBe(expected.toString("hex"));
          if (outputLength > 1000) continue;
          for (const outputEncoding of encodings) {
            expect(
              crypto.hash(algorithm, input.toString(), { outputLength, outputEncoding }),
              `${label} ${outputEncoding}`,
            ).toBe(expected.toString(outputEncoding));
          }
        }
      }
    });

    test("outputLength of a digest that has one length", () => {
      expect(crypto.hash("sha256", "abc", { outputLength: 32 })).toBe(hex);
      expect(crypto.hash("sha3-256", "abc", { outputLength: 32, outputEncoding: "base64" })).toBe(
        "Ophdp0/iJbIEXBcta9OQvYVfCG4+nVJbRr/iRRFDFTI=",
      );
      expect(crypto.hash("blake2s256", "abc", { outputLength: 32 })).toBe(
        "508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982",
      );

      // node holds the length in an `int`, and prints "-1" for the last of these.
      for (const [algorithm, outputLength] of [
        ["sha256", 8],
        ["SHA256", 31],
        ["sha512", 0],
        ["sha3-256", 16],
        ["blake2s256", 16],
        ["md5", 2 ** 32 - 1],
      ] as const) {
        expect(thrownBy(() => crypto.hash(algorithm, input, { outputLength }))).toEqual({
          name: "Error",
          code: undefined,
          message: `Output length ${outputLength} is invalid for ${algorithm}, which does not support XOF`,
        });
      }
    });

    // With the limit of a string at 2 ** 20 characters, no row makes a digest of more than 1 MiB. node throws the same
    // ERR_STRING_TOO_LONG at its own limit of 0x1fffffe8 characters, after it has made the digest. From 2 ** 31 bytes on
    // it throws ERR_OSSL_CRYPTO_MALLOC_FAILURE, because it holds the length in an `int`.
    test("a string that would be too long is refused", () => {
      // For each encoding, the longest digest that the check lets through. For utf8 it counts one character per byte.
      const longest = {
        hex: 2 ** 19,
        base64: 786_432,
        base64url: 786_432,
        latin1: 2 ** 20,
        ascii: 2 ** 20,
        utf8: 2 ** 20,
        ucs2: 2 ** 21 + 1,
        utf16le: 2 ** 21 + 1,
      };
      const originalLimit = setSyntheticAllocationLimitForTesting(2 ** 20);
      try {
        for (const [outputEncoding, outputLength] of Object.entries(longest)) {
          expect(
            thrownBy(() => hash("shake128", "abc", { outputLength: outputLength + 1, outputEncoding })).code,
            outputEncoding,
          ).toBe("ERR_STRING_TOO_LONG");
        }
        expect(hash("shake128", "abc", { outputLength: longest.hex })).toHaveLength(2 ** 20);
        expect(hash("shake128", "abc", { outputLength: longest.base64, outputEncoding: "base64" })).toHaveLength(
          2 ** 20,
        );
      } finally {
        setSyntheticAllocationLimitForTesting(originalLimit);
      }
    });

    // ASAN refuses an allocation above its cap, as in test/js/node/buffer-oom.test.ts. So a digest that fits a
    // string fails where it is allocated, and the next longer one shows that it is refused before that.
    test.skipIf(!isASAN)("the length of a string is checked before the digest is allocated", async () => {
      const failed = "RangeError ERR_MEMORY_ALLOCATION_FAILED";
      const tooLong = "Error ERR_STRING_TOO_LONG";
      const rows = [
        ["buffer", 64 << 20, failed],
        ["hex", 64 << 20, failed],
        ["hex", 2 ** 30 - 1, failed],
        ["hex", 2 ** 30, tooLong],
        ["base64", 1_610_612_733, failed],
        ["base64", 1_610_612_734, tooLong],
        ["base64url", 1_610_612_735, failed],
        ["base64url", 1_610_612_736, tooLong],
        ["latin1", 2 ** 31 - 1, failed],
        ["latin1", 2 ** 31, tooLong],
        ["ascii", 2 ** 31 - 1, failed],
        ["ascii", 2 ** 31, tooLong],
        ["utf8", 2 ** 31 - 1, failed],
        ["utf8", 2 ** 31, tooLong],
        ["ucs2", 2 ** 32 - 1, failed],
        ["utf16le", 2 ** 32 - 1, failed],
        ["buffer", 2 ** 32 - 1, failed],
      ];
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
          const crypto = require("node:crypto");
          const rows = ${JSON.stringify(rows.map(([outputEncoding, outputLength]) => [outputEncoding, outputLength]))};
          for (const row of rows) {
            const [outputEncoding, outputLength] = row;
            try {
              row.push(crypto.hash("shake128", "abc", { outputLength, outputEncoding }).length);
            } catch (error) {
              row.push(error.name + " " + error.code);
            }
          }
          console.log(JSON.stringify({ rows, afterwards: crypto.hash("shake128", "abc", { outputLength: 8 }) }));
          `,
        ],
        env: {
          ...bunEnv,
          ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "allocator_may_return_null=1", "max_allocation_size_mb=32"]
            .filter(Boolean)
            .join(":"),
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // stderr is not compared: ASAN prints a warning for each allocation that it refuses.
      expect(JSON.parse(stdout.trim() || JSON.stringify({ stderr }))).toEqual({
        rows,
        afterwards: "5881092dd818bf5c",
      });
      expect(exitCode).toBe(0);
    });

    test("what is not an object is refused", () => {
      const received = new Map<unknown, string>([
        [null, "null"],
        [1, "type number (1)"],
        [true, "type boolean (true)"],
        [Symbol("s"), "type symbol (Symbol(s))"],
        [10n, "type bigint (10n)"],
        [[], "an instance of Array"],
        [() => {}, "function "],
        [function named() {}, "function named"],
        [class {}, "function "],
      ]);
      for (const [options, description] of received) {
        expect(thrownBy(() => hash("sha256", "abc", options))).toEqual({
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
          message: `The "options" argument must be of type object. Received ${description}`,
        });
      }
    });

    // node reads both as an object without options, and returns the digest in hex.
    test("a buffer and a String object mean what they do without this form", () => {
      const into = new Uint8Array(40).fill(0xa5);
      expect<unknown>(hash("sha256", "abc", into)).toBe(into);
      expect(Buffer.from(into).toString("hex")).toBe(hex + "a5a5a5a5a5a5a5a5");
      expect(hash("sha256", "abc", new String("base64"))).toBe("ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=");
    });

    test("the members are validated under their own names", () => {
      const errors = new Map<object, ReturnType<typeof thrownBy>>([
        [
          { outputEncoding: 1 },
          {
            name: "TypeError",
            code: "ERR_INVALID_ARG_TYPE",
            message: 'The "outputEncoding" argument must be of type string. Received type number (1)',
          },
        ],
        [
          { outputEncoding: new String("hex") },
          {
            name: "TypeError",
            code: "ERR_INVALID_ARG_TYPE",
            message: 'The "outputEncoding" argument must be of type string. Received an instance of String',
          },
        ],
        [
          { outputEncoding: "x" },
          {
            name: "TypeError",
            code: "ERR_INVALID_ARG_VALUE",
            message: "The argument 'outputEncoding' is invalid. Received 'x'",
          },
        ],
        [
          { outputEncoding: "it's" },
          {
            name: "TypeError",
            code: "ERR_INVALID_ARG_VALUE",
            message: `The argument 'outputEncoding' is invalid. Received "it's"`,
          },
        ],
        [
          { outputEncoding: "hex\n" },
          {
            name: "TypeError",
            code: "ERR_INVALID_ARG_VALUE",
            message: "The argument 'outputEncoding' is invalid. Received 'hex\\n'",
          },
        ],
        [
          { outputLength: "8" },
          {
            name: "TypeError",
            code: "ERR_INVALID_ARG_TYPE",
            message: `The "outputLength" argument must be of type number. Received type string ('8')`,
          },
        ],
        [
          { outputLength: null },
          {
            name: "TypeError",
            code: "ERR_INVALID_ARG_TYPE",
            message: 'The "outputLength" argument must be of type number. Received null',
          },
        ],
        [
          { outputLength: 1.5 },
          {
            name: "RangeError",
            code: "ERR_OUT_OF_RANGE",
            message: 'The value of "outputLength" is out of range. It must be an integer. Received 1.5',
          },
        ],
        [
          { outputLength: NaN },
          {
            name: "RangeError",
            code: "ERR_OUT_OF_RANGE",
            message: 'The value of "outputLength" is out of range. It must be an integer. Received NaN',
          },
        ],
        [
          { outputLength: -1 },
          {
            name: "RangeError",
            code: "ERR_OUT_OF_RANGE",
            message: 'The value of "outputLength" is out of range. It must be >= 0 && <= 4294967295. Received -1',
          },
        ],
        [
          { outputLength: 2 ** 32 },
          {
            name: "RangeError",
            code: "ERR_OUT_OF_RANGE",
            message:
              'The value of "outputLength" is out of range. It must be >= 0 && <= 4294967295. Received 4294967296',
          },
        ],
      ]);
      for (const [options, error] of errors) {
        for (const algorithm of ["sha256", "shake128"]) {
          expect(thrownBy(() => hash(algorithm, "abc", options))).toEqual(error);
        }
      }
      // A wrong type of `outputEncoding` is reported before a wrong `outputLength`.
      expect(thrownBy(() => hash("sha256", "abc", { outputEncoding: 1, outputLength: -1 })).code).toBe(
        "ERR_INVALID_ARG_TYPE",
      );
      // node reports an unknown `outputEncoding` before a wrong `outputLength`: ERR_INVALID_ARG_VALUE.
      expect(thrownBy(() => hash("sha256", "abc", { outputEncoding: "x", outputLength: -1 })).code).toBe(
        "ERR_OUT_OF_RANGE",
      );
    });

    // The options of cSHAKE, which neither Bun nor the OpenSSL of node v26.12.1 has.
    test("functionName and customization are refused", () => {
      const unsupported = { name: "Error", code: undefined, message: "Digest options are not supported" };
      for (const member of ["functionName", "customization"]) {
        for (const value of ["x", "", Buffer.from("x"), new Uint8Array(0)]) {
          for (const algorithm of ["sha256", "shake256"]) {
            expect(thrownBy(() => hash(algorithm, "abc", { [member]: value }))).toEqual(unsupported);
            expect(thrownBy(() => hash(algorithm, "abc", { [member]: value, outputLength: 32 }))).toEqual(unsupported);
          }
        }
        expect(hash("sha256", "abc", { [member]: undefined })).toBe(hex);
        expect(hash("shake128", "abc", { [member]: undefined, outputLength: 8 })).toBe("5881092dd818bf5c");

        // What node reports before it is reported before it here too.
        expect(thrownBy(() => hash("sha256", "abc", { [member]: "x", outputEncoding: "x" })).code).toBe(
          "ERR_INVALID_ARG_VALUE",
        );
        expect(thrownBy(() => hash("sha256", "abc", { [member]: "x", outputLength: -1 })).code).toBe(
          "ERR_OUT_OF_RANGE",
        );
        expect(thrownBy(() => hash("sha256", "abc", { [member]: "x", outputLength: 8 })).message).toBe(
          "Output length 8 is invalid for sha256, which does not support XOF",
        );
        expect(thrownBy(() => hash("no-such-digest", "abc", { [member]: "x" }))).toEqual(
          thrownBy(() => hash("no-such-digest", "abc")),
        );

        // node checks the type first of all, and throws ERR_INVALID_ARG_TYPE for these.
        for (const value of [null, 1, {}]) {
          expect(thrownBy(() => hash("sha256", "abc", { [member]: value }))).toEqual(unsupported);
        }
      }
    });

    test("the arguments before it are validated first, and as without it", () => {
      const badOptions = { outputLength: -1 };
      expect(thrownBy(() => hash(1, "abc", badOptions))).toEqual(thrownBy(() => hash(1, "abc")));
      expect(thrownBy(() => hash("sha256", 1, badOptions))).toEqual(thrownBy(() => hash("sha256", 1)));
      for (const options of [{}, { outputEncoding: "base64" }, { outputLength: 8 }]) {
        expect(thrownBy(() => hash("no-such-digest", "abc", options))).toEqual(
          thrownBy(() => hash("no-such-digest", "abc", "hex")),
        );
      }
    });

    test("the data is read after the getters of the options have run", () => {
      const empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

      const resized = new ArrayBuffer(64, { maxByteLength: 64 });
      expect(
        hash("sha256", new Uint8Array(resized).fill(0x61), {
          get outputLength() {
            resized.resize(0);
            return undefined;
          },
        }),
      ).toBe(empty);

      const transferred = new Uint8Array(64).fill(0x61);
      expect(
        hash("shake128", transferred, {
          get outputLength() {
            transferred.buffer.transfer();
            return 32;
          },
        }),
      ).toBe(crypto.createHash("shake128", { outputLength: 32 }).digest("hex"));

      const written = new Uint8Array(3).fill(0x61);
      expect(
        hash("sha256", written, {
          get outputEncoding() {
            written.set([0x61, 0x62, 0x63]);
            return "hex";
          },
        }),
      ).toBe(hex);

      const boom = new RangeError("boom");
      expect(() =>
        hash("sha256", "abc", {
          get outputLength() {
            throw boom;
          },
        }),
      ).toThrow(boom);
    });

    test("length", () => {
      expect(crypto.hash.length).toBe(3);
    });
  });
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

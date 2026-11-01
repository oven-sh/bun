import { CryptoHasher, MD4, MD5, SHA1, SHA224, SHA256, SHA384, SHA512, SHA512_256, gc } from "bun";
import { describe, expect, it } from "bun:test";
import crypto from "crypto";
import { bunEnv, bunExe, isWindows, tmpdirSync } from "harness";
import assert from "node:assert";
import path from "path";
import { hashesFixture } from "./fixtures/sign.fixture.ts";
const HashClasses = [MD5, MD4, SHA1, SHA224, SHA256, SHA384, SHA512, SHA512_256];

describe("CryptoHasher", () => {
  it("CryptoHasher.algorithms", () => {
    expect(CryptoHasher.algorithms).toEqual([
      "blake2b256",
      "blake2b512",
      "blake2s256",
      "md4",
      "md5",
      "ripemd160",
      "sha1",
      "sha224",
      "sha256",
      "sha384",
      "sha512",
      "sha512-224",
      "sha512-256",
      "sha3-224",
      "sha3-256",
      "sha3-384",
      "sha3-512",
      "shake128",
      "shake256",
    ]);
  });

  // prettier-ignore
  const expected = {
    blake2b256: "256c83b297114d201b30179f3f0ef0cace9783622da5974326b436178aeef610",
    blake2b512: "021ced8799296ceca557832ab941a50b4a11f83478cf141f51f933f653ab9fbcc05a037cddbed06e309bf334942c4e58cdf1a46e237911ccd7fcf9787cbc7fd0",
    blake2s256: "9aec6806794561107e594b1f6a8a6b0c92a0cba9acf5e5e93cca06f781813b0b",
    md4: "aa010fbc1d14c795d86ef98c95479d17",
    md5: "5eb63bbbe01eeed093cb22bb8f5acdc3",
    ripemd160: "98c615784ccb5fe5936fbc0cbe9dfdb408d92f0f",
    sha1: "2aae6c35c94fcfb415dbe95f408b9ce91ee846ed",
    sha224: "2f05477fc24bb4faefd86517156dafdecec45b8ad3cf2522a563582b",
    sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    sha384: "fdbd8e75a67f29f701a4e040385e2e23986303ea10239211af907fcbb83578b3e417cb71ce646efd0819dd8c088de1bd",
    sha512: "309ecc489c12d6eb4cc40f50c902f2b4d0ed77ee511a7c7a9bcd3ca86d4cd86f989dd35bc5ff499670da34255b45b0cfd830e81f605dcf7dc5542e93ae9cd76f",
    "sha512-224": "22e0d52336f64a998085078b05a6e37b26f8120f43bf4db4c43a64ee",
    "sha512-256": "0ac561fac838104e3f2e4ad107b4bee3e938bf15f2b15f009ccccd61a913f017",
    "sha3-224": "dfb7f18c77e928bb56faeb2da27291bd790bc1045cde45f3210bb6c5",
    "sha3-256": "644bcc7e564373040999aac89e7622f3ca71fba1d972fd94a31c3bfbf24e3938",
    "sha3-384": "83bff28dde1b1bf5810071c6643c08e5b05bdb836effd70b403ea8ea0a634dc4997eb1053aa3593f590f9c63630dd90b",
    "sha3-512": "840006653e9ac9e95117a15c915caab81662918e925de9e004f774ff82d7079a40d4d27b1b372657c61d46d470304c88c788b3a4527ad074d1dccbee5dbaa99a",
    shake128: "3a9159f071e4dd1c8c4f968607c30942",
    shake256: "369771bb2cb9d2b04c1d54cca487e372d9f187f73f7ba3f65b95c8ee7798c527",
  } as const;

  const expectedBitLength = {
    blake2b256: 256,
    blake2b512: 512,
    blake2s256: 256,
    md4: 128,
    md5: 128,
    ripemd160: 160,
    sha1: 160,
    sha224: 224,
    sha256: 256,
    sha384: 384,
    sha512: 512,
    "sha512-224": 224,
    "sha512-256": 256,
    "sha3-224": 224,
    "sha3-256": 256,
    "sha3-384": 384,
    "sha3-512": 512,
    shake128: 128,
    shake256: 256,
  } as const;

  for (const algorithm of CryptoHasher.algorithms) {
    it(`new CryptoHasher ${algorithm}`, () => {
      var hasher = new CryptoHasher(algorithm);
      expect(hasher.algorithm).toEqual(algorithm);
      expect(hasher.byteLength).toEqual(expectedBitLength[algorithm] / 8);
      hasher.update("hello world");
      expect(hasher.digest("hex")).toEqual(expected[algorithm]);
    });

    it(`CryptoHasher.hash ${algorithm}`, () => {
      expect(CryptoHasher.hash(algorithm, "hello world").toString("hex")).toEqual(expected[algorithm]);
    });

    it(`new CryptoHasher ${algorithm} multi-part`, () => {
      var hasher = new CryptoHasher(algorithm);
      hasher.update("hello ");
      hasher.update("world");
      expect(hasher.digest("hex")).toBe(expected[algorithm]);
      expect(hasher.algorithm).toBe(algorithm);
    });

    it(`new CryptoHasher ${algorithm} to Buffer`, () => {
      var hasher = new CryptoHasher(algorithm);
      expect(hasher.algorithm).toEqual(algorithm);
      hasher.update("hello world");
      expect(hasher.digest()).toEqual(Buffer.from(expected[algorithm], "hex"));
    });
  }

  it("CryptoHasher resets when digest is called", () => {
    var hasher = new CryptoHasher("sha256");
    hasher.update("hello");
    expect(hasher.digest("hex")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    hasher.update("world");
    expect(hasher.digest("hex")).toBe("486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7");
  });

  for (let alg of CryptoHasher.algorithms) {
    it(`CryptoHasher ${alg} copy is the same`, () => {
      const orig = new CryptoHasher(alg);
      orig.update("hello");
      const copy = orig.copy();

      expect(copy.digest("hex")).toBe(orig.digest("hex"));
      expect(copy.algorithm).toBe(orig.algorithm);
    });

    it(`CryptoHasher ${alg} copy is not linked`, () => {
      const orig = new CryptoHasher(alg);
      orig.update("hello");
      const copy = orig.copy();

      orig.update("world");
      expect(copy.digest("hex")).not.toBe(orig.digest("hex"));
    });

    it(`CryptoHasher ${alg} copy can be used after digest()`, () => {
      const orig = new CryptoHasher(alg);
      orig.update("hello");
      orig.digest("hex");
      const copy = orig.copy();

      expect(() => copy.digest("hex")).not.toThrow();
    });

    it(`CryptoHasher ${alg} copy updates the same`, () => {
      const orig = new CryptoHasher(alg);
      orig.update("hello");
      const copy = orig.copy();

      orig.update("world");
      copy.update("world");
      expect(copy.digest("hex")).toBe(orig.digest("hex"));
    });
  }
});

describe("createHash outputLength", () => {
  it("shake128 digest matches Node.js for small and zero outputLength", () => {
    expect(crypto.createHash("shake128", { outputLength: 8 }).update("abc").digest("hex")).toBe("5881092dd818bf5c");
    expect(crypto.createHash("shake128", { outputLength: 32 }).update("abc").digest("hex")).toBe(
      "5881092dd818bf5cf8a3ddb793fbcba74097d5c526a6d35f97b83351940f2cc8",
    );
    expect(crypto.createHash("shake128", { outputLength: 0 }).update("abc").digest("hex")).toBe("");
    expect(crypto.createHash("shake128", { outputLength: 0 }).update("abc").digest()).toEqual(Buffer.alloc(0));
    expect(
      crypto.createHash("shake128", { outputLength: 8 }).update("abc").copy({ outputLength: 4 }).digest("hex"),
    ).toBe("5881092d");
  });

  it.skipIf(isWindows)("shake128 outputLength >= 2**31 does not abort the process", async () => {
    // options.outputLength is validated against the full uint32 range, so 2**31
    // must either produce a digest or throw a catchable error, never terminate
    // the process.
    const messages: string[] = [];
    const entering = Promise.withResolvers<void>();
    const done = Promise.withResolvers<void>();
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const crypto = require("node:crypto");
         const known = "5881092dd818bf5cf8a3ddb793fbcba7";
         const h = crypto.createHash("shake128", { outputLength: 2 ** 31 }).update("abc");
         process.send("entering");
         try {
           const d = h.digest();
           if (d.length !== 2 ** 31) throw new Error("wrong length " + d.length);
           if (d.subarray(0, 16).toString("hex") !== known) throw new Error("wrong prefix");
           process.send("ok");
         } catch (e) {
           process.send("caught:" + (e.code || e.name));
         }`,
      ],
      env: bunEnv,
      stdout: "ignore",
      stderr: "ignore",
      ipc(message) {
        messages.push(String(message));
        if (message === "entering") entering.resolve();
        else done.resolve();
      },
      serialization: "json",
    });

    // The abort is a synchronous capacity check that fires instantly; past it
    // the child squeezes 2 GiB of output, which is too slow in debug to await.
    // Give it a short window after reaching the call site, then stop it.
    await Promise.race([entering.promise, proc.exited]);
    await Promise.race([done.promise, proc.exited, Bun.sleep(2000)]);
    proc.kill("SIGKILL");

    const exitCode = await proc.exited;

    expect(messages[0]).toBe("entering");
    expect(proc.signalCode).not.toBe("SIGABRT");
    if (proc.signalCode === null) {
      expect(messages[1]).toMatch(/^(ok|caught:\S+)$/);
      expect(exitCode).toBe(0);
    } else {
      expect(proc.signalCode).toBe("SIGKILL");
    }
  });
});

// The cSHAKE options of Node v26.9.0 (nodejs/node#65484). Node checks them and then fails the construction for
// every digest unless its OpenSSL is 4.0 or later, and BoringSSL has no cSHAKE either. The block uses node:assert
// so that it also runs on Node: every expected value is what the node v26.12.1 binary gives.
// https://github.com/nodejs/node/blob/v26.12.1/lib/internal/crypto/hash.js#L94-L147
describe("createHash functionName and customization", () => {
  const keys = ["functionName", "customization"] as const;
  const unsupported = (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.deepStrictEqual(
      { name: error.name, message: error.message, hasCode: "code" in error },
      { name: "Error", message: "Digest method not supported", hasCode: false },
    );
    return true;
  };
  const invalidType = (key: string, received: string) => ({
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message: `The "options.${key}" property must be of type string or an instance of ArrayBuffer, Buffer, TypedArray, or DataView. Received ${received}`,
  });
  const nulBytes = (key: string, received: string) => ({
    name: "TypeError",
    code: "ERR_INVALID_ARG_VALUE",
    message: `The property 'options.${key}' must not contain NUL bytes. Received ${received}`,
  });
  const outOfRange = {
    name: "RangeError",
    code: "ERR_OUT_OF_RANGE",
    message: 'The value of "options.outputLength" is out of range. It must be >= 0 && <= 4294967295. Received -1',
  };
  const logged = (target: object, log: string[]) =>
    new Proxy(target, {
      get(object, key, receiver) {
        if (typeof key === "string") log.push(key);
        return Reflect.get(object, key, receiver);
      },
    });
  const sha256OfA = "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb";

  for (const key of keys) {
    it(`refuses a defined ${key} for every digest`, () => {
      const values = ["x", "", Buffer.from("x"), new Uint8Array(0), new ArrayBuffer(0), new Uint16Array([0x0101])];
      for (const algorithm of ["shake128", "shake256", "sha256", "sha3-256", "md5", "blake2b512", "ripemd160"]) {
        for (const value of values) {
          assert.throws(() => crypto.createHash(algorithm, { [key]: value }), unsupported);
          assert.throws(() => crypto.createHash(algorithm, { outputLength: 16, [key]: value }), unsupported);
        }
      }
      assert.throws(() => crypto.createHash("nope", { [key]: "x" }), unsupported);
      assert.throws(() => crypto.createHash("", { [key]: "x" }), unsupported);
      // An inherited key and a function as the options count too.
      assert.throws(() => crypto.createHash("sha256", Object.create({ [key]: "x" })), unsupported);
      assert.throws(
        () =>
          crypto.createHash(
            "sha256",
            Object.assign(() => {}, { [key]: "x" }),
          ),
        unsupported,
      );
    });

    it(`ignores an undefined ${key}`, () => {
      const expected = crypto.createHash("shake128", { outputLength: 16 }).update("a").digest("hex");
      assert.strictEqual(expected, "85c8de88d28866bf0868090b3961162b");
      assert.strictEqual(
        crypto
          .createHash("shake128", { outputLength: 16, [key]: undefined })
          .update("a")
          .digest("hex"),
        expected,
      );
      assert.strictEqual(crypto.createHash("sha256", null).update("a").digest("hex"), sha256OfA);
    });

    it(`checks ${key} before it looks the digest up`, () => {
      const invalid: [unknown, string][] = [
        [null, "null"],
        [5, "type number (5)"],
        [false, "type boolean (false)"],
        [{}, "an instance of Object"],
        [[1], "an instance of Array"],
      ];
      for (const algorithm of ["shake128", "sha256", "nope"]) {
        for (const [value, received] of invalid) {
          assert.throws(() => crypto.createHash(algorithm, { [key]: value }), invalidType(key, received));
        }
        assert.throws(() => crypto.createHash(algorithm, { [key]: "a\0b" }), nulBytes(key, "<Buffer 61 00 62>"));
        assert.throws(() => crypto.createHash(algorithm, { [key]: Buffer.from([0]) }), nulBytes(key, "<Buffer 00>"));
        // The bytes are checked, not the elements.
        assert.throws(
          () => crypto.createHash(algorithm, { [key]: new Uint16Array([1]) }),
          nulBytes(key, "Uint16Array(1) [ 1 ]"),
        );
      }
    });

    it(`Hash.prototype.copy() and createHmac() ignore ${key}`, () => {
      for (const value of ["x", null, 5, "a\0b"]) {
        assert.strictEqual(
          crypto
            .createHash("sha256")
            .update("a")
            .copy({ [key]: value })
            .digest("hex"),
          sha256OfA,
        );
        assert.strictEqual(
          crypto
            .createHmac("sha256", "k", { [key]: value })
            .update("a")
            .digest("hex"),
          crypto.createHmac("sha256", "k").update("a").digest("hex"),
        );
      }
    });

    it(`every way to construct a Hash refuses ${key}`, () => {
      const options = { [key]: "x" };
      class Subclass extends crypto.Hash {}
      assert.throws(() => new crypto.Hash("sha256", options), unsupported);
      // @ts-expect-error crypto.Hash is callable without new (DEP0179)
      assert.throws(() => crypto.Hash("sha256", options), unsupported);
      assert.throws(() => new Subclass("sha256", options), unsupported);
      assert.throws(() => Reflect.construct(crypto.Hash, ["sha256", options]), unsupported);
    });
  }

  it("checks outputLength, then functionName, then customization, then looks the digest up", () => {
    for (const algorithm of ["sha256", "nope"]) {
      assert.throws(() => crypto.createHash(algorithm, { outputLength: -1, functionName: null }), outOfRange);
      assert.throws(() => crypto.createHash(algorithm, { outputLength: -1, customization: "x" }), outOfRange);
      assert.throws(
        () => crypto.createHash(algorithm, { functionName: null, customization: 5 }),
        invalidType("functionName", "null"),
      );
      assert.throws(
        () => crypto.createHash(algorithm, { functionName: "a\0", customization: null }),
        nulBytes("functionName", "<Buffer 61 00>"),
      );
      assert.throws(
        () => crypto.createHash(algorithm, { functionName: "x", customization: "a\0" }),
        nulBytes("customization", "<Buffer 61 00>"),
      );
    }
    assert.throws(() => crypto.createHash("nope", { outputLength: -1 }), outOfRange);
    assert.throws(() => crypto.createHash("nope", {}), unsupported);
    assert.throws(() => crypto.createHash(5 as any, { customization: null }), {
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: 'The "algorithm" argument must be of type string. Received type number (5)',
    });
    // The refusal comes before the digest is asked for an output length that it cannot give.
    assert.throws(() => crypto.createHash("sha256", { outputLength: 5, customization: "x" }), unsupported);
    assert.throws(() => crypto.createHash("shake128", { outputLength: 0, customization: "x" }), unsupported);
  });

  it("reads each option once, in Node's order, and stops at the first one that fails", () => {
    const cases: [string, object, string[]][] = [
      ["sha256", {}, ["outputLength", "functionName", "customization"]],
      ["nope", {}, ["outputLength", "functionName", "customization"]],
      ["sha256", { customization: "x" }, ["outputLength", "functionName", "customization"]],
      ["sha256", { functionName: null, customization: null }, ["outputLength", "functionName"]],
      ["nope", { outputLength: -1, functionName: null }, ["outputLength"]],
      // typeof options is "function": Node does not read outputLength from it.
      ["sha256", () => {}, ["functionName", "customization"]],
    ];
    for (const [algorithm, options, expected] of cases) {
      const log: string[] = [];
      try {
        crypto.createHash(algorithm, logged(options, log));
      } catch {}
      assert.deepStrictEqual(log, expected);
    }

    const copyLog: string[] = [];
    crypto
      .createHash("sha256")
      .update("a")
      .copy(logged({ functionName: 5, customization: null }, copyLog));
    assert.deepStrictEqual(copyLog, ["outputLength"]);

    const copyOfFunctionLog: string[] = [];
    crypto
      .createHash("sha256")
      .update("a")
      .copy(logged(() => {}, copyOfFunctionLog) as any);
    assert.deepStrictEqual(copyOfFunctionLog, []);

    const hmacLog: string[] = [];
    crypto.createHmac("sha256", "k", logged({ functionName: 5, customization: null }, hmacLog));
    assert.deepStrictEqual(hmacLog, ["encoding"]);
  });

  it("a throwing getter propagates before the digest is looked up", () => {
    const boom = new RangeError("boom");
    for (const key of keys) {
      const options = Object.defineProperty({}, key, {
        get() {
          throw boom;
        },
      });
      assert.throws(
        () => crypto.createHash("nope", options),
        error => error === boom,
      );
      assert.throws(() => crypto.createHash("nope", Object.assign(options, { outputLength: -1 })), outOfRange);
    }
  });

  it("reads the options of a primitive through its prototype, but not of undefined or null", () => {
    try {
      // @ts-expect-error
      String.prototype.customization = "x";
      // @ts-expect-error
      Number.prototype.functionName = null;
      assert.throws(() => crypto.createHash("sha256", "hex" as any), unsupported);
      assert.throws(() => crypto.createHash("sha256", 5 as any), invalidType("functionName", "null"));
      assert.strictEqual(crypto.createHash("sha256", undefined).update("a").digest("hex"), sha256OfA);
      assert.strictEqual(
        crypto
          .createHash("sha256", null as any)
          .update("a")
          .digest("hex"),
        sha256OfA,
      );
    } finally {
      // @ts-expect-error
      delete String.prototype.customization;
      // @ts-expect-error
      delete Number.prototype.functionName;
    }
  });

  it("does not read outputLength from an options value that is a function", () => {
    const options = Object.assign(() => {}, { outputLength: -1 });
    assert.strictEqual(crypto.createHash("sha256", options).update("a").digest("hex"), sha256OfA);
    assert.strictEqual(crypto.createHash("sha256").update("a").copy(options).digest("hex"), sha256OfA);
  });

  it("keeps the order of copy() and of the outputLength checks", () => {
    const finalized = crypto.createHash("sha256");
    finalized.digest();
    assert.throws(() => finalized.copy({ outputLength: -1 }), { name: "Error", code: "ERR_CRYPTO_HASH_FINALIZED" });
    assert.throws(() => crypto.createHash("shake128").copy({ outputLength: -1 }), outOfRange);
    assert.strictEqual(
      crypto.createHash("shake128", { outputLength: 8 }).update("abc").copy({ outputLength: 4 }).digest("hex"),
      "5881092d",
    );
    assert.throws(() => crypto.createHash("sha256", { outputLength: 5 }), {
      name: "Error",
      code: "ERR_OSSL_EVP_NOT_XOF_OR_INVALID_LENGTH",
    });
  });

  it("a refused construction leaves nothing behind", () => {
    assert.throws(() => crypto.createHash("shake128", { customization: "x" }), unsupported);
    assert.strictEqual(
      crypto.createHash("shake128", { outputLength: 16 }).update("a").digest("hex"),
      "85c8de88d28866bf0868090b3961162b",
    );
    assert.throws(() => crypto.createHash("nope"), unsupported);
  });
});

describe("crypto.getCurves", () => {
  it("should return an array of strings", () => {
    expect(Array.isArray(crypto.getCurves())).toBe(true);
    expect(typeof crypto.getCurves()[0]).toBe("string");
  });
});

describe("crypto", () => {
  for (let Hash of HashClasses) {
    for (let [input, label] of [
      ["hello world", '"hello world"'],
      ["hello world".repeat(20).slice(), '"hello world" x 20'],
      ["", "empty string"],
      ["a", '"a"'],
    ]) {
      describe(label, () => {
        gc(true);

        it(`${Hash.name} base64`, () => {
          gc(true);
          const result = new Hash();
          result.update(input);
          expect(typeof result.digest("base64")).toBe("string");
          gc(true);
        });

        it(`${Hash.name} hash base64`, () => {
          Hash.hash(input, "base64");
          gc(true);
        });

        it(`${Hash.name} hex`, () => {
          const result = new Hash();
          result.update(input);
          expect(typeof result.digest("hex")).toBe("string");
          gc(true);
        });

        it(`${Hash.name} hash hex`, () => {
          expect(typeof Hash.hash(input, "hex")).toBe("string");
          gc(true);
        });

        it(`${Hash.name} buffer`, () => {
          var buf = new Uint8Array(256);
          const result = new Hash();

          result.update(input);
          expect(result.digest(buf)).toBe(buf);
          expect(buf[0] != 0).toBe(true);
          gc(true);
        });

        it(`${Hash.name} buffer`, () => {
          var buf = new Uint8Array(256);

          expect(Hash.hash(input, buf) instanceof Uint8Array).toBe(true);
          gc(true);
        });

        it(`${Hash.name} hash matches the streaming digest and node:crypto`, () => {
          const nodeName = Hash.name.toLowerCase().replace("_", "-");
          const expected = crypto.createHash(nodeName).update(input).digest();

          expect(Hash.hash(input, "hex")).toBe(expected.toString("hex"));
          expect(Hash.hash(input, "base64")).toBe(new Hash().update(input).digest("base64"));

          const buf = new Uint8Array(256).fill(0xa5);
          expect(Hash.hash(input, buf)).toBe(buf);
          expect(Buffer.from(buf.subarray(0, expected.byteLength))).toEqual(expected);
          expect(buf.subarray(expected.byteLength).every(byte => byte === 0xa5)).toBe(true);
        });
      });
    }
  }
});

describe("crypto.createSign()/.verifySign()", () => {
  it.each(hashesFixture)(
    "should create and verify digital signature for %s",
    async (alg, privKey, pubKey, expectedSign) => {
      const p = await Bun.file(`${__dirname}/${privKey}`).text();
      const sign = crypto.createSign(alg).update("text").sign(p, "base64");

      expect(sign).toEqual(expectedSign);

      const verify = crypto
        .createVerify(alg)
        .update("text")
        .verify(await Bun.file(`${__dirname}/${pubKey}`).text(), sign, "base64");
      expect(verify).toBeTrue();
    },
  );
});

it("should send cipher events in the right order", async () => {
  const package_dir = tmpdirSync();
  const fixture_path = path.join(package_dir, "fixture.js");

  await Bun.write(
    fixture_path,
    String.raw`
    function patchEmitter(emitter, prefix) {
      var oldEmit = emitter.emit;

      emitter.emit = function () {
        console.log([prefix, arguments[0]]);
        oldEmit.apply(emitter, arguments);
      };
    }

    const crypto = require("node:crypto");

    const plaintext = "Out of the mountain of despair, a stone of hope.";

    const key = Buffer.from("3fad401bb178066f201b55368712530229d6329a5e2c05f48ff36ca65792d21d", "hex");
    const iv = Buffer.from("22371787d3e04a6589d8a1de50c81208", "hex");

    // Since Node 26, read() with no size returns one buffered chunk at a time,
    // so drain the stream instead of assuming a single read returns everything.
    function readAll(stream) {
      const chunks = [];
      for (let chunk; (chunk = stream.read()) !== null; ) chunks.push(chunk);
      return Buffer.concat(chunks);
    }

    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    patchEmitter(cipher, "cipher");
    cipher.end(plaintext);
    let ciph = readAll(cipher);
    console.log([1, ciph.toString("hex")]);

    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
    patchEmitter(decipher, "decipher");
    decipher.end(ciph);
    let dciph = readAll(decipher);
    console.log([2, dciph.toString("hex")]);
    let txt = dciph.toString("utf8");

    console.log([3, plaintext]);
    console.log([4, txt]);
    `,
  );

  const { stdout, stderr } = Bun.spawn({
    cmd: [bunExe(), "run", fixture_path],
    stdout: "pipe",
    stdin: "ignore",
    stderr: "pipe",
    env: bunEnv,
  });
  const err = await stderr.text();
  expect(err).toBeEmpty();
  const out = await stdout.text();
  // Matches Node 26 output for the same fixture (verified byte-for-byte
  // modulo quote style).
  expect(out.split("\n")).toEqual([
    `[ "cipher", "readable" ]`,
    `[ "cipher", "prefinish" ]`,
    `[ "cipher", "data" ]`,
    `[ "cipher", "data" ]`,
    `[ 1, "dfb6b7e029be3ad6b090349ed75931f28f991b52ca9a89f5bf6f82fa1c87aa2d624bd77701dcddfcceaf3add7d66ce06ced17aebca4cb35feffc4b8b9008b3c4" ]`,
    `[ "decipher", "readable" ]`,
    `[ "decipher", "prefinish" ]`,
    `[ "decipher", "data" ]`,
    `[ 2, "4f7574206f6620746865206d6f756e7461696e206f6620646573706169722c20612073746f6e65206f6620686f70652e" ]`,
    `[ 3, "Out of the mountain of despair, a stone of hope." ]`,
    `[ 4, "Out of the mountain of despair, a stone of hope." ]`,
    `[ "cipher", "finish" ]`,
    `[ "cipher", "end" ]`,
    `[ "decipher", "finish" ]`,
    `[ "decipher", "end" ]`,
    `[ "cipher", "close" ]`,
    `[ "decipher", "close" ]`,
    ``,
  ]);
});

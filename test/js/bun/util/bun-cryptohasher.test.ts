import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { createHash, createHmac } from "node:crypto";

// Every digest literal in this file was checked against python hashlib (openssl for md4).

test("Bun.file in CryptoHasher is not supported yet", () => {
  const file = Bun.file(import.meta.path);
  const fileBlob = expect.objectContaining({
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message: "File blob cannot be used here",
  });
  expect(() => Bun.SHA1.hash(file)).toThrow(fileBlob);
  expect(() => Bun.CryptoHasher.hash("sha1", file)).toThrow(fileBlob);
  expect(() => new Bun.SHA1().update(file)).toThrow(fileBlob);
  expect(() => new Bun.CryptoHasher("sha1").update(file)).toThrow(
    "Bun.file() is not supported here yet (it needs an async version)",
  );
});
test("CryptoHasher update should throw when no parameter/null/undefined is passed", () => {
  const expected = expect.objectContaining({
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message: "expected blob, string or buffer",
  });
  // @ts-expect-error
  expect(() => new Bun.CryptoHasher("sha1").update()).toThrow(expected);
  // @ts-expect-error
  expect(() => new Bun.CryptoHasher("sha1").update(undefined)).toThrow(expected);
  // @ts-expect-error
  expect(() => new Bun.CryptoHasher("sha1").update(null)).toThrow(expected);
});
test("CryptoHasher.update(str, 'hex') rejects odd-length hex like node:crypto", () => {
  // Odd-length hex strings must throw instead of silently hashing the longest valid even prefix.
  for (const s of ["abc", "SGVsbG8", "deadbee", "ff\nff", "a"]) {
    for (const alg of ["sha1", "sha3-256"] as const) {
      expect(() => new Bun.CryptoHasher(alg).update(s, "hex"), `input ${JSON.stringify(s)} alg ${alg}`).toThrow(
        expect.objectContaining({
          code: "ERR_INVALID_ARG_VALUE",
          message: `The argument 'encoding' is invalid for data of length ${s.length}. Received 'hex'`,
        }),
      );
      expect(() => new Bun.CryptoHasher(alg, "key").update(s, "hex")).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_ARG_VALUE" }),
      );
    }
  }

  // Error message echoes the encoding argument as passed.
  expect(() => new Bun.CryptoHasher("sha1").update("abc", "HEX")).toThrow(
    expect.objectContaining({
      code: "ERR_INVALID_ARG_VALUE",
      message: "The argument 'encoding' is invalid for data of length 3. Received 'HEX'",
    }),
  );

  // Even-length hex decodes and matches node:crypto (including truncation at the first invalid char).
  for (const s of ["ab", "deadbeef", "ffzz"]) {
    expect(new Bun.CryptoHasher("sha1").update(s, "hex").digest("hex")).toBe(
      createHash("sha1").update(s, "hex").digest("hex"),
    );
  }

  // Buffers are unaffected by the input encoding parameter.
  expect(new Bun.CryptoHasher("sha1").update(Buffer.from("abc"), "hex").digest("hex")).toBe(
    createHash("sha1").update(Buffer.from("abc")).digest("hex"),
  );
});
test("update(str, 'hex') decodes two-byte strings from the low byte of each code unit like node", () => {
  // U+FF41 narrows to 'A', so "f\uff41" is the byte 0xfa; U+0147 narrows to 'G' and stops decoding.
  for (const [input, bytes] of [
    ["f\uff41", [0xfa]],
    ["\uff46\uff41\u0147\u0147cd", [0xfa]],
    ["\u0131\u0132\u0133\u0134", [0x12, 0x34]],
  ] as const) {
    const expected = createHash("sha1").update(Buffer.from(bytes)).digest("hex");
    expect(new Bun.CryptoHasher("sha1").update(input, "hex").digest("hex"), JSON.stringify(input)).toBe(expected);
    expect(new Bun.CryptoHasher("sha1", "key").update(input, "hex").digest("hex"), JSON.stringify(input)).toBe(
      createHmac("sha1", "key").update(Buffer.from(bytes)).digest("hex"),
    );
    expect(createHash("sha1").update(input, "hex").digest("hex"), JSON.stringify(input)).toBe(expected);
  }
});
test("CryptoHasher throws on non-latin1 algorithm names instead of crashing", () => {
  const unsupported = (message: string) =>
    expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message });
  // @ts-expect-error
  expect(() => Bun.CryptoHasher.hash("🚀", "hello")).toThrow(unsupported('Unsupported algorithm "🚀"'));
  // @ts-expect-error
  expect(() => Bun.CryptoHasher.hash("sha3-256\u{1F680}", "hello", "hex")).toThrow(
    unsupported('Unsupported algorithm "sha3-256🚀"'),
  );
  // @ts-expect-error
  expect(() => new Bun.CryptoHasher("🚀")).toThrow(unsupported("Unsupported algorithm 🚀"));
  // @ts-expect-error
  expect(() => new Bun.CryptoHasher("ünïcode")).toThrow(unsupported("Unsupported algorithm ünïcode"));
});

test("static hash requires the algorithm to be a string primitive", () => {
  const expected = expect.objectContaining({
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message: "Expected string",
  });
  // @ts-expect-error
  expect(() => Bun.CryptoHasher.hash(new String("sha256"), "hello")).toThrow(expected);
  expect(() =>
    Bun.CryptoHasher.hash(
      // @ts-expect-error
      {
        toString() {
          return "sha256";
        },
      },
      "hello",
    ),
  ).toThrow(expected);
  // @ts-expect-error
  expect(() => Bun.CryptoHasher.hash(123, "hello")).toThrow(expected);
  // @ts-expect-error
  expect(() => Bun.CryptoHasher.hash(undefined, "hello")).toThrow(expected);
  // @ts-expect-error
  expect(() => Bun.CryptoHasher.hash(null, "hello")).toThrow(expected);
  expect(Bun.CryptoHasher.hash("sha256", "hello", "hex")).toBe(
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
});

test("hash functions read their buffers and hasher state only after every argument has been coerced", async () => {
  // A toString() hook on one argument detaches the buffer behind another argument, or digests the
  // hasher, before the hash runs. transfer(0) frees the old backing store at once, so no GC is
  // needed to expose a stale pointer. One child process runs every case, so a fault there does not
  // take down the test runner.
  const source = /* js */ `
    const caught = fn => {
      try {
        return fn();
      } catch (e) {
        return { code: e.code, message: e.message };
      }
    };
    const detachedInput = hash => {
      const buf = new Uint8Array(64 * 1024).fill(7);
      const encoding = new String("hex");
      encoding.toString = () => {
        buf.buffer.transfer(0);
        return "hex";
      };
      return { digest: hash(buf, encoding), detached: buf.byteLength === 0 };
    };
    const detachedOutput = hash => {
      const out = new Uint8Array(32);
      const input = new String("hello");
      input.toString = () => {
        out.buffer.transfer(0);
        return "hello";
      };
      return { result: caught(() => hash(input, out)), detached: out.byteLength === 0 };
    };
    const digestedDuringUpdate = {};
    for (const name of ["SHA1", "SHA224", "SHA256", "SHA384", "SHA512", "SHA512_256", "MD4", "MD5"]) {
      const hasher = new Bun[name]().update("hello");
      const input = new String("world");
      input.toString = () => {
        hasher.digest();
        return "world";
      };
      digestedDuringUpdate[name] = caught(() => hasher.update(input));
    }
    console.log(
      JSON.stringify({
        detachedInput: {
          cryptoHasher: detachedInput((buf, encoding) => Bun.CryptoHasher.hash("sha256", buf, encoding)),
          sha256: detachedInput((buf, encoding) => Bun.SHA256.hash(buf, encoding)),
          sha: detachedInput((buf, encoding) => Bun.sha(buf, encoding)),
        },
        detachedOutput: {
          cryptoHasher: detachedOutput((input, out) => Bun.CryptoHasher.hash("sha256", input, out)),
          sha256: detachedOutput((input, out) => Bun.SHA256.hash(input, out)),
          sha: detachedOutput((input, out) => Bun.sha(input, out)),
        },
        digestedDuringUpdate,
      }),
    );
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");

  // The input is read after it was detached, so the digest is the digest of zero bytes.
  const sha256Empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
  const sha512_256Empty = "c672b8d1ef56ed28ab87c3622c5114069bdd3ad7b8f9737498d0c01ecef0967a";
  // The output buffer is checked after it was detached, so it is too small.
  const tooSmall = {
    result: { code: "ERR_INVALID_ARG_TYPE", message: "TypedArray must be at least 32 bytes" },
    detached: true,
  };
  const digested = (name: string) => ({
    code: "ERR_INVALID_STATE",
    message: `${name} hasher already digested, create a new instance to update`,
  });
  expect(JSON.parse(stdout)).toEqual({
    detachedInput: {
      cryptoHasher: { digest: sha256Empty, detached: true },
      sha256: { digest: sha256Empty, detached: true },
      sha: { digest: sha512_256Empty, detached: true },
    },
    detachedOutput: { cryptoHasher: tooSmall, sha256: tooSmall, sha: tooSmall },
    digestedDuringUpdate: {
      SHA1: digested("SHA1"),
      SHA224: digested("SHA224"),
      SHA256: digested("SHA256"),
      SHA384: digested("SHA384"),
      SHA512: digested("SHA512"),
      SHA512_256: digested("SHA512_256"),
      MD4: digested("MD4"),
      MD5: digested("MD5"),
    },
  });
  expect(exitCode).toBe(0);
});

test("Bun.sha validates its arguments like Bun.SHA512_256.hash", () => {
  const hex = "53048e2681941ef99b2e29b76b4c7dabe4c2d0c634fc6d46e0e2f13107e7af23";
  expect(Bun.sha("abc", "hex")).toBe(hex);
  expect(Bun.SHA512_256.hash("abc", "hex")).toBe(hex);
  const out = new Uint8Array(32);
  expect(Bun.sha("abc", out)).toBe(out);
  expect(Buffer.from(out).toString("hex")).toBe(hex);
  expect(Bun.sha("abc")).toEqual(out);
  expect(Bun.sha("abc", undefined)).toEqual(out);

  // An output argument that is neither an encoding nor a TypedArray throws
  // instead of being ignored.
  const badOutput = expect.objectContaining({
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message: "expected string or buffer",
  });
  for (const output of [123, {}, null, true, [], () => {}, Symbol("x")]) {
    const label = `output ${typeof output}`;
    // @ts-expect-error
    expect(() => Bun.sha("abc", output), label).toThrow(badOutput);
    // @ts-expect-error
    expect(() => Bun.SHA512_256.hash("abc", output), label).toThrow(badOutput);
  }

  const badInput = expect.objectContaining({
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message: "expected blob, string or buffer",
  });
  for (const input of [undefined, 123, null, {}]) {
    const label = `input ${typeof input}`;
    // @ts-expect-error
    expect(() => Bun.sha(input), label).toThrow(badInput);
    // @ts-expect-error
    expect(() => Bun.SHA512_256.hash(input), label).toThrow(badInput);
  }
  // @ts-expect-error
  expect(() => Bun.sha()).toThrow(badInput);
});

describe("HMAC", () => {
  const hashes = {
    "sha1": "e2e1f7f597941d9b0021978618218a9e08731426",
    "sha256": "c7a7c96c73af32ea6e5b1ca6768b1d822249eb88f85160433d7b09bb2b21e170",
    "sha384": "2483522dcb7cb65fa13f0a3c1efe867abbd79ecb19a6ba4bac45d4f4bac31de2e2463b11838b8055601fad73d0b5af4c",
    "sha512":
      "f82266c950db24eba03f899466fdf905494709f09f98f4b7d7db31f1443a33b4fe5ca82f74fb360609d8a05a87fb065dd77bee912c27de89cbba7897061ac735",
    "blake2b512":
      "9e66ba10f4d7e80abc2584150fc5f9a246634118280fd9ae086794d37cb9919d681ee285b68f9cec2eda9f878d157125cc465c8b0e3c023a7040ed0be7f25023",
    "md5": "4e7eb9f9332e4eb1dc5a2d7d065ba1bf",
    "sha224": "d34c3a2647d4f82a4e6baeaa7d94379eafd931e0c16cbc44b4ba4d1e",
    "sha512-224": "af398c7f21f58e1377580227a89590d3ab8be52b31182fad9ec4d667",
    "sha512-256": "0ed15b2750a2a7281e96af006ab79e82ed54a7a2081bdb49e70a70d8c6bfeff0",
    "sha3-224": "3dd0595758af01c6a9d662326acc3bc0c7e49b94573f74f800b6c114",
    "sha3-256": "5b246f6c8b41fbd23b7aa3a73c0c93c6a35d4973bc727b24ad65f538d51ff3b6",
    "sha3-384": "f0af5d4479dc409e11c6e23014893c42a51fbd3435c93452f6154a87128174e2492a6b31994b1436ae681b3f1d838613",
    "sha3-512":
      "b15ed8373f1b493ccd417a7591745fdefbb4aa7b85c6937284de678e1a7b73b31e4da07561d358fefa30c6b1cf1a4b19a4c0d2f4f6e90ddfadc3a12367cb1a3c",
    "ripemd160": "5291464ec22d15e61190b00b81b87c1a9dcb966f",
  };
  const consumed = "HMAC has been consumed and is no longer usable";
  const throws = (fn: () => unknown) => {
    try {
      fn();
      return "no throw";
    } catch (e) {
      return (e as Error).message;
    }
  };
  const afterDigest = (hmac: Bun.CryptoHasher) => ({
    digest: throws(() => hmac.digest()),
    byteLength: throws(() => hmac.byteLength),
    copy: throws(() => hmac.copy()),
    update: throws(() => hmac.update("more")),
  });
  const allConsumed = { digest: consumed, byteLength: consumed, copy: consumed, update: consumed };

  for (let key of ["key", Buffer.from("key"), Buffer.from("key").buffer]) {
    test.each(Object.entries(hashes))("%s (key: " + key.constructor.name + ")", (algorithm, expected) => {
      const hmac = new Bun.CryptoHasher(algorithm, key);
      hmac.update("data\n");
      const copied = hmac.copy();
      expect(copied.copy()).toBeInstanceOf(Bun.CryptoHasher);

      const state = { algorithm, byteLength: expected.length / 2, digest: expected };
      expect({ algorithm: hmac.algorithm, byteLength: hmac.byteLength, digest: hmac.digest("hex") }).toEqual(state);
      // The copy is still usable after the original was digested.
      expect({ algorithm: copied.algorithm, byteLength: copied.byteLength, digest: copied.digest("hex") }).toEqual(
        state,
      );

      // digest() consumes an HMAC: every later operation throws.
      expect({ hmac: afterDigest(hmac), copied: afterDigest(copied) }).toEqual({
        hmac: allConsumed,
        copied: allConsumed,
      });

      // Note that algorithm may throw if the first time the property was accessed is after it was already consumed.
      // This is a property caching edgecase that it does not always throw.
      // But let's see if anyone complains about it. It is extremely minor
    });
  }

  const unsupported = [["shake128"], ["shake256"]] as const;
  test.each(unsupported)("%s is not supported", algorithm => {
    expect(() => new Bun.CryptoHasher(algorithm, "key")).toThrow("HMAC is not supported for this algorithm yet");
    expect(new Bun.CryptoHasher(algorithm).algorithm).toBe(algorithm);
  });
});

describe("static hashers", () => {
  for (let algorithm of [
    Bun.SHA1,
    Bun.SHA224,
    Bun.SHA256,
    Bun.SHA384,
    Bun.SHA512,
    Bun.SHA512_256,
    Bun.MD4,
    Bun.MD5,
  ] as const) {
    test(`second digest should throw an error ${algorithm.name}`, () => {
      const hasher = new algorithm().update("hello");
      hasher.digest();
      expect(() => hasher.digest()).toThrow(
        `${algorithm.name} hasher already digested, create a new instance to digest again`,
      );
      expect(() => hasher.update("world")).toThrow(
        `${algorithm.name} hasher already digested, create a new instance to update`,
      );
    });
  }
});

describe("Hash matches reference digests", () => {
  const sourceInputs = [
    Buffer.from([
      103, 87, 129, 242, 154, 82, 159, 206, 176, 124, 10, 39, 235, 214, 121, 13, 34, 155, 131, 178, 40, 34, 252, 134, 7,
      203, 130, 187, 207, 49, 26, 59,
    ]),
    Buffer.from([
      68, 19, 111, 163, 85, 179, 103, 138, 17, 70, 173, 22, 247, 232, 100, 158, 148, 251, 79, 194, 31, 231, 126, 131,
      16, 192, 96, 246, 28, 170, 255, 138,
    ]),
    Buffer.from([
      219, 133, 5, 84, 59, 236, 191, 241, 104, 167, 186, 223, 204, 158, 177, 43, 205, 52, 120, 28, 60, 233, 156, 159,
      125, 64, 171, 91, 240, 17, 71, 210,
    ]),
    Buffer.from([
      34, 93, 2, 87, 76, 190, 175, 238, 185, 96, 201, 38, 104, 215, 236, 99, 223, 134, 157, 237, 254, 36, 49, 242, 100,
      135, 198, 114, 49, 71, 220, 79,
    ]),
  ];

  // A Blob input takes a different path into the hasher than a Buffer.
  const inputs = [...sourceInputs, ...sourceInputs.map(x => new Blob([x]))];

  // Hex digests of sourceInputs, in order.
  const digests = {
    sha1: [
      "25b8cb4ac0499acdaecb5c5bcd72bf7b4af17599",
      "1b21e09040dbb5bed7727c34f45e0c0705821ec7",
      "7c35c0a288ac36a54fe0559406f7cd8c74d6401f",
      "7e8f0a60442dde14079982f981ff51ccc8fc721f",
    ],
    sha256: [
      "71bcc56fa3fa8f2e1d2fcf06a8e4a95337c286cb68a57a8da69386e4e02c5f6a",
      "c74f3008fdd2f7c5ae5446ab2e522629f63346f68a4026b4f72b91b393475ff6",
      "9801a682688feb689613ffaed72165d2e42d0daa918de81125c10baea032acf7",
      "324c27b84dab9870a399c4a3b86101a3e01dbaf96d4605501fcb405a7be2a89f",
    ],
    sha512: [
      "a9c638c774125fa19db1574709641f3923f3471d44da1715422e85dd04db49edddbd660dd77e7bf01bd6b5d597540295a76be4840a03a58b3857a0b43351552d",
      "a5ff0017e5faebbb18563dfc39fbb3e2db4a8ccca2e029e124dd472623e179b621772f3dac4210598f68d31cc4c3a6005e2940c55298a4fb8314f6b7f3e22292",
      "c8f3e36e89a223717d96f55abd44836a499b6c2ea5fc7d93bf2fa2df72b5ee86925b37f93396b2a2a442d163fc6dca77eb63209206ebfb0847dec84f506db889",
      "287b698c06a8b6b5af3d3e4b966b7898d1f5d675457854950ba5bae9877c66ff7859ffb27c013064f0246379b56f08c871cb7c65f48856703ad650f7f6548b68",
    ],
    md5: [
      "3b3579e416de5d7775a4e92b0c30e4b9",
      "dde82ade99f87dd7cab686ad0f3283a7",
      "4cf897b53dbc3fac0433c6cc911eef5c",
      "dfcd12014d97b4e1d97a2e16b8e1ca5f",
    ],
  };

  for (let algorithm of ["sha1", "sha256", "sha512", "md5"] as const) {
    describe(algorithm, () => {
      const Class = globalThis.Bun[algorithm.toUpperCase() as "SHA1" | "SHA256" | "SHA512" | "MD5"];
      // With no encoding, digest() and hash() return the raw bytes.
      for (const [name, encoding] of [
        ["hex", "hex"],
        ["base64", "base64"],
        ["bytes", undefined],
      ] as const) {
        test(name, () => {
          const expected = inputs.map((_, i) => {
            const bytes = Buffer.from(digests[algorithm][i % sourceInputs.length], "hex");
            return encoding === undefined ? bytes : bytes.toString(encoding);
          });
          const results = {
            instance: inputs.map(input => {
              const hasher = new Bun.CryptoHasher(algorithm);
              // The input encoding argument has no effect on a Buffer or Blob input.
              expect(hasher.update(input, encoding)).toBe(hasher);
              return hasher.digest(encoding);
            }),
            static: inputs.map(input => Bun.CryptoHasher.hash(algorithm, input, encoding)),
            classInstance: inputs.map(input => new Class().update(input).digest(encoding)),
            classStatic: inputs.map(input => Class.hash(input, encoding)),
          };
          expect(results).toEqual({
            instance: expected,
            static: expected,
            classInstance: expected,
            classStatic: expected,
          });
        });
      }
    });
  }
});

describe("CryptoHasher", () => {
  // Hex digests of "hello" for every accepted algorithm name.
  const hello = {
    "blake2b256": "324dcf027dd4a30a932c441f365a25e86b173defa4b8e58948253471b81b72cf",
    "blake2b512":
      "e4cfa39a3d37be31c59609e807970799caa68a19bfaa15135f165085e01d41a65ba1e1b146aeb6bd0092b49eac214c103ccfa3a365954bbbe52f74a2b3620c94",
    "blake2s256": "19213bacc58dee6dbde3ceb9a47cbb330b3d86f8cca8997eb00be456f140ca25",
    "ripemd160": "108f07b8382412612c048d07d13f814118445acd",
    "rmd160": "108f07b8382412612c048d07d13f814118445acd",
    "md4": "866437cb7a794bce2b727acc0362ee27",
    "md5": "5d41402abc4b2a76b9719d911017c592",
    "sha1": "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
    "sha128": "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
    "sha224": "ea09ae9cc6768c50fcee903ed054556e5bfc8347907f12598aa24193",
    "sha256": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    "sha384": "59e1748777448c69de6b800d7a33bbfb9ff1b463e44354c3553bcdb9c666fa90125a3c79f90397bdf5f6a13de828684f",
    "sha512":
      "9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043",
    "sha-1": "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
    "sha-224": "ea09ae9cc6768c50fcee903ed054556e5bfc8347907f12598aa24193",
    "sha-256": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    "sha-384": "59e1748777448c69de6b800d7a33bbfb9ff1b463e44354c3553bcdb9c666fa90125a3c79f90397bdf5f6a13de828684f",
    "sha-512":
      "9b71d224bd62f3785d96d46ad3ea3d73319bfbc2890caadae2dff72519673ca72323c3d99ba5c11d7c7acc6e14b8c5da0c4663475c2e5c3adef46f73bcdec043",
    "sha-512/224": "fe8509ed1fb7dcefc27e6ac1a80eddbec4cb3d2c6fe565244374061c",
    "sha-512_224": "fe8509ed1fb7dcefc27e6ac1a80eddbec4cb3d2c6fe565244374061c",
    "sha-512224": "fe8509ed1fb7dcefc27e6ac1a80eddbec4cb3d2c6fe565244374061c",
    "sha512-224": "fe8509ed1fb7dcefc27e6ac1a80eddbec4cb3d2c6fe565244374061c",
    "sha-512/256": "e30d87cfa2a75db545eac4d61baf970366a8357c7f72fa95b52d0accb698f13a",
    "sha-512_256": "e30d87cfa2a75db545eac4d61baf970366a8357c7f72fa95b52d0accb698f13a",
    "sha-512256": "e30d87cfa2a75db545eac4d61baf970366a8357c7f72fa95b52d0accb698f13a",
    "sha512-256": "e30d87cfa2a75db545eac4d61baf970366a8357c7f72fa95b52d0accb698f13a",
    "sha3-224": "b87f88c72702fff1748e58b87e9141a42c0dbedc29a78cb0d4a5cd81",
    "sha3-256": "3338be694f50c5f338814986cdf0686453a888b84f424d792af4b9202398f392",
    "sha3-384": "720aea11019ef06440fbf05d87aa24680a2153df3907b23631e7177ce620fa1330ff07c0fddee54699a4c3ee0ee9d887",
    "sha3-512":
      "75d527c368f2efe848ecf6b073a36767800805e9eef2b1857d5f984f036eb6df891d75f72d9b154518c1cd58835286d1da9a38deba3de98b5a53e5ed78a84976",
    "shake128": "8eb4b6a932f280335ee1a279f8c208a3",
    "shake256": "1234075ae4a1e77316cf2d8000974581a343b9ebbca7e3d1db83394c30f22162",
  };

  // The algorithm getter reports the canonical name of an alias.
  const canonical: Record<string, string> = {
    "rmd160": "ripemd160",
    "sha128": "sha1",
    "sha-1": "sha1",
    "sha-224": "sha224",
    "sha-256": "sha256",
    "sha-384": "sha384",
    "sha-512": "sha512",
    "sha-512/224": "sha512-224",
    "sha-512_224": "sha512-224",
    "sha-512224": "sha512-224",
    "sha-512/256": "sha512-256",
    "sha-512_256": "sha512-256",
    "sha-512256": "sha512-256",
  };

  const encodings = ["hex", "base64", "base64url", "buffer", undefined] as const;

  test.each(Object.entries(hello))("%s", (algorithm, hex) => {
    const bytes = Buffer.from(hex, "hex");
    // "buffer" and no encoding both return the raw bytes.
    const expected = {
      hex,
      base64: bytes.toString("base64"),
      base64url: bytes.toString("base64url"),
      buffer: bytes,
      default: bytes,
    };

    const collect = (run: (encoding: (typeof encodings)[number]) => unknown) =>
      Object.fromEntries(encodings.map(encoding => [encoding ?? "default", run(encoding)]));

    const hasher = new Bun.CryptoHasher(algorithm);
    expect({ algorithm: hasher.algorithm, byteLength: hasher.byteLength }).toEqual({
      algorithm: canonical[algorithm] ?? algorithm,
      byteLength: bytes.length,
    });
    expect({
      instance: collect(encoding => new Bun.CryptoHasher(algorithm).update("hello").digest(encoding)),
      static: collect(encoding => Bun.CryptoHasher.hash(algorithm, "hello", encoding)),
    }).toEqual({ instance: expected, static: expected });
  });
});

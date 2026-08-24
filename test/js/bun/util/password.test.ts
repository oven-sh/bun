import { password } from "bun";
import { describe, expect, test } from "bun:test";
import { expectRssDeltaBelow, isASAN, isDebug } from "harness";

const placeholder = "hey";
const argonVariants = ["argon2id", "argon2i", "argon2d"] as const;
type ArgonVariant = (typeof argonVariants)[number];

// PHC string: a 32-byte salt and a 32-byte hash, both base64 without padding.
function argon2Hash(algorithm: ArgonVariant, memoryCost: number, timeCost: number) {
  return new RegExp(
    `^\\$${algorithm}\\$v=19\\$m=${memoryCost},t=${timeCost},p=1\\$[A-Za-z0-9+/]{43}\\$[A-Za-z0-9+/]{43}$`,
  );
}

// Modular crypt string: a 22-char salt and a 31-char hash in bcrypt's own base64 alphabet.
function bcryptHash(cost: number) {
  return new RegExp(`^\\$2b\\$${String(cost).padStart(2, "0")}\\$[./A-Za-z0-9]{53}$`);
}

const typeError = (code: string, message: unknown) => expect.objectContaining({ name: "TypeError", code, message });

// Matcher for an error message that names the function, given as a template
// with `{fn}` in it. The async forms are pinned exactly. hashSync and
// verifySync report themselves as 'hash' and 'verify', so for them the name is
// left open rather than pinned to the wrong one.
function named(name: string, sync: boolean, template: string, code = "ERR_INVALID_ARG_TYPE") {
  const [before, after] = template.split("{fn}");
  if (!sync) return typeError(code, before + name + after);
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return typeError(code, expect.stringMatching(new RegExp(`^${escape(before)}\\w+${escape(after)}$`)));
}

// The message lists the accepted names. Its lead-in ("to be a unknown
// algorithm, expected one of") is not pinned.
const unknownAlgorithm = typeError(
  "ERR_INVALID_ARG_TYPE",
  expect.stringContaining('"bcrypt", "argon2id", "argon2d", "argon2i" (default is "argon2id")'),
);
const verifyError = (code: string, reason: string) =>
  expect.objectContaining({ code, message: `Password verification failed with error "${reason}"` });
const unsupportedAlgorithm = verifyError("PASSWORD_UNSUPPORTED_ALGORITHM", "UnsupportedAlgorithm");
const invalidEncoding = verifyError("PASSWORD_INVALID_ENCODING", "InvalidEncoding");
const weakParameters = verifyError("PASSWORD_WEAK_PARAMETERS", "WeakParameters");

// The leak this guards (#29913) was the encoded hash string, about 100 bytes
// per hash() or hashSync() call that was never freed. Bun 1.3.13 (unfixed)
// shows it as about 100 bytes of RSS growth per call, so the check needs tens
// of thousands of calls over a flat baseline. Two things keep the baseline
// flat on top of what the harness does (mimalloc purge delay 0, ASAN
// quarantine off): the warm-up runs past the JIT tier-up of the loop, which
// commits about 3 MiB once before call 3000, and every chunk of 2000 calls
// ends in a full GC, so the strings the calls leave behind never grow the
// heap. The fixed build then reads 0 MiB.
//
// A debug build hashes about 200x slower, so the suite does not run there.
describe.skipIf(isDebug)("does not leak", () => {
  function expectRssGrowthBelow(
    calls: string,
    warmup: number,
    measured: number,
    bounds: { release: number; debug: number },
  ) {
    const code = /* js */ `
      const rss = process.platform === "darwin" && typeof Bun.unsafe.memoryFootprint === "function" ? Bun.unsafe.memoryFootprint : process.memoryUsage.rss;
      const opts = { algorithm: "argon2id", memoryCost: 8, timeCost: 1 };
      const chunk = 2000;
      async function run(n) {
        for (let done = 0; done < n; done += chunk) {
          ${calls}
          Bun.gc(true);
        }
      }
      await run(${warmup});
      const before = rss();
      await run(${measured});
      console.log(JSON.stringify({ deltaMiB: (rss() - before) / 1024 / 1024 }));
    `;
    return expectRssDeltaBelow(["--smol", "-e", code], bounds);
  }

  // Release: unfixed 4 to 5 MiB, fixed 0 MiB. The `debug` bound is the ASAN
  // lane, where a leaked block carries redzones and the allocator's baseline
  // moves by a few MiB, so it measures more calls against a wider bound.
  test("hashSync", async () => {
    await expectRssGrowthBelow(
      /* js */ `for (let i = 0; i < chunk; i++) Bun.password.hashSync("hey", opts);`,
      4_000,
      isASAN ? 60_000 : 40_000,
      { release: 2, debug: 6 },
    );
  });

  // Release: unfixed 4 to 6 MiB, fixed 0 to 1 MiB.
  test("hash", async () => {
    await expectRssGrowthBelow(
      /* js */ `
        for (let j = 0; j < chunk / 100; j++) {
          const batch = [];
          for (let i = 0; i < 100; i++) batch.push(Bun.password.hash("hey", opts));
          await Promise.all(batch);
        }`,
      10_000,
      isASAN ? 100_000 : 50_000,
      { release: 2, debug: 8 },
    );
  });
});

describe("hash", () => {
  for (const [name, hash, sync] of [
    ["hash", password.hash, false],
    ["hashSync", password.hashSync, true],
  ] as const) {
    describe(`${name} argument parsing`, () => {
      test("no blank password allowed", () => {
        expect(() => hash("")).toThrow(typeError("ERR_INVALID_ARG_TYPE", "password must not be empty"));
      });

      test("password is required", () => {
        // @ts-expect-error
        expect(() => hash()).toThrow(
          named(name, sync, "Not enough arguments to '{fn}'. Expected 1, got 0.", "ERR_MISSING_ARGS"),
        );
      });

      test("invalid algorithm throws", () => {
        // @ts-expect-error
        expect(() => hash(placeholder, "scrpyt")).toThrow(unknownAlgorithm);
        // @ts-expect-error
        expect(() => hash(placeholder, 123)).toThrow(
          named(name, sync, "Expected algorithm to be a string for '{fn}'."),
        );

        // An object is read as options, so its toString() is not an algorithm name.
        expect(() =>
          hash(placeholder, {
            // @ts-expect-error
            toString() {
              return "scrypt";
            },
          }),
        ).toThrow(named(name, sync, "Expected options.algorithm to be a string for '{fn}'."));

        expect(() =>
          hash(placeholder, {
            // @ts-expect-error
            algorithm: "poop",
          }),
        ).toThrow(unknownAlgorithm);

        const rounds = typeError("ERR_INVALID_ARG_TYPE", "Rounds must be an integer between 4 and 31");
        for (const cost of [Infinity, -999, 3, 32]) {
          expect(() => hash(placeholder, { algorithm: "bcrypt", cost })).toThrow(rounds);
        }
        // @ts-expect-error
        expect(() => hash(placeholder, { algorithm: "bcrypt", cost: "10" })).toThrow(
          named(name, sync, "Expected cost to be a number for '{fn}'."),
        );

        // argon2 requires `memoryCost >= 8 * parallelism`; Bun hard-codes
        // `parallelism = 1`, so anything below 8 must throw rather than be
        // silently clamped (regression coverage for #30960).
        const memory = typeError("ERR_INVALID_ARG_TYPE", "Memory cost must be at least 8");
        for (const memoryCost of [-1, 0, 1, 3, 7]) {
          expect(() => hash(placeholder, { algorithm: "argon2id", memoryCost })).toThrow(memory);
        }

        const time = typeError("ERR_INVALID_ARG_TYPE", "Time cost must be greater than 0");
        for (const timeCost of [-1, 0]) {
          expect(() => hash(placeholder, { algorithm: "argon2id", timeCost })).toThrow(time);
        }
        // @ts-expect-error
        expect(() => hash(placeholder, { algorithm: "argon2id", timeCost: "2" })).toThrow(
          named(name, sync, "Expected timeCost to be a number for '{fn}'."),
        );
      });

      test("cost values are range-checked before ToInt32 narrowing", () => {
        // These used to wrap modulo 2^32 (cost: 2^32 + 4 hashed with cost 4)
        // or truncate (cost: 4.5 hashed with cost 4) instead of throwing.
        const rounds = typeError("ERR_INVALID_ARG_TYPE", "Rounds must be an integer between 4 and 31");
        for (const cost of [2 ** 32 + 4, 4.5]) {
          expect(() => hash(placeholder, { algorithm: "bcrypt", cost })).toThrow(rounds);
        }

        const time = typeError("ERR_INVALID_ARG_TYPE", "Time cost must be an integer between 1 and 4294967295");
        for (const timeCost of [2 ** 32 + 2, 1.5, Infinity]) {
          expect(() => hash(placeholder, { algorithm: "argon2id", timeCost })).toThrow(time);
        }

        const memory = typeError("ERR_INVALID_ARG_TYPE", "Memory cost must be an integer between 8 and 4294967295");
        for (const memoryCost of [2 ** 32 + 4608, 8.5, Infinity]) {
          expect(() => hash(placeholder, { algorithm: "argon2id", memoryCost })).toThrow(memory);
        }

        // NaN and -Infinity fail the lower-bound check first.
        for (const timeCost of [NaN, -Infinity]) {
          expect(() => hash(placeholder, { algorithm: "argon2id", timeCost })).toThrow(
            typeError("ERR_INVALID_ARG_TYPE", "Time cost must be greater than 0"),
          );
        }
        for (const memoryCost of [NaN, -Infinity]) {
          expect(() => hash(placeholder, { algorithm: "argon2id", memoryCost })).toThrow(
            typeError("ERR_INVALID_ARG_TYPE", "Memory cost must be at least 8"),
          );
        }
      });

      test("coercion throwing doesn't crash", () => {
        // The async form still coerces the password with ToString, so only the
        // sync form's error is pinned.
        const notAPassword = named(name, sync, "Expected password to be a string or TypedArray for '{fn}'.");
        // @ts-expect-error
        expect(() => hash(Symbol())).toThrow(sync ? notAPassword : TypeError);
        expect(() =>
          // @ts-expect-error
          hash({
            toString() {
              throw new Error("toString() failed");
            },
          }),
        ).toThrow(sync ? notAPassword : Error);
      });

      for (const ArrayBufferView of [
        Uint8Array,
        Uint16Array,
        Uint32Array,
        Int8Array,
        Int16Array,
        Int32Array,
        Float16Array,
        Float32Array,
        Float64Array,
        ArrayBuffer,
      ]) {
        test(`empty ${ArrayBufferView.name} throws`, () => {
          expect(() => hash(new ArrayBufferView(0))).toThrow(
            typeError("ERR_INVALID_ARG_TYPE", "password must not be empty"),
          );
        });
      }
    });
  }
});

describe("verify", () => {
  for (const [name, verify, sync] of [
    ["verify", password.verify, false],
    ["verifySync", password.verifySync, true],
  ] as const) {
    describe(`${name} argument parsing`, () => {
      test("minimum args", () => {
        // @ts-expect-error
        expect(() => verify()).toThrow(
          named(name, sync, "Not enough arguments to '{fn}'. Expected 2, got 0.", "ERR_MISSING_ARGS"),
        );
        // The message reports "got 0" for a one-argument call too, so the
        // count is not pinned here.
        // @ts-expect-error
        expect(() => verify("")).toThrow(
          typeError("ERR_MISSING_ARGS", expect.stringMatching(/^Not enough arguments to '\w+'\. Expected 2, got /)),
        );
      });

      test("empty values return false", async () => {
        expect(await verify("", "$")).toBeFalse();
        expect(await verify("$", "")).toBeFalse();
      });

      test("invalid algorithm throws", () => {
        // @ts-expect-error
        expect(() => verify(placeholder, "$", "scrpyt")).toThrow(unknownAlgorithm);
        const notAString = named(name, sync, "Expected algorithm to be a string for '{fn}'.");
        // @ts-expect-error
        expect(() => verify(placeholder, "$", 123)).toThrow(notAString);
        expect(() =>
          // @ts-expect-error
          verify(placeholder, "$", {
            toString() {
              return "scrypt";
            },
          }),
        ).toThrow(notAString);
      });

      test("coercion throwing doesn't crash", () => {
        // The async form still coerces both arguments with ToString, so only
        // the sync form's errors are pinned.
        const notAPassword = named(name, sync, "Expected password to be a string or TypedArray for '{fn}'.");
        const notAHash = named(name, sync, "Expected hash to be a string or TypedArray for '{fn}'.");
        const throwing = {
          toString() {
            throw new Error("toString() failed");
          },
        };
        // @ts-expect-error
        expect(() => verify(Symbol(), Symbol())).toThrow(sync ? notAPassword : TypeError);
        // @ts-expect-error
        expect(() => verify(throwing, "valid")).toThrow(sync ? notAPassword : Error);
        // @ts-expect-error
        expect(() => verify("valid", throwing)).toThrow(sync ? notAHash : Error);
      });

      for (const ArrayBufferView of [
        Uint8Array,
        Uint16Array,
        Uint32Array,
        Int8Array,
        Int16Array,
        Int32Array,
        Float16Array,
        Float32Array,
        Float64Array,
        ArrayBuffer,
      ]) {
        test(`empty ${ArrayBufferView.name} returns false`, async () => {
          expect(await verify(new ArrayBufferView(0), new ArrayBufferView(0))).toBeFalse();
          expect(await verify("", new ArrayBufferView(0))).toBeFalse();
          expect(await verify(new ArrayBufferView(0), "")).toBeFalse();
        });
      }
    });
  }
});

// Round trips use the cheapest parameters each algorithm accepts, so a hash
// takes microseconds instead of the ~100 ms a default-cost hash takes. The
// argon2 values are above the minimums so the test sees both options reach
// the encoded string.
const cheap: {
  algorithm: Bun.Password.AlgorithmLabel;
  options: Bun.Password.Argon2Algorithm | Bun.Password.BCryptAlgorithm;
  format: RegExp;
}[] = [
  ...argonVariants.map(algorithm => ({
    algorithm,
    options: { algorithm, memoryCost: 16, timeCost: 3 },
    format: argon2Hash(algorithm, 16, 3),
  })),
  { algorithm: "bcrypt", options: { algorithm: "bcrypt", cost: 4 }, format: bcryptHash(4) },
];

for (const { algorithm, options, format } of cheap) {
  describe(algorithm, () => {
    for (const [kind, input] of [
      ["string", placeholder],
      ["buffer", Buffer.from(placeholder)],
    ] as const) {
      describe(kind, () => {
        // The same bytes in the other representation.
        const other = typeof input === "string" ? Buffer.from(input) : input.toString();
        const wrong = placeholder + "\0";

        test("sync round trip", async () => {
          const hashed = password.hashSync(input, options);
          expect(hashed).toMatch(format);
          // A fresh salt each call.
          expect(password.hashSync(input, options)).not.toBe(hashed);

          expect(password.verifySync(input, hashed)).toBeTrue();
          expect(password.verifySync(other, hashed)).toBeTrue();
          expect(password.verifySync(input, hashed, algorithm)).toBeTrue();
          expect(await password.verify(input, hashed)).toBeTrue();
          expect(password.verifySync(wrong, hashed)).toBeFalse();

          // The plain password is not an encoded hash.
          expect(() => password.verifySync(hashed, input)).toThrow(unsupportedAlgorithm);
          expect(() => password.verifySync(hashed, input, algorithm)).toThrow(invalidEncoding);
        });

        test.concurrent("async round trip", async () => {
          const hashed = await password.hash(input, options);
          expect(hashed).toMatch(format);
          expect(await password.hash(input, options)).not.toBe(hashed);

          expect(await password.verify(input, hashed)).toBeTrue();
          expect(await password.verify(other, hashed)).toBeTrue();
          expect(await password.verify(input, hashed, algorithm)).toBeTrue();
          expect(password.verifySync(input, hashed)).toBeTrue();
          expect(await password.verify(wrong, hashed)).toBeFalse();

          await expect(password.verify(hashed, input)).rejects.toThrow(unsupportedAlgorithm);
          await expect(password.verify(hashed, input, algorithm)).rejects.toThrow(invalidEncoding);
        });
      });
    }
  });
}

// The only hashes at the default cost (argon2: 64 MiB and 2 iterations,
// bcrypt: cost 10). A default-cost argon2 hash takes about 100 ms on a release
// build and 4 s on a debug build, so each algorithm hashes once, the tests run
// concurrently, and the argon2 ones do not run on debug builds.
describe.concurrent("default parameters", () => {
  test.skipIf(isDebug)("no algorithm means argon2id", async () => {
    const hashed = await password.hash(placeholder);
    expect(hashed).toMatch(argon2Hash("argon2id", 65536, 2));
    expect(await password.verify(placeholder, hashed)).toBeTrue();
  });

  for (const algorithm of argonVariants) {
    test.skipIf(isDebug)(algorithm, async () => {
      const hashed = await password.hash(placeholder, algorithm);
      expect(hashed).toMatch(argon2Hash(algorithm, 65536, 2));
      expect(await password.verify(placeholder, hashed, algorithm)).toBeTrue();
    });
  }

  test("bcrypt", async () => {
    const hashed = password.hashSync(placeholder, "bcrypt");
    expect(hashed).toMatch(bcryptHash(10));
    expect(await password.verify(placeholder, hashed, "bcrypt")).toBeTrue();
  });
});

test.concurrent("bcrypt uses the SHA-512 of passwords longer than 72 characters", async () => {
  const long = Buffer.alloc(300, "hey");
  const hashed = await password.hash(long, { algorithm: "bcrypt", cost: 4 });
  expect(hashed).toMatch(bcryptHash(4));
  expect(await password.verify(long, hashed, "bcrypt")).toBeTrue();
  expect(await password.verify(long.toString(), hashed, "bcrypt")).toBeTrue();
  // Plain bcrypt would truncate to 72 bytes and accept this prefix.
  expect(await password.verify(Buffer.alloc(72, "hey"), hashed, "bcrypt")).toBeFalse();
});

test.concurrent("bcrypt pre-hashing does not break compatibility across Bun versions", async () => {
  // hash generated by Bun 1.2.4
  // if we change the mechanism used to pre-hash long passwords so bcrypt doesn't truncate them,
  // then this hash will not be considered valid by later versions of Bun.
  const hash = "$2b$10$PsJ3/W82mzNJoP0rSblfvet2ab9jZg2aH7tIxr1B8uFLJwuWk/jTi";
  const secret = Buffer.alloc(500, "hello").toString();
  expect(await password.verify(secret, hash)).toBeTrue();
});

test.concurrent("argon2 memoryCost at the 8 minimum is encoded faithfully (regression for #30960)", async () => {
  const hashed = await password.hash("test", {
    algorithm: "argon2id",
    memoryCost: 8,
    timeCost: 1,
  });
  // The encoded PHC string must reflect the user-provided memoryCost, not a
  // silently clamped value. Before the fix, values below 8 were rounded up
  // while still reporting `m=8`; this pins the minimum at 8 as advertised.
  expect(hashed).toMatch(argon2Hash("argon2id", 8, 1));
  expect(await password.verify("test", hashed)).toBeTrue();
});

describe.concurrent("argon2 hashes with memoryCost below 8 from earlier Bun versions still verify", () => {
  // Generated by Bun 1.3.14, which accepted memoryCost < 8.
  const legacy = {
    argon2id:
      "$argon2id$v=19$m=4,t=1,p=1$jaFm03353WIBtbqnvp4hx6Pd0Pk2keYfomedORTs6bI$Q+62iWiDQhCP3VFQvnMnGptmDAHFQGqY3d/dmRcGVOw",
    argon2i:
      "$argon2i$v=19$m=4,t=1,p=1$ccFUBS8pl1c6HrbfKTnDVnFuL7ZzrWWfn/HmEmPhXZs$SnmF2IobheA3dXrQ6PTAIFOI2mW7cmXaEdYOyeepuCc",
    argon2d:
      "$argon2d$v=19$m=4,t=1,p=1$l/aF7c94XVVjN+DEIojRJp2DueSSsSnIugDMmAm1h1E$h7CusZJfNR1nJQPyQsJMoHVpwlC/rCjYBS7Mc1bQdD0",
    "argon2id m=1":
      "$argon2id$v=19$m=1,t=1,p=1$BigwogH2c6TyJp0Po2odtNo1utvkW2MJbgm3liMV4xU$cw5OZZOZRBfd+bOnf1knGDZ67UwQN9j4nzpzt8P6JDY",
  };

  for (const [name, hash] of Object.entries(legacy)) {
    test(name, async () => {
      expect(await password.verify("hello", hash)).toBeTrue();
      expect(await password.verify("hellp", hash)).toBeFalse();
      expect(password.verifySync("hello", hash)).toBeTrue();
      expect(password.verifySync("hellp", hash)).toBeFalse();
    });
  }

  test("hashing with memoryCost below 8 is still rejected", () => {
    expect(() => password.hashSync("hello", { algorithm: "argon2id", memoryCost: 4 })).toThrow(
      typeError("ERR_INVALID_ARG_TYPE", "Memory cost must be at least 8"),
    );
  });
});

test("verify rejects encoded argon2 hashes with cost parameters above the supported maximums", async () => {
  // Hash with small, fast parameters so this test stays cheap on debug builds.
  const hashed = password.hashSync("correct horse", {
    algorithm: "argon2id",
    memoryCost: 8,
    timeCost: 1,
  });
  expect(hashed).toMatch(argon2Hash("argon2id", 8, 1));

  // The untampered hash still verifies.
  expect(password.verifySync("correct horse", hashed)).toBeTrue();

  // A time cost far above the verification ceiling embedded in the encoded
  // hash must be rejected up front instead of being honored.
  const hugeTime = hashed.replace(",t=1,", ",t=100000,");
  expect(hugeTime).not.toBe(hashed);
  expect(() => password.verifySync("correct horse", hugeTime)).toThrow(weakParameters);
  await expect(password.verify("correct horse", hugeTime)).rejects.toThrow(weakParameters);

  // A memory cost above the ceiling is rejected before any allocation is
  // sized from the encoded string.
  const hugeMemory = hashed.replace("$m=8,", "$m=4294967294,");
  expect(hugeMemory).not.toBe(hashed);
  expect(() => password.verifySync("correct horse", hugeMemory)).toThrow(weakParameters);
  await expect(password.verify("correct horse", hugeMemory)).rejects.toThrow(weakParameters);

  // A parallelism value above the ceiling is rejected as well.
  const hugeParallelism = hashed.replace(",p=1$", ",p=65$");
  expect(hugeParallelism).not.toBe(hashed);
  expect(() => password.verifySync("correct horse", hugeParallelism)).toThrow(weakParameters);
  await expect(password.verify("correct horse", hugeParallelism)).rejects.toThrow(weakParameters);

  // The argon2 decoder accepts a leading `+` on the cost fields (Rust's integer
  // grammar), so the ceiling check must too rather than skipping the field.
  const plusMemory = hashed.replace("$m=8,", "$m=+4294967294,");
  expect(plusMemory).not.toBe(hashed);
  expect(() => password.verifySync("correct horse", plusMemory)).toThrow(weakParameters);
  await expect(password.verify("correct horse", plusMemory)).rejects.toThrow(weakParameters);

  // A cost field the decoder can't parse is rejected up front as well.
  const junkMemory = hashed.replace("$m=8,", "$m=8x,");
  expect(() => password.verifySync("correct horse", junkMemory)).toThrow(invalidEncoding);
  await expect(password.verify("correct horse", junkMemory)).rejects.toThrow(invalidEncoding);
});

test("verifySync reads the password buffer only after every argument has been coerced", () => {
  const hashed = password.hashSync("correct horse", { algorithm: "argon2id", memoryCost: 8, timeCost: 1 });
  const passwordBytes = new TextEncoder().encode("correct horse");
  const hashObject = new String(hashed);
  hashObject.toString = () => {
    structuredClone(passwordBytes.buffer, { transfer: [passwordBytes.buffer] });
    Bun.gc(true);
    return hashed;
  };
  expect(password.verifySync(passwordBytes, hashObject as any)).toBeFalse();
  expect(passwordBytes.byteLength).toBe(0);
});

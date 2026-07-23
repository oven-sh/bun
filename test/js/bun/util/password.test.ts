import { password } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";

const placeholder = "hey";

// argon2id iterates so slowly under debug/ASAN that the 60 000 warm-up
// iterations blow past the 90 s test timeout before the leak check even
// starts. The leak numbers are only meaningful on release anyway — skip
// the whole suite on debug so the rest of the file can run.
describe.skipIf(isDebug)("does not leak", () => {
  async function run(code: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--smol", "-e", code],
      env: bunEnv,
      stdout: "inherit",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    // Only fail on a non-zero exit. ASAN builds may emit startup warnings on
    // stderr that are not errors, so don't require stderr to be empty.
    if (exitCode !== 0) throw new Error(stderr || `exited with code ${exitCode}`);
  }

  test("hashSync", async () => {
    await run(/* js */ `
        const opts = { algorithm: "argon2id", memoryCost: 8, timeCost: 1 };
        // Large warm-up so the JSC heap and allocator arenas reach steady state
        // before we start measuring (debug/ASAN builds especially need this).
        for (let i = 0; i < 60000; i++) Bun.password.hashSync("hey", opts);
        Bun.gc(true);
        const before = process.memoryUsage.rss();
        for (let i = 0; i < 60000; i++) Bun.password.hashSync("hey", opts);
        Bun.gc(true);
        const growthMB = (process.memoryUsage.rss() - before) / 1024 / 1024;
        // ASAN's free quarantine (default 256 MB) plus redzones and glibc page
        // retention inflate RSS even when nothing is leaking.
        const limit = ${isASAN ? 400 : 4};
        if (growthMB > limit) throw new Error("leaked " + growthMB.toFixed(2) + "MB (limit " + limit + "MB)");
      `);
  }, 90_000);

  test("hash", async () => {
    await run(/* js */ `
        const opts = { algorithm: "argon2id", memoryCost: 8, timeCost: 1 };
        async function batch(n) {
          const promises = [];
          for (let i = 0; i < n; i++) promises.push(Bun.password.hash("hey", opts));
          await Promise.all(promises);
        }
        for (let i = 0; i < 500; i++) await batch(100);
        Bun.gc(true);
        const before = process.memoryUsage.rss();
        for (let i = 0; i < 2000; i++) await batch(100);
        Bun.gc(true);
        const growthMB = (process.memoryUsage.rss() - before) / 1024 / 1024;
        // ASAN's free quarantine (default 256 MB) plus redzones and glibc page
        // retention inflate RSS even when nothing is leaking.
        const limit = ${isASAN ? 400 : 20};
        if (growthMB > limit) throw new Error("leaked " + growthMB.toFixed(2) + "MB (limit " + limit + "MB)");
      `);
  }, 90_000);
});

describe("hash", () => {
  describe("arguments parsing", () => {
    for (let hash of [password.hash, password.hashSync]) {
      test("no blank password allowed", () => {
        expect(() => hash("")).toThrow("password must not be empty");
      });

      test("password is required", () => {
        // @ts-expect-error
        expect(() => hash()).toThrow();
      });

      test("invalid algorithm throws", () => {
        // @ts-expect-error
        expect(() => hash(placeholder, "scrpyt")).toThrow();
        // @ts-expect-error
        expect(() => hash(placeholder, 123)).toThrow();

        expect(() =>
          hash(placeholder, {
            // @ts-expect-error
            toString() {
              return "scrypt";
            },
          }),
        ).toThrow();

        expect(() =>
          hash(placeholder, {
            // @ts-expect-error
            algorithm: "poop",
          }),
        ).toThrow();

        expect(() =>
          hash(placeholder, {
            algorithm: "bcrypt",
            cost: Infinity,
          }),
        ).toThrow();

        expect(() =>
          hash(placeholder, {
            algorithm: "argon2id",
            memoryCost: -1,
          }),
        ).toThrow();

        // argon2 requires `memoryCost >= 8 * parallelism`; Bun hard-codes
        // `parallelism = 1`, so anything below 8 must throw rather than be
        // silently clamped (regression coverage for #30960).
        for (const invalid of [1, 3, 7]) {
          expect(() =>
            hash(placeholder, {
              algorithm: "argon2id",
              memoryCost: invalid,
            }),
          ).toThrow("Memory cost must be at least 8");
        }

        expect(() =>
          hash(placeholder, {
            algorithm: "argon2id",
            timeCost: -1,
          }),
        ).toThrow();

        expect(() =>
          hash(placeholder, {
            algorithm: "bcrypt",
            cost: -999,
          }),
        ).toThrow();
      });

      test("coercion throwing doesn't crash", () => {
        // @ts-expect-error
        expect(() => hash(Symbol())).toThrow();
        expect(() =>
          // @ts-expect-error
          hash({
            toString() {
              throw new Error("toString() failed");
            },
          }),
        ).toThrow();
      });

      for (let ArrayBufferView of [
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
          expect(() => hash(new ArrayBufferView(0))).toThrow("password must not be empty");
        });
      }
    }
  });
});

describe("verify", () => {
  describe("arguments parsing", () => {
    for (let verify of [password.verify, password.verifySync]) {
      test("minimum args", () => {
        // @ts-expect-error
        expect(() => verify()).toThrow();
        // @ts-expect-error
        expect(() => verify("")).toThrow();
      });

      test("empty values return false", async () => {
        expect(await verify("", "$")).toBeFalse();
        expect(await verify("$", "")).toBeFalse();
      });

      test("invalid algorithm throws", () => {
        // @ts-expect-error
        expect(() => verify(placeholder, "$", "scrpyt")).toThrow();
        // @ts-expect-error
        expect(() => verify(placeholder, "$", 123)).toThrow();
        expect(() =>
          // @ts-expect-error
          verify(placeholder, "$", {
            toString() {
              return "scrypt";
            },
          }),
        ).toThrow();
      });

      test("coercion throwing doesn't crash", () => {
        // @ts-expect-error
        expect(() => verify(Symbol(), Symbol())).toThrow();
        expect(() =>
          verify(
            // @ts-expect-error
            {
              toString() {
                throw new Error("toString() failed");
              },
            },
            "valid",
          ),
        ).toThrow();
        expect(() =>
          // @ts-expect-error
          verify("valid", {
            toString() {
              throw new Error("toString() failed");
            },
          }),
        ).toThrow();
      });

      for (let ArrayBufferView of [
        Uint8Array,
        Uint16Array,
        Uint32Array,
        Int8Array,
        Int16Array,
        Int32Array,
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
    }
  });
});

// The async hashing tests below only await the thread-pooled password.hash /
// password.verify on closure-local inputs (no shared mutable state, no RSS
// assertions), so they can safely overlap.
test.concurrent("bcrypt uses the SHA-512 of passwords longer than 72 characters", async () => {
  const boop = Buffer.from("hey".repeat(100));
  const hashed = await password.hash(boop, "bcrypt");
  expect(await password.verify(boop, hashed, "bcrypt")).toBeTrue();
  const boop2 = Buffer.from("hey".repeat(24));
  expect(await password.verify(boop2, hashed, "bcrypt")).toBeFalse();
});

test.concurrent("bcrypt pre-hashing does not break compatibility across Bun versions", async () => {
  // hash generated by Bun 1.2.4
  // if we change the mechanism used to pre-hash long passwords so bcrypt doesn't truncate them,
  // then this hash will not be considered valid by later versions of Bun.
  const hash = "$2b$10$PsJ3/W82mzNJoP0rSblfvet2ab9jZg2aH7tIxr1B8uFLJwuWk/jTi";
  const secret = "hello".repeat(100);
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
  expect(hashed).toContain("m=8,t=1,p=1");
  expect(await password.verify("test", hashed)).toBeTrue();
});

const defaultAlgorithm = "argon2id";
const algorithms = [undefined, "argon2id", "bcrypt"];
const argons = ["argon2i", "argon2id", "argon2d"];

for (let algorithmValue of algorithms) {
  const prefix = algorithmValue === "bcrypt" ? "$2" : "$" + (algorithmValue || defaultAlgorithm);

  describe(algorithmValue ? algorithmValue : "default", () => {
    const hash = (value: string | TypedArray) => {
      return algorithmValue ? password.hashSync(value, algorithmValue as any) : password.hashSync(value);
    };

    const hashSync = (value: string | TypedArray) => {
      return algorithmValue ? password.hashSync(value, algorithmValue as any) : password.hashSync(value);
    };

    const verify = (pw: string | TypedArray, value: string | TypedArray) => {
      return algorithmValue ? password.verify(pw, value, algorithmValue as any) : password.verify(pw, value);
    };

    const verifySync = (pw: string | TypedArray, value: string | TypedArray) => {
      return algorithmValue ? password.verifySync(pw, value, algorithmValue as any) : password.verifySync(pw, value);
    };

    // Argon2 with the default `interactive_2id` params (64 MiB / 2 iter)
    // is too slow under debug/ASAN to finish inside the per-test timeout;
    // those invocations live in `password sync` (implicit default) and in
    // the `runSlowTest` branch below (explicit default per algorithm). Gate
    // them on release so the rest of the file still exercises the
    // fast-path (bcrypt, arg-parsing, explicit `memoryCost: 8`).
    const isArgonDefaults = algorithmValue === undefined || algorithmValue === "argon2id";
    const skipSlowArgonOnDebug = isDebug && isArgonDefaults;

    for (let input of [placeholder, Buffer.from(placeholder)]) {
      describe(typeof input === "string" ? "string" : "buffer", () => {
        test.skipIf(skipSlowArgonOnDebug)("password sync", () => {
          const hashed = hashSync(input);
          expect(hashed).toStartWith(prefix);
          expect(verifySync(input, hashed)).toBeTrue();
          expect(() => verifySync(hashed, input)).toThrow();
          expect(verifySync(input + "\0", hashed)).toBeFalse();
        });

        describe("password", async () => {
          async function runSlowTest(algorithm = algorithmValue as any) {
            const hashed = await password.hash(input, algorithm);
            const prefix = "$" + algorithm;
            expect(hashed).toStartWith(prefix);
            expect(await password.verify(input, hashed, algorithm)).toBeTrue();
            expect(() => password.verify(hashed, input, algorithm)).toThrow();
            expect(await password.verify(input + "\0", hashed, algorithm)).toBeFalse();
          }

          async function runSlowTestWithOptions(algorithmLabel: any) {
            const algorithm = { algorithm: algorithmLabel, timeCost: 5, memoryCost: 8 };
            const hashed = await password.hash(input, algorithm);
            const prefix = "$" + algorithmLabel;
            expect(hashed).toStartWith(prefix);
            expect(hashed).toContain("t=5");
            expect(hashed).toContain("m=8");
            expect(hashed).toContain("p=1");
            expect(await password.verify(input, hashed, algorithmLabel)).toBeTrue();
            expect(() => password.verify(hashed, input, algorithmLabel)).toThrow();
            expect(await password.verify(input + "\0", hashed, algorithmLabel)).toBeFalse();
          }

          async function runSlowBCryptTest() {
            const algorithm = { algorithm: "bcrypt", cost: 4 } as const;
            const hashed = await password.hash(input, algorithm);
            const prefix = "$" + "2b";
            expect(hashed).toStartWith(prefix);
            expect(await password.verify(input, hashed, "bcrypt")).toBeTrue();
            expect(() => password.verify(hashed, input, "bcrypt")).toThrow();
            expect(await password.verify(input + "\0", hashed, "bcrypt")).toBeFalse();
          }

          if (algorithmValue === defaultAlgorithm) {
            // these tests are very slow
            // run the hashing tests in parallel
            for (const a of argons) {
              // `runSlowTest` uses default params; only `runSlowTestWithOptions`
              // (memoryCost: 8) is fast enough for debug/ASAN.
              test.concurrent(`${a}`, async () => {
                if (!isDebug) await runSlowTest(a);
                await runSlowTestWithOptions(a);
              });
            }
            return;
          }

          async function defaultTest() {
            const hashed = await hash(input);
            expect(hashed).toStartWith(prefix);
            expect(await verify(input, hashed)).toBeTrue();
            expect(() => verify(hashed, input)).toThrow();
            expect(await verify(input + "\0", hashed)).toBeFalse();
          }

          if (algorithmValue === "bcrypt") {
            test.concurrent("bcrypt", async () => {
              await defaultTest();
              await runSlowBCryptTest();
            });
          } else {
            test.skipIf(skipSlowArgonOnDebug)("default", async () => {
              await defaultTest();
            });
          }
        });
      });
    }
  });
}

test("verify rejects encoded argon2 hashes with cost parameters above the supported maximums", async () => {
  // Hash with small, fast parameters so this test stays cheap on debug builds.
  const hashed = password.hashSync("correct horse", {
    algorithm: "argon2id",
    memoryCost: 8,
    timeCost: 1,
  });
  expect(hashed).toContain("$m=8,t=1,p=1$");

  // The untampered hash still verifies.
  expect(password.verifySync("correct horse", hashed)).toBeTrue();

  // A time cost far above the verification ceiling embedded in the encoded
  // hash must be rejected up front instead of being honored.
  const hugeTime = hashed.replace(",t=1,", ",t=100000,");
  expect(hugeTime).not.toBe(hashed);
  expect(() => password.verifySync("correct horse", hugeTime)).toThrow("WeakParameters");
  await expect(password.verify("correct horse", hugeTime)).rejects.toThrow("WeakParameters");

  // A memory cost above the ceiling is rejected before any allocation is
  // sized from the encoded string.
  const hugeMemory = hashed.replace("$m=8,", "$m=4294967294,");
  expect(hugeMemory).not.toBe(hashed);
  expect(() => password.verifySync("correct horse", hugeMemory)).toThrow("WeakParameters");
  await expect(password.verify("correct horse", hugeMemory)).rejects.toThrow("WeakParameters");

  // A parallelism value above the ceiling is rejected as well.
  const hugeParallelism = hashed.replace(",p=1$", ",p=65$");
  expect(hugeParallelism).not.toBe(hashed);
  expect(() => password.verifySync("correct horse", hugeParallelism)).toThrow("WeakParameters");
  await expect(password.verify("correct horse", hugeParallelism)).rejects.toThrow("WeakParameters");
});

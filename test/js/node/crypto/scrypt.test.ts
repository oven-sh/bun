import { expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExeAtLeast, tempDir } from "harness";
import { scrypt, scryptSync } from "node:crypto";
import { join } from "node:path";

// When `crypto.scrypt` fails to allocate the output buffer (OOM for a huge
// `keylen`), `CryptoJob.init` takes the error path. Previously the `errdefer`
// only freed the job allocation and leaked the callback `Strong` plus the
// protected password/salt buffers.
//
// `heapStats().protectedObjectTypeCounts` counts both `protect()`ed values and
// `HandleSet` strong handles, so it catches both the protected input buffers
// and the callback Strong.
//
// Run in a subprocess so that on builds without the synthetic-limit check
// (where the 2 GiB allocation succeeds and scrypt jobs start running) we can
// exit immediately after measuring instead of waiting for them to complete.
test("scrypt async does not leak callback/buffers when output allocation fails", async () => {
  using dir = tempDir("scrypt-oom-leak", {
    "check.js": `
      const crypto = require("node:crypto");
      const { heapStats } = require("bun:jsc");

      function protectedCounts() {
        Bun.gc(true);
        const counts = heapStats().protectedObjectTypeCounts;
        return {
          Function: counts.Function ?? 0,
          Uint8Array: counts.Uint8Array ?? 0,
        };
      }

      const before = protectedCounts();

      let thrown = 0;
      for (let i = 0; i < 50; i++) {
        try {
          crypto.scrypt(Buffer.from("password"), Buffer.from("salt"), 0x7fffffff, function cb() {});
        } catch {
          thrown++;
        }
      }

      const after = protectedCounts();

      console.log(JSON.stringify({ thrown, before, after }));
      process.exit(0);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "check.js"],
    env: { ...bunEnv, BUN_FEATURE_FLAG_SYNTHETIC_MEMORY_LIMIT: String(16 * 1024 * 1024) },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");

  const { thrown, before, after } = JSON.parse(stdout.trim());

  // The error path must have been exercised; if allocation didn't fail,
  // this test isn't measuring anything meaningful.
  expect(thrown).toBe(50);

  // Each failed call previously leaked 1 Function (callback Strong) and
  // 2 Uint8Array (password + salt). With the fix, counts return to baseline.
  expect({
    Function: after.Function - before.Function,
    Uint8Array: after.Uint8Array - before.Uint8Array,
  }).toEqual({
    Function: 0,
    Uint8Array: 0,
  });

  expect(exitCode).toBe(0);
});

test("scrypt copies password and salt before it returns", async () => {
  const password = Buffer.alloc(4096, "p");
  const salt = Buffer.alloc(16, "s");
  const expected = scryptSync(password, salt, 32, { N: 1024 }).toString("hex");
  const results: string[] = [];
  for (let i = 0; i < 20; i++) {
    password.fill("p");
    salt.fill("s");
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    scrypt(password, salt, 32, { N: 1024 }, (err, key) => (err ? reject(err) : resolve(key.toString("hex"))));
    password.fill(0);
    salt.fill(0);
    results.push(await promise);
  }
  expect(results).toEqual(Array(20).fill(expected));
});

test("scrypt doesn't read a resizable ArrayBuffer that shrinks after the call", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const crypto = require("crypto");
        const expected = crypto.scryptSync(Buffer.alloc(65536, 0x41), "salt", 32, { N: 1024 }).toString("hex");
        let wrong = 0;
        for (let i = 0; i < 20; i++) {
          const ab = new ArrayBuffer(65536, { maxByteLength: 1 << 20 });
          new Uint8Array(ab).fill(0x41);
          const { promise, resolve, reject } = Promise.withResolvers();
          crypto.scrypt(new Uint8Array(ab), "salt", 32, { N: 1024 }, (err, key) => (err ? reject(err) : resolve(key.toString("hex"))));
          ab.resize(0);
          if ((await promise) !== expected) wrong++;
        }
        console.log("wrong:", wrong);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("wrong: 0\n");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

test("scryptSync reads its buffers only after every argument has been coerced", () => {
  const passwordBytes = new Uint8Array(64).fill(97);
  const key = scryptSync(passwordBytes, "salt", 16, {
    get N() {
      structuredClone(passwordBytes.buffer, { transfer: [passwordBytes.buffer] });
      Bun.gc(true);
      return 1024;
    },
  });
  expect(passwordBytes.byteLength).toBe(0);
  expect(key).toStrictEqual(scryptSync("", "salt", 16, { N: 1024 }));
});

test("scrypt takes a proxy of a function as its callback", async () => {
  for (const options of [[], [{}]]) {
    const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
    scrypt("p", "s", 4, ...options, new Proxy((err, key) => (err ? reject(err) : resolve(key)), {}));
    expect(await promise).toStrictEqual(scryptSync("p", "s", 4));
  }
});

test("scrypt reports its arguments and options as Node does", () => {
  const received = "Received type string ('x')";
  for (const name of ["N", "cost", "r", "blockSize", "p", "parallelization", "maxmem"]) {
    expect(() => scryptSync("p", "s", 1, { [name]: "x" })).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: `The "${name}" argument must be of type number. ${received}`,
      }),
    );
  }
  // @ts-expect-error
  expect(() => scryptSync("p", "s", "x")).toThrow(`The "keylen" argument must be of type number. ${received}`);
  // @ts-expect-error
  expect(() => scryptSync(5, "s", 1)).toThrow(
    'The "password" argument must be of type string or an instance of ArrayBuffer, Buffer, TypedArray, or DataView. Received type number (5)',
  );
  // @ts-expect-error
  expect(() => scrypt("p", "s", 1, () => {}, 5)).toThrow(
    'The "callback" argument must be of type function. Received type number (5)',
  );
});

test("scrypt passes null as the error of a successful derivation", async () => {
  const { promise, resolve } = Promise.withResolvers<unknown[]>();
  scrypt("password", "salt", 4, { N: 2 }, (...args) => resolve(args));
  expect(await promise).toEqual([null, scryptSync("password", "salt", 4, { N: 2 })]);
});

// Node refuses the second name of an option where it reads it: before it validates what the name holds, before it reads
// a later option, and before it checks the callback. Without a fifth argument, the fourth is the callback.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/crypto/scrypt.js#L40-L50 and #L90-L129
// The fixture prints how each call ends. The expected text is the output of node v26.3.0.
const optionChecksFixture = join(import.meta.dir, "scrypt-option-checks.fixture.js");
const optionChecksExpected = `{ N: 2, cost: "x" }
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "N" cannot be used in combination with option "cost"
{ N: 2, cost: null }
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "N" cannot be used in combination with option "cost"
{ N: 2, cost: -1 }
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "N" cannot be used in combination with option "cost"
{ N: 2, cost: 1.5 }
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "N" cannot be used in combination with option "cost"
{ N: 2, cost: NaN }
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "N" cannot be used in combination with option "cost"
{ N: 2, cost: {} }
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "N" cannot be used in combination with option "cost"
{ N: 2, cost: true }
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "N" cannot be used in combination with option "cost"
{ N: 2, cost: 2 }
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "N" cannot be used in combination with option "cost"
{ N: 0, cost: 2 }
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "N" cannot be used in combination with option "cost"
{ r: 2, blockSize: "x" }
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "r" cannot be used in combination with option "blockSize"
{ r: 2, blockSize: -1 }
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "r" cannot be used in combination with option "blockSize"
{ r: 0, blockSize: null }
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "r" cannot be used in combination with option "blockSize"
{ p: 1, parallelization: "x" }
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "p" cannot be used in combination with option "parallelization"
{ p: 1, parallelization: 1.5 }
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "p" cannot be used in combination with option "parallelization"
{ N: 2, cost: 2, r: "x" }
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "N" cannot be used in combination with option "cost"
{ r: 2, blockSize: 2, p: "x" }
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "r" cannot be used in combination with option "blockSize"
{ p: 1, parallelization: 1, maxmem: -1 }
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "p" cannot be used in combination with option "parallelization"
{ N: 2, cost: 2, r: 2, blockSize: 2 }
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "N" cannot be used in combination with option "cost"
{ N: "x", cost: 2 }
  TypeError [ERR_INVALID_ARG_TYPE]: The "N" argument must be of type number. Received type string ('x')
{ r: 2, blockSize: 2, N: "x" }
  TypeError [ERR_INVALID_ARG_TYPE]: The "N" argument must be of type number. Received type string ('x')
{ p: 1, parallelization: 1, blockSize: -1 }
  RangeError [ERR_OUT_OF_RANGE]: The value of "blockSize" is out of range. It must be >= 0 && <= 4294967295. Received -1
{ cost: "x" }
  TypeError [ERR_INVALID_ARG_TYPE]: The "cost" argument must be of type number. Received type string ('x')
{ blockSize: -1 }
  RangeError [ERR_OUT_OF_RANGE]: The value of "blockSize" is out of range. It must be >= 0 && <= 4294967295. Received -1
{ parallelization: 1.5 }
  RangeError [ERR_OUT_OF_RANGE]: The value of "parallelization" is out of range. It must be an integer. Received 1.5
{ N: 2, r: 1, p: 1 }
  key 48b0d2a8
{ cost: 2, blockSize: 1, parallelization: 1 }
  key 48b0d2a8
{ N: 2, cost: undefined, r: undefined, blockSize: 1, p: 1, parallelization: undefined }
  key 48b0d2a8
scryptSync(p, s, "x", { N: 2, cost: 2 })
  TypeError [ERR_INVALID_ARG_TYPE]: The "keylen" argument must be of type number. Received type string ('x')
  reads: none
scryptSync(p, s, 4, { N: 2, cost: "x", r: 1 })
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "N" cannot be used in combination with option "cost"
  reads: N, cost
scryptSync(p, s, 4, { N: 2, r: 2, blockSize: 2, p: "x" })
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "r" cannot be used in combination with option "blockSize"
  reads: N, cost, r, blockSize
scryptSync(p, s, 4, { N: 2, r: 1, p: 1 })
  key 48b0d2a8
  reads: N, cost, r, blockSize, p, parallelization, maxmem
scrypt(p, s, 4, { N: 2, cost: 2 }, 5)
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "N" cannot be used in combination with option "cost"
  reads: N, cost
scrypt(p, s, 4, { N: 2, cost: "x" }, null)
  TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "N" cannot be used in combination with option "cost"
  reads: N, cost
scrypt(p, s, 4, { N: "x" }, 5)
  TypeError [ERR_INVALID_ARG_TYPE]: The "N" argument must be of type number. Received type string ('x')
  reads: N
scrypt(p, s, 4, { N: 2 }, 5)
  TypeError [ERR_INVALID_ARG_TYPE]: The "callback" argument must be of type function. Received type number (5)
  reads: N, cost, r, blockSize, p, parallelization, maxmem
scrypt(p, s, 4, { N: 2, cost: "x" })
  TypeError [ERR_INVALID_ARG_TYPE]: The "callback" argument must be of type function. Received an instance of Object
  reads: none
scrypt(p, s, 4, { N: 2, cost: "x" }, undefined)
  TypeError [ERR_INVALID_ARG_TYPE]: The "callback" argument must be of type function. Received an instance of Object
  reads: none
scrypt(p, s, 4, 5)
  TypeError [ERR_INVALID_ARG_TYPE]: The "callback" argument must be of type function. Received type number (5)
scrypt(p, s, 4, null)
  TypeError [ERR_INVALID_ARG_TYPE]: The "callback" argument must be of type function. Received null
scrypt(p, s, 4)
  TypeError [ERR_INVALID_ARG_TYPE]: The "callback" argument must be of type function. Received undefined
scrypt(p, s, 4, undefined, callback)
  key 43297877
scrypt(p, s, 4, null, callback)
  key 43297877
scrypt(p, s, 4, callback)
  key 43297877
promisify(scrypt)(p, s, 4, { N: 2, cost: "x" })
  rejects with TypeError [ERR_INCOMPATIBLE_OPTION_PAIR]: Option "N" cannot be used in combination with option "cost"
`;

for (const [name, runtime] of [
  ["bun", bunExe()],
  ["node", nodeExeAtLeast("26.3.0")],
] as const) {
  test.skipIf(!runtime)(`scrypt checks its options and its callback in the order of node v26 (${name})`, async () => {
    await using proc = Bun.spawn({
      cmd: [runtime!, optionChecksFixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: optionChecksExpected, stderr: "", exitCode: 0 });
  });
}

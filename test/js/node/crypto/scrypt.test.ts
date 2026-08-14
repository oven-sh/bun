import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { scryptSync } from "node:crypto";

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

test.each([
  [
    "keylen",
    () => scryptSync("password", "salt", "x" as any),
    `The "keylen" argument must be of type number. Received type string ('x')`,
  ],
  [
    "N",
    () => scryptSync("password", "salt", 16, { N: "x" as any }),
    `The "N" argument must be of type number. Received type string ('x')`,
  ],
  [
    "cost",
    () => scryptSync("password", "salt", 16, { cost: 1n as any }),
    `The "cost" argument must be of type number. Received type bigint (1n)`,
  ],
])("scryptSync reports a non-numeric %s with node's ERR_INVALID_ARG_TYPE message", (_, fn, message) => {
  expect(fn).toThrow(expect.objectContaining({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message }));
});

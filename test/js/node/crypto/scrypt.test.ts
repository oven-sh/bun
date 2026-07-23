import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import crypto from "node:crypto";

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

// Async `crypto.scrypt` snapshots its password/salt at submission time. Safe JS
// can back either input with a resizable ArrayBuffer and resize it to zero
// before the worker runs; the derived key must still match the originally
// submitted bytes (matching Node) instead of reading a stale descriptor.
const SCRYPT_OPTS = { N: 16, r: 8, p: 1 };

test("scrypt async snapshots a resizable-ArrayBuffer-backed password", async () => {
  const salt = Buffer.alloc(16, 0x42);
  const rab = new ArrayBuffer(1024, { maxByteLength: 1024 });
  const password = new Uint8Array(rab);
  password.fill(0x41);
  const original = Buffer.from(password);
  const expected = crypto.scryptSync(original, salt, 64, SCRYPT_OPTS);

  const { promise, resolve, reject } = Promise.withResolvers();
  crypto.scrypt(password, salt, 64, SCRYPT_OPTS, (err, key) => (err ? reject(err) : resolve(key)));
  rab.resize(0);

  const key = await promise;
  expect(rab.byteLength).toBe(0);
  expect(key).toEqual(expected);
});

test("scrypt async snapshots the active region of a RAB-backed password view", async () => {
  const salt = Buffer.alloc(16, 0x42);
  const rab = new ArrayBuffer(256, { maxByteLength: 256 });
  const full = new Uint8Array(rab);
  for (let i = 0; i < full.length; i++) full[i] = i & 0xff;

  // Non-zero byteOffset, length < backing: the snapshot must be the view's
  // active region, not the whole ArrayBuffer.
  const password = new Uint8Array(rab, 64, 100);
  const original = Buffer.from(password);
  const expected = crypto.scryptSync(original, salt, 64, SCRYPT_OPTS);

  const { promise, resolve, reject } = Promise.withResolvers();
  crypto.scrypt(password, salt, 64, SCRYPT_OPTS, (err, key) => (err ? reject(err) : resolve(key)));
  rab.resize(0);

  const key = await promise;
  expect(key).toEqual(expected);
});

test("scrypt async snapshots a resizable-ArrayBuffer-backed salt", async () => {
  const password = Buffer.alloc(64, 0x41);
  const rab = new ArrayBuffer(16, { maxByteLength: 16 });
  const salt = new Uint8Array(rab);
  salt.fill(0x42);
  const original = Buffer.from(salt);
  const expected = crypto.scryptSync(password, original, 64, SCRYPT_OPTS);

  const { promise, resolve, reject } = Promise.withResolvers();
  crypto.scrypt(password, salt, 64, SCRYPT_OPTS, (err, key) => (err ? reject(err) : resolve(key)));
  rab.resize(0);

  const key = await promise;
  expect(rab.byteLength).toBe(0);
  expect(key).toEqual(expected);
});

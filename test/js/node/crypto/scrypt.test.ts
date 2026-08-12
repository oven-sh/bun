import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, runParkedFixture, tempDir } from "harness";
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

// Reads parked on stdin hold both pool threads, so the derivation only runs
// once the parent answers "ready" -- after the memory has grown. On Windows
// fs.read runs on libuv's pool and would not hold the derivation back.
test.concurrent.skipIf(isWindows)(
  "scrypt async derives from the bytes a WebAssembly.Memory view held when the memory grows mid-call",
  async () => {
    using dir = tempDir("scrypt-wasm-memory-view", {
      "fixture.mjs": /* js */ `
      import fs from "node:fs";
      import { scrypt } from "node:crypto";
      const call = (fn, ...args) =>
        new Promise((resolve, reject) => fn(...args, (err, n) => (err ? reject(err) : resolve(n))));
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 4 });
      const password = new Uint8Array(memory.buffer, 128, 32).fill(0x61);
      const parked = Array.from({ length: 3 }, () => call(fs.read, 0, Buffer.alloc(16), 0, 16, null));
      process.stdout.write("park\\n");
      await Promise.race(parked);
      const derived = call(scrypt, password, "salt", 16, { N: 1024 });
      memory.grow(1);
      const others = Array.from({ length: 8 }, () => new WebAssembly.Memory({ initial: 1, maximum: 4 }));
      for (const m of others) new Uint8Array(m.buffer).fill(0x62);
      process.stdout.write("ready\\n");
      await Promise.all(parked);
      console.log(JSON.stringify({ detached: password.byteLength === 0, key: (await derived).toString("hex") }));
    `,
    });
    const { report, stderr, exitCode } = await runParkedFixture({
      cmd: [bunExe(), "fixture.mjs"],
      cwd: String(dir),
      readyBytes: 32,
    });
    expect(stderr).toBe("");
    expect(report).toEqual({
      detached: true,
      key: scryptSync(Buffer.alloc(32, "a"), "salt", 16, { N: 1024 }).toString("hex"),
    });
    expect(exitCode).toBe(0);
  },
);

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

// `WebAssembly.Memory` hands out an ArrayBuffer over its own block, and `grow()`
// detaches that buffer whatever its pin count. So the pin `scrypt` takes on the
// password does not keep the pages mapped for the pool thread: a bounds-checked
// memory allocates a new block and frees the old one at once.
//
// Run in a child: on an unfixed build the pool thread reads another object's
// memory (wrong key) or faults.
test("scrypt copies a password over a WebAssembly.Memory that grows after the call", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      /* js */ `
      import { scrypt, scryptSync } from "node:crypto";
      const PAGES = 4; // 256 KB
      const newMemory = () => new WebAssembly.Memory({ initial: PAGES, maximum: PAGES + 4 });

      const mem = newMemory();
      const password = new Uint8Array(mem.buffer).fill(7);
      const options = { N: 1024, r: 1, p: 1 };
      const expected = scryptSync(Buffer.from(password), "salt", 32, options).toString("hex");

      const { promise, resolve } = Promise.withResolvers();
      scrypt(password, "salt", 32, options, (err, key) => resolve(err ? String(err) : key.toString("hex")));
      mem.grow(2);
      // Claim the freed block, so that reading it cannot see the caller's bytes.
      const claim = Array.from({ length: 2 }, () => {
        const memory = newMemory();
        new Uint8Array(memory.buffer).fill(0xee);
        return memory;
      });

      console.log(JSON.stringify({ detachedAfterGrow: password.byteLength === 0, keyMatches: (await promise) === expected }));
    `,
    ],
    // `useWasmFastMemory=0` makes every memory bounds-checked, so `grow()`
    // moves the block on every platform instead of committing pages in place.
    // `Malloc=1` makes WebKit use system malloc, so the freed block is
    // unmapped instead of kept in bmalloc's cache: the unfixed build faults
    // instead of reading stale bytes.
    env: { ...bunEnv, BUN_JSC_useWasmFastMemory: "0", Malloc: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe(JSON.stringify({ detachedAfterGrow: true, keyMatches: true }));
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

// A fast memory grows in place, so its block does not move. It still needs the
// copy: `grow()` detaches the view the job roots, so nothing the job holds keeps
// the memory alive, and a collection releases its pages under the job. One
// memory in the whole process is enough.
test("scrypt copies a password over a WebAssembly.Memory that is collected after it grows", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      /* js */ `
      import { scrypt } from "node:crypto";
      import { promisify } from "node:util";
      const derive = promisify(scrypt);
      // Costly enough that the job is still running when the memory is collected.
      const options = { N: 4096, r: 8, p: 1 };

      let fromMemory, fromCopy;
      function task() {
        const mem = new WebAssembly.Memory({ initial: 16, maximum: 32 });
        const password = new Uint8Array(mem.buffer).fill(7);
        fromCopy = derive(Buffer.from(password), "salt", 32, options);
        fromMemory = derive(password, "salt", 32, options);
        mem.grow(1);
      }
      task();
      // A fresh stack, so that no slot of task() still names the memory.
      await new Promise(resolve => setImmediate(resolve));
      Bun.gc(true);

      const [a, b] = await Promise.all([fromMemory, fromCopy]);
      console.log(JSON.stringify({ keyMatches: a.equals(b) }));
    `,
    ],
    // No `useWasmFastMemory=0` here: the one memory has to be a fast one.
    // `Malloc=1` makes WebKit use system malloc, so the collected memory's
    // pages are unmapped instead of kept in bmalloc's cache.
    env: { ...bunEnv, Malloc: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout.trim()).toBe(JSON.stringify({ keyMatches: true }));
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

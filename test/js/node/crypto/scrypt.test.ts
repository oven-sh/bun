import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { scrypt, scryptSync } from "node:crypto";

// When `crypto.scrypt` fails to allocate the output buffer (OOM for a huge
// `keylen`), the call takes the error path. It once leaked the callback
// `Strong` there, and the password/salt buffers that the job `protect()`ed at
// the time. The job copies its inputs now, so a buffer can no longer be
// protected; the Uint8Array count guards that this stays so.
//
// `heapStats().protectedObjectTypeCounts` counts both `protect()`ed values and
// `HandleSet` strong handles.
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

  // Each failed call once leaked 1 Function (callback Strong) and 2 Uint8Array
  // (password + salt). Counts must stay at baseline.
  expect({
    Function: after.Function - before.Function,
    Uint8Array: after.Uint8Array - before.Uint8Array,
  }).toEqual({
    Function: 0,
    Uint8Array: 0,
  });

  expect(exitCode).toBe(0);
});

test("scrypt copies password and salt at call time, so the caller can zero them right after the call", async () => {
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

test("scrypt copies its buffers only after every argument has been coerced", async () => {
  const passwordBytes = new Uint8Array(64).fill(97);
  const { promise, resolve, reject } = Promise.withResolvers<Buffer>();
  scrypt(
    passwordBytes,
    "salt",
    16,
    {
      get N() {
        structuredClone(passwordBytes.buffer, { transfer: [passwordBytes.buffer] });
        Bun.gc(true);
        return 1024;
      },
    },
    (err, key) => (err ? reject(err) : resolve(key)),
  );
  expect(passwordBytes.byteLength).toBe(0);
  expect(await promise).toStrictEqual(scryptSync("", "salt", 16, { N: 1024 }));
});

test("scrypt does not read a resizable ArrayBuffer that shrinks after the call", async () => {
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

test("scrypt copies its buffers after an option getter resized them to 0", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const crypto = require("crypto");
        const expected = crypto.scryptSync("", "", 16, { N: 1024 }).toString("hex");
        const password = new Uint8Array(new ArrayBuffer(65536, { maxByteLength: 65536 })).fill(0x41);
        const salt = new Uint8Array(new ArrayBuffer(65536, { maxByteLength: 65536 })).fill(0x42);
        const options = {
          get N() {
            password.buffer.resize(0);
            salt.buffer.resize(0);
            return 1024;
          },
        };
        crypto.scrypt(password, salt, 16, options, (err, key) => {
          if (err) throw err;
          console.log(key.toString("hex") === expected ? "ok" : "wrong");
        });
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("ok\n");
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

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

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

// `StringOrBuffer::from_js` borrowed the password/salt view, then a later
// argument's getter ran `ArrayBuffer.prototype.resize(0)`, which mprotects
// the trimmed pages PROT_NONE while the borrowed slice still spans them;
// reading it SIGSEGVs. `pin()` only guards `transfer()`, so resizable
// non-shared inputs are now snapshotted at capture time.
test("scrypt reads resizable ArrayBuffer inputs at capture time even if a later arg resizes them", async () => {
  const script = `
    const crypto = require("node:crypto");
    const SIZE = 1 << 16;
    const fixed = b => Buffer.alloc(SIZE, b);
    const resizable = b => new Uint8Array(new ArrayBuffer(SIZE, { maxByteLength: SIZE })).fill(b);

    const fullPw   = crypto.scryptSync(fixed(0x41), fixed(0x42).subarray(0, 16), 16, { N: 1024 }).toString("hex");
    const fullSalt = crypto.scryptSync(fixed(0x41).subarray(0, 16), fixed(0x42), 16, { N: 1024 }).toString("hex");

    const out = {};

    // sync: options.N getter resizes the captured password to 0.
    {
      const pw = resizable(0x41);
      out.syncPw = crypto.scryptSync(pw, fixed(0x42).subarray(0, 16), 16, {
        get N() { pw.buffer.resize(0); return 1024; },
      }).toString("hex") === fullPw;
    }
    // sync: options.N getter resizes the captured salt to 0.
    {
      const salt = resizable(0x42);
      out.syncSalt = crypto.scryptSync(fixed(0x41).subarray(0, 16), salt, 16, {
        get N() { salt.buffer.resize(0); return 1024; },
      }).toString("hex") === fullSalt;
    }
    // async: JS thread resizes the password after the job is queued.
    {
      const pw = resizable(0x41);
      const p = new Promise((res, rej) =>
        crypto.scrypt(pw, fixed(0x42).subarray(0, 16), 16, { N: 1024 }, (e, k) => e ? rej(e) : res(k)));
      pw.buffer.resize(0);
      out.asyncPw = (await p).toString("hex") === fullPw;
    }
    // zero-length resizable input stays zero-length.
    {
      const pw = new Uint8Array(new ArrayBuffer(0, { maxByteLength: SIZE }));
      out.syncEmpty = crypto.scryptSync(pw, fixed(0x42).subarray(0, 16), 16, { N: 1024 }).toString("hex")
        === crypto.scryptSync(Buffer.alloc(0), fixed(0x42).subarray(0, 16), 16, { N: 1024 }).toString("hex");
    }
    // growable SharedArrayBuffer is not snapshotted (grow-only, reading the
    // captured extent stays valid) but still derives the same key.
    {
      const pw = new Uint8Array(new SharedArrayBuffer(SIZE, { maxByteLength: 2 * SIZE })).fill(0x41);
      out.sab = crypto.scryptSync(pw, fixed(0x42).subarray(0, 16), 16, { N: 1024 }).toString("hex") === fullPw;
    }

    // regression guard: passing a resizable output buffer to Bun.SHA256.hash
    // still writes into the caller's buffer, not a private copy.
    {
      const dst = new Uint8Array(new ArrayBuffer(32, { maxByteLength: 64 }));
      const ret = Bun.SHA256.hash(fixed(0x41).subarray(0, 5), dst);
      const want = Bun.SHA256.hash(fixed(0x41).subarray(0, 5));
      out.hashOutput = ret === dst && Buffer.from(dst).equals(Buffer.from(want));
    }

    console.log(JSON.stringify(out));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(JSON.parse(stdout.trim())).toEqual({
    syncPw: true,
    syncSalt: true,
    asyncPw: true,
    syncEmpty: true,
    sab: true,
    hashOutput: true,
  });
  expect(exitCode).toBe(0);
});

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import crypto from "node:crypto";

// scryptSync captures the password/salt slice before reading the options bag.
// A hostile getter on `N`/`r`/`p`/`maxmem` can detach the captured buffer and
// recycle its backing, so the key ends up derived from freed memory instead of
// the caller's bytes. The sync Buffer arm now pins the backing so transfer()
// copies instead of freeing while the borrow is live.
test("scryptSync derives from the password bytes at call time when an options getter detaches the buffer", () => {
  const keep: Uint8Array[] = [];
  const size = 1 << 16;
  const mk = (b: number) => {
    const x = Buffer.from(new ArrayBuffer(size));
    x.fill(b);
    return x;
  };

  const pw = mk(0x41);
  const salt = mk(0x41);
  const got = crypto
    .scryptSync(pw, salt, 16, {
      get N() {
        pw.buffer.transfer(0);
        salt.buffer.transfer(0);
        Bun.gc(true);
        for (let i = 0; i < 96; i++) {
          const x = new Uint8Array(size);
          x.fill(0x5a);
          keep.push(x);
        }
        Bun.gc(true);
        return 1024;
      },
    })
    .toString("hex");

  const expected = crypto.scryptSync(mk(0x41), mk(0x41), 16, { N: 1024 }).toString("hex");
  const recycled = crypto.scryptSync(mk(0x5a), mk(0x5a), 16, { N: 1024 }).toString("hex");

  expect({ got, matchesRecycled: got === recycled }).toEqual({ got: expected, matchesRecycled: false });
});

test("scryptSync releases its pin on the input buffers when it returns", () => {
  const pw = Buffer.from(new ArrayBuffer(64));
  const salt = Buffer.from(new ArrayBuffer(64));
  crypto.scryptSync(pw, salt, 16, { N: 1024 });
  // With the pin released, transfer() detaches the source again.
  pw.buffer.transfer(0);
  salt.buffer.transfer(0);
  expect({ pw: pw.buffer.detached, salt: salt.buffer.detached }).toEqual({ pw: true, salt: true });
});

test("scryptSync derives from the password bytes at call time when a String-object salt detaches them", () => {
  const keep: Uint8Array[] = [];
  const size = 1 << 16;
  const pw = Buffer.from(new ArrayBuffer(size));
  pw.fill(0x41);
  const saltStr = Buffer.alloc(32, 0x41).toString();

  class DetachingSalt extends String {
    toString() {
      pw.buffer.transfer(0);
      Bun.gc(true);
      for (let i = 0; i < 96; i++) {
        const x = new Uint8Array(size);
        x.fill(0x5a);
        keep.push(x);
      }
      Bun.gc(true);
      return saltStr;
    }
  }

  const got = crypto.scryptSync(pw, new DetachingSalt(saltStr) as any, 16, { N: 1024 }).toString("hex");
  const expected = crypto
    .scryptSync(Buffer.alloc(size, 0x41), saltStr, 16, { N: 1024 })
    .toString("hex");

  expect(got).toBe(expected);
});

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

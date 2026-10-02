import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test for a re-entrancy bug in the native zlib/brotli/zstd
// handle's emitError(): it used to clear `write_in_progress = false`
// *after* invoking the onerror callback. If that callback issued a new
// async write() (which sets write_in_progress=true and schedules a
// WorkPool task) followed by close(), the post-callback clear clobbered
// the flag and let closeInternal() free the native stream state while a
// task was still queued — the worker thread then ran doWork() on freed
// brotli/zstd/zlib state (use-after-free / `unreachable` panic).
//
// Correct behaviour: the close is deferred until the pending write
// completes, and the second (re-entrant) write's error is delivered, so
// onerror fires exactly twice.

describe("zlib native handle onerror re-entrancy", () => {
  const fixture = /* js */ `
    const zlib = require("zlib");

    const stream = zlib.createBrotliDecompress();
    const handle = stream._handle;

    const badInput = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    const out = Buffer.alloc(1024);
    const FINISH = zlib.constants.BROTLI_OPERATION_FINISH;

    let calls = 0;
    handle.onerror = function (msg, errno, code) {
      calls++;
      if (calls > 1) return;
      // Re-entrant async write from inside onerror.
      this.write(FINISH, badInput, 0, badInput.length, out, 0, out.length);
      // Request close while the re-entrant write is pending. closeInternal()
      // must defer until that write completes.
      this.close();
    };

    handle.write(FINISH, badInput, 0, badInput.length, out, 0, out.length);

    process.on("exit", () => {
      process.stdout.write("calls=" + calls + "\\n");
    });
  `;

  // Run as a subprocess so a crash/SIGILL/SIGSEGV shows up as a non-zero
  // exit code rather than taking down the test runner. The behaviour was
  // timing-dependent (sometimes a worker-thread panic, sometimes a silently
  // dropped write), so exercise it a few times.
  for (let i = 0; i < 3; i++) {
    test.concurrent(`re-entrant write()+close() from onerror completes both writes (iteration ${i})`, async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      // Both writes error, so onerror must fire twice. Before the fix the
      // second write's completion was swallowed (or the process crashed) and
      // this was "calls=1" at best.
      expect(stdout).toBe("calls=2\n");
      expect(exitCode).toBe(0);
    });
  }
});

// A failed init() calls onerror before it throws. The handle is closed by
// then, so nothing the callback does reaches a handle that has no context.
describe.concurrent("zlib native handle onerror during a failed init()", () => {
  const prelude = /* js */ `
    const zlib = require("zlib");
    const show = fn => { try { return "returned " + fn(); } catch (e) { return "threw " + e.code + ": " + e.message; } };
    const h = new (zlib.createZstdDecompress()._handle.constructor)(11);
    const badDictionary = Buffer.from([0x37, 0xa4, 0x30, 0xec, 1, 2, 3, 4, 5, 6, 7, 8]);
    const init = onWrite => h.init(new Uint32Array(0), undefined, new Uint32Array(2), onWrite, badDictionary);
  `;
  const INIT_FAILED = "threw ERR_ZLIB_INITIALIZATION_FAILED: Failed to load zstd dictionary";
  const CLOSED = "threw ERR_INVALID_STATE: zlib binding closed";

  async function run(body: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", prelude + body],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim().split("\n"), exitCode };
  }

  test("init(), writeSync(), write() and close() from onerror", async () => {
    const result = await run(/* js */ `
      const out = new Uint8Array(64);
      let writeCallbacks = 0;
      const inside = [];
      h.onerror = function () {
        inside.push("init: " + show(() => this.init(new Uint32Array(0), undefined, new Uint32Array(2), () => {})));
        inside.push("writeSync: " + show(() => this.writeSync(0, null, 0, 0, out, 0, 64)));
        inside.push("write: " + show(() => this.write(0, null, 0, 0, out, 0, 64)));
        inside.push("close: " + show(() => this.close()));
      };
      console.log("outer: " + show(() => init(() => writeCallbacks++)));
      console.log(inside.join("\\n"));
      process.on("exit", () => console.log("write callbacks: " + writeCallbacks));
    `);
    expect(result).toEqual({
      stdout: [
        `outer: ${INIT_FAILED}`,
        `init: ${CLOSED}`,
        `writeSync: ${CLOSED}`,
        `write: ${CLOSED}`,
        "close: returned undefined",
        "write callbacks: 0",
      ],
      exitCode: 0,
    });
  });

  test("an onerror that throws does not replace the init error", async () => {
    const result = await run(/* js */ `
      process.on("uncaughtException", () => {});
      h.onerror = () => { throw new Error("from onerror"); };
      console.log(show(() => init(() => {})));
    `);
    expect(result).toEqual({ stdout: [INIT_FAILED], exitCode: 0 });
  });
});

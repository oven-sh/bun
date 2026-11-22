import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";

const withoutAsanWarning = (stderr: string) =>
  stderr
    .split("\n")
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");

// When a child process exits while its stdout/stderr pipe still has pending
// activity, onProcessExit keeps the Subprocess JSRef Strong. The pipe later
// drains and PipeReader.on_read_result → Subprocess.on_output_read converts the
// Readable from `.pipe` to `.buffer`, but previously did not call
// updateHasPendingActivity(), so the JSRef stayed Strong forever and the
// JSSubprocess (plus its buffered output) leaked.
//
// To reproduce deterministically we need the stdout drain to complete
// asynchronously, *after* onProcessExit returns. On POSIX the read() issued
// from onProcessExit normally drains the pipe to EOF synchronously, so we
// force EAGAIN by having a grandchild inherit stdout and keep the write end
// open past the direct child's exit. The exit notification then arrives
// while the pipe is still pending, and on_output_read runs later from the event
// loop — the path that leaked.
//
// Windows uses a different pipe/process model; the scenario is POSIX-shaped.
test.skipIf(isWindows)(
  "Subprocess is collectable when stdout pipe drains asynchronously after process exit",
  async () => {
    const script = /* js */ `
      let collected = 0;
      const registry = new FinalizationRegistry(() => {
        collected++;
      });

      const ITERS = 10;

      // The child spawns a detached grandchild that inherits stdout and writes
      // after a short delay, then the child exits immediately. The grandchild
      // keeps the write end of the pipe open past the child's exit, so
      // onProcessExit's read() hits EAGAIN and the drain completes later.
      const childScript =
        "const { spawn } = require('child_process');" +
        "spawn(process.execPath, ['-e', 'setTimeout(() => process.stdout.write(Buffer.alloc(1024, 88)), 30)']," +
        "  { stdio: ['ignore', 'inherit', 'ignore'], detached: true }).unref();";

      async function once() {
        const proc = Bun.spawn({
          cmd: [process.execPath, "-e", childScript],
          env: process.env,
          stdout: "pipe",
          stderr: "ignore",
          stdin: "ignore",
        });
        await proc.exited;
        // Intentionally never touch proc.stdout — on_output_read will convert the
        // pipe to a buffered Readable that nobody references.
        registry.register(proc, undefined);
      }

      for (let i = 0; i < ITERS; i++) {
        await once();
      }

      // Give grandchildren time to write, exit, and for the pipes to reach
      // EOF and fire on_read_result → on_output_read on the event loop. Then GC.
      // Under release-ASAN each grandchild is itself a full \`bun -e\` process
      // with ASAN startup + LSan-exit overhead; the loop exits as soon as all
      // are collected, so the upper bound only affects the failing case.
      for (let i = 0; i < 400 && collected < ITERS; i++) {
        await Bun.sleep(50);
        Bun.gc(true);
      }

      console.log(JSON.stringify({ collected, iters: ITERS }));
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(withoutAsanWarning(stderr)).toBe("");
    const { collected, iters } = JSON.parse(stdout.trim());
    // Without the fix, ZERO Subprocess wrappers are collected because their
    // JSRef is never downgraded. With the fix they are all collectable. We
    // accept any nonzero count as proof the mechanism works — under release-
    // ASAN each grandchild's LSan-exit can outlast the poll window, so an
    // exact-10 assertion is a wall-clock race, not a correctness check.
    expect(collected).toBeGreaterThan(0);
    expect(iters).toBe(10);
    expect(exitCode).toBe(0);
  },
  120_000,
);

// Output that nobody reads stays in native memory until the object that holds it is collected: the Subprocess,
// or the source of the stream that `stdout` or `stderr` returned. JSC paces its collections by the bytes it counts
// (`heapStats().extraMemorySize`), so each of those objects has to report them. One process per scenario, and
// the only collections are the ones the scenario asks for.
describe.concurrent("the collector counts a child's output that nobody has read", () => {
  const size = 8 * 1024 * 1024;
  /** What a scenario makes JSC count beside the output: a struct, a promise, its own strings. */
  const slack = 256 * 1024;

  async function scenario(name: string, output: "stdout" | "stderr" = "stdout", env: Record<string, string> = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "spawn-unread-output-counted-fixture.ts"), name, output, String(size)],
      env: { ...bunEnv, BUN_GC_TIMER_DISABLE: "1", ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(withoutAsanWarning(stderr)).toBe("");
    return { ...JSON.parse(stdout), exitCode };
  }

  test("as the Subprocess's while nothing touches it", async () => {
    const { held, exitCode } = await scenario("never");
    expect(held).toBeWithin(size, size + slack);
    expect(exitCode).toBe(0);
  });

  // These are the reports that let JSC see a Subprocess which it does not visit again before a full collection.
  test.each(["owner", "lateExited", "ipc"])("when it ends after the Subprocess has become old: %s", async name => {
    const { held, exitCode } = await scenario(name);
    expect(held).toBeWithin(size, size + slack);
    expect(exitCode).toBe(0);
  });

  // A grandchild that holds the pipe is a POSIX shape, as in the test at the top of this file.
  test.skipIf(isWindows)("when it ends after the exit of the child", async () => {
    using dir = tempDir("spawn-unread-output-late-eof", {});
    const { held, exitCode } = await scenario("lateEof", "stdout", { LATE_EOF_MARKER: join(String(dir), "write") });
    expect(held).toBeWithin(size, size + slack);
    expect(exitCode).toBe(0);
  });

  test("when `await using` ends the child of an old Subprocess", async () => {
    const { held, exitCode } = await scenario("lateDispose");
    expect(held).toBeWithin(size / 2, size + slack);
    expect(exitCode).toBe(0);
  });

  test("once, for stdout and stderr together", async () => {
    const { held, afterFullGC, exitCode } = await scenario("both");
    expect(held).toBeWithin(2 * size, 2 * size + slack);
    expect(afterFullGC).toBeWithin(2 * size, 2 * size + slack);
    expect(exitCode).toBe(0);
  });

  test("not twice when the script reads it as it hears of the exit", async () => {
    const { held, read, exitCode } = await scenario("readAtExit");
    expect(read).toBe(size);
    expect(held).toBeWithin(size, size + slack);
    expect(exitCode).toBe(0);
  });

  test("not while its pipe is still open", async () => {
    const { held, afterFullGC, exitCode } = await scenario("inFlight");
    expect(held).toBeLessThan(slack);
    expect(afterFullGC).toBeLessThan(slack);
    expect(exitCode).toBe(0);
  });

  test.each([
    ["touchEarly", "stdout"],
    ["touchLate", "stdout"],
    ["touchLate", "stderr"],
  ] as const)("as the stream source's after it is read as a property: %s of %s", async (name, output) => {
    const { held, read, afterRead, exitCode } = await scenario(name, output);
    expect(held).toBeWithin(size, size + slack);
    // An ASAN build writes a warning to the stderr of the child.
    expect(read).toBeWithin(size, size + slack);
    expect(afterRead).toBeLessThan(slack);
    expect(exitCode).toBe(0);
  });

  test("so a loop of spawns is collected with no collection forced", async () => {
    expect(await scenario("loop")).toEqual({ collected: true, exitCode: 0 });
  });

  test("once for spawnSync, whose output is a Buffer", async () => {
    const { held, read, exitCode } = await scenario("sync");
    expect(read).toBe(size);
    expect(held).toBeWithin(size, size + slack);
    expect(exitCode).toBe(0);
  });

  test("not again for the stream of a Blob, which counts its own bytes", async () => {
    const { held, exitCode } = await scenario("blob");
    expect(held).toBeLessThan(slack);
    expect(exitCode).toBe(0);
  });
});

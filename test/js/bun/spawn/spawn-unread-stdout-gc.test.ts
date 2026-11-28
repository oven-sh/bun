import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

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

    const stderrLines = stderr
      .split("\n")
      .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
      .join("\n");
    expect(stderrLines).toBe("");
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

// The first read of `stdout` or `stderr` turns the pipe into a stream and takes it away from the Subprocess, so the
// end of the pipe is no longer seen there. When the child had exited and the pipe was still open, that end was the
// only thing left that would let go of the wrapper.
describe.concurrent("Subprocess is collectable when the first read of the property comes after the exit", () => {
  async function run(script: string, env: Record<string, string | undefined>) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const stderrLines = stderr
      .split("\n")
      .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
      .join("\n");
    expect(stderrLines).toBe("");
    return { ...JSON.parse(stdout), exitCode };
  }

  const collect = /* js */ `
    for (const deadline = performance.now() + 2500; collected < ITERS && performance.now() < deadline; ) {
      Bun.gc(true);
      await Bun.sleep(10);
    }
  `;

  // A process other than the child holds the pipe open past the exit, which is how POSIX gets this order every time.
  test.skipIf(isWindows).each(["stdout", "stderr"])("%s, while another process holds the pipe", async output => {
    using dir = tempDir("spawn-late-getter", {});
    const script = /* js */ `
      const { writeFileSync } = require("node:fs");
      const { OUTPUT: output, MARKER_DIR: dir } = process.env;
      let collected = 0;
      const registry = new FinalizationRegistry(() => {
        collected++;
      });
      const ITERS = 10;

      // sh starts a holder in the background and exits. The holder inherits the pipe, waits for its marker
      // (5 s at most, so that nothing outlives a test that died), writes, and exits.
      const holder =
        '( i=0; while [ ! -e "$0" ] && [ $i -lt 250 ]; do sleep 0.02; i=$((i+1)); done; [ -e "$0" ] && printf held )' +
        (output === "stderr" ? " >&2 &" : " &");

      let readAfterGetter = 0;
      async function once(i) {
        const marker = dir + "/" + i;
        const proc = Bun.spawn({
          cmd: ["/bin/sh", "-c", holder, marker],
          stdin: "ignore",
          stdout: output === "stdout" ? "pipe" : "ignore",
          stderr: output === "stderr" ? "pipe" : "ignore",
        });
        registry.register(proc, undefined);
        await proc.exited;
        const stream = proc[output];
        // The holder writes only now, so what the stream reads shows that the pipe was open at the getter.
        writeFileSync(marker, "");
        if ((await stream.text()) === "held") readAfterGetter++;
      }

      for (let i = 0; i < ITERS; i++) {
        await once(i);
      }
      ${collect}
      console.log(JSON.stringify({ readAfterGetter, collected }));
    `;

    // The CI runner sets BUN_FEATURE_FLAG_NO_ORPHANS on ASAN lanes, which kills the holder the moment sh exits.
    expect(
      await run(script, { OUTPUT: output, MARKER_DIR: String(dir), BUN_FEATURE_FLAG_NO_ORPHANS: undefined }),
    ).toEqual({ readAfterGetter: 10, collected: 10, exitCode: 0 });
  });

  // Windows reports the exit before the end of the pipe with no second process (#44976). POSIX reads the pipe to
  // its end as it handles the exit, so there this case passed before the fix too.
  test.each(["stdout", "stderr"])("%s, with no other holder of the pipe", async output => {
    const script = /* js */ `
      const { OUTPUT: output } = process.env;
      let collected = 0;
      const registry = new FinalizationRegistry(() => {
        collected++;
      });
      const ITERS = 6;

      async function once() {
        const proc = Bun.spawn({
          cmd: [process.execPath, "-e", "process." + output + ".write('late')"],
          env: process.env,
          stdin: "ignore",
          stdout: output === "stdout" ? "pipe" : "ignore",
          stderr: output === "stderr" ? "pipe" : "ignore",
        });
        registry.register(proc, undefined);
        await proc.exited;
        // An ASAN build writes a warning to stderr first.
        return (await proc[output].text()).endsWith("late");
      }

      const read = (await Promise.all(Array.from({ length: ITERS }, once))).filter(Boolean).length;
      ${collect}
      console.log(JSON.stringify({ read, collected }));
    `;

    expect(await run(script, { OUTPUT: output })).toEqual({ read: 6, collected: 6, exitCode: 0 });
  });
});

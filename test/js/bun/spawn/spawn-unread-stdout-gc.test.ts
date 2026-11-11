import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// When a child process exits while its stdout/stderr pipe still has pending
// activity, onProcessExit keeps the Subprocess JSRef Strong. The pipe later
// drains and PipeReader.onReaderDone → Subprocess.onCloseIO converts the
// Readable from `.pipe` to `.buffer`, but previously did not call
// updateHasPendingActivity(), so the JSRef stayed Strong forever and the
// JSSubprocess (plus its buffered output) leaked.
//
// To reproduce deterministically we need the stdout drain to complete
// asynchronously, *after* onProcessExit returns. On POSIX the read() issued
// from onProcessExit normally drains the pipe to EOF synchronously, so we
// force EAGAIN by having a grandchild inherit stdout and keep the write end
// open past the direct child's exit. The exit notification then arrives
// while the pipe is still pending, and onCloseIO runs later from the event
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
        // Intentionally never touch proc.stdout — onCloseIO will convert the
        // pipe to a buffered Readable that nobody references.
        registry.register(proc, undefined);
      }

      for (let i = 0; i < ITERS; i++) {
        await once();
      }

      // Give grandchildren time to write, exit, and for the pipes to reach
      // EOF and fire onReaderDone → onCloseIO on the event loop. Then GC.
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

// Same pending pipe at exit, but the stream is first read off the Subprocess
// before the pipe reaches EOF. That detaches the pipe from the Subprocess, so
// its EOF no longer re-evaluates the wrapper: the getter has to.
//
// The background `cat` holds stdout and stderr open until its stdin ends. Bun
// closes that stdin while it handles the child's exit, after the read that has
// to find the pipes still open, so no timing is involved. (A shell gives a
// background job /dev/null for stdin, hence the dup.)
test.skipIf(isWindows).concurrent.each([
  {
    name: "stdout after exited",
    body: `const p = Bun.spawn({ cmd, stdin: "pipe", stdout: "pipe", stderr: "ignore" });
           await p.exited;
           recordHeld();
           return text(p.stdout);`,
    output: ["out\n"],
    held: [1, 1, 1],
  },
  {
    name: "stderr after exited",
    body: `const p = Bun.spawn({ cmd, stdin: "pipe", stdout: "ignore", stderr: "pipe" });
           await p.exited;
           recordHeld();
           return text(p.stderr);`,
    output: ["err\n"],
    held: [1, 1, 1],
  },
  {
    name: "stderr, then stdout after exited",
    body: `const p = Bun.spawn({ cmd, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
           await p.exited;
           recordHeld();
           return text(p.stderr, p.stdout);`,
    output: ["err\n", "out\n"],
    held: [1, 1, 1],
  },
  {
    name: "stdout, then stderr in onExit",
    body: `const { promise, resolve } = Promise.withResolvers();
           const onExit = p => {
             recordHeld();
             resolve([p.stdout, p.stderr]);
           };
           Bun.spawn({ cmd, stdin: "pipe", stdout: "pipe", stderr: "pipe", onExit });
           return text(...(await promise));`,
    output: ["out\n", "err\n"],
    held: [1, 1, 1],
  },
  {
    // With under three entries, the streams are created when the child exits,
    // before any callback that could look at the Subprocess.
    name: "node:child_process with two stdio entries",
    body: `await once(spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "pipe"] }), "close");
           return [];`,
    output: [],
    held: [],
  },
])("Subprocess is released when a pending stream is first read after exit: $name", async ({ body, output, held }) => {
  const script = /* js */ `
    import { heapStats } from "bun:jsc";
    import { spawn } from "node:child_process";
    import { once } from "node:events";
    const cmd = ["/bin/sh", "-c", "exec 3<&0; cat <&3 & echo out; echo err >&2"];
    const text = (...streams) => Promise.all(streams.map(stream => stream.text()));
    const strong = () => heapStats().protectedObjectTypeCounts.Subprocess ?? 0;

    // Recorded just before the first read: 0 here would mean that the pipe was
    // no longer pending, which is not the case under test.
    const held = [];
    const recordHeld = () => held.push(strong());

    async function run() {
      ${body}
    }

    const outputs = [];
    for (let i = 0; i < 3; i++) outputs.push(await run());
    console.log(JSON.stringify({ outputs, held, leaked: strong() }));
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
  expect({ stdout, exitCode }).toEqual({
    stdout: JSON.stringify({ outputs: [output, output, output], held, leaked: 0 }) + "\n",
    exitCode: 0,
  });
});

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression coverage for a Windows-only panic: integer overflow in
// uv.Loop.active_handles during process teardown when a large number of
// child processes are cleaned up at exit. Historically intermittent with
// ~300+ children. The Windows active_handles counter now saturates like
// the POSIX `active` counter does, so the teardown path cannot underflow.
//
// On POSIX this path was never affected (subActive already saturates), so
// this test also passes there; it is kept enabled everywhere as a general
// stress check of the many-subprocess teardown path.
test("tearing down hundreds of spawned subprocesses at exit does not overflow the loop active-handle counter", async () => {
  const fixture = /* js */ `
    const cmd = process.platform === "win32"
      ? [process.env.comspec || "cmd.exe", "/c", "exit", "0"]
      : ["/bin/sh", "-c", "exit 0"];

    const N = 350;
    const procs = [];
    for (let i = 0; i < N; i++) {
      procs.push(
        Bun.spawn({
          cmd,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        }),
      );
    }

    // Drain output and wait for every child so that all pipe readers and
    // process handles are active by the time we reach teardown.
    await Promise.all(
      procs.map(async (p) => {
        await p.stdout.text();
        await p.stderr.text();
        await p.exited;
      }),
    );

    console.log("spawned=" + procs.length);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const filteredStderr = stderr
    .split(/\r?\n/)
    .filter(s => !s.startsWith("WARNING: ASAN interferes"))
    .join("\n")
    .trim();

  expect(filteredStderr).toBe("");
  expect(stdout.trim()).toBe("spawned=350");
  // A panic during process teardown (after the script body has run) would
  // surface as a non-zero exit code.
  expect(exitCode).toBe(0);
}, 120_000);

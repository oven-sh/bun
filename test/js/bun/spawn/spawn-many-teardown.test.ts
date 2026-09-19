import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Tearing down ~350 children at exit must not underflow the loop's `active`
// counter, which saturates on every platform.
test("tearing down hundreds of spawned subprocesses at exit does not overflow the loop active-handle counter", async () => {
  const N = 350;
  const fixture = /* js */ `
    const cmd = process.platform === "win32"
      ? [process.env.comspec || "cmd.exe", "/c", "exit", "0"]
      : ["/bin/sh", "-c", "exit 0"];

    const N = ${N};
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

  if (exitCode !== 0) {
    console.error(stderr);
  }
  expect(stdout.trim()).toBe(`spawned=${N}`);
  // A panic during process teardown (after the script body has run) would
  // surface as a non-zero exit code.
  expect(exitCode).toBe(0);
}, 120_000);

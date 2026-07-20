import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Bun.SQL lazy getter propagates module load errors without crashing", async () => {
  // The bun:sql internal module reads global `Symbol` at top level. If user
  // code has clobbered the global before the first access, evaluating the
  // module throws. That exception must propagate back to the caller as a
  // normal JS error rather than crashing the process.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        globalThis.Symbol = "i";
        let caught = 0;
        try { Bun.sql; } catch { caught++; }
        try { Bun.SQL; } catch { caught++; }
        console.log("caught=" + caught);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("caught=2");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});

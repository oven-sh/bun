import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";

it("clearImmediate then GC does not crash when the queued immediate is skipped", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        clearImmediate(setImmediate(() => {}));
        Bun.gc(true);
        setTimeout(() => {}, 1);
      `,
    ],
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
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});

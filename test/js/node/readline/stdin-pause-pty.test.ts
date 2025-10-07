import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("stdin pause should stop reading so child can read from stdin", async () => {
  const script = join(__dirname, "stdin-pause-child-reads.mjs");
  const pty = join(__dirname, "run-with-pty.py");
  const runtime = process.env.TEST_RUNTIME || bunExe();

  await using proc = Bun.spawn({
    cmd: ["python3", pty, runtime, script],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const out = stdout || "";
  console.log(out);

  // Child should receive all 3 keystrokes (A, B, C)
  expect(out).toMatch(/CHILD:.*1/);
  expect(out).toMatch(/CHILD:.*2/);
  expect(out).toMatch(/CHILD:.*3/);

  // Parent should receive 0 keystrokes (while paused)
  expect(out).toMatch(/PARENT:.*0/);
  expect(exitCode).toBe(0);
});

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// The fixture sets Error.prepareStackTrace and never restores it, so it runs in
// its own process. Without --isolate, `bun test` runs every file in one process,
// and a require() here would leave the hook installed for every later file.
test("reading .stack inside Error.prepareStackTrace does not call the hook again", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "013880-fixture.cjs")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  // "trigger" prints once: the hook runs for the outer error only. The error
  // that the hook catches gets the default format when the hook reads its .stack.
  expect(stdout).toMatch(/^trigger\n\[Function: abc\]\nError: 1\n(?: {4}at .+\n)+$/);
  expect(exitCode).toBe(0);
});

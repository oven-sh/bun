import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

test("the harness does not pass on the NODE_ENV or BUN_ENV of the shell that runs the tests", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", join(import.meta.dir, "harness-env-fixture.ts")],
    // test/bunfig.toml preloads preload.ts, which removes from process.env every variable that bunEnv does not have.
    cwd: join(import.meta.dir, ".."),
    env: { ...bunEnv, NODE_ENV: "production", BUN_ENV: "production" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain(" 1 pass");
  // stdout also has the version line of `bun test`.
  const report = stdout.split(/\r?\n/).find(line => line.startsWith("{"));
  expect(JSON.parse(report!)).toEqual({
    bunEnv: { NODE_ENV: null, BUN_ENV: null },
    processEnv: { NODE_ENV: null, BUN_ENV: null },
  });
  expect(exitCode).toBe(0);
});

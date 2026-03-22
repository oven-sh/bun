import { test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";

test("s3 presign with missing credentials throws instead of crashing", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `try { Bun.s3.presign("mykey"); } catch(e) { console.log(e.code); }`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stdout.trim()).toBe("ERR_S3_MISSING_CREDENTIALS");
  expect(exitCode).toBe(0);
});

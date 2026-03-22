import { test, expect } from "bun:test";
import { bunExe, bunEnv } from "harness";

test("s3 presign with missing credentials throws instead of crashing", async () => {
  // Scrub AWS credential/config env vars so the test always hits the
  // missing-credentials path regardless of ambient host configuration.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(bunEnv)) {
    if (!key.startsWith("AWS_") && !key.startsWith("S3_")) {
      env[key] = value as string;
    }
  }

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `try { Bun.s3.presign("mykey"); } catch(e) { console.log(e.code); }`],
    env,
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

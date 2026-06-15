import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";

test("S3 error path does not leak WTFStringImpl refs", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", path.join(import.meta.dir, "s3-error-leak-fixture.ts")],
    env: {
      ...bunEnv,
      // S3Client picks up HTTP_PROXY without consulting NO_PROXY, so clear
      // it for the loopback mock.
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      http_proxy: undefined,
      https_proxy: undefined,
      // ASAN's quarantine retains freed allocations, which masks the RSS
      // delta this test measures. Disable it for the subprocess; harmless
      // when the binary is not ASAN-built.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "quarantine_size_mb=0", "thread_local_quarantine_size_kb=0"]
        .filter(Boolean)
        .join(":"),
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) console.error(stderr);
  expect(stdout.trim()).toMatch(/"leaked":false/);
  expect(exitCode).toBe(0);
});

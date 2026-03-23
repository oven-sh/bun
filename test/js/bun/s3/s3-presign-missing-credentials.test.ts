import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test: S3 presign with missing credentials should throw
// ERR_S3_MISSING_CREDENTIALS instead of crashing.

// Spawn subprocesses with S3 credential env vars explicitly unset so
// the tests are not affected by ambient AWS credentials in the host.
const cleanEnv = {
  ...bunEnv,
  AWS_ACCESS_KEY_ID: undefined,
  AWS_SECRET_ACCESS_KEY: undefined,
  S3_ACCESS_KEY_ID: undefined,
  S3_SECRET_ACCESS_KEY: undefined,
  AWS_SESSION_TOKEN: undefined,
  S3_SESSION_TOKEN: undefined,
  S3_ENDPOINT: undefined,
  S3_BUCKET: undefined,
  S3_REGION: undefined,
  AWS_ENDPOINT: undefined,
  AWS_BUCKET: undefined,
  AWS_REGION: undefined,
};

test("S3 presign with missing credentials throws instead of crashing", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      try { Bun.s3.presign("test-path"); } catch(e) { console.log(e.code); }
      try { new Bun.S3Client().presign("test-path"); } catch(e) { console.log(e.code); }
      try { Bun.S3Client.presign("test-path"); } catch(e) { console.log(e.code); }
      Bun.gc(true);
      console.log("ok");
    `,
    ],
    env: cleanEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).not.toContain("error:");
  expect(stdout.trim()).toBe("ERR_S3_MISSING_CREDENTIALS\nERR_S3_MISSING_CREDENTIALS\nERR_S3_MISSING_CREDENTIALS\nok");
  expect(exitCode).toBe(0);
});

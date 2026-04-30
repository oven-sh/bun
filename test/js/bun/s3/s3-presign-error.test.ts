import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("s3 presign with missing credentials throws instead of crashing", async () => {
  // Scrub AWS credential/config env vars so the test always hits the
  // missing-credentials path regardless of ambient host configuration.
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(bunEnv)) {
    if (!key.startsWith("AWS_") && !key.startsWith("S3_") && !key.startsWith("BUN_S3_")) {
      env[key] = value as string;
    }
  }

  // Test instance method (constructS3FileWithS3CredentialsAndOptions):
  //   - initS3WithReferencedCredentials (no credential overrides)
  //   - initS3 (with per-request credentials that still lack endpoint/bucket)
  // Test static method (constructS3FileWithS3Credentials):
  //   - Bun.S3Client.presign (static path)
  const code = [
    `try { Bun.s3.presign("mykey"); } catch(e) { console.log(e.code); }`,
    `try { Bun.s3.presign("mykey", { accessKeyId: "x", secretAccessKey: "y" }); } catch(e) { console.log(e.code); }`,
    `try { Bun.S3Client.presign("mykey"); } catch(e) { console.log(e.code); }`,
  ].join("\n");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env,
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe("ERR_S3_MISSING_CREDENTIALS\nERR_S3_INVALID_PATH\nERR_S3_MISSING_CREDENTIALS");
  expect(exitCode).toBe(0);
});

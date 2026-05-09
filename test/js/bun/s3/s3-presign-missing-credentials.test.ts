import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The path string's ref is transferred to the blob store; when presign fails
// synchronously the errdefer cleanup must not deref it a second time.
test("S3Client.presign with missing credentials throws instead of crashing", async () => {
  const env = { ...bunEnv };
  for (const k of [
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_BUCKET",
    "S3_ENDPOINT",
    "S3_REGION",
    "S3_SESSION_TOKEN",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_BUCKET",
    "AWS_ENDPOINT",
    "AWS_REGION",
    "AWS_SESSION_TOKEN",
  ]) {
    delete env[k];
  }

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        let out = "";
        try { Bun.S3Client.presign("myfile"); } catch (e) { out += e.code; }
        try { new Bun.S3Client({}).presign("myfile"); } catch (e) { out += ":" + e.code; }
        console.log(out);
      `,
    ],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("ERR_S3_MISSING_CREDENTIALS:ERR_S3_MISSING_CREDENTIALS");
  expect(exitCode).toBe(0);
});

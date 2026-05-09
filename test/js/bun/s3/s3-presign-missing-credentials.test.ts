import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// The path string's ref is transferred to the blob store; when the operation
// fails synchronously after that point the errdefer cleanup must not deref it
// a second time.
test("S3Client path methods throw instead of crashing on synchronous errors", async () => {
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
        const out = [];
        try { Bun.S3Client.presign("myfile"); } catch (e) { out.push(e.code); }
        try { new Bun.S3Client({}).presign("myfile"); } catch (e) { out.push(e.code); }
        try { Bun.S3Client.write("myfile", null); } catch (e) { out.push(e.code); }
        try { new Bun.S3Client({}).write("myfile", null); } catch (e) { out.push(e.code); }
        console.log(out.join(":"));
      `,
    ],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe(
    "ERR_S3_MISSING_CREDENTIALS:ERR_S3_MISSING_CREDENTIALS:ERR_INVALID_ARG_TYPE:ERR_INVALID_ARG_TYPE",
  );
  expect(exitCode).toBe(0);
});

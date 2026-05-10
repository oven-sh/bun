import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// When S3 credentials are missing, presign() throws synchronously from
// signRequest after a temporary Blob.Store has already taken ownership of
// the path. The caller's errdefer used to deinit that path a second time,
// which under-flowed the StringImpl refcount and SIGFPE'd in
// StringImpl::costDuringGC on the next collection.

const cleanEnv: Record<string, string | undefined> = {
  ...bunEnv,
  AWS_ACCESS_KEY_ID: undefined,
  AWS_SECRET_ACCESS_KEY: undefined,
  AWS_SESSION_TOKEN: undefined,
  AWS_REGION: undefined,
  AWS_ENDPOINT: undefined,
  AWS_BUCKET: undefined,
  S3_ACCESS_KEY_ID: undefined,
  S3_SECRET_ACCESS_KEY: undefined,
  S3_SESSION_TOKEN: undefined,
  S3_REGION: undefined,
  S3_ENDPOINT: undefined,
  S3_BUCKET: undefined,
};

test("S3 presign with missing credentials throws instead of crashing", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const path = "some-key-name";
        try { Bun.s3.presign(path); } catch (e) { console.log(e.code); }
        try { new Bun.S3Client().presign(path); } catch (e) { console.log(e.code); }
        try { Bun.S3Client.presign(path); } catch (e) { console.log(e.code); }
        try { Bun.file("s3://bucket/" + path).presign(); } catch (e) { console.log(e.code); }
        Bun.gc(true);
        console.log("ok");
      `,
    ],
    env: cleanEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout.trim().split("\n")).toEqual([
    "ERR_S3_MISSING_CREDENTIALS",
    "ERR_S3_MISSING_CREDENTIALS",
    "ERR_S3_MISSING_CREDENTIALS",
    "ERR_S3_MISSING_CREDENTIALS",
    "ok",
  ]);
  expect(exitCode).toBe(0);
});

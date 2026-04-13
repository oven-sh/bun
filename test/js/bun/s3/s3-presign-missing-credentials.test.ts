import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// When S3Client.presign() (and friends) throws after the temporary S3
// blob has been constructed, the errdefer that cleans up the path used
// to double-deref the underlying WTFStringImpl (ownership had already
// transferred to the blob's store). That tripped a debug assertion /
// SIGFPE in release builds.
test("S3Client.presign with missing credentials throws instead of crashing", async () => {
  const script = `
    let caught = 0;
    try { Bun.S3Client.presign("foo"); } catch { caught++; }
    try { Bun.S3Client.presign("foo", {}); } catch { caught++; }
    try { Bun.s3.presign("foo"); } catch { caught++; }
    try { new Bun.S3Client({}).presign("foo"); } catch { caught++; }
    if (caught !== 4) throw new Error("expected all presign calls to throw, got " + caught);
    console.log("ok");
  `;

  // Make sure no ambient S3 credentials make the presign succeed.
  const env: Record<string, string> = { ...bunEnv };
  for (const k of Object.keys(env)) {
    if (k.startsWith("S3_") || k.startsWith("AWS_")) delete env[k];
  }

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

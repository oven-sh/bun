import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// S3Client static methods that accept a path construct an internal Blob
// which takes ownership of the path. If the subsequent operation throws
// (e.g. missing credentials), the errdefer must not double-free the path.
test("S3Client.presign with a path throws cleanly on sign error without double-freeing the path", async () => {
  const env = { ...bunEnv };
  for (const key of Object.keys(env)) {
    if (/^(AWS_|S3_)/.test(key)) delete env[key];
  }

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        let err;
        try {
          Bun.S3Client.presign("some-path", 123);
        } catch (e) {
          err = e;
        }
        if (!err) throw new Error("expected presign to throw");
        if (err.code !== "ERR_S3_MISSING_CREDENTIALS") throw err;
        Bun.gc(true);
        console.log("ok");
      `,
    ],
    env,
    stdout: "pipe",
    stderr: "inherit",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});

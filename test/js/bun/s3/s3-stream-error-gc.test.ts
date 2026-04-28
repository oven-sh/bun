import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// When S3Client.file(...).stream() fails to sign the request (e.g. missing credentials),
// the error is delivered to the ByteStream synchronously and stashed in pending.result
// as a StreamError.JSValue. That variant is expected to be protected so that
// Result.deinit()/processResult() can later unprotect it. Previously the value was
// passed unprotected, so a GC could sweep the error object while the ByteStream still
// held a raw pointer to it, and the stream's finalizer would then dereference a dead
// cell (MarkedBlock::vm() -> null).
test("S3 stream sign error survives GC until the stream is finalized", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const streams = [];
        for (let i = 0; i < 500; i++) {
          streams.push(Bun.S3Client.file("path" + i).stream());
        }
        Bun.gc(true);
        await Bun.sleep(0);
        Bun.gc(true);
        await Bun.sleep(0);
        Bun.gc(true);
        streams.length = 0;
        Bun.gc(true);
        await Bun.sleep(0);
        Bun.gc(true);
      `,
    ],
    env: {
      ...bunEnv,
      AWS_ACCESS_KEY_ID: "",
      AWS_SECRET_ACCESS_KEY: "",
      S3_ACCESS_KEY_ID: "",
      S3_SECRET_ACCESS_KEY: "",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);
});

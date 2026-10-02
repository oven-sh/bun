import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import path from "node:path";

// Writing an S3 source with no credentials to a file-backed Blob routes
// through pipe_readable_stream_to_blob. The S3 stream fails synchronously
// with ERR_S3_MISSING_CREDENTIALS, which ends the sink and detaches the
// controller before assignToStream returns. This used to trip a debug
// assertion that the signal was still live.
//
// Today the credential error is swallowed by ByteStream::on_start() returning
// Start::Empty without checking pending.result, so write() resolves to 0.
// Accept either outcome here so a future fix that surfaces the error does not
// trip this test.
test("Bun.file().write(S3 file) when the S3 stream closes synchronously", async () => {
  using dir = tempDir("s3-write-sync-close", {});
  const dest = path.join(String(dir), "out.bin");

  const fixture = `
    try {
      const s3 = Bun.S3Client.file("key");
      await Bun.file(${JSON.stringify(dest)}).write(s3);
      console.log("resolved");
    } catch (e) {
      console.log("rejected:" + (e?.code ?? e?.name ?? "Error"));
    }
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: {
      ...bunEnv,
      S3_ACCESS_KEY_ID: undefined,
      S3_SECRET_ACCESS_KEY: undefined,
      S3_REGION: undefined,
      S3_ENDPOINT: undefined,
      S3_BUCKET: undefined,
      S3_SESSION_TOKEN: undefined,
      AWS_ACCESS_KEY_ID: undefined,
      AWS_SECRET_ACCESS_KEY: undefined,
      AWS_REGION: undefined,
      AWS_ENDPOINT: undefined,
      AWS_BUCKET: undefined,
      AWS_SESSION_TOKEN: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({
    stdout: normalizeBunSnapshot(stdout),
    stderr: normalizeBunSnapshot(stderr),
    signalCode: proc.signalCode,
  }).toEqual({
    stdout: expect.stringMatching(/^(resolved|rejected:ERR_S3_MISSING_CREDENTIALS)$/),
    stderr: "",
    signalCode: null,
  });
  expect(exitCode).toBe(0);
});

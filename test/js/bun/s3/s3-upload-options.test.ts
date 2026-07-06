import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// The same documented `S3Options` bag must reach the wire whichever entry point
// it was handed to: `client.write(key, data, opts)`, `client.file(key, opts)`,
// `new S3Client(opts)` or `file.writer(opts)`.
test("every upload entry point sends the options it was given", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "s3-upload-options-fixture.ts")],
    // The S3 client does not honor NO_PROXY, so an inherited proxy would
    // hijack the request to the stub server.
    env: {
      ...bunEnv,
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      http_proxy: undefined,
      https_proxy: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const sent = {
    acl: "public-read",
    storageClass: "STANDARD_IA",
    type: "text/csv",
    contentDisposition: "attachment",
    contentEncoding: "gzip",
  };

  expect(stderr).not.toContain("S3Error");
  expect(JSON.parse(stdout || "null")).toEqual({
    "client.write(key, data, options)": sent,
    "client.file(key, options).write(data)": sent,
    "new S3Client(options).write(key, data)": sent,
    "new S3Client(options).file(key).write(data)": sent,
    "client.file(key).writer(options)": sent,
    "client.file(key, options).writer()": sent,
    "client.file(key).writer(options) [multipart]": sent,
    "per-call options override the handle's": {
      ...sent,
      acl: "private",
      contentDisposition: "inline",
      contentEncoding: "br",
    },
  });
  expect(exitCode).toBe(0);
});

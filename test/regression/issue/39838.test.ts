import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/39838
// `s3.write(key, Bun.file(path))` hung forever once the file reached
// 5 x partSize (the default queueSize). The pump that reads the file parked on
// part backpressure with nothing in JS referring to the stream, a GC collected
// it, and no UploadPart response could resume the upload.
const fixture = `
  const partSize = 5 * 1024 * 1024;
  const parts = [];
  let completed = false;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "POST" && url.searchParams.has("uploads")) {
        return new Response(
          "<InitiateMultipartUploadResult><UploadId>upload-1</UploadId></InitiateMultipartUploadResult>",
          { headers: { "content-type": "application/xml" } },
        );
      }
      if (req.method === "PUT") {
        const body = await req.arrayBuffer();
        parts.push([Number(url.searchParams.get("partNumber")), body.byteLength]);
        // Every queue slot is in flight. The client reads more of the file
        // only after this response. Nothing in JS refers to the file stream.
        Bun.gc(true);
        return new Response("", { headers: { ETag: '"etag-' + url.searchParams.get("partNumber") + '"' } });
      }
      await req.text();
      completed = true;
      return new Response(
        '<CompleteMultipartUploadResult><ETag>"etag-1"</ETag></CompleteMultipartUploadResult>',
        { headers: { "content-type": "application/xml" } },
      );
    },
  });

  const s3 = new Bun.S3Client({
    endpoint: "http://127.0.0.1:" + server.port,
    bucket: "bucket",
    accessKeyId: "key",
    secretAccessKey: "secret",
    region: "us-east-1",
  });

  // Five full parts: the smallest file that fills the default queue.
  await Bun.write("payload.bin", new Uint8Array(5 * partSize));
  const written = await s3.write("repro/payload.bin", Bun.file("payload.bin"));
  parts.sort((a, b) => a[0] - b[0]);
  console.log(JSON.stringify({ written, parts, completed }));
  server.stop(true);
`;

test("s3.write(key, Bun.file(path)) settles when a GC runs while every part slot is in flight", async () => {
  using dir = tempDir("issue-39838", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: {
      ...bunEnv,
      HTTP_PROXY: undefined,
      HTTPS_PROXY: undefined,
      http_proxy: undefined,
      https_proxy: undefined,
    },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(normalizeBunSnapshot(stderr)).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    written: 5 * 5 * 1024 * 1024,
    parts: [1, 2, 3, 4, 5].map(n => [n, 5 * 1024 * 1024]),
    completed: true,
  });
  expect(exitCode).toBe(0);
});

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tmpdirSync } from "harness";
import fs from "node:fs";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/31682
// Bun.write(Bun.file(path), s3file) streams through a FileSink that did not
// open the destination with O_TRUNC, so a larger pre-existing destination
// kept its stale tail bytes.
test("Bun.write(Bun.file(path), s3file) truncates a larger existing destination file", async () => {
  const OBJECT_SIZE = 1024 * 1024;
  const objectBytes = Buffer.alloc(OBJECT_SIZE, 0xaa);

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      if (req.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "Content-Length": String(OBJECT_SIZE),
            "ETag": '"etag"',
            "Accept-Ranges": "bytes",
          },
        });
      }
      if (req.method === "GET") {
        const range = req.headers.get("range");
        if (range) {
          const match = /bytes=(\d+)-(\d+)?/.exec(range);
          if (match) {
            const start = Number(match[1]);
            const end = match[2] !== undefined ? Math.min(Number(match[2]), OBJECT_SIZE - 1) : OBJECT_SIZE - 1;
            const body = objectBytes.subarray(start, end + 1);
            return new Response(body, {
              status: 206,
              headers: {
                "Content-Range": `bytes ${start}-${end}/${OBJECT_SIZE}`,
                "Content-Length": String(body.byteLength),
                "ETag": '"etag"',
              },
            });
          }
        }
        return new Response(objectBytes, {
          status: 200,
          headers: {
            "Content-Length": String(OBJECT_SIZE),
            "ETag": '"etag"',
          },
        });
      }
      return new Response("unexpected request", { status: 400 });
    },
  });

  const dest = join(tmpdirSync(), "s3-download-truncate.bin");

  // Pre-existing destination that is 4x larger than the S3 object.
  fs.writeFileSync(dest, Buffer.alloc(4 * OBJECT_SIZE, 0xee));

  // The S3 client resolves HTTP(S)_PROXY from the environment once at
  // startup, so run the download in a child process with the proxy
  // variables removed to guarantee it talks to the local fake endpoint.
  const env = { ...bunEnv, S3_ENDPOINT: server.url.href, S3_DEST: dest };
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"]) {
    delete env[key];
  }

  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const s3 = new Bun.S3Client({
        endpoint: process.env.S3_ENDPOINT,
        bucket: "bucket",
        accessKeyId: "test",
        secretAccessKey: "test",
        region: "eu-west-3",
      });
      await Bun.write(Bun.file(process.env.S3_DEST), s3.file("object"));
      `,
    ],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("");
  expect(exitCode).toBe(0);

  const actual = fs.readFileSync(dest);
  expect(actual.byteLength).toBe(OBJECT_SIZE);
  expect(actual.equals(objectBytes)).toBe(true);
});

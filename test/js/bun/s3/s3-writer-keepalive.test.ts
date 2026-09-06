import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// An S3 writer holds the event loop only while a request is in flight or after
// `end()` while the upload settles. A writer that is never ended must not keep
// the process alive on its own.

// `Bun.serve` that answers every S3 request the writer can send.
const serverSource = `
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
        await req.arrayBuffer();
        return new Response("", { headers: { ETag: '"etag"' } });
      }
      await req.text();
      return new Response(
        '<CompleteMultipartUploadResult><ETag>"etag-1"</ETag></CompleteMultipartUploadResult>',
        { headers: { "content-type": "application/xml" } },
      );
    },
  });
  server.unref();
  const client = new Bun.S3Client({
    endpoint: "http://127.0.0.1:" + server.port,
    bucket: "bucket",
    accessKeyId: "key",
    secretAccessKey: "secret",
    region: "us-east-1",
  });
`;

// The S3 client does not consult NO_PROXY, so a proxy in the environment would
// capture the loopback requests.
const env = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

async function run(source: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", serverSource + source],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const cases: [string, string][] = [
  ["no write", `client.file("key").writer(); console.log("done");`],
  ["one buffered write", `const w = client.file("key").writer(); w.write("a"); console.log("done");`],
  [
    "wrapper collected",
    `(() => { const w = client.file("key").writer(); w.write("a"); })(); Bun.gc(true); console.log("done");`,
  ],
  [
    "a part was flushed",
    `const w = client.file("key").writer({ partSize: 5 * 1024 * 1024 });
     w.write(new Uint8Array(6 * 1024 * 1024));
     console.log("done");`,
  ],
];

for (const [name, source] of cases) {
  test.concurrent(`S3 writer() that is never ended does not keep the process alive (${name})`, async () => {
    const { stdout, stderr, exitCode } = await run(source);
    expect(stderr).toBe("");
    expect(stdout).toBe("done\n");
    expect(exitCode).toBe(0);
  });
}

test.concurrent("S3 writer() end() keeps the process alive until the upload settles", async () => {
  const { stdout, stderr, exitCode } = await run(`
    const w = client.file("key").writer();
    w.write("hello");
    w.end().then(n => console.log("resolved", n), e => console.log("rejected", e.code));
  `);
  expect(stderr).toBe("");
  expect(stdout).toBe("resolved 5\n");
  expect(exitCode).toBe(0);
});

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The S3 uploader has its own copy of the native ByteStream fast path: it takes the stream's
// buffered bytes straight off the ByteStream handle. Once the stream has been materialized
// (anything that installs its controller, such as getReader()), those bytes already live in
// the controller's queue, so the fast path must stand down or the upload is truncated.
//
// 1 MB: a short body is uploaded before anything buffers, which hides the truncation.
const fixture = /* ts */ `
import { S3Client } from "bun";

const PAYLOAD_LENGTH = 1_000_000;
const payload = Buffer.alloc(PAYLOAD_LENGTH, "z").toString();
let received = 0;

const xml = (body: string) => new Response(body, { headers: { "content-type": "application/xml" } });

using s3 = Bun.serve({
  port: 0,
  async fetch(req) {
    if (req.method === "PUT") {
      received += (await req.arrayBuffer()).byteLength;
      return new Response("", { headers: { ETag: '"etag"' } });
    }
    if (new URL(req.url).searchParams.has("uploads")) {
      return xml("<InitiateMultipartUploadResult><UploadId>upload</UploadId></InitiateMultipartUploadResult>");
    }
    await req.text();
    return xml("<CompleteMultipartUploadResult></CompleteMultipartUploadResult>");
  },
});

using upstream = Bun.serve({ port: 0, fetch: () => new Response(payload) });

const client = new S3Client({
  accessKeyId: "key",
  secretAccessKey: "secret",
  bucket: "bucket",
  endpoint: "http://127.0.0.1:" + s3.port,
});

const res = await fetch("http://127.0.0.1:" + upstream.port + "/");
res.body!.getReader().releaseLock(); // materialize, do not read
await client.write("object", new Response(res.body));

console.log(JSON.stringify({ received, expected: PAYLOAD_LENGTH }));
`;

// The S3 client does not honor NO_PROXY, so an inherited proxy would hijack the
// request to the stub server.
const envWithoutProxy = {
  ...bunEnv,
  HTTP_PROXY: undefined,
  HTTPS_PROXY: undefined,
  http_proxy: undefined,
  https_proxy: undefined,
};

describe("S3Client.write()", () => {
  test("uploads a materialized stream body in full", async () => {
    using dir = tempDir("s3-materialized-stream", { "fixture.ts": fixture });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "fixture.ts"],
      env: envWithoutProxy,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("S3Error");
    expect(JSON.parse(stdout)).toEqual({ received: 1_000_000, expected: 1_000_000 });
    expect(exitCode).toBe(0);
  });
});

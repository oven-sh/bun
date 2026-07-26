import { S3Client, type S3Options } from "bun";
import { describe, expect, it } from "bun:test";
import { isASAN, tempDir } from "harness";
import path from "node:path";

// The S3 client routes through HTTP_PROXY without consulting NO_PROXY, which
// breaks the localhost mock origin on proxied machines.
process.env.HTTP_PROXY = "";
process.env.HTTPS_PROXY = "";
process.env.http_proxy = "";
process.env.https_proxy = "";

// writer() leaks its NetworkSink (pre-existing, fix in #34999), which trips
// LeakSanitizer; skip those tests under ASAN until that PR lands.
const itWriter = it.skipIf(isASAN);

// Every write entry point is typed/documented as "Promise resolving to number of
// bytes written". Buffered sources already returned the true count; streamed
// sources (ReadableStream body, Bun.file, writer().end(), download-to-file)
// resolved a hardcoded 0.

describe("s3 write() resolves with bytes transferred", () => {
  const PAYLOAD = 300_000;

  function mockOrigin() {
    let received = 0;
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        received = (await req.arrayBuffer()).byteLength;
        const url = new URL(req.url);
        if (url.search === "?uploads=") {
          // InitiateMultipartUpload
          return new Response(
            `<?xml version="1.0"?><InitiateMultipartUploadResult><UploadId>abc123</UploadId></InitiateMultipartUploadResult>`,
            { status: 200 },
          );
        }
        if (req.method === "GET") {
          return new Response(Buffer.alloc(PAYLOAD, "x"));
        }
        return new Response("", { status: 200, headers: { etag: '"e"' } });
      },
    });
    const options: S3Options = {
      endpoint: server.url.href,
      accessKeyId: "a",
      secretAccessKey: "b",
      bucket: "bk",
      region: "us-east-1",
    };
    return {
      server,
      options,
      client: new S3Client(options),
      received: () => received,
      [Symbol.dispose]() {
        server.stop(true);
      },
    };
  }

  it("buffered: Uint8Array source returns byte count", async () => {
    using m = mockOrigin();
    const n = await m.client.write("k", new Uint8Array(PAYLOAD));
    expect({ returned: n, received: m.received() }).toEqual({ returned: PAYLOAD, received: PAYLOAD });
  });

  it("streamed: Response with ReadableStream body returns byte count", async () => {
    using m = mockOrigin();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(PAYLOAD));
        c.close();
      },
    });
    const n = await m.client.write("k", new Response(stream));
    expect({ returned: n, received: m.received() }).toEqual({ returned: PAYLOAD, received: PAYLOAD });
  });

  it("streamed: Bun.file source returns byte count", async () => {
    using m = mockOrigin();
    using dir = tempDir("s3-write-ret", {
      "src.bin": Buffer.alloc(PAYLOAD, "A"),
    });
    const n = await Bun.write(m.client.file("k"), Bun.file(path.join(String(dir), "src.bin")));
    expect({ returned: n, received: m.received() }).toEqual({ returned: PAYLOAD, received: PAYLOAD });
  });

  it("streamed: S3Client.write(key, Bun.file) returns byte count", async () => {
    using m = mockOrigin();
    using dir = tempDir("s3-write-ret-direct", {
      "src.bin": Buffer.alloc(PAYLOAD, "B"),
    });
    const n = await m.client.write("k", Bun.file(path.join(String(dir), "src.bin")));
    expect({ returned: n, received: m.received() }).toEqual({ returned: PAYLOAD, received: PAYLOAD });
  });

  itWriter("writer(): end() returns total bytes written", async () => {
    using m = mockOrigin();
    const w = m.client.file("k").writer();
    w.write(new Uint8Array(PAYLOAD));
    w.write(new Uint8Array(PAYLOAD));
    w.write(new Uint8Array(PAYLOAD));
    const n = await w.end();
    expect({ returned: n, received: m.received() }).toEqual({
      returned: PAYLOAD * 3,
      received: PAYLOAD * 3,
    });
  });

  itWriter("writer(): end() returns total bytes for a multipart upload", async () => {
    let partsReceived = 0;
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.arrayBuffer();
        if (req.method === "POST" && req.url.includes("?uploads=")) {
          return new Response(
            "<InitiateMultipartUploadResult><UploadId>abc123</UploadId></InitiateMultipartUploadResult>",
            { status: 200 },
          );
        }
        if (req.method === "POST" && req.url.includes("uploadId=")) {
          return new Response('<CompleteMultipartUploadResult><ETag>"etag"</ETag></CompleteMultipartUploadResult>', {
            status: 200,
          });
        }
        partsReceived += body.byteLength;
        return new Response("", { status: 200, headers: { etag: '"e"' } });
      },
    });
    const client = new S3Client({
      endpoint: server.url.href,
      accessKeyId: "a",
      secretAccessKey: "b",
      bucket: "bk",
      region: "us-east-1",
    });
    const partSize = 5 * 1024 * 1024;
    const total = partSize + 1024 * 1024;
    const w = client.file("k").writer({ partSize });
    w.write(Buffer.alloc(total, "a"));
    const n = await w.end();
    expect({ returned: n, received: partsReceived }).toEqual({ returned: total, received: total });
  });

  it("download: Bun.write(path, s3file) returns bytes written to disk", async () => {
    using m = mockOrigin();
    using dir = tempDir("s3-dl-ret", {});
    const dest = path.join(String(dir), "out.bin");
    const n = await Bun.write(dest, m.client.file("k"));
    expect({ returned: n, onDisk: Bun.file(dest).size }).toEqual({ returned: PAYLOAD, onDisk: PAYLOAD });
  });
});

import { S3Client, deflateSync, gzipSync, zstdCompressSync } from "bun";
import { describe, expect, it } from "bun:test";
import type { AddressInfo } from "node:net";
import * as net from "node:net";
import { brotliCompressSync } from "node:zlib";

// S3 stores Content-Encoding as object metadata and replays it verbatim on GET without
// transfer-encoding the body. The S3 client must hand back the stored bytes exactly,
// never inflate them: a GetObject response is the object, not a transport representation.

type Stored = { body: Buffer; encoding?: string };

async function makeOrigin() {
  const objects = new Map<string, Stored>();
  const acceptEncodingSeen: (string | undefined)[] = [];

  const server = net.createServer(socket => {
    let buf = Buffer.alloc(0);
    socket.on("error", () => {});
    socket.on("data", chunk => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const headerEnd = buf.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        const head = buf.subarray(0, headerEnd).toString("latin1");
        const [requestLine, ...headerLines] = head.split("\r\n");
        const [method, path] = requestLine.split(" ");
        const headers: Record<string, string> = {};
        for (const line of headerLines) {
          const i = line.indexOf(":");
          if (i > 0) headers[line.slice(0, i).toLowerCase()] = line.slice(i + 1).trim();
        }
        const contentLength = Number(headers["content-length"] ?? 0);
        if (buf.length < headerEnd + 4 + contentLength) return;
        const body = Buffer.from(buf.subarray(headerEnd + 4, headerEnd + 4 + contentLength));
        buf = buf.subarray(headerEnd + 4 + contentLength);

        if (method === "GET" || method === "HEAD") {
          acceptEncodingSeen.push(headers["accept-encoding"]);
        }

        if (method === "PUT") {
          objects.set(path, { body, encoding: headers["content-encoding"] });
          socket.write('HTTP/1.1 200 OK\r\nETag: "etag"\r\nContent-Length: 0\r\n\r\n');
          continue;
        }

        const obj = objects.get(path);
        const enc = obj?.encoding ? `Content-Encoding: ${obj.encoding}\r\n` : "";
        const len = obj ? obj.body.length : 0;
        const responseBody = method === "GET" && obj ? obj.body : Buffer.alloc(0);
        socket.write(`HTTP/1.1 200 OK\r\nETag: "etag"\r\nAccept-Ranges: bytes\r\n${enc}Content-Length: ${len}\r\n\r\n`);
        if (responseBody.length) socket.write(responseBody);
      }
    });
  });

  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;

  return {
    server,
    objects,
    acceptEncodingSeen,
    client: new S3Client({
      accessKeyId: "test",
      secretAccessKey: "test",
      region: "us-east-1",
      bucket: "bucket",
      endpoint: `http://127.0.0.1:${port}`,
    }),
    [Symbol.dispose]() {
      server.close();
    },
  };
}

const plain = Buffer.from(Buffer.alloc(880, "the quick brown fox jumps over the lazy dog ").toString());

describe("S3Client does not decode Content-Encoding metadata", () => {
  it.each([
    ["gzip", gzipSync],
    ["br", brotliCompressSync],
    ["deflate", deflateSync],
    ["zstd", zstdCompressSync],
  ] as const)("returns the stored %s bytes unchanged", async (encoding, compress) => {
    using origin = await makeOrigin();
    const compressed = Buffer.from(compress(plain));
    expect(compressed.length).toBeLessThan(plain.length);

    await origin.client.write("app.js.gz", compressed, { contentEncoding: encoding });

    const back = Buffer.from(await origin.client.file("app.js.gz").bytes());
    const stat = await origin.client.file("app.js.gz").stat();

    expect({
      wrote: compressed.length,
      readBack: back.length,
      byteIdentical: Buffer.compare(back, compressed) === 0,
      statSize: stat.size,
    }).toEqual({
      wrote: compressed.length,
      readBack: compressed.length,
      byteIdentical: true,
      statSize: compressed.length,
    });
  });

  it("does not advertise Accept-Encoding on S3 requests", async () => {
    using origin = await makeOrigin();
    await origin.client.write("key", plain);
    await origin.client.file("key").bytes();
    await origin.client.file("key").stat();
    expect(origin.acceptEncodingSeen.every(v => v === undefined)).toBe(true);
    expect(origin.acceptEncodingSeen.length).toBeGreaterThan(0);
  });

  it("returns mislabelled plaintext as-is without a decode error", async () => {
    using origin = await makeOrigin();
    // mislabel plaintext as gzip: the client must not try to inflate it.
    origin.objects.set("/bucket/mislabelled", { body: plain, encoding: "gzip" });

    const back = Buffer.from(await origin.client.file("mislabelled").bytes());
    expect({ length: back.length, byteIdentical: Buffer.compare(back, plain) === 0 }).toEqual({
      length: plain.length,
      byteIdentical: true,
    });
  });

  it("passes unknown Content-Encoding values through unchanged", async () => {
    using origin = await makeOrigin();
    origin.objects.set("/bucket/custom", { body: plain, encoding: "aes256" });

    const back = Buffer.from(await origin.client.file("custom").bytes());
    expect(Buffer.compare(back, plain)).toBe(0);
  });

  it("returns stored bytes unchanged via the streaming reader", async () => {
    using origin = await makeOrigin();
    const compressed = Buffer.from(gzipSync(plain));
    origin.objects.set("/bucket/stream.gz", { body: compressed, encoding: "gzip" });

    const chunks: Uint8Array[] = [];
    for await (const chunk of origin.client.file("stream.gz").stream()) {
      chunks.push(chunk);
    }
    const back = Buffer.concat(chunks);
    expect({ length: back.length, byteIdentical: Buffer.compare(back, compressed) === 0 }).toEqual({
      length: compressed.length,
      byteIdentical: true,
    });
  });
});

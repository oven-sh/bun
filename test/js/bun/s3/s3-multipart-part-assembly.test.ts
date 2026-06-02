import { S3Client } from "bun";
import { describe, expect, it } from "bun:test";

// Streamed multipart uploads against a local fake S3 endpoint (the
// s3-insecure.test.ts pattern): pins part sizing, ordering, reassembly, and
// the single-PUT route for sub-part-size uploads.
describe("S3 multipart part assembly", () => {
  function makeServer() {
    const uploads = new Map<string, Map<number, Buffer>>();
    const singlePuts: Buffer[] = [];
    let counter = 0;
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const q = new URL(req.url).searchParams;
        if (req.method === "POST" && q.has("uploads")) {
          const id = `up-${++counter}`;
          uploads.set(id, new Map());
          return new Response(
            `<?xml version="1.0"?><InitiateMultipartUploadResult><Bucket>b</Bucket><Key>k</Key><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`,
            { headers: { "Content-Type": "application/xml" } },
          );
        }
        if (req.method === "PUT" && q.has("partNumber")) {
          uploads.get(q.get("uploadId")!)!.set(Number(q.get("partNumber")), Buffer.from(await req.arrayBuffer()));
          return new Response(null, { headers: { ETag: `"etag-${q.get("partNumber")}"` } });
        }
        if (req.method === "POST" && q.has("uploadId")) {
          return new Response(
            `<?xml version="1.0"?><CompleteMultipartUploadResult><ETag>"done"</ETag></CompleteMultipartUploadResult>`,
            { headers: { "Content-Type": "application/xml" } },
          );
        }
        if (req.method === "PUT") {
          singlePuts.push(Buffer.from(await req.arrayBuffer()));
          return new Response(null, { headers: { ETag: '"single"' } });
        }
        return new Response(null, { status: 400 });
      },
    });
    const s3 = new S3Client({
      endpoint: server.url.origin,
      bucket: "b",
      accessKeyId: "k",
      secretAccessKey: "s",
      region: "us-east-1",
    });
    return { server, s3, uploads, singlePuts };
  }

  function patterned(total: number) {
    const buf = Buffer.alloc(total);
    for (let i = 0; i < total; i++) buf[i] = (i * 13) & 0xff;
    return buf;
  }

  it("splits a streamed upload into full-sized parts that reassemble exactly", async () => {
    const { server, s3, uploads } = makeServer();
    using _s = server;
    const total = Math.floor(12.5 * 1024 * 1024);
    const data = patterned(total);

    const writer = s3.file("multi.bin").writer();
    // odd-sized writes that straddle part boundaries
    const sizes = [1, 4093, 65537, 1024 * 1024 + 7, 3 * 1024 * 1024, 333];
    let offset = 0;
    let i = 0;
    while (offset < total) {
      const n = Math.min(sizes[i++ % sizes.length], total - offset);
      writer.write(data.subarray(offset, offset + n));
      offset += n;
      if (i % 3 === 0) await writer.flush();
    }
    await writer.end();

    const parts = [...uploads.values()].at(-1)!;
    const numbers = [...parts.keys()].sort((a, b) => a - b);
    expect(numbers).toEqual([1, 2, 3]);
    expect(numbers.slice(0, -1).map(n => parts.get(n)!.length)).toEqual([5 * 1024 * 1024, 5 * 1024 * 1024]);
    expect(Buffer.compare(Buffer.concat(numbers.map(n => parts.get(n)!)), data)).toBe(0);
  });

  it("routes sub-part-size uploads through a single PUT", async () => {
    const { server, s3, singlePuts } = makeServer();
    using _s = server;
    const data = patterned(100 * 1024);
    const writer = s3.file("small.bin").writer();
    writer.write(data);
    await writer.end();
    expect(singlePuts).toHaveLength(1);
    expect(Buffer.compare(singlePuts[0], data)).toBe(0);
  });

  it("converts non-ASCII string writes to UTF-8", async () => {
    const { server, s3, singlePuts } = makeServer();
    using _s = server;
    const writer = s3.file("text.txt").writer();
    writer.write("hello ");
    writer.write("wörld ✓");
    await writer.end();
    expect(singlePuts).toHaveLength(1);
    expect(singlePuts[0].toString("utf8")).toBe("hello wörld ✓");
  });
});

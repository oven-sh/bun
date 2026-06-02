import { S3Client } from "bun";
import { describe, expect, it } from "bun:test";
import { tempDir } from "harness";
import net from "node:net";
import { join } from "node:path";

// Bun.write(Bun.file(localPath), s3file) — the S3-download-to-disk path.
// Uses a local fake S3 endpoint (same pattern as s3-insecure.test.ts) so the
// pipe is exercised without docker.
describe("Bun.write(Bun.file(path), s3file)", () => {
  const SIZE = 4 * 1024 * 1024;
  const payload = new Uint8Array(SIZE);
  for (let i = 0; i < SIZE; i++) payload[i] = (i * 17) & 0xff;

  function makeClient(origin: string) {
    return new S3Client({
      endpoint: origin,
      bucket: "test-bucket",
      accessKeyId: "test",
      secretAccessKey: "test",
      region: "us-east-1",
    });
  }

  it("writes the object's bytes to the local file", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () => new Response(payload, { headers: { "Content-Length": String(SIZE) } }),
    });
    using dir = tempDir("s3-write-local", {});
    const dest = join(String(dir), "download.bin");

    await Bun.write(Bun.file(dest), makeClient(server.url.origin).file("some-key"));

    const got = await Bun.file(dest).bytes();
    expect(got.byteLength).toBe(SIZE);
    expect(Buffer.compare(got, payload)).toBe(0);
  });

  it("rejects when the object stream dies mid-body", async () => {
    const raw = net.createServer(socket => {
      socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${SIZE}\r\n\r\n`);
      socket.write(Buffer.alloc(SIZE / 2, 0x42));
      setTimeout(() => socket.destroy(), 50);
    });
    await new Promise<void>(resolve => raw.listen(0, () => resolve()));
    const port = (raw.address() as net.AddressInfo).port;
    using dir = tempDir("s3-write-local-err", {});
    const dest = join(String(dir), "partial.bin");

    expect(async () => {
      await Bun.write(Bun.file(dest), makeClient(`http://127.0.0.1:${port}`).file("k"));
    }).toThrow();

    raw.close();
  });
});

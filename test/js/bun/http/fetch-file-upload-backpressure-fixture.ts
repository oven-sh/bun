// Uploads an unaligned slice of a 16 MiB file to a server that reads slower
// than the client writes, then prints what the server saw. The parent test runs
// this with and without BUN_FEATURE_FLAG_DISABLE_FETCH_SENDFILE so both the
// sendfile(2) path and the userspace copy path get the same check.
import { join } from "path";

const size = 16 * 1024 * 1024;
const start = 123_457;
const bytes = Buffer.allocUnsafe(size);
// Position-dependent pattern: a misplaced or repeated chunk changes the hash.
for (let i = 0; i < size; i += 4) bytes.writeUInt32LE(i >>> 2, i);
const path = join(process.cwd(), "big.bin");
await Bun.write(path, bytes);
const expected = Bun.CryptoHasher.hash("sha256", bytes.subarray(start), "hex");

await using server = Bun.serve({
  port: 0,
  development: false,
  maxRequestBodySize: size,
  async fetch(req) {
    const hasher = new Bun.CryptoHasher("sha256");
    let received = 0;
    for await (const chunk of req.body!) {
      hasher.update(chunk);
      received += chunk.length;
      // Yield so the client outruns the reader and has to resume after partial writes.
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    return Response.json({ contentLength: req.headers.get("content-length"), received, hash: hasher.digest("hex") });
  },
});

const res = await fetch(server.url, { method: "PUT", body: Bun.file(path).slice(start) });
const body = await res.json();
console.log(JSON.stringify({ status: res.status, ...body, expected, expectedLength: size - start }));

import { expect, test } from "bun:test";
import { tempDir } from "harness";

// Regression test for https://github.com/oven-sh/bun/issues/23065
// Streaming large files through ReadableStream drain path should not panic
// with "integer cast truncated bits" when buffer sizes are large.
// The underlying fix changes drain() to return std.ArrayListUnmanaged(u8)
// (usize length) instead of ByteList (u32 length), avoiding overflow for >4GB buffers.

test("streaming a file through ReadableStream drain path works correctly", async () => {
  // Create a file with enough data to exercise the drain path
  const size = 10 * 1024 * 1024; // 10MB
  const data = Buffer.alloc(size, 0xab);

  using dir = tempDir("issue-23065", {
    "test.bin": data,
  });

  const file = Bun.file(`${dir}/test.bin`);
  const stream = file.stream();
  const result = await new Response(stream).arrayBuffer();

  expect(result.byteLength).toBe(size);
  // Verify first and last bytes to ensure data integrity
  const view = new Uint8Array(result);
  expect(view[0]).toBe(0xab);
  expect(view[size - 1]).toBe(0xab);
});

test("piping Bun.file through HTTP server exercises ByteStream drain", async () => {
  using dir = tempDir("issue-23065-http", {
    "upload.bin": Buffer.alloc(1024 * 1024, 0xcd), // 1MB
  });

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.arrayBuffer();
      return new Response(String(body.byteLength));
    },
  });

  const file = Bun.file(`${dir}/upload.bin`);
  const resp = await fetch(server.url, {
    method: "POST",
    body: file,
  });

  const text = await resp.text();
  expect(text).toBe("1048576");
});

test("ReadableStream from file can be consumed via Bun.write", async () => {
  const size = 5 * 1024 * 1024; // 5MB
  using dir = tempDir("issue-23065-write", {
    "source.bin": Buffer.alloc(size, 0xef),
  });

  const source = Bun.file(`${dir}/source.bin`);
  const destPath = `${dir}/dest.bin`;
  await Bun.write(destPath, source);

  const dest = Bun.file(destPath);
  expect(dest.size).toBe(size);
  const destData = new Uint8Array(await dest.arrayBuffer());
  expect(destData[0]).toBe(0xef);
  expect(destData[size - 1]).toBe(0xef);
});

import { expect, test } from "bun:test";
import { zstdCompressSync } from "node:zlib";

test("issue #20053 - multi-frame zstd responses should be fully decompressed", async () => {
  // Create multiple zstd frames that when concatenated form a single large response
  // This simulates what happens with chunked encoding where each chunk might be
  // compressed as a separate frame
  const part1 = "A".repeat(16384); // Exactly 16KB
  const part2 = "B".repeat(3627); // Remaining data to total ~20KB

  const compressed1 = zstdCompressSync(Buffer.from(part1));
  const compressed2 = zstdCompressSync(Buffer.from(part2));

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      // Concatenate two zstd frames (simulating chunked response with multiple frames)
      const combined = Buffer.concat([compressed1, compressed2]);

      return new Response(combined, {
        headers: {
          "content-type": "text/plain",
          "content-encoding": "zstd",
          "transfer-encoding": "chunked",
        },
      });
    },
  });

  // Make a request to the server
  const response = await fetch(`http://localhost:${server.port}/`);
  const text = await response.text();

  // Both frames should be decompressed and concatenated
  expect(text.length).toBe(part1.length + part2.length);
  expect(text.substring(0, 16384)).toBe("A".repeat(16384));
  expect(text.substring(16384)).toBe("B".repeat(3627));
});

test("issue #20053 - zstd with chunked encoding splits JSON into multiple frames", async () => {
  // This test simulates the exact scenario from the original issue
  // where Hono with compression middleware sends multiple zstd frames
  const largeData = { data: "A".repeat(20000) };
  const jsonString = JSON.stringify(largeData);

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      // Simulate chunked encoding by compressing in parts
      // This is what happens when the server uses chunked transfer encoding
      // with compression - each chunk might be compressed separately
      const part1 = jsonString.slice(0, 16384);
      const part2 = jsonString.slice(16384);

      const compressed1 = zstdCompressSync(Buffer.from(part1));
      const compressed2 = zstdCompressSync(Buffer.from(part2));

      // Server sends multiple zstd frames as would happen with chunked encoding
      const combined = Buffer.concat([compressed1, compressed2]);

      return new Response(combined, {
        headers: {
          "content-type": "application/json",
          "content-encoding": "zstd",
          "transfer-encoding": "chunked",
        },
      });
    },
  });

  const response = await fetch(`http://localhost:${server.port}/`);
  const text = await response.text();

  // The decompressed response should be the concatenation of all frames
  expect(text.length).toBe(jsonString.length);
  expect(text).toBe(jsonString);

  // Verify it can be parsed as JSON
  const parsed = JSON.parse(text);
  expect(parsed.data.length).toBe(20000);
  expect(parsed.data).toBe("A".repeat(20000));
});

test("issue #20053 - streaming zstd decompression handles frame boundaries correctly", async () => {
  // Test that the decompressor correctly handles the case where a frame completes
  // but more data might arrive later (streaming scenario)
  const part1 = "First frame content";
  const part2 = "Second frame content";

  const compressed1 = zstdCompressSync(Buffer.from(part1));
  const compressed2 = zstdCompressSync(Buffer.from(part2));

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      // Simulate streaming by sending frames separately
      const combined = Buffer.concat([compressed1, compressed2]);

      return new Response(combined, {
        headers: {
          "content-type": "text/plain",
          "content-encoding": "zstd",
          "transfer-encoding": "chunked",
        },
      });
    },
  });

  const response = await fetch(`http://localhost:${server.port}/`);
  const text = await response.text();

  // Both frames should be decompressed
  expect(text).toBe(part1 + part2);
});

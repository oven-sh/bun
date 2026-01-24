import { describe, expect, it } from "bun:test";
import { tempDirWithFiles } from "harness";
import { join } from "node:path";

// Test for https://github.com/oven-sh/bun/issues/26406
// Response(Bun.file(...)) would fail when accessed over LAN (192.168.x.x) but work on localhost.
// The issue was that sendfile() could execute before HTTP headers were fully flushed to kernel socket buffer.
// When there was network backpressure, headers might still be in userspace buffer when sendfile writes directly
// to kernel socket, causing file content to arrive BEFORE HTTP headers (appearing as HTTP/0.9).

describe("Response(Bun.file()) headers are sent before file content", () => {
  it("concurrent requests to file response all receive valid HTTP headers", async () => {
    const tempDir = tempDirWithFiles("sendfile-test", {
      // Use a larger file to increase chance of triggering backpressure
      "test.txt": "Hello from sendfile test!\n".repeat(1000),
    });

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(Bun.file(join(tempDir, "test.txt")));
      },
    });

    // Make many concurrent requests to increase chance of socket backpressure
    const numRequests = 100;
    const requests = Array.from({ length: numRequests }, async () => {
      const response = await fetch(server.url);

      // The key assertion: we should get valid HTTP headers
      // If the bug occurs, the response might be treated as HTTP/0.9 (no headers)
      // or the status would be incorrect
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/plain");
      expect(response.headers.get("Content-Length")).toBe("26000"); // 26 chars * 1000

      const text = await response.text();
      expect(text.length).toBe(26000);
      expect(text.startsWith("Hello from sendfile test!")).toBe(true);
    });

    await Promise.all(requests);
  });

  it("large file response maintains correct headers under load", async () => {
    const largeContent = Buffer.alloc(1024 * 1024, "x").toString(); // 1MB file
    const tempDir = tempDirWithFiles("sendfile-large-test", {
      "large.txt": largeContent,
    });

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(Bun.file(join(tempDir, "large.txt")));
      },
    });

    // Sequential requests with large files to test sustained operation
    for (let i = 0; i < 10; i++) {
      const response = await fetch(server.url);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Length")).toBe("1048576");

      const text = await response.text();
      expect(text.length).toBe(1048576);
    }
  });

  it("file response with custom headers preserves all headers", async () => {
    const tempDir = tempDirWithFiles("sendfile-headers-test", {
      "test.txt": "Content here",
    });

    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(Bun.file(join(tempDir, "test.txt")), {
          headers: {
            "X-Custom-Header": "custom-value",
            "Cache-Control": "no-cache",
          },
        });
      },
    });

    // Multiple concurrent requests to test header consistency
    const requests = Array.from({ length: 50 }, async () => {
      const response = await fetch(server.url);

      expect(response.status).toBe(200);
      expect(response.headers.get("X-Custom-Header")).toBe("custom-value");
      expect(response.headers.get("Cache-Control")).toBe("no-cache");
      expect(response.headers.get("Content-Type")).toContain("text/plain");

      await response.text();
    });

    await Promise.all(requests);
  });
});

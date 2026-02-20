import { expect, test } from "bun:test";

// Helper to get raw HTTP response headers via TCP socket
async function getRawResponse(port: number, path: string = "/"): Promise<{ headers: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => reject(new Error("Timeout")), 5000);
    Bun.connect({
      hostname: "localhost",
      port,
      socket: {
        data(_socket, data) {
          chunks.push(Buffer.from(data));
        },
        open(socket) {
          socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
        },
        close() {
          clearTimeout(timeout);
          const full = Buffer.concat(chunks);
          const headerEnd = full.indexOf("\r\n\r\n");
          if (headerEnd === -1) {
            reject(new Error("No header terminator found"));
            return;
          }
          resolve({
            headers: full.subarray(0, headerEnd).toString("utf8"),
            body: full.subarray(headerEnd + 4),
          });
        },
        error(_socket, err) {
          clearTimeout(timeout);
          reject(err);
        },
      },
    });
  });
}

function getHeader(rawHeaders: string, name: string): string | null {
  const regex = new RegExp(`^${name}:\\s*(.+)$`, "mi");
  const match = rawHeaders.match(regex);
  return match ? match[1].trim() : null;
}

test("large streaming ReadableStream preserves user-set Content-Length", async () => {
  // Use a large body (1MB) that can't be eagerly buffered into a blob
  const chunkSize = 1024;
  const totalChunks = 1024;
  const totalSize = chunkSize * totalChunks;
  const chunk = new Uint8Array(chunkSize).fill(65); // 'A'

  using server = Bun.serve({
    port: 0,
    async fetch() {
      let remaining = totalChunks;
      const stream = new ReadableStream({
        pull(controller) {
          if (remaining <= 0) {
            controller.close();
            return;
          }
          remaining--;
          controller.enqueue(chunk);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Length": String(totalSize),
          "Content-Type": "application/octet-stream",
        },
      });
    },
  });

  const { headers, body } = await getRawResponse(server.port);

  expect(getHeader(headers, "content-length")).toBe(String(totalSize));
  expect(getHeader(headers, "transfer-encoding")).toBeNull();
  expect(body.length).toBe(totalSize);
});

test("large streaming ReadableStream without Content-Length uses chunked encoding", async () => {
  const chunkSize = 1024;
  const totalChunks = 1024;
  const chunk = new Uint8Array(chunkSize).fill(65);

  using server = Bun.serve({
    port: 0,
    async fetch() {
      let remaining = totalChunks;
      const stream = new ReadableStream({
        pull(controller) {
          if (remaining <= 0) {
            controller.close();
            return;
          }
          remaining--;
          controller.enqueue(chunk);
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "application/octet-stream",
        },
      });
    },
  });

  const { headers } = await getRawResponse(server.port);

  // Without explicit Content-Length, chunked encoding should be used
  expect(getHeader(headers, "transfer-encoding")).toBe("chunked");
  expect(getHeader(headers, "content-length")).toBeNull();
});

test("async ReadableStream with delay preserves user-set Content-Length", async () => {
  const body = "Hello, World!";
  const bodyBytes = new TextEncoder().encode(body);

  using server = Bun.serve({
    port: 0,
    async fetch() {
      const stream = new ReadableStream({
        async pull(controller) {
          // Delay to ensure the stream is not eagerly consumed
          await Bun.sleep(10);
          controller.enqueue(bodyBytes);
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Length": String(bodyBytes.length),
          "Content-Type": "text/plain",
        },
      });
    },
  });

  const { headers, body: respBody } = await getRawResponse(server.port);

  expect(getHeader(headers, "content-length")).toBe(String(bodyBytes.length));
  expect(getHeader(headers, "transfer-encoding")).toBeNull();
  expect(respBody.toString()).toBe(body);
});

test("multi-chunk async ReadableStream preserves user-set Content-Length", async () => {
  const parts = ["Hello, ", "World", "!"];
  const totalSize = parts.reduce((sum, p) => sum + new TextEncoder().encode(p).length, 0);

  using server = Bun.serve({
    port: 0,
    async fetch() {
      let index = 0;
      const stream = new ReadableStream({
        async pull(controller) {
          if (index >= parts.length) {
            controller.close();
            return;
          }
          await Bun.sleep(5);
          controller.enqueue(new TextEncoder().encode(parts[index]));
          index++;
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Length": String(totalSize),
        },
      });
    },
  });

  const { headers, body } = await getRawResponse(server.port);

  expect(getHeader(headers, "content-length")).toBe(String(totalSize));
  expect(getHeader(headers, "transfer-encoding")).toBeNull();
  expect(body.toString()).toBe("Hello, World!");
});

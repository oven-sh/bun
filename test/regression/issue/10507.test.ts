import { expect, test } from "bun:test";

// Helper to get raw HTTP response headers via TCP socket.
// Resolves on connection close, or once Content-Length bytes of body are received
// (for keep-alive connections that don't close after the response).
async function getRawResponse(
  port: number,
  path: string = "/",
  method: string = "GET",
): Promise<{ headers: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        reject(new Error("Timeout"));
      }
    }, 5000);

    function tryResolve() {
      const full = Buffer.concat(chunks);
      const headerEnd = full.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const headerStr = full.subarray(0, headerEnd).toString("utf8");
      const bodyData = full.subarray(headerEnd + 4);

      // If Content-Length is present, resolve once we have enough body bytes
      const clMatch = headerStr.match(/^content-length:\s*(\d+)$/im);
      if (clMatch) {
        const expected = parseInt(clMatch[1], 10);
        if (bodyData.length >= expected) {
          resolved = true;
          clearTimeout(timeout);
          resolve({ headers: headerStr, body: bodyData.subarray(0, expected) });
        }
        return;
      }
      // For chunked/close-delimited, wait for connection close (handled below)
    }

    Bun.connect({
      hostname: "localhost",
      port,
      socket: {
        data(_socket, data) {
          chunks.push(Buffer.from(data));
          tryResolve();
        },
        open(socket) {
          socket.write(`${method} ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
        },
        close() {
          if (resolved) return;
          clearTimeout(timeout);
          const full = Buffer.concat(chunks);
          const headerEnd = full.indexOf("\r\n\r\n");
          if (headerEnd === -1) {
            reject(new Error("No header terminator found"));
            return;
          }
          resolved = true;
          resolve({
            headers: full.subarray(0, headerEnd).toString("utf8"),
            body: full.subarray(headerEnd + 4),
          });
        },
        error(_socket, err) {
          if (resolved) return;
          resolved = true;
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

test("small synchronous ReadableStream with Content-Length has no duplicate headers", async () => {
  const body = "Hello!";

  using server = Bun.serve({
    port: 0,
    fetch() {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Length": String(body.length),
        },
      });
    },
  });

  const { headers, body: respBody } = await getRawResponse(server.port);

  // Must have exactly one Content-Length header (no duplicate from tryEnd)
  const contentLengthCount = (headers.match(/^content-length:/gim) ?? []).length;
  expect(contentLengthCount).toBe(1);
  expect(getHeader(headers, "content-length")).toBe(String(body.length));
  expect(getHeader(headers, "transfer-encoding")).toBeNull();
  expect(respBody.toString()).toBe(body);
});

test("proxy forwards upstream Response.body preserves Content-Length", async () => {
  const payload = "Hello from upstream!";

  // Upstream server returns a known-size body with Content-Length
  using upstream = Bun.serve({
    port: 0,
    fetch() {
      return new Response(payload, {
        headers: { "Content-Length": String(payload.length) },
      });
    },
  });

  // Proxy server fetches from upstream and forwards the stream body
  using proxy = Bun.serve({
    port: 0,
    async fetch() {
      const res = await fetch(`http://localhost:${upstream.port}/`);
      return new Response(res.body, {
        headers: { "Content-Length": res.headers.get("Content-Length")! },
      });
    },
  });

  const { headers, body: respBody } = await getRawResponse(proxy.port);

  expect(getHeader(headers, "content-length")).toBe(String(payload.length));
  expect(getHeader(headers, "transfer-encoding")).toBeNull();
  expect(respBody.toString()).toBe(payload);
});

test("HEAD request with ReadableStream body and Content-Length has no duplicate headers", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("Hello!"));
          controller.close();
        },
      });
      return new Response(stream, {
        headers: { "Content-Length": "6" },
      });
    },
  });

  const { headers } = await getRawResponse(server.port, "/", "HEAD");

  const contentLengthCount = (headers.match(/^content-length:/gim) ?? []).length;
  expect(contentLengthCount).toBe(1);
  expect(getHeader(headers, "content-length")).toBe("6");
  expect(getHeader(headers, "transfer-encoding")).toBeNull();
});

import { expect, test } from "bun:test";

// Test that chunked requests exceeding maxRequestBodySize are properly
// rejected with 413 and that ReadableStreams are errored (not left hanging).

test("chunked request exceeding maxRequestBodySize gets 413", async () => {
  using server = Bun.serve({
    port: 0,
    maxRequestBodySize: 64,
    async fetch(req) {
      // Just try to consume the body as text (buffered path)
      try {
        const body = await req.text();
        return new Response(`OK: ${body.length}`);
      } catch (e: any) {
        return new Response(`Error: ${e.message}`, { status: 500 });
      }
    },
  });

  // Use a raw TCP connection to send chunked transfer-encoding
  // Send a request that exceeds 64 bytes via chunked encoding
  const conn = await Bun.connect({
    hostname: server.hostname,
    port: server.port,
    socket: {
      data(socket, data) {
        socket.data.chunks.push(Buffer.from(data));
        const text = Buffer.concat(socket.data.chunks).toString();
        if (text.includes("\r\n\r\n") || text.includes("0\r\n\r\n")) {
          socket.data.resolve(text);
        }
      },
      open(socket) {},
      close(socket) {
        // If the connection is closed before we get a response, resolve with what we have
        const text = Buffer.concat(socket.data.chunks).toString();
        socket.data.resolve(text);
      },
      error(socket, err) {
        socket.data.reject(err);
      },
      connectError(socket, err) {
        socket.data.reject(err);
      },
    },
    data: {
      chunks: [] as Buffer[],
      resolve: null as any,
      reject: null as any,
    },
  });

  const { promise, resolve, reject } = Promise.withResolvers<string>();
  conn.data.resolve = resolve;
  conn.data.reject = reject;

  // Send chunked request that exceeds 64 byte limit
  // First chunk: 40 bytes (under limit)
  // Second chunk: 40 bytes (total 80 bytes, exceeds 64 byte limit)
  const request =
    "POST / HTTP/1.1\r\n" +
    `Host: ${server.hostname}:${server.port}\r\n` +
    "Transfer-Encoding: chunked\r\n" +
    "\r\n" +
    "28\r\n" + // 0x28 = 40 in hex
    "A".repeat(40) +
    "\r\n" +
    "28\r\n" + // 0x28 = 40 in hex
    "B".repeat(40) +
    "\r\n" +
    "0\r\n" +
    "\r\n";

  conn.write(request);
  conn.flush();

  const response = await promise;
  expect(response).toContain("413");
  conn.end();
});

test("chunked request via ReadableStream gets errored on 413", async () => {
  using server = Bun.serve({
    port: 0,
    maxRequestBodySize: 64,
    async fetch(req) {
      // Consume body as ReadableStream
      const reader = req.body!.getReader();
      try {
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
        return new Response(`OK: ${totalLength}`);
      } catch (e: any) {
        // The read() should reject with an error, not hang indefinitely
        return new Response(`Error: ${e.message}`, { status: 500 });
      }
    },
  });

  const conn = await Bun.connect({
    hostname: server.hostname,
    port: server.port,
    socket: {
      data(socket, data) {
        socket.data.chunks.push(Buffer.from(data));
        const text = Buffer.concat(socket.data.chunks).toString();
        if (text.includes("\r\n\r\n")) {
          socket.data.resolve(text);
        }
      },
      open(socket) {},
      close(socket) {
        const text = Buffer.concat(socket.data.chunks).toString();
        socket.data.resolve(text);
      },
      error(socket, err) {
        socket.data.reject(err);
      },
      connectError(socket, err) {
        socket.data.reject(err);
      },
    },
    data: {
      chunks: [] as Buffer[],
      resolve: null as any,
      reject: null as any,
    },
  });

  const { promise, resolve, reject } = Promise.withResolvers<string>();
  conn.data.resolve = resolve;
  conn.data.reject = reject;

  // Send chunked request that exceeds 64 byte limit
  const request =
    "POST / HTTP/1.1\r\n" +
    `Host: ${server.hostname}:${server.port}\r\n` +
    "Transfer-Encoding: chunked\r\n" +
    "\r\n" +
    "28\r\n" +
    "A".repeat(40) +
    "\r\n" +
    "28\r\n" +
    "B".repeat(40) +
    "\r\n" +
    "0\r\n" +
    "\r\n";

  conn.write(request);
  conn.flush();

  const response = await promise;
  // The server should respond with 413, not hang
  expect(response).toContain("413");
  conn.end();
});

test("chunked request within maxRequestBodySize succeeds", async () => {
  using server = Bun.serve({
    port: 0,
    maxRequestBodySize: 128,
    async fetch(req) {
      const body = await req.text();
      return new Response(`OK: ${body.length}`);
    },
  });

  const conn = await Bun.connect({
    hostname: server.hostname,
    port: server.port,
    socket: {
      data(socket, data) {
        socket.data.chunks.push(Buffer.from(data));
        const text = Buffer.concat(socket.data.chunks).toString();
        if (text.includes("\r\n\r\n")) {
          socket.data.resolve(text);
        }
      },
      open(socket) {},
      close(socket) {
        const text = Buffer.concat(socket.data.chunks).toString();
        socket.data.resolve(text);
      },
      error(socket, err) {
        socket.data.reject(err);
      },
      connectError(socket, err) {
        socket.data.reject(err);
      },
    },
    data: {
      chunks: [] as Buffer[],
      resolve: null as any,
      reject: null as any,
    },
  });

  const { promise, resolve, reject } = Promise.withResolvers<string>();
  conn.data.resolve = resolve;
  conn.data.reject = reject;

  // Send chunked request within 128 byte limit (total 80 bytes)
  const request =
    "POST / HTTP/1.1\r\n" +
    `Host: ${server.hostname}:${server.port}\r\n` +
    "Transfer-Encoding: chunked\r\n" +
    "\r\n" +
    "28\r\n" +
    "A".repeat(40) +
    "\r\n" +
    "28\r\n" +
    "B".repeat(40) +
    "\r\n" +
    "0\r\n" +
    "\r\n";

  conn.write(request);
  conn.flush();

  const response = await promise;
  expect(response).toContain("200");
  expect(response).toContain("OK: 80");
  conn.end();
});

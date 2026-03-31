import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression: fetch silently retries POST on keep-alive disconnect (ECONNRESET)
// and merges response streams from multiple request lifecycles.
// https://github.com/oven-sh/bun/issues/28706
test("POST should not be silently retried on keep-alive disconnect", async () => {
  let connectionCount = 0;
  let requestCount = 0;
  const { promise: allDone, resolve: resolveAll } = Promise.withResolvers<void>();

  // Raw TCP server for precise connection control
  await using server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        connectionCount++;
        socket.data = { buffer: "" };
      },
      data(socket, data) {
        socket.data.buffer += new TextDecoder().decode(data);

        // Wait until we have a complete HTTP request (headers end with \r\n\r\n)
        if (!socket.data.buffer.includes("\r\n\r\n")) return;

        const request = socket.data.buffer;
        socket.data.buffer = "";
        requestCount++;

        if (request.startsWith("POST /login")) {
          // Respond with keep-alive so the connection is reused
          const body = "success";
          socket.write(
            `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: keep-alive\r\n\r\n${body}`
          );
        } else if (request.startsWith("POST /sse")) {
          // Send first chunk with chunked encoding, then close the connection
          // to simulate the server dropping the connection mid-stream
          const chunk = JSON.stringify({ type: "start", sn: requestCount - 1 });
          const hexLen = chunk.length.toString(16);
          socket.write(
            `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: keep-alive\r\n\r\n${hexLen}\r\n${chunk}\r\n`
          );
          // Close the connection after a brief moment to ensure client received data
          setTimeout(() => {
            socket.end();
            // Give time for potential retry, then resolve
            setTimeout(() => resolveAll(), 500);
          }, 100);
        }
      },
      close() {},
      error() {},
    },
    data: { buffer: "" },
  });

  const base = `http://127.0.0.1:${server.port}`;

  // Establish keep-alive connection
  const loginRes = await fetch(`${base}/login`, { method: "POST" });
  expect(await loginRes.text()).toBe("success");

  // POST on the reused keep-alive connection; server will close mid-stream
  const sseRes = await fetch(`${base}/sse`, { method: "POST" });

  const sns: number[] = [];
  try {
    for await (const chunk of sseRes.body!) {
      const text = new TextDecoder().decode(chunk).trim();
      if (text.length > 0) {
        sns.push(JSON.parse(text).sn);
      }
    }
  } catch {
    // Expected: connection closed error
  }

  // Wait for any potential retry to complete
  await allDone;

  // With the bug: the client retries POST, server sees 3 requests
  // (login + sse + retried sse), and chunks from 2 different SNs appear.
  // With the fix: server sees only 2 requests (login + sse), one SN.
  expect(requestCount).toBe(2);
  expect(sns).toEqual([1]);
});

// Verify that GET requests on keep-alive connections are still retried
test("GET should still be retried on keep-alive disconnect", async () => {
  let requestCount = 0;
  const { promise: allDone, resolve: resolveAll } = Promise.withResolvers<void>();

  await using server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        socket.data = { buffer: "" };
      },
      data(socket, data) {
        socket.data.buffer += new TextDecoder().decode(data);
        if (!socket.data.buffer.includes("\r\n\r\n")) return;

        const request = socket.data.buffer;
        socket.data.buffer = "";
        requestCount++;

        if (request.startsWith("GET /setup")) {
          socket.write(
            "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nok"
          );
          // Close the connection after response to make it stale
          setTimeout(() => socket.end(), 50);
        } else if (request.startsWith("GET /data")) {
          const body = "hello";
          socket.write(
            `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n${body}`
          );
          resolveAll();
        }
      },
      close() {},
      error() {},
    },
    data: { buffer: "" },
  });

  const base = `http://127.0.0.1:${server.port}`;

  // Establish keep-alive connection
  const setupRes = await fetch(`${base}/setup`);
  expect(await setupRes.text()).toBe("ok");

  // Wait for server to close the connection
  await new Promise((r) => setTimeout(r, 200));

  // GET on stale connection — should be retried transparently
  const dataRes = await fetch(`${base}/data`);
  expect(await dataRes.text()).toBe("hello");

  await allDone;
  // GET should be retried, so server sees setup + failed attempt + successful retry
  expect(requestCount).toBeGreaterThanOrEqual(2);
});

import { expect, test } from "bun:test";

// Regression: fetch silently retries POST on keep-alive disconnect (ECONNRESET)
// and merges response streams from multiple request lifecycles.
// https://github.com/oven-sh/bun/issues/28706
test("POST should not be silently retried on keep-alive disconnect", async () => {
  let requestCount = 0;
  let retryDetected = false;
  const { promise: allDone, resolve: resolveAll } = Promise.withResolvers<void>();

  // Raw TCP server for precise connection control
  await using server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
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
          socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: keep-alive\r\n\r\n${body}`);
        } else if (request.startsWith("POST /sse")) {
          if (requestCount > 2) {
            // This is a retry — the bug is present
            retryDetected = true;
          }
          // Send first chunk with chunked encoding, then close the connection
          // to simulate the server dropping the connection mid-stream.
          // A brief delay ensures the client receives and parses the response
          // headers before the socket close event fires.
          const chunk = JSON.stringify({ type: "start", sn: requestCount - 1 });
          const hexLen = chunk.length.toString(16);
          socket.write(
            `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: keep-alive\r\n\r\n${hexLen}\r\n${chunk}\r\n`,
          );
          setTimeout(() => socket.end(), 50);
        }
      },
      close() {
        resolveAll();
      },
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
  let streamErrored = false;
  try {
    for await (const chunk of sseRes.body!) {
      const text = new TextDecoder().decode(chunk).trim();
      if (text.length > 0) {
        sns.push(JSON.parse(text).sn);
      }
    }
  } catch {
    streamErrored = true;
  }

  // Wait for server socket close event
  await allDone;

  // The body stream must error from the truncated chunked response
  expect(streamErrored).toBe(true);
  // With the bug: the client retries POST, server sees 3 requests
  // (login + sse + retried sse), and chunks from 2 different SNs appear.
  // With the fix: server sees only 2 requests (login + sse), one SN.
  expect(retryDetected).toBe(false);
  expect(requestCount).toBe(2);
  expect(sns).toEqual([1]);
});

// Verify that GET requests on keep-alive connections are still retried
// by closing the socket after parsing the request but before sending a response
test("GET should still be retried on keep-alive disconnect", async () => {
  let dataAttempts = 0;

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

        if (request.startsWith("GET /setup")) {
          socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nok");
        } else if (request.startsWith("GET /data")) {
          dataAttempts++;
          if (dataAttempts === 1) {
            // Close without responding — forces client to retry via allow_retry
            socket.end();
            return;
          }
          const body = "hello";
          socket.write(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
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

  // GET on keep-alive connection — server closes without responding on first
  // attempt, client retries on fresh connection, second attempt succeeds
  const dataRes = await fetch(`${base}/data`);
  expect(await dataRes.text()).toBe("hello");

  // Exactly 2 attempts: the closed one + the successful retry
  expect(dataAttempts).toBe(2);
});

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression: fetch silently retries POST on keep-alive disconnect (ECONNRESET)
// and merges response streams from multiple request lifecycles.
// https://github.com/oven-sh/bun/issues/28706
//
// Run in a subprocess to isolate from ASAN shutdown diagnostics.
test("POST should not be silently retried on keep-alive disconnect", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      let requestCount = 0;
      let sseSocket;

      const server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          open(socket) { socket.data = { buffer: "" }; },
          data(socket, data) {
            socket.data.buffer += new TextDecoder().decode(data);
            if (!socket.data.buffer.includes("\\r\\n\\r\\n")) return;
            const request = socket.data.buffer;
            socket.data.buffer = "";
            requestCount++;

            if (request.startsWith("POST /login")) {
              const body = "success";
              socket.write("HTTP/1.1 200 OK\\r\\nContent-Length: " + body.length + "\\r\\nConnection: keep-alive\\r\\n\\r\\n" + body);
            } else if (request.startsWith("POST /sse")) {
              const chunk = JSON.stringify({ sn: requestCount - 1 });
              const hexLen = chunk.length.toString(16);
              socket.write("HTTP/1.1 200 OK\\r\\nTransfer-Encoding: chunked\\r\\nConnection: keep-alive\\r\\n\\r\\n" + hexLen + "\\r\\n" + chunk + "\\r\\n");
              sseSocket = socket;
            }
          },
          close() {},
          error() {},
        },
        data: { buffer: "" },
      });

      const base = "http://127.0.0.1:" + server.port;
      const loginRes = await fetch(base + "/login", { method: "POST" });
      await loginRes.text();

      const sseRes = await fetch(base + "/sse", { method: "POST" });
      const sns = [];
      let streamErrored = false;
      try {
        for await (const chunk of sseRes.body) {
          const text = new TextDecoder().decode(chunk).trim();
          if (text.length > 0) {
            sns.push(JSON.parse(text).sn);
            sseSocket?.end();
          }
        }
      } catch { streamErrored = true; }

      server.stop();
      console.log(JSON.stringify({ requestCount, sns, streamErrored }));
      process.exit(0);
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  // The body stream must error from the truncated chunked response
  expect(result.streamErrored).toBe(true);
  // With the bug: requestCount is 3 (login + sse + retried sse).
  // With the fix: requestCount is 2 (login + sse, no retry).
  expect(result.requestCount).toBe(2);
  expect(result.sns).toEqual([1]);
  expect(exitCode).toBe(0);
});

test("GET should still be retried on keep-alive disconnect", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      let dataAttempts = 0;

      const server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          open(socket) { socket.data = { buffer: "" }; },
          data(socket, data) {
            socket.data.buffer += new TextDecoder().decode(data);
            if (!socket.data.buffer.includes("\\r\\n\\r\\n")) return;
            const request = socket.data.buffer;
            socket.data.buffer = "";

            if (request.startsWith("GET /setup")) {
              socket.write("HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\nConnection: keep-alive\\r\\n\\r\\nok");
            } else if (request.startsWith("GET /data")) {
              dataAttempts++;
              if (dataAttempts === 1) { socket.end(); return; }
              const body = "hello";
              socket.write("HTTP/1.1 200 OK\\r\\nContent-Length: " + body.length + "\\r\\n\\r\\n" + body);
            }
          },
          close() {},
          error() {},
        },
        data: { buffer: "" },
      });

      const base = "http://127.0.0.1:" + server.port;
      await (await fetch(base + "/setup")).text();

      const dataRes = await fetch(base + "/data");
      const text = await dataRes.text();

      server.stop();
      console.log(JSON.stringify({ dataAttempts, text }));
      process.exit(0);
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const result = JSON.parse(stdout.trim());
  expect(result.text).toBe("hello");
  // Exactly 2 attempts: the closed one + the successful retry
  expect(result.dataAttempts).toBe(2);
  expect(exitCode).toBe(0);
});

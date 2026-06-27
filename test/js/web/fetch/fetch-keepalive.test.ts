import { expect, test } from "bun:test";
import { bunEnv, bunExe, tls } from "harness";

test("keepalive", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      return new Response(JSON.stringify(req.headers.toJSON()));
    },
  });
  {
    const res = await fetch(`http://localhost:${server.port}`, {
      keepalive: false,
    });
    const headers = await res.json();
    expect(headers.connection).toBeUndefined();
  }

  {
    const res = await fetch(`http://localhost:${server.port}`, {
      keepalive: true,
    });
    const headers = await res.json();
    expect(headers.connection).toBe("keep-alive");
  }

  {
    const res = await fetch(`http://localhost:${server.port}`, {
      keepalive: false,
      headers: {
        "Connection": "HELLO!",
      },
    });
    const headers = await res.json();
    expect(headers.connection).toBe("HELLO!");
  }
});

test("fetch does not reuse a pooled TLS connection for a request with a different Host header", async () => {
  using server = Bun.serve({
    port: 0,
    tls,
    fetch(req) {
      // Identify which TCP connection served this request: a reused
      // keep-alive socket keeps the same client ephemeral port, while a
      // fresh connection must get a new one (the pooled socket still
      // occupies the old 4-tuple).
      return new Response(String(server.requestIP(req)?.port));
    },
  });

  const url = `https://localhost:${server.port}/`;
  const get = async (headers?: Record<string, string>) => {
    const res = await fetch(url, {
      headers,
      tls: { rejectUnauthorized: false },
    });
    return await res.text();
  };

  // Two requests whose TLS handshake used the Host-header override
  // "wrong.example" for SNI/certificate verification share one pooled
  // connection (legitimate keep-alive still works).
  const overrideA = await get({ Host: "wrong.example" });
  const overrideB = await get({ Host: "wrong.example" });
  expect(overrideB).toBe(overrideA);

  // A request without the override expects the server identity to match
  // url.hostname ("localhost"), so it must not be handed the connection
  // that was only ever negotiated as "wrong.example". It has to open a new
  // connection, which cannot have the same client port.
  const plain = await get();
  expect(plain).not.toBe(overrideA);
});

// A reused keep-alive connection reset during a streaming PUT must reject with
// ECONNRESET, not retry: the stream body is already consumed, and the retry
// panicked in send_initial_request_payload. Subprocess: the panic aborts the process.
test("PUT with a ReadableStream body is not retried on keep-alive disconnect", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const CRLF = String.fromCharCode(13, 10);
      let warmRequests = 0;
      let streamRequests = 0;

      const server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          open(socket) { socket.data = { buffer: "" }; },
          data(socket, data) {
            socket.data.buffer += data.toString("latin1");
            if (!socket.data.buffer.includes(CRLF)) return;
            if (socket.data.buffer.startsWith("PUT /warm")) {
              // Wait for the full 4-byte body before replying keep-alive.
              const i = socket.data.buffer.indexOf(CRLF + CRLF);
              if (i < 0 || socket.data.buffer.length < i + 4 + 4) return;
              warmRequests++;
              socket.data.buffer = "";
              socket.write("HTTP/1.1 200 OK" + CRLF + "Content-Length: 2" + CRLF + "Connection: keep-alive" + CRLF + CRLF + "ok");
              return;
            }
            if (socket.data.buffer.startsWith("PUT /stream")) {
              // Wait for the full headers plus at least one body byte so the
              // stream body has actually started being consumed before the reset.
              const i = socket.data.buffer.indexOf(CRLF + CRLF);
              if (i < 0 || socket.data.buffer.length <= i + 4) return;
              streamRequests++;
              socket.data.buffer = "";
              // Reset the connection mid-upload.
              socket.terminate();
            }
          },
          close() {},
          error() {},
          drain() {},
        },
      });

      const base = "http://127.0.0.1:" + server.port;
      const chunk = new Uint8Array(1024);
      const streamBody = () => {
        let pending = 32;
        return new ReadableStream({
          pull(c) {
            if (pending-- <= 0) return c.close();
            c.enqueue(chunk);
          },
        });
      };

      const errors = [];
      for (let i = 0; i < 4; i++) {
        // Park a keep-alive connection so the stream PUT reuses it.
        await (await fetch(base + "/warm", { method: "PUT", body: "warm" })).text();
        try {
          await fetch(base + "/stream", { method: "PUT", body: streamBody(), duplex: "half" });
          errors.push(null);
        } catch (e) {
          errors.push(e && (e.code || e.name));
        }
      }

      server.stop();
      console.log(JSON.stringify({ warmRequests, streamRequests, errors }));
      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // If the subprocess crashed there is no JSON; surface the raw output instead.
  const result = stdout.startsWith("{") ? JSON.parse(stdout.trim()) : { stdout, stderr };
  expect({ result, exitCode }).toEqual({
    // Without the fix every attempt is retried on a fresh connection, so the
    // server sees each PUT /stream twice (streamRequests === 8).
    result: {
      warmRequests: 4,
      streamRequests: 4,
      errors: ["ECONNRESET", "ECONNRESET", "ECONNRESET", "ECONNRESET"],
    },
    exitCode: 0,
  });
});

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tls } from "harness";
import { once } from "node:events";
import { createServer } from "node:net";

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

test("fetch reuses a pooled TLS connection across requests with different Host headers", async () => {
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

  // The TLS handshake is keyed to the URL host (SNI and certificate
  // verification both use url.hostname). A request-level Host header is only
  // an HTTP field, so three requests with differing Host headers share one
  // pooled connection.
  const first = await get({ Host: "wrong.example" });
  const second = await get({ Host: "another.example" });
  const third = await get();
  expect({ second, third }).toEqual({ second: first, third: first });
});

// Whether a completed response leaves its connection in the keep-alive pool is
// decided from the status line and the Connection header:
//   - RFC 9112 §9.6: `close` ends persistence whatever the status code (bun used
//     to honour it on 2xx only, so a 4xx/5xx with `Connection: close` was
//     pooled and the next fetch raced the server's FIN into ECONNRESET), and it
//     wins over a keep-alive token on the same or another Connection line.
//   - RFC 9112 §9.3: an HTTP/1.0 response is persistent only if it says
//     `Connection: keep-alive`; a bare Keep-Alive header is not that. bun never
//     looked at the version, so every HTTP/1.0 response with a Content-Length
//     was pooled and, since nearly every HTTP/1.0 server closes after
//     responding, the next fetch (or a followed redirect's hop) was written
//     onto a dying socket. Node and curl dial again here.
// The server below keeps every socket open and answers each request on the
// connection it arrived on, so `connections` is exactly how many times bun
// dialed for four sequential fetches: pooled => 1, not pooled => 4. Subprocess
// so the pool can't leak between rows.
test.concurrent.each([
  ["HTTP/1.1 200 X", ["Connection: close"], 4],
  ["HTTP/1.1 400 X", ["Connection: close"], 4],
  ["HTTP/1.1 413 X", ["Connection: close"], 4],
  ["HTTP/1.1 500 X", ["Connection: close"], 4],
  ["HTTP/1.1 200 X", ["Connection: close, keep-alive"], 4],
  ["HTTP/1.1 200 X", ["Connection: Keep-Alive ,\tClose"], 4],
  ["HTTP/1.1 200 X", ["Connection: upgrade, close"], 4],
  ["HTTP/1.1 200 X", ["Connection: close", "Connection: keep-alive"], 4],
  ["HTTP/1.1 200 X", [], 1],
  ["HTTP/1.1 404 X", [], 1],
  ["HTTP/1.0 200 X", [], 4],
  ["HTTP/1.0 404 X", [], 4],
  ["HTTP/1.0 200 X", ["Keep-Alive: timeout=5"], 4],
  ["HTTP/1.0 200 X", ["Connection: keep-alive"], 1],
  ["HTTP/1.0 404 X", ["Connection: Keep-Alive"], 1],
  ["HTTP/1.0 200 X", ["Connection: keep-alive, close"], 4],
  ["HTTP/1.0 200 X", ["Connection: keep-alive", "Connection: close"], 4],
  ["HTTP/1.0 200 X", ["Connection: close", "Connection: keep-alive"], 4],
] as [statusLine: string, headers: string[], connections: number][])(
  "%s %j: four fetches use %d connection(s)",
  async (statusLine, headers, connections) => {
    const status = Number(statusLine.split(" ")[1]);
    const head = [statusLine, ...headers, "Content-Length: 2"].join("\r\n") + "\r\n\r\nok";
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import net from "node:net";
        let connections = 0;
        const server = net.createServer(sock => {
          connections++;
          sock.on("error", () => {});
          let buf = "";
          sock.on("data", d => {
            buf += d.toString("latin1");
            while (buf.includes("\\r\\n\\r\\n")) {
              buf = buf.slice(buf.indexOf("\\r\\n\\r\\n") + 4);
              sock.write(${JSON.stringify(head)});
            }
          });
        });
        server.listen(0, "127.0.0.1");
        await new Promise(r => server.on("listening", r));
        const url = "http://127.0.0.1:" + server.address().port + "/";
        const statuses = [];
        for (let i = 0; i < 4; i++) {
          const res = await fetch(url, { keepalive: true });
          statuses.push(res.status);
          await res.text();
        }
        console.log(JSON.stringify({ statuses, connections }));
        process.exit(0);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const result = stdout.startsWith("{") ? JSON.parse(stdout.trim()) : { stdout, stderr };
    expect({ result, exitCode }).toEqual({
      result: { statuses: [status, status, status, status], connections },
      exitCode: 0,
    });
  },
);

// Through a CONNECT proxy two status lines arrive on one connection. The
// proxy's reply to CONNECT only describes the hop to the proxy (tinyproxy,
// Apache mod_proxy_connect and older Squid all answer it with `HTTP/1.0 200`),
// so its version must not decide anything; the origin's response travelling
// inside the tunnel decides whether the tunnel is pooled, and its HTTP/1.0
// status line counts like a direct one. `tunnels` is how many times bun dialed
// the proxy for three sequential fetches: a pooled tunnel serves all three.
// Subprocess so the pool is private and so the machine's own NO_PROXY /
// HTTP_PROXY can't make fetch bypass the explicit proxy.
test.concurrent.each([
  ["HTTP/1.0 200 Connection established", "HTTP/1.1 200 OK", 1],
  ["HTTP/1.0 200 Connection established", "HTTP/1.0 200 OK\r\nConnection: keep-alive", 1],
  ["HTTP/1.1 200 Connection established", "HTTP/1.0 200 OK", 3],
] as [connectReply: string, originHead: string, tunnels: number][])(
  "CONNECT answered %j, origin answering %j: three fetches open %d tunnel(s)",
  async (connectReply, originHead, tunnels) => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import net from "node:net";
        import { createServer as createTlsServer } from "node:tls";
        // Answers every request on the connection it arrived on and never
        // closes, so a tunnel bun pooled keeps working and shows up as reuse.
        const origin = createTlsServer(${JSON.stringify(tls)}, sock => {
          sock.on("error", () => {});
          let buf = "";
          sock.on("data", d => {
            buf += d.toString("latin1");
            while (buf.includes("\\r\\n\\r\\n")) {
              buf = buf.slice(buf.indexOf("\\r\\n\\r\\n") + 4);
              sock.write(${JSON.stringify(originHead + "\r\nContent-Length: 2\r\n\r\nok")});
            }
          });
        });
        origin.listen(0, "127.0.0.1");
        await new Promise(r => origin.on("listening", r));

        let tunnels = 0;
        const proxy = net.createServer(client => {
          tunnels++;
          client.on("error", () => {});
          let head = "";
          const onHead = chunk => {
            head += chunk.toString("latin1");
            if (!head.includes("\\r\\n\\r\\n")) return;
            client.off("data", onHead);
            // bun sends nothing more until it has the reply, so piping right
            // after writing it can't miss any tunnel bytes.
            const upstream = net.connect(origin.address().port, "127.0.0.1", () => {
              client.write(${JSON.stringify(connectReply + "\r\n\r\n")});
              client.pipe(upstream);
              upstream.pipe(client);
            });
            upstream.on("error", () => client.destroy());
          };
          client.on("data", onHead);
        });
        proxy.listen(0, "127.0.0.1");
        await new Promise(r => proxy.on("listening", r));

        const responses = [];
        for (let i = 0; i < 3; i++) {
          const res = await fetch("https://localhost:" + origin.address().port + "/", {
            proxy: "http://127.0.0.1:" + proxy.address().port,
            tls: { rejectUnauthorized: false },
          });
          responses.push(res.status + ":" + (await res.text()));
        }
        console.log(JSON.stringify({ responses, tunnels }));
        process.exit(0);
        `,
      ],
      env: {
        ...bunEnv,
        NO_PROXY: undefined,
        no_proxy: undefined,
        HTTP_PROXY: undefined,
        http_proxy: undefined,
        HTTPS_PROXY: undefined,
        https_proxy: undefined,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const result = stdout.startsWith("{") ? JSON.parse(stdout.trim()) : { stdout, stderr };
    expect({ result, exitCode }).toEqual({
      result: { responses: ["200:ok", "200:ok", "200:ok"], tunnels },
      exitCode: 0,
    });
  },
  // Subprocess start plus up to three TLS handshakes takes ~2s on a debug
  // ASAN build here; leave room for slower CI runners.
  20_000,
);

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

// A server may send its final response (401, 413, ...) while a chunked
// ReadableStream request body is still uploading. That connection is then
// mid-message: the terminating 0\r\n\r\n was never written, so the server is
// still parsing it as the request body. It must be closed, never pooled --
// a pooled reuse writes the NEXT fetch's request line and credential headers
// (Authorization, Cookie) into the PREVIOUS request's body. Subprocess so the
// poisoned pool can't leak into other tests.
test("an early response to a streaming POST closes the socket instead of pooling it mid-chunked-body", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import net from "node:net";
      const connections = [];
      const server = net.createServer(sock => {
        const rec = { bytes: [], responded: false };
        connections.push(rec);
        sock.on("error", () => {});
        sock.on("data", d => {
          rec.bytes.push(d);
          if (!rec.responded) {
            rec.responded = true;
            // Final response long before the chunked upload is done.
            sock.write("HTTP/1.1 401 Unauthorized\\r\\nContent-Length: 0\\r\\n\\r\\n");
          } else {
            // A second burst on an already-answered connection means the next
            // request was written into the previous request's body. Reply with
            // a marker status so the poisoned follow-up fetch observes it
            // instead of hanging.
            sock.write("HTTP/1.1 299 Poisoned\\r\\nContent-Length: 0\\r\\n\\r\\n");
          }
        });
      });
      server.listen(0, "127.0.0.1");
      await new Promise(r => server.on("listening", r));
      const url = "http://127.0.0.1:" + server.address().port + "/";

      // One chunk, then stall: the chunked message never gets its terminator.
      let stall;
      const res1 = await fetch(url, {
        method: "POST",
        duplex: "half",
        body: new ReadableStream({
          pull(c) {
            if (!stall) {
              c.enqueue(new TextEncoder().encode("AAAA"));
              stall = new Promise(() => {});
            }
            return stall;
          },
        }),
      });
      const res2 = await fetch(url, { headers: { Authorization: "Bearer SECRET" } });
      const conn0 = Buffer.concat(connections[0].bytes).toString("latin1");
      console.log(JSON.stringify({
        status1: res1.status,
        status2: res2.status,
        connections: connections.length,
        authLeakedIntoFirstBody: conn0.includes("Authorization: Bearer SECRET"),
      }));
      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const result = stdout.startsWith("{") ? JSON.parse(stdout.trim()) : { stdout, stderr };
  expect({ result, exitCode }).toEqual({
    // Without the fix the 401'd connection is pooled: the second fetch is
    // written onto it (connections === 1), its request line and Authorization
    // header land inside request 1's chunked body on the wire, and it
    // resolves with the server's second-burst reply (299) instead of 401.
    result: { status1: 401, status2: 401, connections: 2, authLeakedIntoFirstBody: false },
    exitCode: 0,
  });
});

// Negative contract for the gate above: a streamed POST whose chunked body
// completed (terminator written) before the response arrived must still hand
// its connection back to the keep-alive pool.
test("a completed streaming POST keeps its connection in the keep-alive pool", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import net from "node:net";
      let connections = 0;
      const server = net.createServer(sock => {
        connections++;
        sock.on("error", () => {});
        let buf = "";
        sock.on("data", d => {
          buf += d.toString("latin1");
          // One response per fully-received chunked message (terminator seen).
          while (buf.includes("0\\r\\n\\r\\n")) {
            buf = buf.slice(buf.indexOf("0\\r\\n\\r\\n") + 5);
            sock.write("HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\n\\r\\nok");
          }
        });
      });
      server.listen(0, "127.0.0.1");
      await new Promise(r => server.on("listening", r));
      const url = "http://127.0.0.1:" + server.address().port + "/";

      const results = [];
      for (let i = 0; i < 8; i++) {
        const body = new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("hello"));
            c.close();
          },
        });
        const res = await fetch(url, { method: "POST", duplex: "half", body });
        results.push(res.status, await res.text());
      }
      console.log(JSON.stringify({ results, connections }));
      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const result = stdout.startsWith("{") ? JSON.parse(stdout.trim()) : { stdout, stderr };
  expect({ result, exitCode }).toEqual({
    result: { results: Array(8).fill([200, "ok"]).flat(), connections: 1 },
    exitCode: 0,
  });
});

// Raw HTTP/1.1 server for the redirect tests below, bound to 127.0.0.1 (the
// address fetch() dials). Every request is answered on the connection it came
// in on, so `connections` is exactly how many times bun dialed.
//   /302, /303, /307  bodyless redirect to /legit on a reusable connection
//   /302-close        the same 302 with Connection: close
//   /302-body         a 302 that carries a body
//   /302-http10       the same 302 from an HTTP/1.0 server (socket left open)
//   /302-http10-ka    ... that says Connection: keep-alive
//   anything else     200 whose body is "<method>:<request body length>"
const redirectServer = `
  import net from "node:net";
  let connections = 0;
  const server = net.createServer(sock => {
    connections++;
    sock.on("error", () => {});
    let buf = "";
    sock.on("data", d => {
      buf += d.toString("latin1");
      while (true) {
        const end = buf.indexOf("\\r\\n\\r\\n");
        if (end === -1) return;
        const head = buf.slice(0, end);
        const len = Number(/^content-length:\\s*(\\d+)/im.exec(head)?.[1] ?? 0);
        if (buf.length < end + 4 + len) return;
        buf = buf.slice(end + 4 + len);
        const [method, path] = head.split(" ");
        const redirect = {
          "/302": "302 Found",
          "/302-close": "302 Found",
          "/302-body": "302 Found",
          "/302-http10": "302 Found",
          "/302-http10-ka": "302 Found",
          "/303": "303 See Other",
          "/307": "307 Temporary Redirect",
        }[path];
        if (!redirect) {
          const body = method + ":" + len;
          sock.write("HTTP/1.1 200 OK\\r\\nContent-Length: " + body.length + "\\r\\n\\r\\n" + body);
        } else if (path === "/302-close") {
          sock.end("HTTP/1.1 " + redirect + "\\r\\nLocation: /legit\\r\\nContent-Length: 0\\r\\nConnection: close\\r\\n\\r\\n");
        } else if (path === "/302-body") {
          sock.write("HTTP/1.1 " + redirect + "\\r\\nLocation: /legit\\r\\nContent-Length: 5\\r\\n\\r\\nmoved");
        } else if (path === "/302-http10") {
          sock.write("HTTP/1.0 " + redirect + "\\r\\nLocation: /legit\\r\\nContent-Length: 0\\r\\n\\r\\n");
        } else if (path === "/302-http10-ka") {
          sock.write("HTTP/1.0 " + redirect + "\\r\\nLocation: /legit\\r\\nContent-Length: 0\\r\\nConnection: keep-alive\\r\\n\\r\\n");
        } else {
          sock.write("HTTP/1.1 " + redirect + "\\r\\nLocation: /legit\\r\\nContent-Length: 0\\r\\n\\r\\n");
        }
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await new Promise(r => server.on("listening", r));
  const origin = "http://127.0.0.1:" + server.address().port;
`;

// A bodyless 3xx on a keep-alive connection leaves that connection as reusable
// as any other completed exchange, so the hop (and every later fetch) should
// ride on it: four redirected fetches, one connection. This used to hold only
// for streamed request bodies; a request whose headers and body went out in a
// single write was never considered finished by the redirect path, so each
// redirect closed the connection and dialed again for the hop (5 connections
// here, one per redirect plus the first). Subprocess so the pool is private to
// the test.
test.concurrent.each([
  ["GET -> 302", "/302", "{}", "GET:0", 1],
  ["POST -> 303 (hop is a bodyless GET)", "/303", '{ method: "POST", body: "payload" }', "GET:0", 1],
  ["POST -> 307 (hop resends the body)", "/307", '{ method: "POST", body: "payload" }', "POST:7", 1],
  ["GET -> HTTP/1.0 302 with Connection: keep-alive", "/302-http10-ka", "{}", "GET:0", 1],
  // Not reusable, so every fetch dials once more for the hop; the hop's own
  // connection is pooled and carries the next fetch's 3xx. The HTTP/1.0 row is
  // what python -m http.server and its kind send: bun used to pool that
  // connection and write the hop onto it while the server was closing it.
  ["GET -> 302 with Connection: close", "/302-close", "{}", "GET:0", 5],
  ["GET -> 302 carrying a body", "/302-body", "{}", "GET:0", 5],
  ["GET -> HTTP/1.0 302", "/302-http10", "{}", "GET:0", 5],
])("redirect keep-alive: %s", async (_, path, init, hopBody, connections) => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      ${redirectServer}
      const results = [];
      for (let i = 0; i < 4; i++) {
        const res = await fetch(origin + ${JSON.stringify(path)}, ${init});
        results.push(res.status, res.redirected, await res.text());
      }
      console.log(JSON.stringify({ results, connections }));
      process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const result = stdout.startsWith("{") ? JSON.parse(stdout.trim()) : { stdout, stderr };
  expect({ result, exitCode }).toEqual({
    result: { results: Array(4).fill([200, true, hopBody]).flat(), connections },
    exitCode: 0,
  });
});

// What the pooling above must not relax: a response (redirect or final) that
// arrives while the request body is still going out leaves the connection
// mid-message. The next request has to dial a new connection; written onto the
// old one, its request line would land inside the unfinished upload, which the
// server below reports with a 299. The stream body never ends. The byte body
// is far larger than the loopback socket buffers on Linux and macOS, so bun
// gets the reply with most of it still unsent; Windows' loopback accepts the
// whole 64 MiB into kernel buffers at once, even with the peer not reading, so
// there the request really is fully sent and reusing the connection is
// legitimate (the server then sees the full body followed by the request).
const earlyReplyCases: [
  label: string,
  earlyReply: string,
  body: string,
  first: [number, string],
  onWindows: boolean,
][] = [
  [
    "303 while a ReadableStream body is still open",
    "HTTP/1.1 303 See Other\r\nLocation: /legit\r\nContent-Length: 0\r\n\r\n",
    "new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(4)); return new Promise(() => {}); } })",
    [200, "GET:0"],
    true,
  ],
  [
    "303 while a 64 MiB byte body is still being written",
    "HTTP/1.1 303 See Other\r\nLocation: /legit\r\nContent-Length: 0\r\n\r\n",
    "new Uint8Array(64 * 1024 * 1024)",
    [200, "GET:0"],
    false,
  ],
  [
    "200 while a 64 MiB byte body is still being written",
    "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n",
    "new Uint8Array(64 * 1024 * 1024)",
    [200, ""],
    false,
  ],
];
for (const [label, earlyReply, body, first, onWindows] of earlyReplyCases) {
  test.concurrent.skipIf(isWindows && !onWindows)(`a connection answered early (${label}) is not pooled`, async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import net from "node:net";
        let connections = 0;
        const server = net.createServer(sock => {
          connections++;
          sock.on("error", () => {});
          let buf = "";
          let answeredEarly = false;
          sock.on("data", d => {
            const chunk = d.toString("latin1");
            if (answeredEarly) {
              // Only the rest of the upload may follow the early reply.
              if (chunk.includes("GET /legit ")) {
                sock.write("HTTP/1.1 299 Poisoned\\r\\nContent-Length: 0\\r\\n\\r\\n");
              }
              return;
            }
            buf += chunk;
            const end = buf.indexOf("\\r\\n\\r\\n");
            if (end === -1) return;
            const head = buf.slice(0, end);
            buf = "";
            if (head.startsWith("POST /upload ")) {
              answeredEarly = true;
              sock.write(${JSON.stringify(earlyReply)});
            } else {
              const len = Number(/^content-length:\\s*(\\d+)/im.exec(head)?.[1] ?? 0);
              const res = head.split(" ")[0] + ":" + len;
              sock.write("HTTP/1.1 200 OK\\r\\nContent-Length: " + res.length + "\\r\\n\\r\\n" + res);
            }
          });
        });
        server.listen(0, "127.0.0.1");
        await new Promise(r => server.on("listening", r));
        const origin = "http://127.0.0.1:" + server.address().port;

        const res1 = await fetch(origin + "/upload", { method: "POST", duplex: "half", body: ${body} });
        const first = [res1.status, await res1.text()];
        const res2 = await fetch(origin + "/legit");
        const second = [res2.status, await res2.text()];
        console.log(JSON.stringify({ first, second, connections }));
        process.exit(0);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const result = stdout.startsWith("{") ? JSON.parse(stdout.trim()) : { stdout, stderr };
    expect({ result, exitCode }).toEqual({
      // The 303 rows' hop and the 200 row's follow-up fetch each dial the second
      // connection; the follow-up in the 303 rows then reuses the hop's.
      result: { first, second: [200, "GET:0"], connections: 2 },
      exitCode: 0,
    });
  });
}

test.skipIf(isWindows)("a full keep-alive pool evicts the longest-idle connection", async () => {
  function makeServer() {
    let connections = 0;
    const srv = createServer(sock => {
      connections++;
      let buf = "";
      sock.on("error", () => {});
      sock.on("data", d => {
        buf += d.toString("latin1");
        let i: number;
        while ((i = buf.indexOf("\r\n\r\n")) >= 0) {
          buf = buf.slice(i + 4);
          sock.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok");
        }
      });
    });
    return { srv, connections: () => connections };
  }
  // One more distinct origin than the pool holds (64). Without eviction the
  // last connection is closed instead of parked and its second request
  // opens a new one.
  const servers = Array.from({ length: 65 }, () => makeServer());
  for (const s of servers) s.srv.listen(0, "127.0.0.1");
  await Promise.all(servers.map(s => once(s.srv, "listening")));
  try {
    const urls = servers.map(s => `http://127.0.0.1:${(s.srv.address() as import("net").AddressInfo).port}/x`);
    for (const url of urls) expect(await (await fetch(url)).text()).toBe("ok");
    expect(await (await fetch(urls[64])).text()).toBe("ok");
    expect(servers[64].connections()).toBe(1);
  } finally {
    for (const s of servers) s.srv.close();
  }
});

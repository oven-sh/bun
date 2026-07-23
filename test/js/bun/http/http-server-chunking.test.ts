import type { Socket } from "bun";
import { setSocketOptions } from "bun:internal-for-testing";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isPosix } from "harness";

describe.if(isPosix)("HTTP server handles chunked transfer encoding", () => {
  test.concurrentIf(!isASAN)("handles fragmented chunk terminators", async () => {
    const script = `
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const body = await req.text();
          return new Response("Got: " + body);
        },
      });
      const { promise, resolve } = Promise.withResolvers();
      const socket = await Bun.connect({
        hostname: "localhost",
        port: server.port,
        socket: {
          data(socket, data) {
            console.log(data.toString());
            socket.end();
          },
          open(socket) {
            socket.write("POST / HTTP/1.1\\r\\nHost: localhost\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n4\\r\\nWiki\\r");
            socket.flush();
            setTimeout(() => {
              socket.write("\\n0\\r\\n\\r\\n");
              socket.flush();
            }, 50);
          },
          error() {},
          close() { resolve(); },
        },
      });
      await promise;
      server.stop();
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout).toContain("200 OK");
    expect(stdout).toContain("Got: Wiki");
    expect(exitCode).toBe(0);
  });

  test.concurrentIf(!isASAN)("rejects invalid terminator in fragmented reads", async () => {
    const script = `
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const body = await req.text();
          return new Response("Got: " + body);
        },
      });
      const { promise, resolve } = Promise.withResolvers();
      const socket = await Bun.connect({
        hostname: "localhost",
        port: server.port,
        socket: {
          data(socket, data) {
            console.log(data.toString());
            socket.end();
          },
          open(socket) {
            socket.write("POST / HTTP/1.1\\r\\nHost: localhost\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n4\\r\\nTestX");
            socket.flush();
            setTimeout(() => {
              socket.write("\\n0\\r\\n\\r\\n");
              socket.flush();
            }, 50);
          },
          error() {},
          close() { resolve(); },
        },
      });
      await promise;
      server.stop();
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout).toContain("400");
    expect(exitCode).toBe(0);
  });
});

describe.if(isPosix)("HTTP server handles split chunk-size CRLF", () => {
  test.concurrentIf(!isASAN)("handles lone CR at end of chunk-size line across TCP segments", async () => {
    // Regression test: when a TCP segment boundary falls between the \r and \n
    // of a chunk-size line (e.g. "5\r" in one segment, "\n..." in the next),
    // the server must buffer and resume correctly instead of spinning.
    const script = `
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const body = await req.text();
          return new Response("Got: " + body);
        },
      });
      const { promise, resolve } = Promise.withResolvers();
      const socket = await Bun.connect({
        hostname: "localhost",
        port: server.port,
        socket: {
          data(socket, data) {
            console.log(data.toString());
            socket.end();
          },
          open(socket) {
            // Send headers
            socket.write("PUT / HTTP/1.1\\r\\nHost: localhost\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n");
            socket.flush();
            // After a delay, send chunk size with lone \\r (no \\n yet)
            setTimeout(() => {
              socket.write("5\\r");
              socket.flush();
              // After another delay, send the rest: \\n, chunk data, and final chunk
              setTimeout(() => {
                socket.write("\\nHello\\r\\n0\\r\\n\\r\\n");
                socket.flush();
              }, 50);
            }, 50);
          },
          error() {},
          close() { resolve(); },
        },
      });
      await promise;
      server.stop();
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout).toContain("200 OK");
    expect(stdout).toContain("Got: Hello");
    expect(exitCode).toBe(0);
  });

  test.concurrentIf(!isASAN)("handles lone CR in chunk-size with extensions", async () => {
    // Same split but with a chunk extension before the CRLF
    const script = `
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          const body = await req.text();
          return new Response("Got: " + body);
        },
      });
      const { promise, resolve } = Promise.withResolvers();
      const socket = await Bun.connect({
        hostname: "localhost",
        port: server.port,
        socket: {
          data(socket, data) {
            console.log(data.toString());
            socket.end();
          },
          open(socket) {
            socket.write("PUT / HTTP/1.1\\r\\nHost: localhost\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n");
            socket.flush();
            setTimeout(() => {
              // chunk size with extension, CR split from LF
              socket.write("5;ext=val\\r");
              socket.flush();
              setTimeout(() => {
                socket.write("\\nHello\\r\\n0\\r\\n\\r\\n");
                socket.flush();
              }, 50);
            }, 50);
          },
          error() {},
          close() { resolve(); },
        },
      });
      await promise;
      server.stop();
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    expect(stdout).toContain("200 OK");
    expect(stdout).toContain("Got: Hello");
    expect(exitCode).toBe(0);
  });

  test.concurrentIf(!isASAN)("rejects chunk extensions that exceed the 16 KiB per-chunk cap", async () => {
    // A hostile client can hold a connection and unmetered inbound bandwidth by
    // streaming arbitrarily large chunk-extension bytes, which maxRequestBodySize
    // never sees. llhttp (Node) caps this at 16 KiB per chunk; Bun.serve must too.
    const script = `
      const server = Bun.serve({
        port: 0,
        maxRequestBodySize: 1024 * 1024,
        async fetch(req) {
          const n = (await req.arrayBuffer()).byteLength;
          return new Response("n=" + n);
        },
      });
      const { promise, resolve } = Promise.withResolvers();
      let received = "";
      const socket = await Bun.connect({
        hostname: "localhost",
        port: server.port,
        socket: {
          data(s, d) { received += d.toString(); },
          open(s) {
            // 20 KiB of extension bytes on one chunk-size line (cap is 16 KiB).
            // Body is 2 bytes, well under maxRequestBodySize.
            const ext = Buffer.alloc(20 * 1024, "e").toString();
            s.write("POST / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n2;" + ext + "\\r\\nhi\\r\\n0\\r\\n\\r\\n");
            s.flush();
          },
          error() {},
          close() { console.log(JSON.stringify({ received })); resolve(); },
        },
      });
      await promise;
      server.stop();
    `;

    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const { received } = JSON.parse(stdout);
    // Server must reject (413) and close the connection; it must not hand the
    // request to fetch() (which would answer 200 "n=2").
    expect(received).not.toContain("200");
    expect(received).not.toContain("n=2");
    expect(received).toContain("413");
    expect(exitCode).toBe(0);
  });

  test.concurrentIf(!isASAN)(
    "accepts small chunk extensions on every chunk (cap is per chunk, not per message)",
    async () => {
      // 10 chunks x 8 KiB extension each = 80 KiB total extension bytes, but each
      // chunk-size line is under the 16 KiB cap so the request must succeed.
      const script = `
      const server = Bun.serve({
        port: 0,
        async fetch(req) { return new Response("Got: " + (await req.text())); },
      });
      const { promise, resolve } = Promise.withResolvers();
      let received = "";
      const socket = await Bun.connect({
        hostname: "localhost",
        port: server.port,
        socket: {
          data(s, d) { received += d.toString(); },
          open(s) {
            const ext = Buffer.alloc(8 * 1024, "e").toString();
            let wire = "POST / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n";
            for (let i = 0; i < 10; i++) wire += "1;" + ext + "\\r\\nA\\r\\n";
            wire += "0\\r\\n\\r\\n";
            s.write(wire);
            s.flush();
          },
          error() {},
          close() { console.log(received); resolve(); },
        },
      });
      await promise;
      server.stop();
    `;

      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout).toContain("200 OK");
      expect(stdout).toContain("Got: AAAAAAAAAA");
      expect(exitCode).toBe(0);
    },
  );

  test.concurrentIf(!isASAN)("rejects bare LF in chunk-size position (invalid byte not stranded)", async () => {
    // A byte <=32 that isn't \r in chunk-size position must error immediately.
    // Previously this could strand the byte in HttpParser's fallback buffer,
    // corrupting header parsing on the next request.
    const script = `
      const server = Bun.serve({
        port: 0,
        async fetch(req) {
          try {
            await req.text();
            return new Response("OK");
          } catch {
            return new Response("Body error", { status: 400 });
          }
        },
      });
      const { promise, resolve } = Promise.withResolvers();
      let received = "";
      const socket = await Bun.connect({
        hostname: "localhost",
        port: server.port,
        socket: {
          data(socket, data) {
            received += data.toString();
          },
          open(socket) {
            // Bare LF (0x0A) where chunk-size hex is expected
            socket.write("PUT / HTTP/1.1\\r\\nHost: localhost\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n\\n");
            socket.flush();
          },
          error() {},
          close() {
            console.log(received);
            resolve();
          },
        },
      });
      await promise;
      server.stop();
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Server should reject with 400, not hang or accept
    expect(stderr).toBe("");
    expect(stdout).toContain("400");
    expect(exitCode).toBe(0);
  });

  test.concurrentIf(!isASAN)("rejects Content-Length values that would alias chunked-encoding state bits", async () => {
    // remainingStreamingBytes is shared between CL and chunked state. CL >= 2^59 would
    // set STATE_HAS_HEXDIG and route a fixed-length body into the chunked decoder.
    const script = `
      let urls = [];
      const server = Bun.serve({
        port: 0,
        async fetch(req) { urls.push(new URL(req.url).pathname); return new Response("OK"); },
      });
      const { promise, resolve } = Promise.withResolvers();
      let received = "";
      const socket = await Bun.connect({
        hostname: "localhost",
        port: server.port,
        socket: {
          data(s, d) { received += d.toString(); },
          async open(s) {
            s.write("GET /first HTTP/1.1\\r\\nHost: x\\r\\nContent-Length: 576460752303423488\\r\\n\\r\\n");
            s.flush();
            await Bun.sleep(20);
            s.write("\\r\\n\\r\\nGET /smuggled HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
            s.flush();
          },
          error() {},
          close() { console.log(JSON.stringify({ received, urls })); resolve(); },
        },
      });
      await promise;
      server.stop();
    `;

    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const { received, urls } = JSON.parse(stdout);
    expect(received).toContain("400");
    expect(urls).not.toContain("/smuggled");
    expect(exitCode).toBe(0);
  });

  describe.each([
    ["bare CRLF", "\\r\\n"],
    ["extension only", ";a=b\\r\\n"],
  ])("rejects chunk-size with zero hex digits (%s)", (_, chunkSizeLine) => {
    // RFC 7230 4.1: chunk-size = 1*HEXDIG. A chunk-size line with no hex digit
    // must be rejected. Previously this parsed as size 0 (last-chunk), allowing a
    // pipelined request after the bogus terminator to be smuggled.
    test.concurrentIf(!isASAN)("rejects and does not process trailing pipelined request", async () => {
      const script = `
        let requests = 0;
        const server = Bun.serve({
          port: 0,
          async fetch(req) {
            requests++;
            try {
              await req.text();
              return new Response("OK " + req.url);
            } catch {
              return new Response("Body error", { status: 400 });
            }
          },
        });
        const { promise, resolve } = Promise.withResolvers();
        let received = "";
        const socket = await Bun.connect({
          hostname: "localhost",
          port: server.port,
          socket: {
            data(socket, data) { received += data.toString(); },
            open(socket) {
              socket.write(
                "PUT /first HTTP/1.1\\r\\nHost: x\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n" +
                "${chunkSizeLine}\\r\\n" +
                "GET /smuggled HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n"
              );
              socket.flush();
            },
            error() {},
            close() { console.log(JSON.stringify({ received, requests })); resolve(); },
          },
        });
        await promise;
        server.stop();
      `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      const { received, requests } = JSON.parse(stdout);
      expect(received).toContain("400");
      expect(received).not.toContain("/smuggled");
      // The smuggled request must never reach the handler.
      expect(requests).toBeLessThanOrEqual(1);
      expect(exitCode).toBe(0);
    });

    test.concurrentIf(!isASAN)("rejects when chunk-size line is split across packets", async () => {
      const script = `
        const server = Bun.serve({
          port: 0,
          async fetch(req) {
            try { await req.text(); return new Response("OK"); }
            catch { return new Response("Body error", { status: 400 }); }
          },
        });
        const { promise, resolve } = Promise.withResolvers();
        let received = "";
        const socket = await Bun.connect({
          hostname: "localhost",
          port: server.port,
          socket: {
            data(socket, data) { received += data.toString(); },
            async open(socket) {
              socket.write("PUT / HTTP/1.1\\r\\nHost: x\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n");
              socket.flush();
              await Bun.sleep(20);
              socket.write("${chunkSizeLine}");
              socket.flush();
              await Bun.sleep(20);
              socket.write("\\r\\n");
              socket.flush();
            },
            error() {},
            close() { console.log(received); resolve(); },
          },
        });
        await promise;
        server.stop();
      `;

      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stderr).toBe("");
      expect(stdout).toContain("400");
      expect(exitCode).toBe(0);
    });
  });
});

describe.if(isPosix)("HTTP server handles fragmented requests", () => {
  test.concurrentIf(!isASAN)("handles requests with tiny send buffer (regression test)", async () => {
    using server = Bun.serve({
      hostname: "127.0.0.1",

      port: 0,
      async fetch(req) {
        const body = await req.text();
        const headers: Record<string, string> = {};
        req.headers.forEach((value, key) => {
          headers[key] = value;
        });
        return new Response(
          JSON.stringify({
            method: req.method,
            url: req.url,
            headers,
            body,
          }),
          {
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    });

    const { port } = server;
    // 10 == batchSize is deliberate: one full-width batch preserves the concurrent-accept
    // pressure. The old value of 100 repeated the same per-connection path 10x over.
    let remaining = 10;
    const batchSize = 10;

    for (let i = 0; i < remaining; i += batchSize) {
      const promises: Promise<void>[] = [];
      for (let j = 0; j < batchSize; j++) {
        promises.push(
          (async i => {
            const { resolve: resolveClose, reject: rejectClose, promise: closePromise } = Promise.withResolvers();

            let buffer: Buffer;
            let offset = 0;

            function actuallyWrite(socket) {
              while (offset < buffer.length) {
                const written = socket.write(buffer, offset, 1);

                if (written == 0) break;

                if (written > 1) {
                  throw new Error(`Written ${written} bytes, expected 1`);
                }
                socket.flush();
                offset += written;
              }
            }

            let remainingRequests = 20;

            const socket = await Bun.connect({
              hostname: server.hostname,
              port: server.port!,
              socket: {
                open(socket: Socket) {
                  // Set a very small send buffer to force fragmentation
                  // This simulates the condition that triggered the bug
                  setSocketOptions(socket, 1, 1); // 1 = send buffer, 1 = size

                  const input = `GET /test-${i} HTTP/1.1\r\nHost: ${server.hostname}:${port}\r\nUser-Agent: Bun-Test\r\nAccept: */*\r\n\r\n`;
                  const repeated = Buffer.alloc(input.length * remainingRequests, input);

                  buffer = repeated;
                  actuallyWrite(socket);
                },
                data(socket: Socket, data: Buffer) {
                  // Mini HTTP parser to count complete responses
                  const dataStr = data.toString();
                  const responses = dataStr.split("\r\n\r\n");

                  // Count complete responses (those that have both headers and body)
                  for (let k = 0; k < responses.length - 1; k++) {
                    if (responses[k].includes("HTTP/1.1 200 OK")) {
                      remainingRequests--;
                    }
                  }
                  if (remainingRequests == 0) {
                    socket.end();
                  }
                },
                close() {
                  if (remainingRequests > 0) {
                    throw new Error(`Expected 20 responses, got ${20 - remainingRequests}`);
                  }

                  resolveClose();
                },
                drain(socket: Socket) {
                  actuallyWrite(socket);
                },
                error(_socket: Socket, error: Error) {
                  rejectClose(error);
                },
              },
            });

            // Wait for the socket to close
            await closePromise;
          })(i),
        );
      }

      await Promise.all(promises);
    }

    server.stop();
  });

  // RFC 7230 4.1: after the last-chunk "0\r\n" comes trailer-part (zero or
  // more header lines) then the terminating CRLF. Those bytes belong to the
  // current message, so Bun.serve must consume them (discarded, since no
  // req.trailers is exposed here) and leave the keep-alive connection ready
  // for the next request.
  describe("chunked request trailer-part", () => {
    async function drive(
      bodyWrites: readonly string[],
      { pipeline }: { pipeline: boolean },
    ): Promise<{ paths: string[]; received: string }> {
      const paths: string[] = [];
      await using server = Bun.serve({
        port: 0,
        async fetch(req) {
          paths.push(new URL(req.url).pathname);
          let body = "";
          try {
            body = await req.text();
          } catch {}
          return new Response("body=" + body + ".");
        },
      });
      let received = "";
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      await Bun.connect({
        hostname: "127.0.0.1",
        port: server.port,
        socket: {
          data(_s, d) {
            received += d.toString();
          },
          async open(s) {
            s.write("POST /a HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n");
            for (const segment of bodyWrites) {
              s.write(segment);
              s.flush();
              // Yield to the I/O poll phase so the server sees each segment
              // in its own recv() and the state machine actually resumes
              // across packet boundaries.
              await new Promise<void>(r => setImmediate(r));
            }
            if (pipeline) {
              // Connection: close on the second request so the server closes
              // after both responses are fully written; waiting on socket
              // close avoids racing status-line counting against body
              // delivery.
              s.write("GET /b HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
              s.flush();
            }
          },
          error(_s, err) {
            reject(err);
          },
          close() {
            resolve();
          },
        },
      });
      await promise;
      return { paths, received };
    }

    test.concurrentIf(!isASAN).each([
      ["one write", ["5\r\nhello\r\n0\r\nX-Trail: one\r\nX-More: two\r\n\r\n"]],
      ["split mid trailer name", ["5\r\nhello\r\n0\r\nX", "-Trail: one\r\nX-More: two\r\n\r\n"]],
      ["split after last-chunk", ["5\r\nhello\r\n0\r\n", "X-Trail: one\r\n", "X-More: two\r\n", "\r\n"]],
      ["split on trailer CR", ["5\r\nhello\r\n0\r\nX-Trail: one\r", "\nX-More: two\r\n\r\n"]],
      ["split on terminating CR", ["5\r\nhello\r\n0\r\nX-Trail: one\r\nX-More: two\r\n\r", "\n"]],
      ["last-chunk with extension", ["5\r\nhello\r\n0;ext=v\r\nX-Trail: one\r\n\r\n"]],
    ] as const)("consumes trailer-part and preserves keep-alive (%s)", async (_, bodyWrites) => {
      const { paths, received } = await drive(bodyWrites, { pipeline: true });
      expect({ paths, bodies: received.match(/body=[a-z]*\./g) ?? [] }).toEqual({
        paths: ["/a", "/b"],
        bodies: ["body=hello.", "body=."],
      });
    });

    test.concurrentIf(!isASAN).each([
      ["bare LF on a trailer line", "5\r\nhello\r\n0\r\nX-T: 9\n\r\n"],
      ["CR not followed by LF", "5\r\nhello\r\n0\r\nX-T: 9\rZ\r\n\r\n"],
    ])("rejects a malformed trailer-part (%s)", async (_, body) => {
      const { paths, received } = await drive([body], { pipeline: false });
      expect({ paths, status: received.match(/HTTP\/1\.1 \d+/)?.[0] }).toEqual({
        paths: ["/a"],
        status: "HTTP/1.1 400",
      });
    });

    test.concurrentIf(!isASAN)(
      "rejects a trailer-part larger than the header-size limit with 431",
      async () => {
        const line = "X-T: " + Buffer.alloc(200, "v").toString() + "\r\n";
        const trailer = Buffer.alloc(17 * 1024, line).toString();
        const { paths, received } = await drive(["5\r\nhello\r\n0\r\n" + trailer + "\r\n"], { pipeline: true });
        expect({ paths, status: received.match(/HTTP\/1\.1 \d+/)?.[0] }).toEqual({
          paths: ["/a"],
          status: "HTTP/1.1 431",
        });
      },
    );
  });
});

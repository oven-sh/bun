import type { Server, ServerWebSocket, Socket } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, bunRun, rejectUnauthorizedScope, tempDirWithFiles, tls } from "harness";
import path from "path";

describe.concurrent("Server", () => {
  test("should not use 100% CPU when websocket is idle", async () => {
    const { stderr } = bunRun(path.join(import.meta.dir, "bun-websocket-cpu-fixture.js"));
    expect(stderr).toBe("");
  });
  test("normlizes incoming request URLs", async () => {
    using server = Bun.serve({
      fetch(request) {
        return new Response(request.url, {
          headers: {
            "Connection": "close",
          },
        });
      },
      port: 0,
    });
    const received: string[] = [];
    const expected: string[] = [];
    for (let path of [
      "/",
      "/../",
      "/./",
      "/foo",
      "/foo/",
      "/foo/bar",
      "/foo/bar/",
      "/foo/bar/..",
      "/foo/bar/../",
      "/foo/bar/../?123",
      "/foo/bar/../?123=456",
      "/foo/bar/../#123=456",
      "/",
      "/../",
      "/./",
      "/foo",
      "/foo/",
      "/foo/bar",
      "/foo/bar/",
      "/foo/bar/..",
      "/foo/bar/../",
      "/foo/bar/../?123",
      "/foo/bar/../?123=456",
      "/foo/bar/../#123=456",
      "/../".repeat(128),
      "/./".repeat(128),
      "/foo".repeat(128),
      "/foo/".repeat(128),
      "/foo/bar".repeat(128),
      "/foo/bar/".repeat(128),
      "/foo/bar/..".repeat(128),
      "/foo/bar/../".repeat(128),
      "/../".repeat(128),
      "/./".repeat(128),
      "/foo".repeat(128),
      "/foo/".repeat(128),
      "/foo/bar".repeat(128),
      "/foo/bar/".repeat(128),
      "/foo/bar/..".repeat(128),
      "/foo/bar/../".repeat(128),
    ]) {
      expected.push(new URL(path, "http://localhost:" + server.port).href);

      const { promise, resolve } = Promise.withResolvers();
      Bun.connect({
        hostname: server.hostname,
        port: server.port,

        socket: {
          async open(socket) {
            socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost:${server.port}\r\n\r\n`);
            await socket.flush();
          },
          async data(socket, data) {
            const lines = Buffer.from(data).toString("utf8");
            received.push(lines.split("\r\n\r\n").at(-1)!);
            await socket.end();
            resolve();
          },
        },
      });
      await promise;
    }

    expect(received).toEqual(expected);
  });

  test("should not allow Bun.serve without first argument being a object", () => {
    expect(() => {
      //@ts-ignore
      using server = Bun.serve();
    }).toThrow("Bun.serve expects an object");

    [undefined, null, 1, "string", true, false, Symbol("symbol")].forEach(value => {
      expect(() => {
        //@ts-ignore
        using server = Bun.serve(value);
      }).toThrow("Bun.serve expects an object");
    });
  });

  test("should not allow Bun.serve with invalid tls option", () => {
    [1, "string", true, Symbol("symbol")].forEach(value => {
      expect(() => {
        using server = Bun.serve({
          //@ts-ignore
          tls: value,
          fetch() {
            return new Response("Hello");
          },
          port: 0,
        });
      }).toThrow("TLSOptions must be an object");
    });
  });

  test("should allow Bun.serve using null or undefined tls option", () => {
    [null, undefined].forEach(value => {
      expect(() => {
        using server = Bun.serve({
          //@ts-ignore
          tls: value,
          fetch() {
            return new Response("Hello");
          },
          port: 0,
        });
      }).not.toThrow("TLSOptions must be an object");
    });
  });

  test("returns active port when initializing server with 0 port", () => {
    using server = Bun.serve({
      fetch() {
        return new Response("Hello");
      },
      port: 0,
    });

    expect(server.port).not.toBe(0);
    expect(server.port).toBeDefined();
  });

  test("allows connecting to server", async () => {
    using server = Bun.serve({
      fetch() {
        return new Response("Hello");
      },
      port: 0,
    });

    const response = await fetch(`http://${server.hostname}:${server.port}`);
    expect(await response.text()).toBe("Hello");
  });

  test("allows listen on IPV6", async () => {
    {
      using server = Bun.serve({
        hostname: "[::1]",
        fetch() {
          return new Response("Hello");
        },
        port: 0,
      });

      expect(server.port).not.toBe(0);
      expect(server.port).toBeDefined();
    }

    {
      using server = Bun.serve({
        hostname: "::1",
        fetch() {
          return new Response("Hello");
        },
        port: 0,
      });

      expect(server.port).not.toBe(0);
      expect(server.port).toBeDefined();
    }
  });

  test("abort signal on server", async () => {
    {
      let abortPromise = Promise.withResolvers();
      let fetchAborted = false;
      const abortController = new AbortController();
      using server = Bun.serve({
        async fetch(req) {
          req.signal.addEventListener("abort", () => {
            abortPromise.resolve();
          });
          abortController.abort();
          await abortPromise.promise;
          return new Response("Hello");
        },
        port: 0,
      });

      try {
        await fetch(`http://${server.hostname}:${server.port}`, { signal: abortController.signal }).then(res =>
          res.text(),
        );
      } catch (err: any) {
        expect(err).toBeDefined();
        expect(err?.name).toBe("AbortError");
        fetchAborted = true;
      }
      // wait for the server to process the abort signal, fetch may throw before the server processes the signal
      await abortPromise.promise;
      expect(fetchAborted).toBe(true);
    }
  });

  test("abort signal on server should only fire if aborted", async () => {
    {
      const abortController = new AbortController();

      let signalOnServer = false;
      let fetchAborted = false;
      using server = Bun.serve({
        async fetch(req) {
          req.signal.addEventListener("abort", () => {
            signalOnServer = true;
          });
          return new Response("Hello");
        },
        port: 0,
      });

      try {
        await fetch(`http://${server.hostname}:${server.port}`, { signal: abortController.signal }).then(res =>
          res.text(),
        );
      } catch {
        fetchAborted = true;
      }
      // wait for the server to process the abort signal, fetch may throw before the server processes the signal
      await Bun.sleep(15);
      expect(signalOnServer).toBe(false);
      expect(fetchAborted).toBe(false);
    }
  });

  test("abort signal on server with direct stream", async () => {
    {
      let signalOnServer = false;
      const abortController = new AbortController();

      using server = Bun.serve({
        async fetch(req) {
          req.signal.addEventListener("abort", () => {
            signalOnServer = true;
          });
          return new Response(
            new ReadableStream({
              type: "direct",
              async pull(controller) {
                abortController.abort();

                const buffer = await Bun.file(import.meta.dir + "/fixture.html.gz").arrayBuffer();
                controller.write(buffer);

                //wait to detect the connection abortion
                await Bun.sleep(15);

                controller.close();
              },
            }),
            {
              headers: {
                "Content-Encoding": "gzip",
                "Content-Type": "text/html; charset=utf-8",
                "Content-Length": "1",
              },
            },
          );
        },
        port: 0,
      });

      try {
        await fetch(`http://${server.hostname}:${server.port}`, { signal: abortController.signal }).then(res =>
          res.text(),
        );
      } catch {}
      await Bun.sleep(10);
      expect(signalOnServer).toBe(true);
    }
  });

  test("server.fetch should work with a string", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("Hello World!");
      },
    });
    {
      const url = `http://${server.hostname}:${server.port}/`;
      const response = await server.fetch(url);
      expect(await response.text()).toBe("Hello World!");
      expect(response.status).toBe(200);
      expect(response.url).toBe(url);
    }
  });

  test("server.fetch should work with a Request object", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("Hello World!");
      },
    });
    {
      const url = `http://${server.hostname}:${server.port}/`;
      const response = await server.fetch(new Request(url));
      expect(await response.text()).toBe("Hello World!");
      expect(response.status).toBe(200);
      expect(response.url).toBe(url);
    }
  });

  test("server should return a body for a OPTIONS Request", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("Hello World!");
      },
    });
    {
      const url = `http://${server.hostname}:${server.port}/`;
      const response = await fetch(
        new Request(url, {
          method: "OPTIONS",
        }),
      );
      expect(await response.text()).toBe("Hello World!");
      expect(response.status).toBe(200);
      expect(response.url).toBe(url);
    }
  });

  test("abort signal on server with stream", async () => {
    {
      let signalOnServer = false;
      const abortController = new AbortController();

      using server = Bun.serve({
        async fetch(req) {
          req.signal.addEventListener("abort", () => {
            signalOnServer = true;
          });

          return new Response(
            new ReadableStream({
              async pull(controller) {
                abortController.abort();

                const buffer = await Bun.file(import.meta.dir + "/fixture.html.gz").arrayBuffer();
                controller.enqueue(buffer);

                //wait to detect the connection abortion
                await Bun.sleep(15);
                controller.close();
              },
            }),
            {
              headers: {
                "Content-Encoding": "gzip",
                "Content-Type": "text/html; charset=utf-8",
                "Content-Length": "1",
              },
            },
          );
        },
        port: 0,
      });

      try {
        await fetch(`http://${server.hostname}:${server.port}`, { signal: abortController.signal }).then(res =>
          res.text(),
        );
      } catch {}
      await Bun.sleep(10);
      expect(signalOnServer).toBe(true);
    }
  });

  test("should not crash with big formData", async () => {
    const proc = Bun.spawn({
      cmd: [bunExe(), "big-form-data.fixture.js"],
      cwd: import.meta.dir,
      env: bunEnv,
    });
    await proc.exited;
    expect(proc.exitCode).toBe(0);
  });

  test("should be able to parse source map and fetch small stream", async () => {
    const { stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), path.join("js-sink-sourmap-fixture", "index.mjs")],
      cwd: import.meta.dir,
      env: bunEnv,
      stdin: "inherit",
      stderr: "inherit",
      stdout: "inherit",
    });
    expect(exitCode).toBe(0);
  });

  test("handshake failures should not impact future connections", async () => {
    using server = Bun.serve({
      tls,
      fetch() {
        return new Response("Hello");
      },
      port: 0,
    });
    const url = `${server.hostname}:${server.port}`;

    try {
      // This should fail because it's "http://" and not "https://"
      await fetch(`http://${url}`, { tls: { rejectUnauthorized: false } });
      expect.unreachable();
    } catch (err: any) {
      expect(err.code).toBe("ECONNRESET");
    }

    {
      const result = await fetch(server.url, { tls: { rejectUnauthorized: false } }).then(res => res.text());
      expect(result).toBe("Hello");
    }

    // Test that HTTPS keep-alive doesn't cause it to re-use the connection on
    // the next attempt, when the next attempt has reject unauthorized enabled
    {
      expect(
        async () => await fetch(server.url, { tls: { rejectUnauthorized: true } }).then(res => res.text()),
      ).toThrow("self signed certificate");
    }

    {
      using _ = rejectUnauthorizedScope(true);
      expect(async () => await fetch(server.url).then(res => res.text())).toThrow("self signed certificate");
    }

    {
      using _ = rejectUnauthorizedScope(false);
      const result = await fetch(server.url).then(res => res.text());
      expect(result).toBe("Hello");
    }
  });

  test("rejected promise handled by error method should not be logged", async () => {
    const { stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), path.join("rejected-promise-fixture.js")],
      cwd: import.meta.dir,
      env: bunEnv,
      stderr: "pipe",
    });
    expect(stderr.toString("utf-8")).toBeEmpty();
    expect(exitCode).toBe(0);
  });
});

// By not timing out, this test passes.
test("Bun.serve().unref() works", async () => {
  expect([path.join(import.meta.dir, "unref-fixture.ts")]).toRun();
});

test("unref keeps process alive for ongoing connections", async () => {
  expect([path.join(import.meta.dir, "unref-fixture-2.ts")]).toRun();
});

test("Bun does not crash when given invalid config", async () => {
  await using server1 = Bun.serve({
    fetch(request, server) {
      //
      throw new Error("Should not be called");
    },
    port: 0,
  });

  const cases = [
    {
      fetch() {},
      port: server1.port,
      websocket: {},
    },
    {
      port: server1.port,
      get websocket() {
        throw new Error();
      },
    },
    {
      fetch() {},
      port: server1.port,
      get websocket() {
        throw new Error();
      },
    },
    {
      fetch() {},
      port: server1.port,
      get tls() {
        throw new Error();
      },
    },
  ];

  for (const options of cases) {
    expect(() => {
      Bun.serve(options as any);
    }).toThrow();
  }
});

test("Bun should be able to handle utf16 inside Content-Type header #11316", async () => {
  using server = Bun.serve({
    port: 0,
    fetch() {
      const fileSuffix = "测试.html".match(/\.([a-z0-9]*)$/i)?.[1];

      return new Response("Hello World!\n", {
        headers: {
          "Content-Type": `text/${fileSuffix}`,
        },
      });
    },
  });

  const result = await fetch(server.url);
  expect(result.status).toBe(200);
  expect(result.headers.get("Content-Type")).toBe("text/html");
});

test("should be able to await server.stop()", async () => {
  const { promise, resolve } = Promise.withResolvers();
  const ready = Promise.withResolvers();
  const received = Promise.withResolvers();
  using server = Bun.serve({
    port: 0,
    // Avoid waiting for DNS resolution in fetch()
    hostname: "127.0.0.1",
    async fetch(req) {
      received.resolve();
      await ready.promise;
      return new Response("Hello World", {
        headers: {
          // Prevent Keep-Alive from keeping the connection open
          "Connection": "close",
        },
      });
    },
  });

  // Start the request
  const responsePromise = fetch(server.url);
  // Wait for the server to receive it.
  await received.promise;
  // Stop listening for new connections
  const stopped = server.stop();
  // Continue the request
  ready.resolve();
  // Wait for the response
  await (await responsePromise).text();
  // Wait for the server to stop
  await stopped;
  // Ensure the server is completely stopped
  expect(async () => await fetch(server.url)).toThrow();
});

test("should be able to await server.stop(true) with keep alive", async () => {
  const { promise, resolve } = Promise.withResolvers();
  const ready = Promise.withResolvers();
  const received = Promise.withResolvers();
  using server = Bun.serve({
    port: 0,
    // Avoid waiting for DNS resolution in fetch()
    hostname: "127.0.0.1",
    async fetch(req) {
      received.resolve();
      await ready.promise;
      return new Response("Hello World");
    },
  });

  // Start the request
  const responsePromise = fetch(server.url);
  // Wait for the server to receive it.
  await received.promise;
  // Stop listening for new connections
  const stopped = server.stop(true);
  // Continue the request
  ready.resolve();

  // Wait for the server to stop
  await stopped;

  // It should fail before the server responds
  expect(async () => {
    await (await responsePromise).text();
  }).toThrow();

  // Ensure the server is completely stopped
  expect(async () => await fetch(server.url)).toThrow();
});

test("should be able to async upgrade using custom protocol", async () => {
  const { promise, resolve } = Promise.withResolvers<{ code: number; reason: string } | boolean>();
  using server = Bun.serve<unknown>({
    port: 0,
    async fetch(req: Request, server: Server) {
      await Bun.sleep(1);

      if (server.upgrade(req)) return;
    },
    websocket: {
      close(ws: ServerWebSocket<unknown>, code: number, reason: string): void | Promise<void> {
        resolve({ code, reason });
      },
      message(ws: ServerWebSocket<unknown>, data: string): void | Promise<void> {
        ws.send("world");
      },
    },
  });

  const ws = new WebSocket(server.url.href, "ocpp1.6");
  ws.onopen = () => {
    ws.send("hello");
  };
  ws.onmessage = e => {
    console.log(e.data);
    resolve(true);
  };

  expect(await promise).toBe(true);
});

test("should be able to abrubtly close a upload request", async () => {
  const { promise, resolve } = Promise.withResolvers();
  const { promise: promise2, resolve: resolve2 } = Promise.withResolvers();
  using server = Bun.serve({
    port: 0,
    hostname: "localhost",
    maxRequestBodySize: 1024 * 1024 * 1024 * 16,
    async fetch(req) {
      let total_size = 0;
      req.signal.addEventListener("abort", resolve);
      try {
        for await (const chunk of req.body as ReadableStream) {
          total_size += chunk.length;
          if (total_size > 1024 * 1024 * 1024) {
            return new Response("too big", { status: 413 });
          }
        }
      } catch (e) {
        expect((e as Error)?.name).toBe("AbortError");
      } finally {
        resolve2();
      }

      return new Response("Received " + total_size);
    },
  });
  // ~100KB
  const chunk = Buffer.alloc(1024 * 100, "a");
  // ~1GB
  const MAX_PAYLOAD = 1024 * 1024 * 1024;
  const request = Buffer.from(
    `POST / HTTP/1.1\r\nHost: ${server.hostname}:${server.port}\r\nContent-Length: ${MAX_PAYLOAD}\r\n\r\n`,
  );

  type SocketInfo = { state: number; pending: Buffer | null };
  function tryWritePending(socket: Socket<SocketInfo>) {
    if (socket.data.pending === null) {
      // first write
      socket.data.pending = request;
    }
    const data = socket.data.pending as Buffer;
    const written = socket.write(data);
    if (written < data.byteLength) {
      // partial write
      socket.data.pending = data.slice(0, written);
      return false;
    }

    // full write got to next state
    if (socket.data.state === 0) {
      // request sent -> send chunk
      socket.data.pending = chunk;
    } else {
      // chunk sent -> delay shutdown
      setTimeout(() => socket.shutdown(), 100);
    }
    socket.data.state++;
    socket.flush();
    return true;
  }

  function trySend(socket: Socket<SocketInfo>) {
    while (socket.data.state < 2) {
      if (!tryWritePending(socket)) {
        return;
      }
    }
    return;
  }
  await Bun.connect({
    hostname: server.hostname,
    port: server.port,
    data: {
      state: 0,
      pending: null,
    } as SocketInfo,
    socket: {
      open: trySend,
      drain: trySend,
      data(socket, data) {},
    },
  });
  await Promise.all([promise, promise2]);
  expect().pass();
});

// This test is disabled because it can OOM the CI
test.skip("should be able to stream huge amounts of data", async () => {
  const buf = Buffer.alloc(1024 * 1024 * 256);
  const CONTENT_LENGTH = 3 * 1024 * 1024 * 1024;
  let received = 0;
  let written = 0;
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            while (written < CONTENT_LENGTH) {
              written += buf.byteLength;
              await controller.write(buf);
            }
            controller.close();
          },
        }),
        {
          headers: {
            "Content-Type": "text/plain",
            "Content-Length": CONTENT_LENGTH.toString(),
          },
        },
      );
    },
  });

  const response = await fetch(server.url);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("text/plain");
  const reader = (response.body as ReadableStream).getReader();
  while (true) {
    const { done, value } = await reader.read();
    received += value ? value.byteLength : 0;
    if (done) {
      break;
    }
  }
  expect(written).toBe(CONTENT_LENGTH);
  expect(received).toBe(CONTENT_LENGTH);
}, 30_000);

describe("HEAD requests #15355", () => {
  test("should be able to make HEAD requests with content-length or transfer-encoding (async)", async () => {
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        await Bun.sleep(1);
        if (req.method === "HEAD") {
          if (req.url.endsWith("/content-length")) {
            return new Response(null, {
              headers: {
                "Content-Length": "11",
              },
            });
          }
          return new Response(null, {
            headers: {
              "Transfer-Encoding": "chunked",
            },
          });
        }
        if (req.url.endsWith("/content-length")) {
          return new Response("Hello World");
        }
        return new Response(async function* () {
          yield "Hello";
          await Bun.sleep(1);
          yield " ";
          await Bun.sleep(1);
          yield "World";
        });
      },
    });

    {
      const response = await fetch(server.url + "/content-length");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBe("11");
      expect(await response.text()).toBe("Hello World");
    }
    {
      const response = await fetch(server.url + "/chunked");
      expect(response.status).toBe(200);
      expect(response.headers.get("transfer-encoding")).toBe("chunked");
      expect(await response.text()).toBe("Hello World");
    }

    {
      const response = await fetch(server.url + "/content-length", {
        method: "HEAD",
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBe("11");
      expect(await response.text()).toBe("");
    }
    {
      const response = await fetch(server.url + "/chunked", {
        method: "HEAD",
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("transfer-encoding")).toBe("chunked");
      expect(await response.text()).toBe("");
    }
  });

  test("should be able to make HEAD requests with content-length or transfer-encoding (sync)", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.method === "HEAD") {
          if (req.url.endsWith("/content-length")) {
            return new Response(null, {
              headers: {
                "Content-Length": "11",
              },
            });
          }
          return new Response(null, {
            headers: {
              "Transfer-Encoding": "chunked",
            },
          });
        }
        if (req.url.endsWith("/content-length")) {
          return new Response("Hello World");
        }
        return new Response(async function* () {
          yield "Hello";
          await Bun.sleep(1);
          yield " ";
          await Bun.sleep(1);
          yield "World";
        });
      },
    });

    {
      const response = await fetch(server.url + "/content-length");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBe("11");
      expect(await response.text()).toBe("Hello World");
    }
    {
      const response = await fetch(server.url + "/chunked");
      expect(response.status).toBe(200);
      expect(response.headers.get("transfer-encoding")).toBe("chunked");
      expect(await response.text()).toBe("Hello World");
    }

    {
      const response = await fetch(server.url + "/content-length", {
        method: "HEAD",
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBe("11");
      expect(await response.text()).toBe("");
    }
    {
      const response = await fetch(server.url + "/chunked", {
        method: "HEAD",
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("transfer-encoding")).toBe("chunked");
      expect(await response.text()).toBe("");
    }
  });

  test("should fallback to the body if content-length is missing in the headers", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.endsWith("/content-length")) {
          return new Response("Hello World", {
            headers: {
              "Content-Type": "text/plain",
              "X-Bun-Test": "1",
            },
          });
        }

        if (req.url.endsWith("/chunked")) {
          return new Response(
            async function* () {
              yield "Hello";
              await Bun.sleep(1);
              yield " ";
              await Bun.sleep(1);
              yield "World";
            },
            {
              headers: {
                "Content-Type": "text/plain",
                "X-Bun-Test": "1",
              },
            },
          );
        }

        return new Response(null, {
          headers: {
            "Content-Type": "text/plain",
            "X-Bun-Test": "1",
          },
        });
      },
    });
    {
      const response = await fetch(server.url + "/content-length", {
        method: "HEAD",
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBe("11");
      expect(response.headers.get("x-bun-test")).toBe("1");
      expect(await response.text()).toBe("");
    }
    {
      const response = await fetch(server.url + "/chunked", {
        method: "HEAD",
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("transfer-encoding")).toBe("chunked");
      expect(response.headers.get("x-bun-test")).toBe("1");
      expect(await response.text()).toBe("");
    }
    {
      const response = await fetch(server.url + "/null", {
        method: "HEAD",
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBe("0");
      expect(response.headers.get("x-bun-test")).toBe("1");
      expect(await response.text()).toBe("");
    }
  });

  test("HEAD requests should not have body", async () => {
    const dir = tempDirWithFiles("fsr", {
      "hello": "Hello World",
    });

    const filename = path.join(dir, "hello");
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        if (req.url.endsWith("/file")) {
          return new Response(Bun.file(filename));
        }
        return new Response("Hello World");
      },
    });

    {
      const response = await fetch(server.url);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBe("11");
      expect(await response.text()).toBe("Hello World");
    }
    {
      const response = await fetch(server.url + "/file");
      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBe("11");
      expect(await response.text()).toBe("Hello World");
    }

    function doHead(server: Server, path: string): Promise<{ headers: string; body: string }> {
      const { promise, resolve } = Promise.withResolvers();
      // use node net to make a HEAD request
      const net = require("net");
      const url = new URL(server.url);
      const socket = net.createConnection(url.port, url.hostname);
      socket.write(`HEAD ${path} HTTP/1.1\r\nHost: ${url.hostname}:${url.port}\r\n\r\n`);
      let body = "";
      let headers = "";
      socket.on("data", data => {
        body += data.toString();
        if (!headers) {
          const headerIndex = body.indexOf("\r\n\r\n");
          if (headerIndex !== -1) {
            headers = body.slice(0, headerIndex);
            body = body.slice(headerIndex + 4);

            setTimeout(() => {
              // wait to see if we get extra data
              resolve({ headers, body });
              socket.destroy();
            }, 100);
          }
        }
      });
      return promise as Promise<{ headers: string; body: string }>;
    }
    {
      const response = await fetch(server.url, {
        method: "HEAD",
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBe("11");
      expect(await response.text()).toBe("");
    }
    {
      const response = await fetch(server.url + "/file", {
        method: "HEAD",
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-length")).toBe("11");
      expect(await response.text()).toBe("");
    }
    {
      const { headers, body } = await doHead(server, "/");
      expect(headers.toLowerCase()).toContain("content-length: 11");
      expect(body).toBe("");
    }
    {
      const { headers, body } = await doHead(server, "/file");
      expect(headers.toLowerCase()).toContain("content-length: 11");
      expect(body).toBe("");
    }
  });

  describe("HEAD request should respect status", () => {
    test("status only without headers", async () => {
      using server = Bun.serve({
        port: 0,
        fetch(req) {
          return new Response(null, { status: 404 });
        },
      });
      const response = await fetch(server.url, { method: "HEAD" });
      expect(response.status).toBe(404);
      expect(response.headers.get("content-length")).toBe("0");
    });
    test("status only with headers", async () => {
      using server = Bun.serve({
        port: 0,
        fetch(req) {
          return new Response(null, {
            status: 404,
            headers: { "X-Bun-Test": "1", "Content-Length": "11" },
          });
        },
      });
      const response = await fetch(server.url, { method: "HEAD" });
      expect(response.status).toBe(404);
      expect(response.headers.get("content-length")).toBe("11");
      expect(response.headers.get("x-bun-test")).toBe("1");
    });

    test("status only with transfer-encoding", async () => {
      using server = Bun.serve({
        port: 0,
        fetch(req) {
          return new Response(null, { status: 404, headers: { "Transfer-Encoding": "chunked" } });
        },
      });
      const response = await fetch(server.url, { method: "HEAD" });
      expect(response.status).toBe(404);
      expect(response.headers.get("transfer-encoding")).toBe("chunked");
    });

    test("status only with body", async () => {
      using server = Bun.serve({
        port: 0,
        fetch(req) {
          return new Response("Hello World", { status: 404 });
        },
      });
      const response = await fetch(server.url, { method: "HEAD" });
      expect(response.status).toBe(404);
      expect(response.headers.get("content-length")).toBe("11");
      expect(await response.text()).toBe("");
    });

    test("should allow Strict-Transport-Security", async () => {
      using server = Bun.serve({
        port: 0,
        fetch(req) {
          return new Response("Hello World", {
            status: 200,
            headers: { "Strict-Transport-Security": "max-age=31536000" },
          });
        },
      });
      const response = await fetch(server.url, { method: "HEAD" });
      expect(response.status).toBe(200);
      expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
    });
  });
});

describe("websocket and routes test", () => {
  const serverConfigurations = [
    {
      // main route for upgrade
      routes: {
        "/": (req: Request, server: Server) => {
          if (server.upgrade(req)) return;
          return new Response("Forbidden", { status: 403 });
        },
      },
      shouldBeUpgraded: true,
      hasPOST: false,
      testName: "main route for upgrade",
    },
    {
      // Generic route for upgrade
      routes: {
        "/*": (req: Request, server: Server) => {
          if (server.upgrade(req)) return;
          return new Response("Forbidden", { status: 403 });
        },
      },
      shouldBeUpgraded: true,
      hasPOST: false,
      expectedPath: "/bun",
      testName: "generic route for upgrade",
    },
    // GET route for upgrade
    {
      routes: {
        "/ws": {
          GET: (req: Request, server: Server) => {
            if (server.upgrade(req)) return;
            return new Response("Forbidden", { status: 403 });
          },
          POST: (req: Request) => {
            return new Response(req.body);
          },
        },
      },
      shouldBeUpgraded: true,
      hasPOST: true,
      expectedPath: "/ws",
      testName: "GET route for upgrade",
    },
    // POST route and fetch route for upgrade
    {
      routes: {
        "/": {
          POST: (req: Request, server: Server) => {
            return new Response("Hello World");
          },
        },
      },
      fetch: (req: Request, server: Server) => {
        if (server.upgrade(req)) return;
        return new Response("Forbidden", { status: 403 });
      },
      shouldBeUpgraded: true,
      hasPOST: true,
      testName: "POST route + fetch route for upgrade",
    },
    // POST route for upgrade
    {
      routes: {
        "/": {
          POST: (req: Request, server: Server) => {
            return new Response("Hello World");
          },
        },
      },
      shouldBeUpgraded: false,
      hasPOST: true,
      testName: "POST route for upgrade and no fetch",
    },
    // fetch only
    {
      fetch: (req: Request, server: Server) => {
        if (server.upgrade(req)) return;
        return new Response("Forbidden", { status: 403 });
      },
      shouldBeUpgraded: true,
      hasPOST: false,
      testName: "fetch only for upgrade",
    },
  ];
  for (const config of serverConfigurations) {
    const { routes, fetch: serverFetch, shouldBeUpgraded, hasPOST, expectedPath, testName } = config;
    test(testName, async () => {
      using server = Bun.serve({
        port: 0,
        routes,
        fetch: serverFetch,
        websocket: {
          message: (ws, message) => {
            // PING PONG
            ws.send(`recv: ${message}`);
          },
        },
      });

      {
        const { promise, resolve, reject } = Promise.withResolvers();
        const url = new URL(server.url);
        url.pathname = expectedPath || "/";
        url.hostname = "127.0.0.1";
        const ws = new WebSocket(url.toString()); // bun crashes here
        ws.onopen = () => {
          ws.send("Hello server");
        };
        ws.onmessage = event => {
          resolve(event.data);
          ws.close();
        };
        let errorFired = false;
        ws.onerror = e => {
          errorFired = true;
          // Don't reject on error, we expect both error and close for failed upgrade
        };
        ws.onclose = event => {
          if (!shouldBeUpgraded) {
            // For failed upgrade, resolve with the close code
            resolve(event.code);
          } else {
            reject(event.code);
          }
        };
        if (shouldBeUpgraded) {
          const result = await promise;
          expect(result).toBe("recv: Hello server");
        } else {
          const result = await promise;
          expect(errorFired).toBe(true); // Error event should fire for failed upgrade
          expect(result).toBe(1002);
        }
        if (hasPOST) {
          const result = await fetch(url, {
            method: "POST",
            body: "Hello World",
          });
          expect(result.status).toBe(200);
          const body = await result.text();
          expect(body).toBe("Hello World");
        }
      }
    });
  }
});

test("should be able to redirect when using empty streams #15320", async () => {
  using server = Bun.serve({
    port: 0,
    websocket: void 0,
    async fetch(req, server2) {
      const url = new URL(req.url);
      if (url.pathname === "/redirect") {
        const emptyStream = new ReadableStream({
          start(controller) {
            // Immediately close the stream to make it empty
            controller.close();
          },
        });

        return new Response(emptyStream, {
          status: 307,
          headers: {
            location: "/",
          },
        });
      }

      return new Response("Hello, World");
    },
  });

  const response = await fetch(`http://localhost:${server.port}/redirect`);
  expect(await response.text()).toBe("Hello, World");
});

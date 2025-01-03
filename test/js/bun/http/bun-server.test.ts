import type { Server, ServerWebSocket, Socket } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, rejectUnauthorizedScope, tempDirWithFiles } from "harness";
import path from "path";

describe("Server", () => {
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
      }).toThrow("tls option expects an object");
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
      }).not.toThrow("tls option expects an object");
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
      let signalOnServer = false;
      let fetchAborted = false;
      const abortController = new AbortController();
      using server = Bun.serve({
        async fetch(req) {
          req.signal.addEventListener("abort", () => {
            signalOnServer = true;
          });
          abortController.abort();
          await Bun.sleep(15);
          return new Response("Hello");
        },
        port: 0,
      });

      try {
        await fetch(`http://${server.hostname}:${server.port}`, { signal: abortController.signal });
      } catch (err: any) {
        expect(err).toBeDefined();
        expect(err?.name).toBe("AbortError");
        fetchAborted = true;
      }
      // wait for the server to process the abort signal, fetch may throw before the server processes the signal
      await Bun.sleep(15);
      expect(signalOnServer).toBe(true);
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
        await fetch(`http://${server.hostname}:${server.port}`, { signal: abortController.signal });
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
        await fetch(`http://${server.hostname}:${server.port}`, { signal: abortController.signal });
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
        await fetch(`http://${server.hostname}:${server.port}`, { signal: abortController.signal });
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
      tls: {
        cert: "-----BEGIN CERTIFICATE-----\nMIIDrzCCApegAwIBAgIUHaenuNcUAu0tjDZGpc7fK4EX78gwDQYJKoZIhvcNAQEL\nBQAwaTELMAkGA1UEBhMCVVMxCzAJBgNVBAgMAkNBMRYwFAYDVQQHDA1TYW4gRnJh\nbmNpc2NvMQ0wCwYDVQQKDARPdmVuMREwDwYDVQQLDAhUZWFtIEJ1bjETMBEGA1UE\nAwwKc2VydmVyLWJ1bjAeFw0yMzA5MDYyMzI3MzRaFw0yNTA5MDUyMzI3MzRaMGkx\nCzAJBgNVBAYTAlVTMQswCQYDVQQIDAJDQTEWMBQGA1UEBwwNU2FuIEZyYW5jaXNj\nbzENMAsGA1UECgwET3ZlbjERMA8GA1UECwwIVGVhbSBCdW4xEzARBgNVBAMMCnNl\ncnZlci1idW4wggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC+7odzr3yI\nYewRNRGIubF5hzT7Bym2dDab4yhaKf5drL+rcA0J15BM8QJ9iSmL1ovg7x35Q2MB\nKw3rl/Yyy3aJS8whZTUze522El72iZbdNbS+oH6GxB2gcZB6hmUehPjHIUH4icwP\ndwVUeR6fB7vkfDddLXe0Tb4qsO1EK8H0mr5PiQSXfj39Yc1QHY7/gZ/xeSrt/6yn\n0oH9HbjF2XLSL2j6cQPKEayartHN0SwzwLi0eWSzcziVPSQV7c6Lg9UuIHbKlgOF\nzDpcp1p1lRqv2yrT25im/dS6oy9XX+p7EfZxqeqpXX2fr5WKxgnzxI3sW93PG8FU\nIDHtnUsoHX3RAgMBAAGjTzBNMCwGA1UdEQQlMCOCCWxvY2FsaG9zdIcEfwAAAYcQ\nAAAAAAAAAAAAAAAAAAAAATAdBgNVHQ4EFgQUF3y/su4J/8ScpK+rM2LwTct6EQow\nDQYJKoZIhvcNAQELBQADggEBAGWGWp59Bmrk3Gt0bidFLEbvlOgGPWCT9ZrJUjgc\nhY44E+/t4gIBdoKOSwxo1tjtz7WsC2IYReLTXh1vTsgEitk0Bf4y7P40+pBwwZwK\naeIF9+PC6ZoAkXGFRoyEalaPVQDBg/DPOMRG9OH0lKfen9OGkZxmmjRLJzbyfAhU\noI/hExIjV8vehcvaJXmkfybJDYOYkN4BCNqPQHNf87ZNdFCb9Zgxwp/Ou+47J5k4\n5plQ+K7trfKXG3ABMbOJXNt1b0sH8jnpAsyHY4DLEQqxKYADbXsr3YX/yy6c0eOo\nX2bHGD1+zGsb7lGyNyoZrCZ0233glrEM4UxmvldBcWwOWfk=\n-----END CERTIFICATE-----\n",
        key: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC+7odzr3yIYewR\nNRGIubF5hzT7Bym2dDab4yhaKf5drL+rcA0J15BM8QJ9iSmL1ovg7x35Q2MBKw3r\nl/Yyy3aJS8whZTUze522El72iZbdNbS+oH6GxB2gcZB6hmUehPjHIUH4icwPdwVU\neR6fB7vkfDddLXe0Tb4qsO1EK8H0mr5PiQSXfj39Yc1QHY7/gZ/xeSrt/6yn0oH9\nHbjF2XLSL2j6cQPKEayartHN0SwzwLi0eWSzcziVPSQV7c6Lg9UuIHbKlgOFzDpc\np1p1lRqv2yrT25im/dS6oy9XX+p7EfZxqeqpXX2fr5WKxgnzxI3sW93PG8FUIDHt\nnUsoHX3RAgMBAAECggEAAckMqkn+ER3c7YMsKRLc5bUE9ELe+ftUwfA6G+oXVorn\nE+uWCXGdNqI+TOZkQpurQBWn9IzTwv19QY+H740cxo0ozZVSPE4v4czIilv9XlVw\n3YCNa2uMxeqp76WMbz1xEhaFEgn6ASTVf3hxYJYKM0ljhPX8Vb8wWwlLONxr4w4X\nOnQAB5QE7i7LVRsQIpWKnGsALePeQjzhzUZDhz0UnTyGU6GfC+V+hN3RkC34A8oK\njR3/Wsjahev0Rpb+9Pbu3SgTrZTtQ+srlRrEsDG0wVqxkIk9ueSMOHlEtQ7zYZsk\nlX59Bb8LHNGQD5o+H1EDaC6OCsgzUAAJtDRZsPiZEQKBgQDs+YtVsc9RDMoC0x2y\nlVnP6IUDXt+2UXndZfJI3YS+wsfxiEkgK7G3AhjgB+C+DKEJzptVxP+212hHnXgr\n1gfW/x4g7OWBu4IxFmZ2J/Ojor+prhHJdCvD0VqnMzauzqLTe92aexiexXQGm+WW\nwRl3YZLmkft3rzs3ZPhc1G2X9QKBgQDOQq3rrxcvxSYaDZAb+6B/H7ZE4natMCiz\nLx/cWT8n+/CrJI2v3kDfdPl9yyXIOGrsqFgR3uhiUJnz+oeZFFHfYpslb8KvimHx\nKI+qcVDcprmYyXj2Lrf3fvj4pKorc+8TgOBDUpXIFhFDyM+0DmHLfq+7UqvjU9Hs\nkjER7baQ7QKBgQDTh508jU/FxWi9RL4Jnw9gaunwrEt9bxUc79dp+3J25V+c1k6Q\nDPDBr3mM4PtYKeXF30sBMKwiBf3rj0CpwI+W9ntqYIwtVbdNIfWsGtV8h9YWHG98\nJ9q5HLOS9EAnogPuS27walj7wL1k+NvjydJ1of+DGWQi3aQ6OkMIegap0QKBgBlR\nzCHLa5A8plG6an9U4z3Xubs5BZJ6//QHC+Uzu3IAFmob4Zy+Lr5/kITlpCyw6EdG\n3xDKiUJQXKW7kluzR92hMCRnVMHRvfYpoYEtydxcRxo/WS73SzQBjTSQmicdYzLE\ntkLtZ1+ZfeMRSpXy0gR198KKAnm0d2eQBqAJy0h9AoGBAM80zkd+LehBKq87Zoh7\ndtREVWslRD1C5HvFcAxYxBybcKzVpL89jIRGKB8SoZkF7edzhqvVzAMP0FFsEgCh\naClYGtO+uo+B91+5v2CCqowRJUGfbFOtCuSPR7+B3LDK8pkjK2SQ0mFPUfRA5z0z\nNVWtC0EYNBTRkqhYtqr3ZpUc\n-----END PRIVATE KEY-----\n",
      },
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
      expect(err.code).toBe("ConnectionClosed");
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

      expect(fileSuffix).toBeUTF16String();

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
});

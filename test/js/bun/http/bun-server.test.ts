import { describe, expect, test } from "bun:test";
import { bunExe, bunEnv } from "harness";
import path from "path";

describe("Server", () => {
  test("normlizes incoming request URLs", async () => {
    const server = Bun.serve({
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

    server.stop(true);
    expect(received).toEqual(expected);
  });

  test("should not allow Bun.serve without first argument being a object", () => {
    expect(() => {
      //@ts-ignore
      const server = Bun.serve();
      server.stop(true);
    }).toThrow("Bun.serve expects an object");

    [undefined, null, 1, "string", true, false, Symbol("symbol")].forEach(value => {
      expect(() => {
        //@ts-ignore
        const server = Bun.serve(value);
        server.stop(true);
      }).toThrow("Bun.serve expects an object");
    });
  });

  test("should not allow Bun.serve with invalid tls option", () => {
    [1, "string", true, Symbol("symbol"), false].forEach(value => {
      expect(() => {
        const server = Bun.serve({
          //@ts-ignore
          tls: value,
          fetch() {
            return new Response("Hello");
          },
          port: 0,
        });
        server.stop(true);
      }).toThrow("tls option expects an object");
    });
  });

  test("should allow Bun.serve using null or undefined tls option", () => {
    [null, undefined].forEach(value => {
      expect(() => {
        const server = Bun.serve({
          //@ts-ignore
          tls: value,
          fetch() {
            return new Response("Hello");
          },
          port: 0,
        });
        server.stop(true);
      }).not.toThrow("tls option expects an object");
    });
  });

  test("returns active port when initializing server with 0 port", () => {
    const server = Bun.serve({
      fetch() {
        return new Response("Hello");
      },
      port: 0,
    });

    expect(server.port).not.toBe(0);
    expect(server.port).toBeDefined();
    server.stop(true);
  });

  test("allows connecting to server", async () => {
    const server = Bun.serve({
      fetch() {
        return new Response("Hello");
      },
      port: 0,
    });

    const response = await fetch(`http://${server.hostname}:${server.port}`);
    expect(await response.text()).toBe("Hello");
    server.stop(true);
  });

  test("allows listen on IPV6", async () => {
    {
      const server = Bun.serve({
        hostname: "[::1]",
        fetch() {
          return new Response("Hello");
        },
        port: 0,
      });

      expect(server.port).not.toBe(0);
      expect(server.port).toBeDefined();
      server.stop(true);
    }

    {
      const server = Bun.serve({
        hostname: "::1",
        fetch() {
          return new Response("Hello");
        },
        port: 0,
      });

      expect(server.port).not.toBe(0);
      expect(server.port).toBeDefined();
      server.stop(true);
    }
  });

  test("abort signal on server", async () => {
    {
      let signalOnServer = false;
      const abortController = new AbortController();
      const server = Bun.serve({
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
      } catch {}
      expect(signalOnServer).toBe(true);
      server.stop(true);
    }
  });

  test("abort signal on server should only fire if aborted", async () => {
    {
      const abortController = new AbortController();

      let signalOnServer = false;
      const server = Bun.serve({
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
      } catch {}
      expect(signalOnServer).toBe(false);
      server.stop(true);
    }
  });

  test("abort signal on server with direct stream", async () => {
    {
      let signalOnServer = false;
      const abortController = new AbortController();

      const server = Bun.serve({
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
      server.stop(true);
    }
  });

  test("server.fetch should work with a string", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("Hello World!");
      },
    });
    try {
      const url = `http://${server.hostname}:${server.port}/`;
      const response = await server.fetch(url);
      expect(await response.text()).toBe("Hello World!");
      expect(response.status).toBe(200);
      expect(response.url).toBe(url);
    } finally {
      server.stop(true);
    }
  });

  test("server.fetch should work with a Request object", async () => {
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        return new Response("Hello World!");
      },
    });
    try {
      const url = `http://${server.hostname}:${server.port}/`;
      const response = await server.fetch(new Request(url));
      expect(await response.text()).toBe("Hello World!");
      expect(response.status).toBe(200);
      expect(response.url).toBe(url);
    } finally {
      server.stop(true);
    }
  });
  test("abort signal on server with stream", async () => {
    {
      let signalOnServer = false;
      const abortController = new AbortController();

      const server = Bun.serve({
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
      server.stop(true);
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
      stderr: "pipe",
    });
    expect(stderr).toBeEmpty();
    expect(exitCode).toBe(0);
  });

  test("handshake failures should not impact future connections", async () => {
    const server = Bun.serve({
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
      // should fail
      await fetch(`http://${url}`, { tls: { rejectUnauthorized: false } });
      expect.unreachable();
    } catch (err: any) {
      expect(err.code).toBe("ConnectionClosed");
    }

    try {
      const result = await fetch(`https://${url}`, { tls: { rejectUnauthorized: false } }).then(res => res.text());
      expect(result).toBe("Hello");
    } finally {
      server.stop(true);
    }
  });

  test("rejected promise handled by error method should not be logged", async () => {
    const { stderr, exitCode } = Bun.spawnSync({
      cmd: [bunExe(), path.join("rejected-promise-fixture.js")],
      cwd: import.meta.dir,
      env: bunEnv,
      stderr: "pipe",
    });
    expect(stderr).toBeEmpty();
    expect(exitCode).toBe(0);
  });
});

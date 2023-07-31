import { describe, expect, test } from "bun:test";

describe("Server", () => {
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
});

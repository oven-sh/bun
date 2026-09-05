import type { Server, ServerWebSocket, Socket } from "bun";
import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  bunRun,
  isWindows,
  normalizeBunSnapshot,
  rejectUnauthorizedScope,
  tempDir,
  tempDirWithFiles,
  tls,
} from "harness";
import path from "path";

describe.concurrent("Server", () => {
  test("should not use 100% CPU when websocket is idle", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "bun-websocket-cpu-fixture.js")],
      env: { ...bunEnv, NODE_ENV: undefined },
      cwd: import.meta.dir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr.trim()).toBe("");
    // The fixture prints its CPU% samples to stdout and exits nonzero when the idle CPU% is too high.
    expect(exitCode, stdout).toBe(0);
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
    expect({ status: response.status, text: await response.text() }).toEqual({ status: 200, text: "Hello" });
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
      const response = await fetch(`http://[::1]:${server.port}/`);
      expect({ status: response.status, text: await response.text() }).toEqual({ status: 200, text: "Hello" });
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
      const response = await fetch(`http://[::1]:${server.port}/`);
      expect({ status: response.status, text: await response.text() }).toEqual({ status: 200, text: "Hello" });
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
      const aborted = Promise.withResolvers<void>();
      const abortController = new AbortController();

      using server = Bun.serve({
        async fetch(req) {
          req.signal.addEventListener("abort", () => {
            signalOnServer = true;
            aborted.resolve();
          });
          return new Response(
            new ReadableStream({
              type: "direct",
              async pull(controller) {
                abortController.abort();

                const buffer = await Bun.file(import.meta.dir + "/fixture.html.gz").arrayBuffer();
                controller.write(buffer);

                // Keep the stream open until the server has observed the abort.
                await aborted.promise;

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
      await aborted.promise;
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
      const aborted = Promise.withResolvers<void>();
      const abortController = new AbortController();

      using server = Bun.serve({
        async fetch(req) {
          req.signal.addEventListener("abort", () => {
            signalOnServer = true;
            aborted.resolve();
          });

          return new Response(
            new ReadableStream({
              async pull(controller) {
                abortController.abort();

                const buffer = await Bun.file(import.meta.dir + "/fixture.html.gz").arrayBuffer();
                controller.enqueue(buffer);

                // Keep the stream open until the server has observed the abort.
                await aborted.promise;
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
      await aborted.promise;
      expect(signalOnServer).toBe(true);
    }
  });

  test("should not crash with big formData", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "big-form-data.fixture.js"],
      cwd: import.meta.dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The fixture exits 0 only when the server echoed the 45 MB field back intact.
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  test("should be able to parse source map and fetch small stream", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join("js-sink-sourmap-fixture", "index.mjs")],
      cwd: import.meta.dir,
      // The fixture falls back to port 3000 without this.
      env: { ...bunEnv, PORT: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Exit code 2 means the streamed body did not round-trip; 1 means the server threw.
    expect({ stdout: stdout.replace(/:\d+\.\.\./, ":<port>..."), stderr, exitCode }).toEqual({
      stdout: "Listening on http://localhost:<port>...\n",
      stderr: "",
      exitCode: 0,
    });
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
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join("rejected-promise-fixture.js")],
      cwd: import.meta.dir,
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The fixture exits 0 only when the error handler's "Hello" reached the client.
    expect({ stdout, stderr, exitCode }).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });
});

// By not timing out, this test passes.
test.concurrent("Bun.serve().unref() works", async () => {
  expect(await bunRun(path.join(import.meta.dir, "unref-fixture.ts"))).toSpawn("");
});

test.concurrent("unref keeps process alive for ongoing connections", async () => {
  expect(await bunRun(path.join(import.meta.dir, "unref-fixture-2.ts"))).toSpawn("Completed: 10");
});

test.concurrent("Bun does not crash when given invalid config", async () => {
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

test.concurrent("Bun should be able to handle utf16 inside Content-Type header #11316", async () => {
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
  expect({ status: result.status, contentType: result.headers.get("Content-Type"), text: await result.text() }).toEqual(
    { status: 200, contentType: "text/html", text: "Hello World!\n" },
  );
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

describe.concurrent("server.stop() drain promise counts open connections", () => {
  // The drain promise must not resolve while a connection is still open, and
  // a graceful stop() must actively drain: idle keep-alive connections close
  // right away, busy ones close as soon as their in-flight work completes.
  // The client never hangs up first, so every observed close below is
  // server-initiated; idleTimeout is long enough that a timeout-driven close
  // would flake the runtime budget long before firing.
  async function runDrainFixture(mode: "idle" | "inflight" | "inflightHead" | "force") {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const net = require("net");
          const mode = ${JSON.stringify(mode)};
          const inflight = Promise.withResolvers();
          const release = Promise.withResolvers();
          const server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            idleTimeout: 255,
            async fetch(req) {
              if (new URL(req.url).pathname === "/slow") {
                inflight.resolve();
                await release.promise;
              }
              return new Response("ok");
            },
          });
          const port = server.port;
          const c = net.connect(port, "127.0.0.1");
          let buf = "";
          let events = [];
          c.on("data", d => (buf += d));
          c.on("close", () => events.push("close"));
          c.on("error", () => {});
          await new Promise((resolve, reject) => {
            c.on("connect", resolve);
            c.on("error", reject);
          });
          const method = mode === "inflightHead" ? "HEAD" : "GET";
          c.write(method + " /" + (mode === "idle" ? "fast" : "slow") + " HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
          if (mode === "idle") {
            while (!buf.includes("\\r\\nok")) await new Promise(r => setImmediate(r));
          } else {
            await inflight.promise;
          }
          const pendingBeforeStop = server.pendingRequests;
          let resolved = false;
          const stopped = server.stop(false).then(() => { resolved = true; });
          await new Promise(r => setImmediate(r));
          const resolvedEarly = resolved;
          let responseAfterStop = false;
          if (mode === "inflight" || mode === "inflightHead") {
            // The held request completes; its full response must reach the
            // client before the server closes the now-idle connection. A HEAD
            // response has no body, so its completion goes through the
            // no-body end path rather than internalEnd.
            release.resolve();
            const doneMark = mode === "inflightHead" ? "\\r\\n\\r\\n" : "\\r\\nok";
            while (!buf.includes(doneMark) && !events.includes("close")) await new Promise(r => setImmediate(r));
            responseAfterStop = buf.includes(doneMark);
          } else if (mode === "force") {
            // Escalation cuts the still-held request; release the handler so
            // the aborted request can settle.
            server.stop(true);
            release.resolve();
          }
          await stopped;
          // The client socket's 'close' and the server-side filter → promise
          // resolution race; poll so the assertion is order-independent.
          let closed = events.includes("close");
          const until = Date.now() + 2000;
          while (!closed && Date.now() < until) {
            await new Promise(r => setImmediate(r));
            closed = events.includes("close");
          }
          console.log(JSON.stringify({
            pendingBeforeStop,
            resolvedEarly,
            responseAfterStop,
            resolved,
            closed,
            pendingAfterStop: server.pendingRequests,
            statusLine: buf.split("\\r\\n")[0],
          }));
          c.destroy();
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stderr, out: JSON.parse(stdout.trim() || "null"), exitCode };
  }

  test("stop() closes an idle keep-alive connection and the promise resolves", async () => {
    // The sweep closes the socket inside stop() itself, so the promise may
    // already be resolved one tick later; resolvedEarly is not meaningful.
    expect(await runDrainFixture("idle")).toEqual({
      stderr: "",
      out: {
        pendingBeforeStop: 0,
        resolvedEarly: expect.any(Boolean),
        responseAfterStop: false,
        resolved: true,
        closed: true,
        pendingAfterStop: 0,
        statusLine: "HTTP/1.1 200 OK",
      },
      exitCode: 0,
    });
  });

  test("in-flight request completes across stop(), then its connection is closed", async () => {
    expect(await runDrainFixture("inflight")).toEqual({
      stderr: "",
      out: {
        pendingBeforeStop: 1,
        resolvedEarly: false,
        responseAfterStop: true,
        resolved: true,
        closed: true,
        pendingAfterStop: 0,
        statusLine: "HTTP/1.1 200 OK",
      },
      exitCode: 0,
    });
  });

  test("in-flight HEAD request completes across stop(), then its connection is closed", async () => {
    expect(await runDrainFixture("inflightHead")).toEqual({
      stderr: "",
      out: {
        pendingBeforeStop: 1,
        resolvedEarly: false,
        responseAfterStop: true,
        resolved: true,
        closed: true,
        pendingAfterStop: 0,
        statusLine: "HTTP/1.1 200 OK",
      },
      exitCode: 0,
    });
  });

  test("a handler rejection on a HEAD request still closes its drained connection", async () => {
    // The production 500 for a rejected handler renders from the rejection
    // microtask, uncorked, and a HEAD response ends without a body: no cork
    // or parser gate runs, so RequestContext::end_without_body has to run the
    // close gate itself for the stop() mark to take effect.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const net = require("net");
          const inflight = Promise.withResolvers();
          const release = Promise.withResolvers();
          const server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            idleTimeout: 255,
            development: false,
            async fetch() {
              inflight.resolve();
              await release.promise;
              throw new Error("boom");
            },
          });
          const c = net.connect(server.port, "127.0.0.1");
          let buf = "";
          const closed = Promise.withResolvers();
          c.on("data", d => (buf += d));
          c.on("close", () => closed.resolve());
          c.on("error", () => {});
          await new Promise((resolve, reject) => { c.on("connect", resolve); c.on("error", reject); });
          c.write("HEAD /slow HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
          await inflight.promise;
          let resolved = false;
          const stopped = server.stop(false).then(() => { resolved = true; });
          await new Promise(r => setImmediate(r));
          const resolvedEarly = resolved;
          // The handler rejects; the 500 head renders from the microtask and
          // the drained connection must close on its own.
          release.resolve();
          await stopped;
          await closed.promise;
          console.log(JSON.stringify({ resolvedEarly, statusLine: buf.split("\\r\\n")[0], resolved }));
          // The rejected handler marks the process exit code; the drain
          // assertions above are what this test is about.
          process.exit(0);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    // The rejected handler is logged to stderr by design; drain it but assert
    // only the drain behavior.
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ out: JSON.parse(stdout.trim() || "null"), exitCode }).toEqual({
      out: { resolvedEarly: false, statusLine: "HTTP/1.1 500 Internal Server Error", resolved: true },
      exitCode: 0,
    });
  });

  test("stop(true) after stop(false) force-closes the still-busy connection", async () => {
    // The cut connection never receives a response, so its buffer stays empty.
    expect(await runDrainFixture("force")).toEqual({
      stderr: "",
      out: {
        pendingBeforeStop: 1,
        resolvedEarly: false,
        responseAfterStop: false,
        resolved: true,
        closed: true,
        pendingAfterStop: 0,
        statusLine: "",
      },
      exitCode: 0,
    });
  });

  test("a connection mid-request survives stop() until the client closes", async () => {
    // A connection that is receiving a request ("sending a request" - Node's
    // idle definition excludes it) is spared by the graceful sweep, and with
    // no dispatched request the connection count is the only term holding the
    // drain promise open. The mid-request state is staged as a partial second
    // request head on a keep-alive connection that already completed a full
    // request, so the server demonstrably owns the socket. If the sweep still
    // closed it, the partial head had not arrived when stop() ran (on a loaded
    // host the bytes can lag the client's write by longer than any fixed tick
    // budget, and a connection whose bytes the server never saw is closed as
    // idle) - that round proves nothing and is retried on a fresh server.
    //
    // Two variants run on confirmed-spared rounds:
    // - destroy: the promise keeps pending until the client hangs up.
    // - complete: the client finishes the head after stop(); the request must
    //   still dispatch and be answered (the close-when-idle mark has to
    //   survive the dispatch's response-state reset, which only spares
    //   connection-scoped bits), and then the mark closes the served
    //   connection and the drain resolves.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const net = require("net");
          async function round(completeHead) {
            const server = Bun.serve({
              port: 0,
              hostname: "127.0.0.1",
              idleTimeout: 255,
              fetch: () => new Response("ok"),
            });
            const c = net.connect(server.port, "127.0.0.1");
            const state = { buf: "", closed: false };
            c.on("data", d => (state.buf += d));
            c.on("close", () => (state.closed = true));
            c.on("error", () => {});
            await new Promise((resolve, reject) => { c.on("connect", resolve); c.on("error", reject); });
            c.write("GET /first HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
            while (!state.buf.includes("\\r\\nok")) await new Promise(r => setImmediate(r));
            // Half of a second request's head: mid-request, nothing dispatched.
            c.write("GET /second HTTP/1.1\\r\\nHost: x\\r\\n");
            // Yield so the server's parser can consume the head (stop() runs
            // its sweep synchronously, and a head still in the kernel buffer
            // leaves the connection idle). No tick budget is guaranteed to be
            // enough - the void-round classification below covers the misses.
            for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
            let resolved = false;
            const stopped = server.stop(false).then(() => { resolved = true; });
            // The promise must stay pending while the mid-request connection
            // is open; the client never hangs up during this window, so only
            // the sweep can close the socket.
            for (let i = 0; i < 20 && !resolved && !state.closed; i++) {
              await new Promise(r => setImmediate(r));
            }
            if (resolved || state.closed) {
              // Server-initiated close: the sweep saw the connection idle
              // because the partial head had not arrived yet. Correct for an
              // idle connection, but not the state under test - void round.
              // A resolution with the socket left open would be the bug.
              const until = Date.now() + 2000;
              while (!state.closed && Date.now() < until) await new Promise(r => setImmediate(r));
              if (!state.closed) return { fail: "stop() resolved while a mid-request connection was open" };
              await stopped;
              c.destroy();
              return null;
            }
            // Confirmed: the sweep spared the mid-request connection, so the
            // partial head was parsed and the close-when-idle mark is set.
            if (completeHead) {
              // Finish the head: the request dispatches on the marked
              // connection, its response reaches the client, then the mark
              // closes the drained connection (the client never hangs up).
              c.write("\\r\\n");
              while (!state.closed) await new Promise(r => setImmediate(r));
              await stopped;
              return {
                resolved: true,
                closed: true,
                secondServed: (state.buf.match(/\\r\\nok/g) || []).length === 2,
              };
            }
            c.destroy();
            await stopped;
            const until = Date.now() + 2000;
            while (!state.closed && Date.now() < until) await new Promise(r => setImmediate(r));
            return { resolved: true, closed: state.closed };
          }
          const results = {};
          for (let attempt = 1; attempt <= 16 && (!results.destroy || !results.complete); attempt++) {
            const variant = results.destroy ? "complete" : "destroy";
            const r = await round(variant === "complete");
            if (r === null) continue;
            if (r.fail) { console.error(r.fail); process.exit(1); }
            results[variant] = r;
          }
          if (!results.destroy || !results.complete) {
            console.error("every round raced: the partial head never arrived before stop()");
            process.exit(1);
          }
          console.log(JSON.stringify(results));
          process.exit(0);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, out: JSON.parse(stdout.trim() || "null"), exitCode }).toEqual({
      stderr: "",
      out: {
        destroy: { resolved: true, closed: true },
        complete: { resolved: true, closed: true, secondServed: true },
      },
      exitCode: 0,
    });
  });

  test("in-flight Bun.file (sendfile) response completes across stop(), then its connection is closed", async () => {
    // The sendfile completion path (uws_res_end_sendfile) bypasses internalEnd
    // and returns `false` to uWS's onWritable, so none of the parser-side
    // shouldCloseConnection() gates run; the explicit gate after the stream's
    // on_complete is what closes the drained connection here.
    const dir = tempDirWithFiles("drain-sendfile", {});
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const net = require("net");
          const SIZE = 16 * 1024 * 1024;
          await Bun.write("big.bin", Buffer.alloc(SIZE, "x"));
          const server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            idleTimeout: 255,
            fetch: () => new Response(Bun.file("big.bin")),
          });
          const c = net.connect(server.port, "127.0.0.1");
          // Parse the response framing so the assertion is on body bytes, not
          // raw socket bytes (headers must not mask a truncated body).
          let head = "";
          let headDone = false;
          let contentLength = -1;
          let bodyBytes = 0;
          let sawClose = false;
          const firstData = Promise.withResolvers();
          c.on("data", d => {
            if (!headDone) {
              head += d.toString("latin1");
              const he = head.indexOf("\\r\\n\\r\\n");
              if (he !== -1) {
                headDone = true;
                contentLength = +(/\\r\\ncontent-length: *(\\d+)/i.exec(head.slice(0, he))?.[1] ?? -1);
                bodyBytes = head.length - he - 4;
              }
            } else {
              bodyBytes += d.length;
            }
            firstData.resolve();
          });
          c.on("close", () => (sawClose = true));
          c.on("error", () => {});
          await new Promise((resolve, reject) => { c.on("connect", resolve); c.on("error", reject); });
          c.write("GET / HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
          // First bytes of the response have arrived; 16 MB cannot fit in the
          // socket buffers, so the transfer is still in flight server-side.
          await firstData.promise;
          c.pause();
          let resolved = false;
          const stopped = server.stop(false).then(() => { resolved = true; });
          await new Promise(r => setImmediate(r));
          const resolvedEarly = resolved;
          c.resume();
          // The full body must arrive, then the server closes the connection
          // (the client never hangs up; idleTimeout is far beyond the test
          // budget, so only the drain can close it).
          while (!sawClose) await new Promise(r => setImmediate(r));
          await stopped;
          console.log(JSON.stringify({ resolvedEarly, contentLength, bodyBytes, resolved }));
        `,
      ],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, out: JSON.parse(stdout.trim() || "null"), exitCode }).toEqual({
      stderr: "",
      out: { resolvedEarly: false, contentLength: 16 * 1024 * 1024, bodyBytes: 16 * 1024 * 1024, resolved: true },
      exitCode: 0,
    });
  });

  test("a response completing inside another socket's parse window still closes its drained connection", async () => {
    // internalEnd's post-uncork close gate must key on WHICH socket the
    // parser is on, not the context-wide isParsingHttp bit: B's parked
    // response below completes in the microtask drain inside A's onData
    // (A's body completion resolves it), and B gets no later gate of its
    // own. With the context-wide bit, B lingered until idleTimeout and
    // stop() hung.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const net = require("net");
          const releaseB = Promise.withResolvers();
          const bHeld = Promise.withResolvers();
          const aStarted = Promise.withResolvers();
          const server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            idleTimeout: 255,
            async fetch(req) {
              const path = new URL(req.url).pathname;
              if (path === "/hold") {
                bHeld.resolve();
                await releaseB.promise;
                return new Response("held");
              }
              if (path === "/poke") {
                aStarted.resolve();
                // Parks until the body arrives after stop(). The fin chunk is
                // delivered inside A's parse window, so this continuation -
                // and B's completion, which it unblocks - runs in that
                // window's microtask drain.
                await req.text();
                releaseB.resolve();
                return new Response("poked");
              }
              return new Response("ok");
            },
          });
          function dial() {
            const c = net.connect(server.port, "127.0.0.1");
            const state = { c, buf: "", closed: false };
            c.on("data", d => (state.buf += d));
            c.on("close", () => (state.closed = true));
            c.on("error", () => {});
            return new Promise((res, rej) => {
              c.on("connect", () => res(state));
              c.on("error", rej);
            });
          }
          const b = await dial();
          b.c.write("GET /hold HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
          await bHeld.promise;
          const a = await dial();
          // Complete head, held body: once the handler has started, A is
          // dispatched and demonstrably owned by the server, and it stays
          // busy at the sweep, so it is spared and marked close-when-idle.
          // (A partial head could not be awaited: nothing observable fires
          // for it, and on a loaded host its bytes can lag the client's
          // write past the sweep, leaving the connection invisible to it.)
          a.c.write("POST /poke HTTP/1.1\\r\\nHost: x\\r\\nContent-Length: 2\\r\\n\\r\\n");
          await aStarted.promise;
          let resolved = false;
          const stopped = server.stop(false).then(() => { resolved = true; });
          await new Promise(r => setImmediate(r));
          const resolvedEarly = resolved;
          // Complete A's body; the handler resumes inside A's parse window
          // and resolves B. Both responses must be delivered, then both
          // connections close server-initiated and the drain promise
          // resolves.
          a.c.write("hi");
          while (!a.closed || !b.closed) await new Promise(r => setImmediate(r));
          await stopped;
          console.log(JSON.stringify({
            resolvedEarly,
            aGotResponse: a.buf.includes("poked"),
            bGotResponse: b.buf.includes("held"),
            resolved,
          }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, out: JSON.parse(stdout.trim() || "null"), exitCode }).toEqual({
      stderr: "",
      out: { resolvedEarly: false, aGotResponse: true, bGotResponse: true, resolved: true },
      exitCode: 0,
    });
  });

  test("closeIdleConnections() is a one-shot sweep that spares busy connections and keeps listening", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const net = require("net");
          const inflight = Promise.withResolvers();
          const release = Promise.withResolvers();
          const server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            idleTimeout: 255,
            async fetch(req) {
              if (new URL(req.url).pathname === "/slow") {
                inflight.resolve();
                await release.promise;
              }
              return new Response("ok");
            },
          });
          const port = server.port;
          function dial() {
            const c = net.connect(port, "127.0.0.1");
            const state = { c, buf: "", closed: false };
            c.on("data", d => (state.buf += d));
            c.on("close", () => (state.closed = true));
            c.on("error", () => {});
            return new Promise((resolve, reject) => {
              c.on("connect", () => resolve(state));
              c.on("error", reject);
            });
          }
          const countOks = s => (s.buf.match(/\\r\\nok/g) || []).length;
          const idle = await dial();
          idle.c.write("GET /fast HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
          while (countOks(idle) < 1) await new Promise(r => setImmediate(r));
          const busy = await dial();
          busy.c.write("GET /slow HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
          await inflight.promise;

          const closedFirst = server.closeIdleConnections();
          // Idle connection closes; the busy one is spared.
          while (!idle.closed) await new Promise(r => setImmediate(r));
          const busyClosedBySweep = busy.closed;
          release.resolve();
          while (countOks(busy) < 1) await new Promise(r => setImmediate(r));
          // One-shot: the spared connection was not marked close-when-idle, so
          // it keeps serving keep-alive requests after its response completed.
          busy.c.write("GET /fast HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
          while (countOks(busy) < 2) await new Promise(r => setImmediate(r));
          // The listener is untouched: a fresh connection still gets served.
          const fresh = await dial();
          fresh.c.write("GET /fast HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
          while (countOks(fresh) < 1) await new Promise(r => setImmediate(r));
          // Both surviving connections are idle keep-alive now; a second
          // sweep closes them both and reports the count.
          const closedSecond = server.closeIdleConnections();
          while (!busy.closed || !fresh.closed) await new Promise(r => setImmediate(r));
          console.log(JSON.stringify({
            closedFirst,
            busyClosedBySweep,
            busyServedAfterSweep: countOks(busy) === 2,
            freshServed: countOks(fresh) === 1,
            closedSecond,
          }));
          server.stop(true);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, out: JSON.parse(stdout.trim() || "null"), exitCode }).toEqual({
      stderr: "",
      out: {
        closedFirst: 1,
        busyClosedBySweep: false,
        busyServedAfterSweep: true,
        freshServed: true,
        closedSecond: 2,
      },
      exitCode: 0,
    });
  });

  test("websocket-only server: a second stop() returns the still-pending promise", async () => {
    // After upgrade() the filter fires -1, so a websocket-only server has
    // active_connection_count == 0 and only the has_active_web_sockets() term
    // in get_all_closed_promise's early-return keeps a repeat stop() call from
    // handing back a fresh resolved promise while the first one is pending.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            fetch(req, server) {
              if (server.upgrade(req)) return;
              return new Response("no");
            },
            websocket: { open() {}, message() {}, close() {} },
          });
          const ws = new WebSocket("ws://127.0.0.1:" + server.port + "/");
          await new Promise((resolve, reject) => {
            ws.onopen = resolve;
            ws.onerror = reject;
          });
          let resolved1 = false, resolved2 = false;
          const p1 = server.stop(false).then(() => { resolved1 = true; });
          await new Promise(r => setImmediate(r));
          const p2 = server.stop(false).then(() => { resolved2 = true; });
          await new Promise(r => setImmediate(r));
          const resolvedEarly = resolved1 || resolved2;
          ws.close();
          await Promise.all([p1, p2]);
          console.log(JSON.stringify({ resolvedEarly, resolved: resolved1 && resolved2 }));
          process.exit(0);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, out: JSON.parse(stdout.trim() || "null"), exitCode }).toEqual({
      stderr: "",
      out: { resolvedEarly: false, resolved: true },
      exitCode: 0,
    });
  });

  test("pre-handshake TLS close does not steal another connection's count", async () => {
    // For TLS, +1 fires in onHandshake, -1 in onClose. A socket that RSTs
    // before the handshake reaches onClose without a matching +1; without the
    // per-socket filteredOpen gate that -1 would steal the live handshaken
    // connection's count and leave it stuck after that connection closes, so
    // stop(false) would never resolve. The live connection holds a request
    // across stop() so the sweep cannot close it before the raw closes land.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const net = require("net");
          const tls = require("tls");
          const { tls: serverTls } = require(${JSON.stringify(require.resolve("harness"))});
          const inflight = Promise.withResolvers();
          const release = Promise.withResolvers();
          const server = Bun.serve({
            port: 0, hostname: "127.0.0.1", tls: serverTls,
            async fetch() {
              inflight.resolve();
              await release.promise;
              return new Response("ok");
            },
          });
          const port = server.port;
          // One real TLS keep-alive connection: handshake completes, count=1.
          const c = tls.connect({ port, host: "127.0.0.1", ca: serverTls.cert, rejectUnauthorized: false });
          let buf = "";
          const closed = Promise.withResolvers();
          c.on("data", d => (buf += d));
          c.on("close", () => closed.resolve());
          c.on("error", () => {});
          await new Promise((resolve, reject) => {
            c.on("secureConnect", resolve);
            c.on("error", reject);
          });
          c.write("GET / HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
          await inflight.promise;
          // Three raw TCP connects that close before the handshake. onClose
          // fires for each; without filteredOpen, each -1 would steal c's
          // count (and the rest would be swallowed by the prev==0 guard).
          for (let i = 0; i < 3; i++) {
            const raw = net.connect(port, "127.0.0.1");
            await new Promise((resolve, reject) => {
              raw.on("connect", resolve);
              raw.on("error", reject);
            });
            // One junk byte wakes Linux TCP_DEFER_ACCEPT so accept() runs
            // (and so onClose does), while still not a valid ClientHello so
            // onHandshake never fires +1.
            raw.write("\\x00");
            raw.destroy();
          }
          // Give the server a few ticks to process the raw closes.
          for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
          let resolved = false;
          const stopped = server.stop(false).then(() => { resolved = true; });
          await new Promise(r => setImmediate(r));
          const resolvedEarly = resolved;
          // The held response completes, reaches the client, and the drain
          // closes the connection (server-initiated; the client never hangs
          // up); the promise must resolve on its own. The runner timeout is
          // the stall bound for both awaits.
          release.resolve();
          await stopped;
          // Reaching the log below proves the server-initiated close arrived.
          await closed.promise;
          const gotResponse = buf.includes("\\r\\nok");
          console.log(JSON.stringify({ resolvedEarly, resolved, gotResponse }));
          process.exit(0);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, out: JSON.parse(stdout.trim() || "null"), exitCode }).toEqual({
      stderr: "",
      out: { resolvedEarly: false, resolved: true, gotResponse: true },
      exitCode: 0,
    });
  });

  test("server.reload() keeps the connection count coherent", async () => {
    // clearRoutes() used to wipe filterHandlers, so a connection open across
    // reload left active_connection_count stuck > 0 forever. With the stuck
    // count (or a wiped filter, whose close would no longer decrement), the
    // sweep in stop(false) closes the idle connection but the drain promise
    // never resolves.
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const net = require("net");
          const server = Bun.serve({
            port: 0, hostname: "127.0.0.1",
            idleTimeout: 255,
            fetch: () => new Response("ok"),
          });
          const port = server.port;
          const c = net.connect(port, "127.0.0.1");
          let buf = "";
          const closed = Promise.withResolvers();
          c.on("data", d => (buf += d));
          c.on("close", () => closed.resolve());
          c.on("error", () => {});
          await new Promise((resolve, reject) => {
            c.on("connect", resolve);
            c.on("error", reject);
          });
          c.write("GET / HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
          while (!buf.includes("\\r\\nok")) await new Promise(r => setImmediate(r));
          // Connection is idle keep-alive. Reload swaps routes; the filter
          // must survive so the count still tracks open/close.
          server.reload({ fetch: () => new Response("ok") });
          let resolved = false;
          const stopped = server.stop(false).then(() => { resolved = true; });
          // stop() closes the idle connection itself; the client never hangs
          // up, so both awaits are server-driven and the runner timeout is
          // the stall bound (a stuck count would hang right here).
          await stopped;
          await closed.promise;
          console.log(JSON.stringify({ resolved }));
          process.exit(0);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, out: JSON.parse(stdout.trim() || "null"), exitCode }).toEqual({
      stderr: "",
      out: { resolved: true },
      exitCode: 0,
    });
  });
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

// Shared rig for the "late keep-alive" tests below: open a raw TCP socket,
// hold the first request in-flight across stop()/close(), pipeline a second
// request behind it, release, GC, and print the second response's status
// line (or "" if the connection closed instead). The subprocess runs the rig
// so a (former) panic in the dispatch trampoline surfaces as a non-zero exit
// instead of taking down the runner.
//
// `deinit_if_we_can` defers the wrapper downgrade while the connection is
// still open, so the held request always dispatches and completes against a
// live wrapper. What happens to the pipelined request depends on the server:
// a Bun.serve graceful stop marks the busy connection close-when-idle, so the
// connection closes right after the held response and the pipelined request
// is dropped (secondOutcome: "closed"); node:http queues pipelined responses,
// so close() still delivers it before the connection closes
// (secondOutcome: "200"). Either way the wrapper then downgrades to Weak and
// the GC pass below must collect it cleanly.
//
// `serverSnippet` must define `port` (the listen port) and `stop()` in scope,
// and may read `release`/`inflight`/`hits` for the hold protocol.
async function runLateKeepAlive(reqPath: string, serverSnippet: string, secondOutcome: "200" | "closed") {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { fullGC } = require("bun:jsc");

        let received = "";
        let sockClosed = false;
        let waiter = Promise.withResolvers();
        // Wait until a complete HTTP/1.1 response (headers + content-length
        // body, or empty for 503) has arrived, then consume + return its
        // status line.
        const nextResponse = async () => {
          while (true) {
            const headerEnd = received.indexOf("\\r\\n\\r\\n");
            if (headerEnd !== -1) {
              const head = received.slice(0, headerEnd);
              const m = /content-length: (\\d+)/i.exec(head);
              const bodyLen = m ? Number(m[1]) : 0;
              const total = headerEnd + 4 + bodyLen;
              if (received.length >= total) {
                const status = head.split("\\r\\n")[0];
                received = received.slice(total);
                return status;
              }
            }
            if (sockClosed) return "";
            await waiter.promise;
            waiter = Promise.withResolvers();
          }
        };

        const release = Promise.withResolvers();
        const inflight = Promise.withResolvers();
        let hits = 0;

        await (async () => {
          ${serverSnippet}

          globalThis.sock = await Bun.connect({
            hostname: "127.0.0.1",
            port,
            socket: {
              data(_s, d) { received += d.toString("latin1"); waiter.resolve(); },
              close() { sockClosed = true; waiter.resolve(); },
              error() { sockClosed = true; waiter.resolve(); },
            },
          });

          // First request: handler parks on \`release\`, keeping the socket
          // non-idle through stop().
          sock.write("GET ${reqPath} HTTP/1.1\\r\\nHost: x\\r\\nConnection: keep-alive\\r\\n\\r\\n");
          await inflight.promise;
          // Pipeline the late request behind the held one. uws won't read it
          // until the first response is sent.
          sock.write("GET ${reqPath} HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");

          // Graceful stop: listener closes; downgrade deferred while the
          // connection is open.
          stop();
        })();
        // The only server binding is now out of scope.

        // First request completes against a live wrapper (the connection is
        // open, so it stays Strong). What happens to the pipelined request
        // depends on the caller: Bun.serve's drain closes the connection at
        // idle and drops it (second = ""), node:http delivers the queued
        // response (second = 200). Previously the late dispatch could panic
        // (or 503 when the gate checked Strong-only).
        release.resolve();
        const first = await nextResponse();
        if (!first.includes("200")) throw new Error("first request failed: " + first);
        const second = await nextResponse();

        // Wrapper is now Weak and unreferenced; GC must collect it cleanly.
        for (let i = 0; i < 3; i++) {
          Bun.gc(true);
          fullGC();
          await Bun.sleep(0);
        }
        console.log(second);

        sock.end();
        process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    // "200": the pipelined request must actually dispatch and be answered.
    // "closed": the connection must close cleanly after the held response
    // without the pipelined request being answered (and without a panic).
    stdout: secondOutcome === "200" ? expect.stringMatching(/^HTTP\/1\.1 200\b/) : "",
    stderr: "",
    exitCode: 0,
  });
}

test("stop() completes the in-flight request, then closes the connection instead of serving a late pipelined request", async () => {
  // The route handler is held across stop(), so the connection is busy during
  // the sweep and gets marked close-when-idle; the held response must still be
  // delivered in full, after which the connection closes and the pipelined
  // request behind it is dropped (a pipelining client retries it elsewhere,
  // RFC 9112 9.3.2). Must not panic: the close path runs against a server
  // whose only JS binding went out of scope before the drain.
  await runLateKeepAlive(
    "/r",
    `
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        routes: {
          "/r": async () => {
            if (++hits === 1) {
              inflight.resolve();
              await release.promise; // keep pending_requests > 0 across stop()
            }
            return new Response("ok");
          },
        },
      });
      const port = server.port;
      const stop = () => server.stop();
    `,
    "closed",
  );
});

test("stop() closes the drained connection before a late pipelined WebSocket upgrade dispatches", async () => {
  // Sibling of the HTTP late-keep-alive test for the WebSocket upgrade path.
  // The connection is busy during stop()'s sweep (held response), so it is
  // marked close-when-idle: the held response is delivered, then the
  // connection closes, and the upgrade request pipelined behind it never
  // reaches the fetch handler (the client reconnects elsewhere). Must exit
  // cleanly: the close runs on a gracefully stopped server.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      /* js */ `
        const release = Promise.withResolvers();
        const inflight = Promise.withResolvers();
        let upgraded;
        const server = Bun.serve({
          port: 0, hostname: "127.0.0.1",
          async fetch(req, server) {
            if (req.headers.get("x-hold")) {
              inflight.resolve();
              await release.promise;
              return new Response("held", { headers: { "content-length": "4" } });
            }
            upgraded = server.upgrade(req);
            if (upgraded) return;
            return new Response("426 no-upgrade", { status: 426, headers: { "content-length": "14" } });
          },
          websocket: { open() {}, message() {}, close() {} },
        });
        const port = server.port;
        let received = "";
        let sockClosed = false;
        let waiter = Promise.withResolvers();
        globalThis.sock = await Bun.connect({
          hostname: "127.0.0.1", port,
          socket: {
            data(_s, d) { received += d.toString("latin1"); waiter.resolve(); },
            close() { sockClosed = true; waiter.resolve(); },
            error() { sockClosed = true; waiter.resolve(); },
          },
        });
        // Hold one request so stop() can't downgrade yet.
        sock.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nx-hold: 1\\r\\nConnection: keep-alive\\r\\n\\r\\n");
        await inflight.promise;
        // Pipeline the upgrade behind it.
        const key = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");
        sock.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Key: " + key + "\\r\\nSec-WebSocket-Version: 13\\r\\n\\r\\n");
        server.stop();
        release.resolve();
        // Wait for the held response and the server-initiated close (the
        // pipelined upgrade is dropped by the drain, so no second response).
        while (!sockClosed && (received.match(/\\r\\n\\r\\n/g) || []).length < 2) {
          await waiter.promise; waiter = Promise.withResolvers();
        }
        // Response bodies are not CRLF-terminated, so the next status line is
        // glued to the previous body; match status lines by pattern.
        const statuses = [...received.matchAll(/HTTP\\/1\\.1 \\d{3} [^\\r\\n]*/g)].map(m => m[0]);
        sock.end();
        console.log(JSON.stringify({ statuses, upgraded }));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const out = JSON.parse(stdout.trim() || "{}");
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  // Held request 200; the pipelined upgrade never dispatches (fetch is not
  // called again, so `upgraded` is never assigned) and no 101 is written.
  expect(out.upgraded).toBeUndefined();
  expect(out.statuses).toEqual([expect.stringMatching(/^HTTP\/1\.1 200\b/)]);
});

test.concurrent("late keep-alive request to a node:http server after close() still dispatches", async () => {
  // Same shape but through node:http so the request dispatches via
  // on_node_http_request_with_upgrade_ctx — the trampoline that would panic
  // on a stale shadow without the `js_value_for_dispatch` gate. Unlike
  // Bun.serve, node:http queues pipelined requests, so the queued response is
  // still delivered after close() before the drain closes the connection.
  await runLateKeepAlive(
    "/",
    `
      const http = require("node:http");
      const srv = http.createServer(async (req, res) => {
        if (++hits === 1) {
          inflight.resolve();
          await release.promise; // hold socket non-idle through close()
        }
        res.writeHead(200, { "content-length": 2 });
        res.end("ok");
      });
      await new Promise(r => srv.listen(0, "127.0.0.1", r));
      const port = srv.address().port;
      // close() → closeIdleConnections() (skips this socket) → stop().
      // Also drops node:http's own reference to the Bun server.
      const stop = () => srv.close();
    `,
    "200",
  );
});

test("node:http close() drops the loop ref once in-flight requests finish, without waiting for the surviving connection", async () => {
  expect(await bunRun(path.join(import.meta.dir, "node-http-close-unref-fixture.ts"))).toSpawn(
    JSON.stringify({ status: "HTTP/1.1 200 OK", connectionOpenAtExit: true }),
  );
});

test("request on a connection surviving graceful stop() never reaches a collected handler", async () => {
  // Stress sibling of the late-keep-alive tests above, for the js_value
  // downgrade gate: the wrapper (the handlers' only GC root) must stay Strong
  // while a connection can still dispatch, even after the user dropped every
  // JS reference to the server.
  //
  // node:http is the server kind whose keep-alive connections outlive a
  // graceful close(): close() sweeps idle connections once and leaves busy
  // ones alone, and they stay keep-alive after their response, as in Node.
  // (Bun.serve marks busy connections close-when-idle at stop(), #37074, so a
  // late request there is dropped before it reaches a handler.) Each round
  // holds one request per parked connection across close(), drops the only
  // binding, churns the heap and forces a GC, then sends late requests on the
  // surviving connections. The late requests for a round's connections are
  // sent from later rounds, so they run from a different frame than the one
  // whose conservative stack scan could still see the wrapper.
  //
  // Invariant: every late request is answered by the original handler
  // ("ok <tag>"). A closed connection is a failure too: nothing but a
  // regression closes a parked connection (keepAliveTimeout is 0 and node:http
  // has no native idle timeout), and a round with no dispatch would prove
  // nothing. Without the gate the wrapper is collected while the connections
  // are open: its finalizer tears the native server down and closes them, and
  // a dispatch that races the finalizer reaches a swept cell.
  const dir = tempDirWithFiles("stop-keepalive-gc", {
    "churn-fixture.js": `
      // Bun.gc(true) collects AND sweeps synchronously: a wrapper that lost its
      // last root is destroyed (its finalizer runs) inside the call, not when
      // the lazy sweeper reaches its block as with Bun.gc(false). So on a build
      // without the downgrade gate the parked connections are closed before the
      // same round's late requests are answered. A fixed round count is enough:
      // a gateless build fails in round 1, and ROUNDS leaves a wide margin on
      // top of that.
      const http = require("node:http");
      const net = require("net");
      const ROUNDS = 16;
      let sink;
      function churn() {
        // Enough allocation to recycle freed cells (a reused wrapper cell shows
        // up as a foreign body), small enough to stay cheap in debug builds.
        let a = [];
        for (let j = 0; j < 2000; j++) a.push(j & 1 ? { j } : "s" + j);
        sink = a;
        for (let j = 0; j < 4000; j++) sink = function () { return j; };
        for (let j = 0; j < 20; j++) sink = new Response("x");
      }
      // One parked keep-alive connection. request(path) writes a GET on the
      // already-established socket and resolves { status, body } using
      // Content-Length framing, or null once the socket is gone.
      function park(port) {
        const sock = net.connect(port, "127.0.0.1");
        sock.setNoDelay(true);
        sock.on("error", () => {});
        let buf = "", pending = null, closed = false;
        function flush() {
          if (!pending) return;
          const he = buf.indexOf("\\r\\n\\r\\n");
          if (he < 0) return;
          const head = buf.slice(0, he);
          const status = +(/^HTTP\\/1\\.[01] (\\d{3})/.exec(head)?.[1] ?? 0);
          const len = +(/\\r\\ncontent-length: *(\\d+)/i.exec(head)?.[1] ?? 0);
          if (buf.length < he + 4 + len) return;
          const body = buf.slice(he + 4, he + 4 + len);
          buf = buf.slice(he + 4 + len);
          const p = pending;
          pending = null;
          p({ status, body });
        }
        sock.on("data", d => { buf += d.toString("latin1"); flush(); });
        sock.on("close", () => {
          closed = true;
          if (pending) { const p = pending; pending = null; p(null); }
        });
        return {
          connected: new Promise((res, rej) => { sock.on("connect", res); sock.on("error", rej); }),
          request(path) {
            if (closed || sock.destroyed) return Promise.resolve(null);
            return new Promise(resolve => {
              pending = resolve;
              try {
                sock.write("GET " + path + " HTTP/1.1\\r\\nHost: x\\r\\nConnection: keep-alive\\r\\n\\r\\n");
              } catch {
                pending = null;
                resolve(null);
              }
              flush();
            });
          },
          destroy() { sock.destroy(); },
        };
      }
      const entries = [];
      const fails = [];
      for (let round = 1; round <= ROUNDS && !fails.length; round++) {
        const want = "ok " + round;
        const release = Promise.withResolvers();
        const bothHeld = Promise.withResolvers();
        let held = 0;
        let srv = http.createServer(async (req, res) => {
          if (req.url === "/hold") {
            if (++held === 2) bothHeld.resolve();
            await release.promise;
          }
          res.writeHead(200, { "content-length": String(want.length) });
          res.end(want);
        });
        // No keep-alive timer: only a regression can close a parked connection.
        srv.keepAliveTimeout = 0;
        // Bind the loopback address the parks dial, not the wildcard: macOS's
        // ephemeral allocator honors only exact-address conflicts, so a
        // wildcard listener can be handed a port another process holds at
        // 127.0.0.1 and that listener would answer this fixture's dials.
        await new Promise(r => srv.listen(0, "127.0.0.1", r));
        const port = srv.address().port;
        // Two parked keep-alive connections, each busy with a held request
        // when close() sweeps, so both outlive the server binding.
        const parks = [park(port), park(port)];
        await Promise.all(parks.map(p => p.connected));
        const firsts = Promise.all(parks.map(p => p.request("/hold")));
        await bothHeld.promise;
        srv.close(); // graceful: the sweep skips the busy connections
        srv = null;
        release.resolve();
        const first = await firsts;
        if (first.some(r => !r || r.status !== 200 || r.body !== want)) {
          fails.push("round " + round + ": bad held response " + JSON.stringify(first));
          break;
        }
        // The only binding is gone; the connections are idle keep-alive on a
        // closed server.
        entries.push({ parks, want });
        if (entries.length > 6) for (const p of entries.shift().parks) p.destroy();
        churn();
        Bun.gc(true);
        churn();
        churn();
        const decoys = [];
        for (let i = 0; i < 3; i++) decoys.push(Bun.serve({ port: 0, hostname: "127.0.0.1", fetch() { return new Response("decoy"); } }));
        churn();
        const rs = await Promise.all(
          entries.flatMap(({ parks, want }) => parks.map(p => p.request("/late").then(r => ({ want, r })))),
        );
        for (const d of decoys) d.stop(true);
        for (const { want, r } of rs) {
          if (!r) {
            fails.push("round " + round + ": a parked connection closed");
          } else if (r.status !== 200 || r.body !== want) {
            fails.push("round " + round + ": wrong response " + JSON.stringify(r));
          }
        }
      }
      if (fails.length) {
        console.log("FAIL " + fails.join("; "));
        process.exit(1);
      }
      console.log("PASS");
      process.exit(0);
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(dir, "churn-fixture.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({ stdout: "PASS", stderr: "", exitCode: 0 });
}, 30_000);

test("server wrapper survives GC while a websocket is connected after stop()", async () => {
  // The previous test exercises the one-tick HTTP keep-alive race; this one
  // covers the steadier websocket case. After a graceful stop() with a live
  // websocket, the user may drop their `server` binding. The native struct
  // stays alive (active_websockets > 0), but stop() previously downgraded
  // js_value immediately, so GC could finalize the JS wrapper — and with it
  // m_routeList — while the connection was still in use. With the downgrade
  // deferred into deinit_if_we_can's idle predicate, the wrapper must outlive
  // the websocket and become collectable only after the last close.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const { fullGC, heapStats } = require("bun:jsc");

        const serverCount = () => {
          const c = heapStats().objectTypeCounts;
          return (c.DebugHTTPServer ?? 0) + (c.HTTPServer ?? 0);
        };

        // Poll: collect, yield a loop turn so pending close callbacks can run,
        // re-check. Returns as soon as the count reaches target.
        async function drain(target) {
          const deadline = Date.now() + 5000;
          while (serverCount() > target && Date.now() < deadline) {
            Bun.gc(true);
            fullGC();
            await new Promise(r => setImmediate(r));
          }
        }

        // objectTypeCounts includes the (lazily created) prototype object(s)
        // once the first server is constructed — and on libuv platforms both
        // Debug and non-Debug prototypes may end up materialized. Measure the
        // floor while a trivial server is the only live instance: whatever the
        // count is above that one instance is prototype(s). Assertions are
        // relative to it; the trivial server itself must be collected by the
        // final drain like any other stopped server.
        const baseline = (() => {
          const s = Bun.serve({ port: 0, fetch: () => new Response("ok") });
          const floor = serverCount() - 1;
          s.stop(true);
          return floor;
        })();

        const ws = await (async () => {
          const server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            routes: { "/r": () => new Response("ok") },
            fetch(req, server) {
              if (server.upgrade(req)) return;
              return new Response("nope", { status: 404 });
            },
            websocket: { open() {}, message() {}, close() {} },
          });

          const opened = Promise.withResolvers();
          const ws = new WebSocket("ws://127.0.0.1:" + server.port);
          ws.onopen = () => opened.resolve();
          ws.onerror = e => opened.reject(e);
          await opened.promise;

          // Graceful stop: listener closes, the live websocket stays open.
          server.stop();
          return ws;
        })();
        // The only \`server\` binding is now out of scope; only the live
        // websocket keeps the native side around. GC is deterministic about
        // reachability, so a few full collections (with loop turns between
        // them for any deferred downgrade to land) are as strong as many.
        for (let i = 0; i < 5; i++) {
          Bun.gc(true);
          fullGC();
          await new Promise(r => setImmediate(r));
        }
        const afterStopGC = serverCount();

        const closed = Promise.withResolvers();
        ws.onclose = () => closed.resolve();
        ws.close();
        await closed.promise;

        await drain(baseline);
        const afterCloseGC = serverCount();

        console.log(JSON.stringify({ baseline, afterStopGC, afterCloseGC }));
        process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const { baseline, afterStopGC, afterCloseGC } = JSON.parse(stdout.trim() || "{}");
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  // js_value stays Strong while a websocket is connected → GC must not
  // collect the wrapper. baseline already includes the prototype(s), so the
  // live instance shows as baseline+1.
  expect(afterStopGC).toBeGreaterThan(baseline);
  // Last websocket closing triggers deinit_if_we_can → downgrade → wrapper
  // becomes collectable again (no leak).
  expect(afterCloseGC).toBe(baseline);
}, 15_000);

test.concurrent("should be able to async upgrade using custom protocol", async () => {
  const serverClose = Promise.withResolvers<{ code: number; reason: string }>();
  using server = Bun.serve<unknown>({
    port: 0,
    async fetch(req: Request, server: Server) {
      await Bun.sleep(1);

      if (server.upgrade(req)) return;
    },
    websocket: {
      close(ws: ServerWebSocket<unknown>, code: number, reason: string): void | Promise<void> {
        serverClose.resolve({ code, reason });
      },
      message(ws: ServerWebSocket<unknown>, data: string): void | Promise<void> {
        ws.send("world");
      },
    },
  });

  const ws = new WebSocket(server.url.href, "ocpp1.6");
  const echoed = Promise.withResolvers<string>();
  ws.onopen = () => {
    ws.send("hello");
  };
  ws.onmessage = e => echoed.resolve(e.data);
  ws.onerror = e => echoed.reject(e);

  const data = await echoed.promise;
  // The upgrade (after an await in fetch) negotiated the requested subprotocol.
  expect({ protocol: ws.protocol, data }).toEqual({ protocol: "ocpp1.6", data: "world" });
  ws.close(1000, "bye");
  expect(await serverClose.promise).toEqual({ code: 1000, reason: "bye" });
});

test.concurrent("should be able to abrubtly close a upload request", async () => {
  const aborted = Promise.withResolvers<void>();
  const chunkConsumed = Promise.withResolvers<void>();
  const handlerDone = Promise.withResolvers<{ error: string | undefined; received: number }>();
  // ~100KB
  const chunk = Buffer.alloc(1024 * 100, "a");
  using server = Bun.serve({
    port: 0,
    hostname: "localhost",
    maxRequestBodySize: 1024 * 1024 * 1024 * 16,
    async fetch(req) {
      let total_size = 0;
      let error: unknown;
      req.signal.addEventListener("abort", () => aborted.resolve());
      try {
        for await (const part of req.body as ReadableStream) {
          total_size += part.length;
          if (total_size >= chunk.byteLength) chunkConsumed.resolve();
          if (total_size > 1024 * 1024 * 1024) {
            return new Response("too big", { status: 413 });
          }
        }
      } catch (e) {
        error = e;
      } finally {
        handlerDone.resolve({ error: (error as Error)?.name, received: total_size });
      }

      return new Response("Received " + total_size);
    },
  });
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
      // partial write: keep the unsent tail
      socket.data.pending = data.slice(written);
      return false;
    }

    // full write got to next state
    if (socket.data.state === 0) {
      // request sent -> send chunk
      socket.data.pending = chunk;
    } else {
      // chunk sent -> half-close once the server has consumed it, so the body
      // ends 1 GB short of its Content-Length
      chunkConsumed.promise.then(() => socket.shutdown());
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
  await aborted.promise;
  // The body iterator saw exactly the one chunk, then the truncated upload aborted it.
  expect(await handlerDone.promise).toEqual({ error: "AbortError", received: chunk.byteLength });
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

describe.concurrent("HEAD requests #15355", () => {
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
    await using dir = tempDir("fsr", {
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

    function doHead(server: Server, path: string): Promise<{ statusLine: string; headers: string; body: string }> {
      const { promise, resolve, reject } = Promise.withResolvers<{
        statusLine: string;
        headers: string;
        body: string;
      }>();
      // use node net to make a HEAD request; "Connection: close" makes the
      // server end the connection after the response, so every byte it sent
      // has arrived by the time 'end' fires and a stray body cannot hide.
      const net = require("net");
      const url = new URL(server.url);
      const socket = net.createConnection(url.port, url.hostname);
      socket.write(`HEAD ${path} HTTP/1.1\r\nHost: ${url.hostname}:${url.port}\r\nConnection: close\r\n\r\n`);
      let received = "";
      socket.on("data", data => {
        received += data.toString();
      });
      socket.on("error", reject);
      socket.on("end", () => {
        const headerIndex = received.indexOf("\r\n\r\n");
        const head = received.slice(0, headerIndex);
        resolve({
          statusLine: head.split("\r\n")[0],
          headers: head.slice(head.indexOf("\r\n") + 2),
          body: received.slice(headerIndex + 4),
        });
        socket.destroy();
      });
      return promise;
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
      const { statusLine, headers, body } = await doHead(server, "/");
      expect(statusLine).toBe("HTTP/1.1 200 OK");
      expect(headers.toLowerCase()).toContain("content-length: 11");
      expect(body).toBe("");
    }
    {
      const { statusLine, headers, body } = await doHead(server, "/file");
      expect(statusLine).toBe("HTTP/1.1 200 OK");
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

    // fastGet(.TransferEncoding/.ContentLength) returns a ZigString borrowing
    // the header map entry's WTF::StringImpl; renderMetadata() -> doWriteHeaders()
    // then calls fastRemove() on those names and derefs the FetchHeaders,
    // destroying the StringImpl before the borrowed bytes are written to the
    // socket (Transfer-Encoding) or parsed (Content-Length).
    //
    // Passing duplicate header entries makes FetchHeaders combine them via
    // makeString(), producing a fresh StringImpl owned solely by the map so the
    // remove actually frees it. The bodies are null so this stays on the
    // fastGet path: HEAD only reads the handler-supplied framing headers for a
    // bodiless Response. `Malloc=1` routes bmalloc through the system
    // allocator so ASAN-enabled builds observe the use-after-free; release
    // builds fall through and validate the header values round-trip.
    test("transfer-encoding / content-length whose StringImpl is held only by the header map", async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            import { connect } from "node:net";
            using server = Bun.serve({
              port: 0,
              fetch(req) {
                if (req.url.endsWith("/te")) {
                  return new Response(null, {
                    headers: [
                      ["Transfer-Encoding", "gzip"],
                      ["Transfer-Encoding", "chunked"],
                    ],
                  });
                }
                return new Response(null, {
                  headers: [
                    ["Content-Length", "1"],
                    ["Content-Length", "2"],
                  ],
                });
              },
            });
            function rawHead(path) {
              return new Promise((resolve, reject) => {
                let data = "";
                const sock = connect(server.port, "127.0.0.1", () => {
                  sock.write("HEAD " + path + " HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");
                });
                sock.on("data", d => (data += d.toString("latin1")));
                sock.on("end", () => resolve(data));
                sock.on("error", reject);
              });
            }
            const te = await rawHead("/te");
            const cl = await rawHead("/cl");
            console.log(JSON.stringify({
              te: /transfer-encoding:\\s*(.+)\\r\\n/i.exec(te)?.[1],
              cl: /content-length:\\s*(.+)\\r\\n/i.exec(cl)?.[1],
            }));
          `,
        ],
        env: {
          ...bunEnv,
          // Route bmalloc through the system heap so ASAN observes StringImpl
          // allocations in sanitizer builds. On Windows bmalloc's SystemHeap is
          // unimplemented and would RELEASE_BASSERT, so leave bmalloc in place
          // there — Windows has no ASAN lane anyway.
          ...(isWindows
            ? {}
            : {
                Malloc: "1",
                // symbolize=0 so a pre-fix ASAN abort exits promptly instead of
                // spending seconds in llvm-symbolizer; detect_leaks=0 because
                // routing WTF allocations through system malloc makes
                // process-lifetime WebKit singletons visible to LSan at exit.
                ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "symbolize=0", "detect_leaks=0"].filter(Boolean).join(":"),
              }),
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // "1, 2" is not a valid integer so Content-Length parses as 0; what we
      // care about is that parsing it does not read freed memory.
      expect({ stdout: stdout.trim(), stderr: stderr.trim() }).toEqual({
        stdout: JSON.stringify({ te: "gzip, chunked", cl: "0" }),
        stderr: "",
      });
      expect(exitCode).toBe(0);
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

  test("a proxied upstream HEAD response keeps the upstream Content-Length", async () => {
    using upstream = Bun.serve({
      port: 0,
      fetch() {
        return new Response("Hello World");
      },
    });
    // The upstream's response to HEAD has a null body, so the handler-supplied
    // Content-Length (the upstream's) is what gets sent, as for any bodiless
    // Response above.
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        return fetch(upstream.url, { method: req.method });
      },
    });
    const head = await fetch(server.url, { method: "HEAD" });
    expect({ status: head.status, contentLength: head.headers.get("content-length"), text: await head.text() }).toEqual(
      { status: 200, contentLength: "11", text: "" },
    );
    const get = await fetch(server.url);
    expect({ status: get.status, contentLength: get.headers.get("content-length"), text: await get.text() }).toEqual({
      status: 200,
      contentLength: "11",
      text: "Hello World",
    });
  });
});

describe.concurrent("websocket and routes test", () => {
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

test.concurrent("should be able to redirect when using empty streams #15320", async () => {
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
  expect({
    status: response.status,
    redirected: response.redirected,
    url: response.url,
    text: await response.text(),
  }).toEqual({ status: 200, redirected: true, url: `http://localhost:${server.port}/`, text: "Hello, World" });
});

test("HEAD request for a Response with an S3 file body reports the object size and the server keeps serving", async () => {
  // Answering a HEAD request whose Response body is an S3-backed Blob resolves
  // the object size with an async S3 stat before writing headers. Run the
  // server in a subprocess so a crash on that completion path shows up as a
  // non-zero exit code instead of taking down the test runner.
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        // Fake S3 origin: answers the stat (HEAD) with a fixed Content-Length.
        const s3Origin = Bun.serve({
          port: 0,
          fetch(req) {
            if (req.method === "HEAD") {
              return new Response(null, {
                headers: {
                  "Content-Length": "11",
                  "ETag": '"abc123"',
                  "Content-Type": "text/plain",
                },
              });
            }
            return new Response("Hello World");
          },
        });

        const s3 = new Bun.S3Client({
          accessKeyId: "test",
          secretAccessKey: "test",
          region: "us-east-1",
          bucket: "my-bucket",
          endpoint: s3Origin.url.href,
        });

        const app = Bun.serve({
          port: 0,
          fetch(req) {
            if (new URL(req.url).pathname === "/health") {
              return new Response("alive");
            }
            return new Response(s3.file("hello.txt"));
          },
        });

        for (let i = 0; i < 8; i++) {
          const res = await fetch(new URL("/object", app.url), { method: "HEAD" });
          if (res.status !== 200) {
            throw new Error("unexpected HEAD status: " + res.status);
          }
          const contentLength = res.headers.get("content-length");
          if (contentLength !== "11") {
            throw new Error("unexpected content-length: " + contentLength);
          }
          await res.arrayBuffer();
        }

        // The request context for each HEAD request above has been released by
        // now; a fresh request must still be served off the same pool.
        const health = await fetch(new URL("/health", app.url));
        if ((await health.text()) !== "alive") {
          throw new Error("server is no longer responding");
        }

        console.log("s3-head-ok");
        process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("s3-head-ok");
  expect(exitCode).toBe(0);
});

// Handler callbacks (fetch/error/websocket.*) are stored on the JS wrapper and
// traced by the GC rather than independently rooted. These tests lock in that
// reload/stop transitions never leave a window where a handler is collected
// while a dispatch path can still reach it.
describe.concurrent("handler liveness across reload/stop", () => {
  test("server.reload({ fetch }) swaps the handler for the next request", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        return new Response("first");
      },
    });

    expect(await (await fetch(server.url)).text()).toBe("first");

    server.reload({
      fetch() {
        return new Response("second");
      },
    });
    // Drop any last reference the test frame holds to the old handler, then
    // collect. The new handler must be the one the wrapper traces now.
    Bun.gc(true);

    expect(await (await fetch(server.url)).text()).toBe("second");

    // A second reload back-to-back must also take effect (catches a stale
    // cached read of the previous slot value).
    server.reload({
      fetch() {
        return new Response("third");
      },
    });
    Bun.gc(true);
    expect(await (await fetch(server.url)).text()).toBe("third");
  });

  test("in-flight request completes with its handler after stop() + GC", async () => {
    const received = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let handlerRan = 0;

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch() {
        handlerRan++;
        received.resolve();
        await release.promise;
        return new Response("in-flight-ok", { headers: { Connection: "close" } });
      },
    });

    const responsePromise = fetch(server.url);
    await received.promise;

    // stop() drops the listener while the request is mid-handler. The wrapper
    // must remain live (pending_requests > 0) so the handler the request was
    // dispatched into is still reachable.
    const stopped = server.stop();
    Bun.gc(true);

    release.resolve();
    const body = await (await responsePromise).text();
    await stopped;

    expect(body).toBe("in-flight-ok");
    expect(handlerRan).toBe(1);
  });

  test("websocket close handler fires when stop() closes an open connection", async () => {
    const opened = Promise.withResolvers<void>();
    const serverClose = Promise.withResolvers<{ code: number; reason: string }>();
    const clientClose = Promise.withResolvers<void>();

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response(null, { status: 404 });
      },
      websocket: {
        open() {
          opened.resolve();
        },
        message() {},
        close(_ws, code, reason) {
          serverClose.resolve({ code, reason });
        },
      },
    });

    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`);
    ws.onclose = () => clientClose.resolve();
    await opened.promise;

    // Connection is open; force-stop the server. The wrapper must stay live
    // long enough for the close callback (read off the wrapper) to fire.
    Bun.gc(true);
    const stopped = server.stop(true);
    Bun.gc(true);

    const { code } = await serverClose.promise;
    await clientClose.promise;
    await stopped;

    // The invariant is that the close handler ran at all (it's read off the
    // wrapper after stop()); the exact close code is uws's choice.
    expect(typeof code).toBe("number");
    expect(code).toBeGreaterThanOrEqual(1000);
  });

  test("ws.close() with a reason whose toString() re-enters close() decrements the count once", async () => {
    // ServerWebSocket.close coerces the reason arg via toString(), which can
    // re-enter ws.close() before the outer call sets the closed flag. The
    // re-check after coercion ensures only one on_websocket_closed() runs.
    let openCount = 0;
    const bothOpen = Promise.withResolvers<void>();
    const targetClosed = Promise.withResolvers<void>();
    let reentered = 0;
    let closedTarget: unknown;

    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response(null, { status: 404 });
      },
      websocket: {
        open() {
          if (++openCount === 2) bothOpen.resolve();
        },
        message(ws, m) {
          if (m === "do-close") {
            // Only c1 sends this; capture c1's server-side peer here rather
            // than by open() order, which is not guaranteed across platforms.
            closedTarget = ws;
            ws.close(1000, {
              toString() {
                reentered++;
                ws.close(); // re-entrant close before outer sets closed=true
                return "bye";
              },
            } as unknown as string);
          }
        },
        close(ws) {
          if (ws === closedTarget) targetClosed.resolve();
        },
      },
    });

    const c1 = new WebSocket(`ws://127.0.0.1:${server.port}/`);
    const c2 = new WebSocket(`ws://127.0.0.1:${server.port}/`);
    const c1Open = Promise.withResolvers<void>();
    const c2Open = Promise.withResolvers<void>();
    const c1Closed = Promise.withResolvers<void>();
    c1.onopen = () => c1Open.resolve();
    c2.onopen = () => c2Open.resolve();
    c1.onerror = e => c1Open.reject(e);
    c2.onerror = e => c2Open.reject(e);
    c1.onclose = () => c1Closed.resolve();
    await Promise.all([bothOpen.promise, c1Open.promise, c2Open.promise]);
    expect(server.pendingWebSockets).toBe(2);

    c1.send("do-close");
    await targetClosed.promise;
    await c1Closed.promise;

    // Without the re-check, the outer close() would decrement again: 2→0.
    expect({ reentered, pending: server.pendingWebSockets }).toEqual({ reentered: 1, pending: 1 });

    const c2Closed = Promise.withResolvers<void>();
    c2.onclose = () => c2Closed.resolve();
    c2.close();
    await c2Closed.promise;
  });

  test("server.fetch() still dispatches to the handler after stop()", async () => {
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        return new Response("via server.fetch: " + new URL(req.url).pathname);
      },
    });

    const url = `http://${server.hostname}:${server.port}/after-stop`;

    server.stop();
    Bun.gc(true);

    // No listener, but the JS wrapper is still on our stack — server.fetch()
    // reads the handler off the wrapper, so it must still resolve.
    const response = await server.fetch(url);
    expect(await response.text()).toBe("via server.fetch: /after-stop");
    expect(response.status).toBe(200);
  });
});

// The native↔JS cycle: a handler that closes over `server` used to be
// uncollectable because ServerConfig held it as a Strong root. With handlers
// stored as WriteBarrier slots on the wrapper, the cycle is all-JS-heap and
// GC collects it once nothing else references the wrapper.
describe.concurrent("handler GC tracing (heapStats wrapper-count)", () => {
  test("server with handler closing over itself is collected after stop()", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
        const { heapStats, fullGC } = require("bun:jsc");
        const live = () => {
          const c = heapStats().objectTypeCounts;
          return (c.DebugHTTPServer ?? 0) + (c.HTTPServer ?? 0);
        };
        // Poll: collect, yield a loop turn so the connection close can land,
        // re-check. Returns as soon as the count reaches target.
        async function drain(target) {
          const deadline = Date.now() + 5000;
          while (live() > target && Date.now() < deadline) {
            Bun.gc(true);
            fullGC();
            await new Promise(r => setImmediate(r));
          }
        }

        // Materialize prototype(s) first so baseline = whatever floor this
        // build settles at (libuv platforms may surface 2, not 1): while the
        // trivial server is the only live instance, everything above one is
        // prototype(s). The final drain must collect it as well.
        const baseline = (() => {
          const s = Bun.serve({ port: 0, development: true, fetch: () => new Response("ok") });
          const floor = live() - 1;
          s.stop(true);
          return floor;
        })();

        await (async () => {
          const server = Bun.serve({
            port: 0,
            development: true,
            // Closes over server — the cycle.
            fetch: () => new Response("port " + server.port),
            error: e => { server.stop(); return new Response(String(e)); },
          });
          const r = await fetch(server.url, { keepalive: false });
          if (!(await r.text()).startsWith("port ")) throw new Error("dispatch broke");
          server.stop(true);
        })();
        // No live reference to server or its handlers from here.
        await drain(baseline);
        console.log(JSON.stringify({ baseline, after: live() }));
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const { baseline, after } = JSON.parse(stdout.trim() || "{}");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    // baseline already includes the prototype(s); a collected instance returns
    // to it exactly. On main this fails: the cycle keeps the instance alive
    // (after = baseline+1).
    expect(after).toBe(baseline);
  }, 15_000);

  // Control: a handler that does NOT close over server is collected on main
  // today. This pins that the redesign doesn't regress the non-cycle case.
  test("server with handler NOT closing over itself is collected (control)", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
        const { heapStats, fullGC } = require("bun:jsc");
        const live = () => {
          const c = heapStats().objectTypeCounts;
          return (c.DebugHTTPServer ?? 0) + (c.HTTPServer ?? 0);
        };
        async function drain(target) {
          const deadline = Date.now() + 5000;
          while (live() > target && Date.now() < deadline) {
            Bun.gc(true); fullGC();
            await new Promise(r => setImmediate(r));
          }
        }
        // Prototype floor: the count above the one live instance.
        const baseline = (() => {
          const s = Bun.serve({ port: 0, development: true, fetch: () => new Response("ok") });
          const floor = live() - 1;
          s.stop(true);
          return floor;
        })();

        await (async () => {
          const server = Bun.serve({
            port: 0, development: true,
            fetch: () => new Response("ok"),
          });
          await fetch(server.url, { keepalive: false });
          server.stop(true);
        })();
        await drain(baseline);
        console.log(JSON.stringify({ baseline, after: live() }));
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const { baseline, after } = JSON.parse(stdout.trim() || "{}");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(after).toBe(baseline);
  }, 15_000);

  // JSServerWebSocket holds a traced reference to the JSServer wrapper, so the
  // server (and its ws handlers) stay alive while any websocket is connected,
  // and become collectable once the last one closes.
  test("server stays alive while a websocket is connected, then collects after close", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
        const { heapStats, fullGC } = require("bun:jsc");
        const liveServer = () => {
          const c = heapStats().objectTypeCounts;
          return (c.DebugHTTPServer ?? 0) + (c.HTTPServer ?? 0);
        };

        async function gcUntilCountAtMost(max) {
          const deadline = Date.now() + 5000;
          while (liveServer() > max && Date.now() < deadline) {
            Bun.gc(true);
            fullGC();
            await new Promise(r => setImmediate(r));
          }
          return liveServer();
        }

        // Materialize prototype(s) first; baseline = the floor count, read
        // while the trivial server is the only live instance.
        const baseline = (() => {
          const s = Bun.serve({ port: 0, development: true, fetch: () => new Response("ok") });
          const floor = liveServer() - 1;
          s.stop(true);
          return floor;
        })();

        const opened = Promise.withResolvers();
        const clientOpen = Promise.withResolvers();
        const echoed = Promise.withResolvers();
        const closed = Promise.withResolvers();

        // The client and its handlers are created here, outside the scope that
        // holds server. The client's close handler is the last function native
        // code calls before the measurement below, and a pointer to it stays on
        // the native stack (conservatively scanned) for a while. Had it been
        // created next to server, it would share server's scope and keep the
        // server alive through that stale pointer, which is not what this test
        // measures.
        let client;
        function connect(url) {
          client = new WebSocket(url);
          client.onopen = () => clientOpen.resolve();
          client.onmessage = e => echoed.resolve(e.data);
          client.onclose = () => closed.resolve();
        }

        // Scope server so the only post-stop root is the connected websocket.
        // Nothing is returned from the arrow: a returned value would keep the
        // async frame's scope (which contains server) alive via the
        // resolved-value chain in JSC.
        await (async () => {
          const server = Bun.serve({
            port: 0,
            development: true,
            fetch(req, s) { if (s.upgrade(req)) return; return new Response("ok"); },
            websocket: {
              open() { opened.resolve(); },
              // Closes over server — the cycle through wsHandlers.
              message(ws, m) { ws.send(server.port + ":" + m); },
            },
          });
          connect(server.url.href.replace("http", "ws"));
          await opened.promise;      // server-side ws created (roots wrapper)
          await clientOpen.promise;  // client ready to send (avoid InvalidStateError)
          server.stop(); // graceful — listener gone, ws stays
        })();

        // server out of scope. Wrapper is rooted only via:
        //   ServerWebSocket(this_value strong) → JSServerWebSocket → m_server → JSServer
        // GC must NOT collect while the ws is open.
        Bun.gc(true); fullGC();
        const whileConnected = liveServer();

        // Dispatch through the cycle-captured handler (proves it's alive).
        client.send("hi");
        const echo = await echoed.promise;

        client.close();
        await closed.promise;
        client = null;
        // The last ws closing triggers on_websocket_closed → deinit_if_we_can,
        // which downgrades the wrapper without an explicit stop(true) — that's
        // the path under test, so no force-finish here.
        const afterClose = await gcUntilCountAtMost(baseline);

        console.log(JSON.stringify({ baseline, whileConnected, echo, afterClose }));
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const { baseline, whileConnected, echo, afterClose } = JSON.parse(stdout.trim() || "{}");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    // baseline already includes the prototype(s); the instance on top of it
    // proves the ws traced root kept it alive across GC.
    expect(whileConnected).toBeGreaterThan(baseline);
    expect(echo).toMatch(/^\d+:hi$/); // handler dispatched (server.port captured)
    expect(afterClose).toBe(baseline); // instance collected, back to prototype floor
  }, 15_000);

  // Reload swaps handlers via WriteBarrier .set() — old handlers become
  // unreachable once nothing else holds them.
  test("reload() releases the old handlers for collection", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
        const { heapStats, fullGC } = require("bun:jsc");
        // objectTypeCounts only tracks JSC cell types, not user-defined JS
        // classes, so use AsyncFunction as the observable: the OLD handler is
        // async (counted), the NEW handler is a plain function (not counted).
        const liveAsync = () => heapStats().objectTypeCounts.AsyncFunction ?? 0;

        const baseline = liveAsync();
        const server = Bun.serve({
          port: 0,
          fetch: async () => new Response("old"),
        });
        const beforeReload = liveAsync();
        server.reload({ fetch: () => new Response("new") });
        const deadline = Date.now() + 5000;
        while (liveAsync() > baseline && Date.now() < deadline) {
          Bun.gc(true);
          fullGC();
          await new Promise(r => setImmediate(r));
        }
        console.log(JSON.stringify({ baseline, beforeReload, afterReload: liveAsync() }));
        server.stop(true);
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const { baseline, beforeReload, afterReload } = JSON.parse(stdout.trim() || "{}");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(beforeReload).toBeGreaterThan(baseline); // sanity: the async handler was counted
    expect(afterReload).toBeLessThan(beforeReload); // old handler released after reload
  });

  // reload({websocket}) that omits a previously-set per-event handler must
  // CLEAR that wrapper slot, not leave the old handler pinned.
  test("reload() that drops a websocket handler clears its slot", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
        const { heapStats, fullGC } = require("bun:jsc");
        const liveAsync = () => heapStats().objectTypeCounts.AsyncFunction ?? 0;

        let oldPingFired = 0;

        const baseline = liveAsync();
        const server = Bun.serve({
          port: 0,
          fetch: (req, s) => s.upgrade(req) ? undefined : new Response("ok"),
          websocket: {
            message(ws, m) { ws.send(m); },
            // async so it shows up in objectTypeCounts.AsyncFunction.
            ping: async () => { oldPingFired++; },
          },
        });
        const withPing = liveAsync();

        // Reload with a websocket config that omits ping. The wsOnPing slot
        // must be cleared (not left holding the old async closure).
        server.reload({
          fetch: (req, s) => s.upgrade(req) ? undefined : new Response("ok"),
          websocket: { message(ws, m) { ws.send(m); } },
        });
        const deadline = Date.now() + 5000;
        while (liveAsync() > baseline && Date.now() < deadline) {
          Bun.gc(true);
          fullGC();
          await new Promise(r => setImmediate(r));
        }
        const afterReload = liveAsync();

        // Behavioral check: a client ping must not reach the dropped handler.
        const opened = Promise.withResolvers();
        const echoed = Promise.withResolvers();
        const ws = new WebSocket(server.url.href.replace("http", "ws"));
        ws.onopen = () => opened.resolve();
        ws.onerror = e => { opened.reject(e); echoed.reject(e); };
        ws.onmessage = e => echoed.resolve(e.data);
        await opened.promise;
        ws.ping("p");
        ws.send("hi"); // round-trip after the ping so any ping dispatch has happened
        await echoed.promise;
        ws.close();
        server.stop(true);

        console.log(JSON.stringify({ baseline, withPing, afterReload, oldPingFired }));
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const { baseline, withPing, afterReload, oldPingFired } = JSON.parse(stdout.trim() || "{}");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(withPing).toBeGreaterThan(baseline); // sanity: async ping was counted
    expect(afterReload).toBeLessThan(withPing); // dropped slot cleared → old ping collected
    expect(oldPingFired).toBe(0); // and never dispatched after reload
  });

  // Stress test under aggressive GC — catches missing write barriers.
  test("serve+ws+reload survives BUN_JSC_collectContinuously=1", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
        const server = Bun.serve({
          port: 0,
          fetch: (req, s) => s.upgrade(req) ? undefined : new Response("ok"),
          websocket: { open() {}, message(ws, m) { ws.send(m); } },
        });
        for (let i = 0; i < 10; i++) {
          const ws = new WebSocket(server.url.href.replace("http", "ws"));
          // Reject (don't hang) if the connection drops mid-await — under
          // collectContinuously a missing write barrier surfaces as an abrupt
          // close/error, and a bare onopen-only resolver would just time out.
          const fail = Promise.withResolvers();
          ws.onerror = e => fail.reject(e.error ?? new Error("ws error on iter " + i));
          ws.onclose = e => fail.reject(new Error("ws closed (" + e.code + ") on iter " + i));
          await Promise.race([new Promise(r => { ws.onopen = r; }), fail.promise]);
          ws.send("hi");
          await Promise.race([new Promise(r => { ws.onmessage = r; }), fail.promise]);
          const closed = new Promise(r => { ws.onclose = r; }); // before close(): event may fire synchronously
          ws.close();
          await closed;
          server.reload({
            fetch: (req, s) => s.upgrade(req) ? undefined : new Response("ok " + i),
            websocket: { open() {}, message(ws, m) { ws.send(m + i); } },
          });
        }
        server.stop(true);
        console.log("survived");
      `,
      ],
      env: { ...bunEnv, BUN_JSC_collectContinuously: "1", BUN_JSC_useConcurrentGC: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(normalizeBunSnapshot(stdout)).toBe("survived");
    expect(exitCode).toBe(0);
  }, 30_000);

  // with_async_context_if_needed wraps each handler in a fresh AsyncContextFrame
  // that is NOT a property of the user's options arg. Stored as a raw JSValue in
  // heap-boxed ServerConfig, it must stay rooted across init→listen→ptr_to_js→
  // slot-set (which includes vm.perform_gc()).
  test("handlers wrapped via AsyncLocalStorage survive Bun.serve init under collectContinuously", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
        const { AsyncLocalStorage } = require("node:async_hooks");
        const als = new AsyncLocalStorage();
        // Serve inside als.run so with_async_context_if_needed wraps every handler.
        const server = await als.run({ ctx: 1 }, async () => {
          return Bun.serve({
            port: 0, development: true,
            fetch: () => new Response(String(als.getStore()?.ctx)),
            error: () => new Response("err"),
            websocket: {
              open() {}, message(ws, m) { ws.send(m); }, close() {},
            },
          });
        });
        const r = await fetch(server.url, { keepalive: false });
        const body = await r.text();
        server.stop(true);
        // The handler's ALS context wrapper survived init→ptr_to_js (would crash
        // under collectContinuously if the AsyncContextFrame were collected).
        console.log(JSON.stringify({ body, ok: body === "1" }));
      `,
      ],
      env: { ...bunEnv, BUN_JSC_collectContinuously: "1", BUN_JSC_useConcurrentGC: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const { body, ok } = JSON.parse(stdout.trim() || "{}");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect({ body, ok }).toEqual({ body: "1", ok: true });
  }, 30_000);

  // An accessor- or Proxy-backed options object returns a fresh handler fn
  // that is NOT a data property of the object, so nothing on the JS heap
  // retains it between from_js reading it and serve_with! writing it into the
  // wrapper's WriteBarrier slot. Without a scoped gcProtect across
  // init()/listen()'s allocations, that fn is collectible; under
  // collectContinuously it IS collected, and the first request dispatches
  // into a freed cell. Pre-PR this was safe because from_js rooted each
  // callback in a Strong the moment get_truthy returned.
  test("handlers returned by an accessor-backed options object survive Bun.serve init under collectContinuously", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
        // Each get_truthy("fetch"/"message"/...) hits a getter that allocates
        // a fresh closure with no other JS-heap referrer. Use getters (not a
        // Proxy) so accidental extra lookups of the same key don't allocate a
        // second fn that rotates the first one out of the arena; "extra
        // lookup collected the cell early" and "no protect collected it" are
        // indistinguishable failures otherwise.
        const opts = {
          port: 0,
          development: true,
          get fetch() { return (req, server) => {
            if (server.upgrade(req)) return;
            return new Response("ok-fetch");
          }; },
          get error() { return () => new Response("err", { status: 500 }); },
          websocket: {
            get open() { return ws => ws.send("ws-open"); },
            get message() { return (ws, m) => ws.send("m:" + m); },
            close() {},
          },
        };
        const server = Bun.serve(opts);
        // HTTP path (on_request slot).
        const body = await (await fetch(server.url, { keepalive: false })).text();
        // WebSocket path (wsOnOpen + wsOnMessage slots).
        const ws = new WebSocket(server.url);
        const msgs = [];
        const got2 = new Promise(r => {
          ws.onmessage = e => { msgs.push(e.data); if (msgs.length === 2) r(); };
          ws.onopen = () => ws.send("hi");
          ws.onerror = () => r();
        });
        await got2;
        ws.close();
        server.stop(true);
        console.log(JSON.stringify({ body, msgs }));
      `,
      ],
      env: { ...bunEnv, BUN_JSC_collectContinuously: "1", BUN_JSC_useConcurrentGC: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const { body, msgs } = JSON.parse(stdout.trim() || "{}");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect({ body, msgs }).toEqual({ body: "ok-fetch", msgs: ["ws-open", "m:hi"] });
  }, 30_000);

  // Sibling of the above for server.reload(): on_reload_from_zig moves the
  // websocket handler shadows into the heap-boxed self.config before
  // write_ws_handler_slots roots them, and each wrap_handler_slot allocates
  // via with_async_context_if_needed. Pre-PR on_create's server.protect()
  // gcProtected all 7 at read time.
  test("reload() with accessor-backed websocket handlers survives under collectContinuously", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
        const { AsyncLocalStorage } = require("node:async_hooks");
        const als = new AsyncLocalStorage();
        const server = Bun.serve({
          port: 0, development: true,
          fetch(req, s) { if (s.upgrade(req)) return; return new Response("v1"); },
          websocket: { open() {}, message() {}, close() {} },
        });
        // Reload inside als.run so with_async_context_if_needed allocates an
        // AsyncContextFrame for every ws handler it wraps (the GC point
        // between moving the shadows into self.config and rooting them).
        als.run({}, () => server.reload({
          fetch(req, s) { if (s.upgrade(req)) return; return new Response("v2"); },
          websocket: {
            get open() { return ws => ws.send("r-open"); },
            get message() { return (ws, m) => ws.send("r:" + m); },
            get close() { return () => {}; },
            get drain() { return () => {}; },
            get ping() { return () => {}; },
            get pong() { return () => {}; },
          },
        }));
        const body = await (await fetch(server.url, { keepalive: false })).text();
        const ws = new WebSocket(server.url);
        const msgs = [];
        await new Promise(r => {
          ws.onmessage = e => { msgs.push(e.data); if (msgs.length === 2) r(); };
          ws.onopen = () => ws.send("hi");
          ws.onerror = () => r();
        });
        ws.close();
        server.stop(true);
        console.log(JSON.stringify({ body, msgs }));
      `,
      ],
      env: { ...bunEnv, BUN_JSC_collectContinuously: "1", BUN_JSC_useConcurrentGC: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const { body, msgs } = JSON.parse(stdout.trim() || "{}");
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect({ body, msgs }).toEqual({ body: "v2", msgs: ["r-open", "r:hi"] });
  }, 30_000);

  // A ws.close() inside the message handler on the last socket of a stopped
  // server downgrades the wrapper (the sole GC root for wsOnError) before the
  // message handler returns. The error path must have copied on_error to the
  // stack before entering user JS, or a GC between the close and the throw
  // collects it and run_error_callback calls a freed cell.
  test("error handler survives ws.close()+throw inside the last socket's message handler under collectContinuously", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
        let errorFired = 0;
        const opened = Promise.withResolvers();
        const closed = Promise.withResolvers();
        let ws;
        // Scope server so the module-level frame holds no reference to the
        // wrapper when message(ws) runs; after ws.close() downgrades js_value
        // and clears m_server, the wrapper must have zero roots for Bun.gc to
        // reach wsOnError.
        await (async () => {
          const server = Bun.serve({
            port: 0, hostname: "127.0.0.1",
            fetch(req, s) { if (s.upgrade(req)) return; return new Response("no"); },
            websocket: {
              open() {},
              message(ws) {
                ws.close(); // last socket of a stopped server → wrapper downgrades
                Bun.gc(true);
                throw new Error("boom");
              },
              error(e) { errorFired++; },
            },
          });
          ws = new WebSocket("ws://127.0.0.1:" + server.port);
          ws.onopen = () => opened.resolve();
          ws.onerror = e => opened.reject(e);
          ws.onclose = () => closed.resolve();
          await opened.promise;
          server.stop(); // graceful: listener gone, this ws keeps wrapper Strong
        })();
        ws.send("go");
        await closed.promise;
        console.log(JSON.stringify({ errorFired }));
        process.exit(0);
      `,
      ],
      env: { ...bunEnv, BUN_JSC_collectContinuously: "1", BUN_JSC_useConcurrentGC: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ out: JSON.parse(stdout.trim() || "null"), stderr, exitCode }).toEqual({
      out: { errorFired: 1 },
      stderr: "",
      exitCode: 0,
    });
  }, 30_000);
});

// The warning is only registered when `idleTimeout` is not passed, so the test
// has to wait for the default 10 second timeout to fire. uWS sweeps timeouts on
// a coarse timer, so the close lands a couple of seconds after that.
test.concurrent(
  "development mode prints the idle timeout warning when the timeout fires, not at exit",
  async () => {
    using dir = tempDir("serve-idle-timeout-warn", {});
    const stderrPath = path.join(String(dir), "stderr.txt");

    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        import { readFileSync } from "node:fs";
        const server = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          development: true,
          async fetch(req) {
            await req.text();
            return new Response("ok");
          },
        });
        await Bun.connect({
          hostname: "127.0.0.1",
          port: server.port,
          socket: {
            open(socket) {
              // A POST whose body never completes. The server times it out
              // after the default idleTimeout and closes the socket.
              socket.write("POST / HTTP/1.1\\r\\nHost: x\\r\\nContent-Length: 100\\r\\n\\r\\nabc");
            },
            data() {},
            error() {},
            close() {
              // The server runs the timeout handler before it closes the
              // socket. Whatever the handler wrote to stderr must already be
              // in the file by the time the client sees the close.
              console.log(JSON.stringify({ stderrAtClose: readFileSync(process.env.STDERR_PATH, "utf8") }));
              server.stop(true);
            },
          },
        });
      `,
      ],
      env: { ...bunEnv, STDERR_PATH: stderrPath },
      stdout: "pipe",
      stderr: Bun.file(stderrPath),
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const warning = "[Bun.serve]: request timed out after 10 seconds. Pass `idleTimeout` to configure.\n";

    expect({
      out: JSON.parse(stdout.trim() || "null"),
      stderrAtExit: await Bun.file(stderrPath).text(),
      exitCode,
    }).toEqual({
      out: { stderrAtClose: warning },
      stderrAtExit: warning,
      exitCode: 0,
    });
  },
  30_000,
);

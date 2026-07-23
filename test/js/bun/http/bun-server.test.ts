import type { Server, ServerWebSocket, Socket } from "bun";
import { describe, expect, test } from "bun:test";
import {
  bunEnv,
  bunExe,
  isWindows,
  normalizeBunSnapshot,
  rejectUnauthorizedScope,
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

// Shared rig for the two "late keep-alive" tests below: open a raw TCP
// socket, hold the first request in-flight across stop()/close(), pipeline a
// second request behind it, release, GC, and print the second response's
// status line. The subprocess runs the rig so a (former) panic in the dispatch
// trampoline surfaces as a non-zero exit instead of taking down the runner.
//
// The wrapper's `js_value` downgrades to Weak once the first request
// completes (pending_requests → 0 in `deinit_if_we_can`). While Weak the
// wrapper cell is still alive and its WriteBarrier slots still root the
// handlers, so the pipelined request must dispatch cleanly — no panic, and a
// 200 from the same handler. The `respond_stopped_503` guard in the
// trampolines is a safety net for the `Finalized` case (wrapper GC'd while
// `self` still lives between `finalize()` and the next-tick
// `schedule_deinit`); that window is not deterministically reachable from a
// test, so these pin the Weak→dispatch path plus clean collection afterwards.
//
// `serverSnippet` must define `port` (the listen port) and `stop()` in scope,
// and may read `release`/`inflight`/`hits` for the hold protocol.
async function runLateKeepAlive(reqPath: string, serverSnippet: string) {
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

          // First request: handler parks on \`release\`, keeping
          // pending_requests > 0 so stop() defers the js_value downgrade.
          sock.write("GET ${reqPath} HTTP/1.1\\r\\nHost: x\\r\\nConnection: keep-alive\\r\\n\\r\\n");
          await inflight.promise;
          // Pipeline the late request behind the held one. uws won't read it
          // until the first response is sent, by which time js_value is Weak.
          sock.write("GET ${reqPath} HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");

          // Graceful stop: listener closes; downgrade deferred (request in flight).
          stop();
        })();
        // The only server binding is now out of scope.

        // First request completes → pending_requests → 0 → js_value downgrades
        // to Weak. The pipelined request then hits the trampoline with the
        // wrapper still alive (Weak) → handler runs → 200. Previously: panic
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
  // Must actually dispatch — empty would mean the socket was closed before the
  // pipelined request reached the trampoline.
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: expect.stringMatching(/^HTTP\/1\.1 200\b/),
    stderr: "",
    exitCode: 0,
  });
}

test("late keep-alive request to a route after stop() dispatches while the wrapper is Weak", async () => {
  // Per-route handlers live in ServerRouteList, which is reachable from JS only
  // through the Server wrapper — exercises on_user_route_request's gate.
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
  );
});

test("late keep-alive WebSocket upgrade after stop()+idle is refused by server.upgrade()", async () => {
  // Sibling of the HTTP late-keep-alive test for the WebSocket upgrade path.
  // After `deinit_if_we_can` downgrades the wrapper AND clears
  // `handler.server`/`handler.app`, `js_value_for_dispatch()` still lets the
  // pipelined request reach `fetch()` while the wrapper is Weak, but
  // `server.upgrade()` must return false: accepting would create a
  // `ServerWebSocket` whose open/close accounting is skipped (`handler.server`
  // is None), so `has_active_web_sockets()` would stay false and the next idle
  // pass could free the `NewServer` box under a live socket.
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
        // Wait for both responses.
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
  // First request 200 (held handler), pipelined upgrade refused → 426 body.
  expect(out.upgraded).toBe(false);
  expect(out.statuses?.[0]).toMatch(/^HTTP\/1\.1 200\b/);
  expect(out.statuses?.[1]).toMatch(/^HTTP\/1\.1 426\b/);
});

test("late keep-alive request to a node:http server after close() dispatches while the wrapper is Weak", async () => {
  // Same shape but through node:http so the request dispatches via
  // on_node_http_request_with_upgrade_ctx — the trampoline that would panic
  // on a stale shadow without the `js_value_for_dispatch` gate.
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
  );
});

test("server wrapper survives GC while a websocket is connected and is collected after stop()", async () => {
  // Wrapper must survive GC while a ws is connected with no user-held
  // `server` binding; stop() ends the ws and downgrades js_value so the
  // wrapper becomes collectable.
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

        async function drain(target) {
          for (let i = 0; i < 30 && serverCount() > target; i++) {
            Bun.gc(true);
            fullGC();
            await new Promise(r => setImmediate(r));
            await Bun.sleep(10);
          }
        }

        // objectTypeCounts includes the (lazily created) prototype object(s)
        // once the first server is constructed — and on libuv platforms both
        // Debug and non-Debug prototypes may end up materialized. Create+stop
        // a trivial server first so the baseline captures whatever prototype
        // floor this build settles at; assertions are then relative to it.
        await (async () => {
          const s = Bun.serve({ port: 0, fetch: () => new Response("ok") });
          s.stop(true);
        })();
        await drain(0);
        const baseline = serverCount();

        let serverRef;
        const closed = Promise.withResolvers();
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
          serverRef = new WeakRef(server);

          const opened = Promise.withResolvers();
          const ws = new WebSocket("ws://127.0.0.1:" + server.port);
          ws.onopen = () => opened.resolve();
          ws.onerror = e => opened.reject(e);
          ws.onclose = () => closed.resolve();
          await opened.promise;
          return ws;
        })();
        // The only strong \`server\` binding is now out of scope; js_value
        // stays Strong while the listener/socket are live.

        for (let i = 0; i < 30; i++) {
          Bun.gc(true);
          fullGC();
          await new Promise(r => setImmediate(r));
          await Bun.sleep(10);
        }
        const whileConnected = serverCount();

        // Graceful stop now also ends open websockets with 1001.
        await serverRef.deref().stop();
        serverRef = null;
        await closed.promise;

        await drain(baseline);
        const afterStop = serverCount();

        console.log(JSON.stringify({ baseline, whileConnected, afterStop }));
        process.exit(0);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const { baseline, whileConnected, afterStop } = JSON.parse(stdout.trim() || "{}");
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  // baseline already includes the prototype(s), so the live instance shows as
  // baseline+1 while connected.
  expect(whileConnected).toBeGreaterThan(baseline);
  // stop() ended the websocket and downgraded the wrapper: no leak.
  expect(afterStop).toBe(baseline);
}, 15_000);

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
describe("handler liveness across reload/stop", () => {
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
describe("handler GC tracing (heapStats wrapper-count)", () => {
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
        async function drain(target) {
          for (let i = 0; i < 30 && live() > target; i++) {
            Bun.gc(true);
            fullGC();
            await new Promise(r => setImmediate(r));
            await Bun.sleep(10);
          }
        }

        // Materialize prototype(s) first so baseline = whatever floor this
        // build settles at (libuv platforms may surface 2, not 1).
        await (async () => {
          const s = Bun.serve({ port: 0, development: true, fetch: () => new Response("ok") });
          s.stop(true);
        })();
        await drain(0);
        const baseline = live();

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
          for (let i = 0; i < 30 && live() > target; i++) {
            Bun.gc(true); fullGC();
            await new Promise(r => setImmediate(r));
            await Bun.sleep(10);
          }
        }
        await (async () => {
          const s = Bun.serve({ port: 0, development: true, fetch: () => new Response("ok") });
          s.stop(true);
        })();
        await drain(0);
        const baseline = live();

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
          for (let i = 0; i < 30; i++) {
            Bun.gc(true);
            fullGC();
            if (liveServer() <= max) return liveServer();
            await new Promise(r => setImmediate(r));
            await Bun.sleep(10);
          }
          return liveServer();
        }

        // Materialize prototype(s) first; baseline = the floor count.
        await (async () => {
          const s = Bun.serve({ port: 0, development: true, fetch: () => new Response("ok") });
          s.stop(true);
        })();
        await gcUntilCountAtMost(0);
        const baseline = liveServer();

        const opened = Promise.withResolvers();
        const clientOpen = Promise.withResolvers();
        const echoed = Promise.withResolvers();
        const closed = Promise.withResolvers();

        // Scope server so only the native side roots it while the ws is open.
        // Assign client to the outer var (returning it would keep the async
        // frame's scope, which contains server, alive via the resolved value).
        let client;
        let serverRef;
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
          serverRef = new WeakRef(server);
          client = new WebSocket(server.url.href.replace("http", "ws"));
          client.onopen = () => clientOpen.resolve();
          client.onmessage = e => echoed.resolve(e.data);
          client.onclose = () => closed.resolve();
          await opened.promise;      // server-side ws created (roots wrapper)
          await clientOpen.promise;  // client ready to send (avoid InvalidStateError)
        })();

        // server out of scope. Wrapper is rooted via js_value (Strong while
        // listener/socket live) and the wsHandlers cycle. GC must NOT collect.
        Bun.gc(true); fullGC();
        const whileConnected = liveServer();

        // Dispatch through the cycle-captured handler (proves it's alive).
        client.send("hi");
        const echo = await echoed.promise;

        // Graceful stop now also ends open websockets with 1001.
        await serverRef.deref().stop();
        serverRef = null;
        await closed.promise;
        client = null;
        // stop() drained the last ws and ran deinit_if_we_can → downgrade.
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
        for (let i = 0; i < 30 && liveAsync() > baseline; i++) {
          Bun.gc(true);
          fullGC();
          await new Promise(r => setImmediate(r));
          await Bun.sleep(10);
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
        for (let i = 0; i < 30 && liveAsync() > baseline; i++) {
          Bun.gc(true);
          fullGC();
          await new Promise(r => setImmediate(r));
          await Bun.sleep(10);
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
        let serverRef;
        // Scope server so nothing roots the wrapper when message(ws) runs;
        // a WeakRef lets the handler call stop() without itself rooting it.
        await (async () => {
          const server = Bun.serve({
            port: 0, hostname: "127.0.0.1",
            fetch(req, s) { if (s.upgrade(req)) return; return new Response("no"); },
            websocket: {
              open() {},
              message(ws) {
                ws.close(); // last socket → count=0
                serverRef.deref()?.stop(); // listener gone → wrapper downgrades
                serverRef = null;
                Bun.gc(true);
                throw new Error("boom");
              },
              error(e) { errorFired++; },
            },
          });
          serverRef = new WeakRef(server);
          ws = new WebSocket("ws://127.0.0.1:" + server.port);
          ws.onopen = () => opened.resolve();
          ws.onerror = e => opened.reject(e);
          ws.onclose = () => closed.resolve();
          await opened.promise;
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

import { file, gc, Serve, serve, Server } from "bun";
import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import {
  bunEnv,
  bunExe,
  bunRun,
  dumpStats,
  emptyProcessMaxRSS,
  isAndroid,
  isASAN,
  isBroken,
  isDebug,
  isIntelMacOS,
  isIPv4,
  isIPv6,
  isLinux,
  isPosix,
  isWindows,
  libcPathForDlopen,
  MAX_PATH_BYTES,
  runFixtureMaxRSS,
  tempDir,
  tls,
  tmpdirSync,
} from "harness";
import { connect } from "net";
import { join, resolve } from "path";
// import { renderToReadableStream } from "react-dom/server";
// import app_jsx from "./app.jsx";
import { setSocketOptions, sweepSocketTimers } from "bun:internal-for-testing";
import { heapStats } from "bun:jsc";
import { spawn } from "child_process";
import { on, once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import net, { type AddressInfo } from "node:net";
import { networkInterfaces } from "node:os";
import { Duplex } from "node:stream";
import nodeTls from "node:tls";
import { Worker } from "node:worker_threads";
import { tmpdir } from "os";

let renderToReadableStream: any = null;
let app_jsx: any = null;

type Handler = (req: Request) => Response;
afterEach(() => {
  gc(true);
});

const count = 200;
let server: Server<any> | undefined;

async function runTest(
  { port, ...serverOptions }: Serve.Options<any> & { unix?: undefined },
  test: (server: Server<any>) => Promise<void> | void,
) {
  if (server) {
    server.reload({ ...serverOptions, port: 0 });
  } else {
    while (!server) {
      try {
        server = serve({ ...serverOptions, port: 0 });
        break;
      } catch (e: any) {
        console.log("catch:", e);
        if (e?.message !== `Failed to start server `) {
          throw e;
        }
      }
    }
  }

  await test(server);
}

afterAll(() => {
  if (server) {
    server.stop(true);
    server = undefined;
  }
});

it("should be able to abruptly stop the server many times", async () => {
  async function run() {
    const stopped = Promise.withResolvers();
    const server = Bun.serve({
      port: 0,
      error() {
        return new Response("Error", { status: 500 });
      },
      async fetch(req, server) {
        await Bun.sleep(50);
        server.stop(true);
        await Bun.sleep(50);
        server = undefined as any;
        if (stopped.resolve) {
          stopped.resolve();
          stopped.resolve = undefined as any;
        }

        return new Response("Hello, World!");
      },
    });
    const url = server.url;

    async function request() {
      try {
        await fetch(url, { keepalive: true }).then(res => res.text());
        expect.unreachable();
      } catch (e: any) {
        expect(["ECONNRESET", "ECONNREFUSED"]).toContain(e.code);
      }
    }

    const requests = new Array(20);
    for (let i = 0; i < 20; i++) {
      requests[i] = request();
    }
    await Promise.all(requests);
    await stopped.promise;
    Bun.gc(true);
  }
  const runs = new Array(10);
  for (let i = 0; i < 10; i++) {
    runs[i] = run();
  }

  await Promise.all(runs);
  Bun.gc(true);
});

// This test reproduces a crash in Bun v1.1.18 and earlier
it("should be able to abruptly stop the server", async () => {
  for (let i = 0; i < 2; i++) {
    const controller = new AbortController();

    using server = Bun.serve({
      port: 0,
      error() {
        return new Response("Error", { status: 500 });
      },
      async fetch(req, server) {
        server.stop(true);
        await Bun.sleep(10);
        return new Response();
      },
    });

    await fetch(server.url, {
      signal: controller.signal,
    })
      .then(res => {
        return res.blob();
      })
      .catch(() => {});
  }
});

// https://github.com/oven-sh/bun/issues/6758
// https://github.com/oven-sh/bun/issues/4517
it("should call cancel() on ReadableStream when the Request is aborted", async () => {
  let waitForCancel = Promise.withResolvers();
  const abortedFn = mock(() => {
    console.log("'abort' event fired", new Date());
  });
  const cancelledFn = mock(() => {
    console.log("'cancel' function called", new Date());
    waitForCancel.resolve();
  });
  let onIncomingRequest = Promise.withResolvers();
  await runTest(
    {
      async fetch(req) {
        req.signal.addEventListener("abort", abortedFn);
        // Give it a chance to start the stream so that the cancel function can be called.
        setTimeout(() => {
          console.log("'onIncomingRequest' function called", new Date());
          onIncomingRequest.resolve();
        }, 0);
        return new Response(
          new ReadableStream({
            async pull(controller) {
              await waitForCancel.promise;
            },
            cancel: cancelledFn,
          }),
        );
      },
    },
    async server => {
      const controller = new AbortController();
      const signal = controller.signal;
      // The head arrives before the body has a chunk, so fetch() resolves and the abort fails the body read.
      const response = await fetch(server.url, { signal });
      await onIncomingRequest.promise;
      controller.abort();
      await expect(response.text()).rejects.toMatchObject({ name: "AbortError" });
      await waitForCancel.promise;

      expect(abortedFn).toHaveBeenCalled();
      expect(cancelledFn).toHaveBeenCalled();
    },
  );
});
describe("HEAD request with a ReadableStream body", () => {
  for (const isAsync of [false, true]) {
    it(`calls cancel() and releases the stream (${isAsync ? "async" : "sync"} handler)`, async () => {
      let starts = 0;
      let cancels = 0;
      let live = 0;
      const cancelled = Promise.withResolvers<void>();
      const enc = new TextEncoder();
      const makeResponse = () => {
        let t: ReturnType<typeof setInterval>;
        return new Response(
          new ReadableStream({
            start(c) {
              starts++;
              live++;
              t = setInterval(() => {
                try {
                  c.enqueue(enc.encode("data: tick\n\n"));
                } catch {
                  clearInterval(t);
                  live--;
                }
              }, 20);
            },
            cancel() {
              cancels++;
              clearInterval(t);
              live--;
              if (cancels === starts) cancelled.resolve();
            },
          }),
          { headers: { "Content-Type": "text/event-stream" } },
        );
      };
      await using server = Bun.serve({
        port: 0,
        idleTimeout: 0,
        fetch: isAsync
          ? async () => {
              await 1;
              return makeResponse();
            }
          : () => makeResponse(),
      });
      Bun.gc(true);
      const before = heapStats().objectTypeCounts.ReadableStream || 0;

      for (let i = 0; i < 8; i++) {
        const res = await fetch(server.url, { method: "HEAD" });
        expect(res.status).toBe(200);
        expect(res.headers.get("transfer-encoding")).toBe("chunked");
        expect(await res.text()).toBe("");
      }
      await cancelled.promise;

      expect({ starts, cancels, live }).toEqual({ starts: 8, cancels: 8, live: 0 });

      Bun.gc(true);
      const after = heapStats().objectTypeCounts.ReadableStream || 0;
      // Before the fix this leaked one ReadableStream per HEAD (before -> before+8).
      expect(after).toBeLessThanOrEqual(before + 2);
    });
  }
});

describe("HEAD request answered with a fetch() Response whose body was never read", () => {
  it.each([
    ["fetch()", (url: URL) => fetch(url)],
    ["HTMLRewriter.transform(await fetch())", async (url: URL) => new HTMLRewriter().transform(await fetch(url))],
  ])("%s aborts the upstream request", async (_name, proxied) => {
    const aborted = Promise.withResolvers<void>();
    await using upstream = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch(req) {
        req.signal.addEventListener("abort", () => aborted.resolve());
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("never ends"));
            },
          }),
        );
      },
    });
    await using proxy = Bun.serve({
      port: 0,
      fetch: () => proxied(upstream.url),
    });

    const res = await fetch(proxy.url, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("");
    await aborted.promise;
  });
});

for (let withDelay of [true, false]) {
  for (let connectionHeader of ["keepalive", "not keepalive"] as const) {
    it(`should NOT call cancel() on ReadableStream that finished normally for ${connectionHeader} request and ${withDelay ? "with" : "without"} delay`, async () => {
      const cancelledFn = mock(() => {
        console.log("'cancel' function called", new Date());
      });
      let onIncomingRequest = Promise.withResolvers();
      await runTest(
        {
          async fetch(req) {
            return new Response(
              new ReadableStream({
                async pull(controller) {
                  controller.enqueue(new Uint8Array([1, 2, 3]));
                  if (withDelay) await Bun.sleep(1);
                  controller.close();
                },
                cancel: cancelledFn,
              }),
            );
          },
        },
        async server => {
          const resp = await fetch(
            server.url,
            connectionHeader === "keepalive"
              ? {}
              : {
                  headers: {
                    "Connection": "close",
                  },
                  keepalive: false,
                },
          );
          await resp.blob();
          // Delay for one run of the event loop.
          await Bun.sleep(1);
          expect(cancelledFn).not.toHaveBeenCalled();
        },
      );
    });
  }
}
describe.todoIf(isBroken && isIntelMacOS)(
  "1000 uploads & downloads in batches of 64 do not leak ReadableStream",
  () => {
    for (let isDirect of [true, false] as const) {
      it(
        isDirect ? "direct" : "default",
        async () => {
          const blob = new Blob([new Uint8Array(1024 * 768).fill(123)]);
          Bun.gc(true);

          const expected = Bun.CryptoHasher.hash("sha256", blob, "base64");
          const initialCount = heapStats().objectTypeCounts.ReadableStream || 0;

          await runTest(
            {
              async fetch(req) {
                var hasher = new Bun.SHA256();
                for await (const chunk of req.body!) {
                  await Bun.sleep(0);
                  hasher.update(chunk);
                }
                return new Response(
                  isDirect
                    ? new ReadableStream({
                        type: "direct",
                        async pull(controller) {
                          await Bun.sleep(0);
                          controller.write(Buffer.from(hasher.digest("base64")));
                          await controller.flush();
                          controller.close();
                        },
                      })
                    : new ReadableStream({
                        async pull(controller) {
                          await Bun.sleep(0);
                          controller.enqueue(Buffer.from(hasher.digest("base64")));
                          controller.close();
                        },
                      }),
                );
              },
            },
            async server => {
              const count = 1000;
              const batchSize = 64;
              let completed = 0;
              const wrongDigests: string[] = [];
              async function callback() {
                const response = await fetch(server.url, {
                  body: blob,
                  method: "POST",
                });

                // We are testing for ReadableStream leaks, so we use the ReadableStream here.
                const chunks: Uint8Array[] = [];
                for await (const chunk of response.body!) {
                  chunks.push(chunk);
                }

                const digest = Buffer.from(Bun.concatArrayBuffers(chunks)).toString();
                if (digest !== expected) wrongDigests.push(digest);

                // Collect while the rest of the batch is in flight. CI sets BUN_GARBAGE_COLLECTOR_LEVEL,
                // which makes every expect() collect too, so the digests are checked once at the end.
                if (++completed % 4 === 0) Bun.gc(false);
              }
              for (let remaining = count; remaining > 0; remaining -= batchSize) {
                const batch: Promise<void>[] = [];
                for (let i = 0; i < Math.min(batchSize, remaining); i++) {
                  batch.push(callback());
                }
                await Promise.all(batch);
              }
              expect({ completed, wrongDigests }).toEqual({ completed: count, wrongDigests: [] });

              Bun.gc(true);
              dumpStats();
              expect(heapStats().objectTypeCounts.ReadableStream).toBeWithin(
                Math.max(initialCount - count / 2, 0),
                initialCount + count / 2,
              );
            },
          );
        },
        100000,
      );
    }
  },
);

[200, 200n, 303, 418, 599, 599n].forEach(statusCode => {
  it(`should response with HTTP status code (${statusCode})`, async () => {
    await runTest(
      {
        fetch() {
          return new Response("Foo Bar", { status: statusCode as number });
        },
      },
      async server => {
        const response = await fetch(server.url.origin);
        expect(response.status).toBe(Number(statusCode));
        expect(await response.text()).toBe("Foo Bar");
      },
    );
  });
});

[-200, 42, 100, 102, 12345, Math.PI, 999, 600, 199, 199n, 600n, 100n, 102n].forEach(statusCode => {
  it(`should error on invalid HTTP status code (${statusCode})`, async () => {
    await runTest(
      {
        fetch() {
          try {
            return new Response("Foo Bar", { status: statusCode as number });
          } catch (err) {
            expect(err).toBeInstanceOf(RangeError);
            return new Response("Error!", { status: 500 });
          }
        },
      },
      async server => {
        const response = await fetch(server.url.origin);
        expect(response.status).toBe(500);
        expect(await response.text()).toBe("Error!");
      },
    );
  });
});

it("should display a welcome message when the response value type is incorrect", async () => {
  await runTest(
    {
      // @ts-ignore
      fetch(req) {
        return Symbol("invalid response type");
      },
    },
    async server => {
      const response = await fetch(server.url.origin);
      const text = await response.text();
      expect(text).toContain("Welcome to Bun!");
    },
  );
});

// The async handler path already reported non-Response returns to stderr; the
// synchronous path must emit the same diagnostic instead of staying silent.
it("logs the invalid-response diagnostic when a synchronous fetch handler returns a non-Response value", async () => {
  const script = `
    const statuses = [];
    async function hit(fetchImpl) {
      await using server = Bun.serve({ port: 0, development: false, fetch: fetchImpl });
      const res = await fetch(server.url);
      await res.arrayBuffer();
      statuses.push(res.status);
    }
    await hit(() => ({ forgot: "new Response" }));
    await hit(() => "plain string");
    await hit(() => 42);
    await hit(async () => ({ forgot: "new Response" }));
    console.log(JSON.stringify(statuses));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const diagnostics = stderr.match(/Expected a Response object, but received/g) ?? [];
  expect({
    // Returning a non-Response still renders 204 in production mode; only the
    // missing stderr diagnostic on the synchronous path changes.
    statuses: JSON.parse(stdout.trim()),
    diagnosticCount: diagnostics.length,
    exitCode,
  }).toEqual({
    statuses: [204, 204, 204, 204],
    diagnosticCount: 4,
    exitCode: 0,
  });
  expect(stderr).toContain(`received '"plain string"'`);
  expect(stderr).toContain("received '42'");
});

it("passes the error to error() when inspecting a non-Response return value throws", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      import { inspect } from "node:util";
      const events = [];
      const throwsOnInspect = message => ({ [inspect.custom]() { throw new Error(message); } });
      process.on("uncaughtException", err => events.push("uncaughtException: " + err.message));
      async function hit(label, firstResult) {
        let calls = 0;
        await using server = Bun.serve({
          port: 0,
          development: false,
          routes: { "/:id": req => (calls++ === 0 ? firstResult(req) : new Response("ok")) },
          error: err => new Response("error(): " + err.message, { status: 500 }),
        });
        for (let i = 0; i < 2; i++) {
          const res = await fetch(new URL("/1", server.url));
          events.push(label + ": " + res.status + " " + (await res.text()));
        }
      }
      await hit("sync", () => throwsOnInspect("sync inspect"));
      await hit("pending promise", async () => {
        await new Promise(resolve => setImmediate(resolve));
        return throwsOnInspect("pending promise inspect");
      });
      await hit("request", req => {
        req.params.nested = throwsOnInspect("request inspect");
        return req;
      });
      console.log(JSON.stringify(events));
    `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr.match(/^error: Expected a Response object.*$/gm) ?? stderr).toEqual(
    new Array(3).fill("error: Expected a Response object"),
  );
  expect(stdout.trim()).toBe(
    JSON.stringify(
      ["sync", "pending promise", "request"].flatMap(label => [
        `${label}: 500 error(): ${label} inspect`,
        `${label}: 200 ok`,
      ]),
    ),
  );
  expect(exitCode).toBe(0);
});

it("request.signal works in trivial case", async () => {
  var aborty = new AbortController();
  var signaler = Promise.withResolvers();
  await runTest(
    {
      async fetch(req) {
        req.signal.addEventListener("abort", () => {
          signaler.resolve();
        });
        aborty.abort();
        await Bun.sleep(2);
        return new Response("Test failed!");
      },
    },
    async server => {
      expect(async () => {
        const response = await fetch(server.url.origin, {
          signal: aborty.signal,
        });
        await signaler.promise;
        await response.blob();
      }).toThrow("The operation was aborted.");
    },
  );
});

it("request.signal works in leaky case", async () => {
  var aborty = new AbortController();
  var signaler = Promise.withResolvers();

  await runTest(
    {
      async fetch(req) {
        req.signal.addEventListener("abort", () => {
          signaler.resolve();
        });
        aborty.abort();
        await Bun.sleep(20);
        return new Response("Test failed!");
      },
    },
    async server => {
      await expect(async () => {
        const resp = await fetch(server.url.origin, { signal: aborty.signal });
        await signaler.promise;
        await Bun.sleep(10);
        resp.body?.getReader();
      }).toThrow("The operation was aborted.");
    },
  );
});

it("should work for a file", async () => {
  const fixture = resolve(import.meta.dir, "./fetch.js.txt");
  const textToExpect = readFileSync(fixture, "utf-8");
  await runTest(
    {
      fetch(req) {
        return new Response(file(fixture));
      },
    },
    async server => {
      const response = await fetch(server.url.origin);
      expect(await response.text()).toBe(textToExpect);
    },
  );
});

it("keeps serving from a Worker after an error that no error() handles", async () => {
  using dir = tempDir("serve-worker-unhandled-error", {
    "a.txt": "hello",
    "server.mjs": `
      import { join } from "node:path";
      import { parentPort } from "node:worker_threads";
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(req) {
          const { pathname } = new URL(req.url);
          if (pathname === "/throws") throw new Error("thrown by the handler");
          return new Response(Bun.file(join(import.meta.dirname, pathname)));
        },
      });
      parentPort.postMessage(server.port);
    `,
  });
  const worker = new Worker(join(String(dir), "server.mjs"));
  const errors: unknown[] = [];
  worker.on("error", error => errors.push(error.code));
  try {
    const [port] = await once(worker, "message");
    const get = (path: string) => fetch(`http://127.0.0.1:${port}${path}`).then(res => res.status);
    const statuses = [
      await get("/missing.txt"),
      await get("/throws").catch(error => error.code),
      await get("/a.txt").catch(error => error.code),
    ];
    expect({ statuses, errors }).toEqual({ statuses: [404, 500, 200], errors: [] });
  } finally {
    await worker.terminate();
  }
});

it("request.url should log successfully", async () => {
  const fixture = resolve(import.meta.dir, "./fetch.js.txt");
  const textToExpect = readFileSync(fixture, "utf-8");
  var expected: string;
  await runTest(
    {
      fetch(req) {
        expect(Bun.inspect(req).includes(expected)).toBe(true);
        return new Response(file(fixture));
      },
    },
    async server => {
      expected = `http://localhost:${server.port}/helloooo`;
      const response = await fetch(expected);
      expect(response.url).toBe(expected);
      expect(await response.text()).toBe(textToExpect);
    },
  );
});

it("request.url should be based on the Host header", async () => {
  const fixture = resolve(import.meta.dir, "./fetch.js.txt");
  const textToExpect = readFileSync(fixture, "utf-8");
  await runTest(
    {
      fetch(req) {
        expect(req.url).toBe("http://example.com/helloooo");
        return new Response(file(fixture));
      },
    },
    async server => {
      const expected = `${server.url.origin}/helloooo`;
      const response = await fetch(expected, {
        headers: {
          Host: "example.com",
        },
      });
      expect(response.url).toBe(expected);
      expect(await response.text()).toBe(textToExpect);
    },
  );
});

it.each([
  ["HTTP/1.0", "GET /helloooo HTTP/1.0\r\nHost: a/b\r\n\r\n"],
  ["HTTP/1.1", "GET /helloooo HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n"],
])("request.url is the request-target when the %s Host header is not a valid authority", async (_version, payload) => {
  using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req) {
      return new Response(req.url);
    },
  });

  const socket = net.connect(server.port!, "127.0.0.1");
  const response = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    socket.on("error", reject);
    socket.on("data", chunk => chunks.push(chunk as Buffer));
    socket.on("close", () => resolve(Buffer.concat(chunks).toString()));
    socket.write(payload);
  });
  socket.destroy();
  expect(response).toStartWith("HTTP/1.1 200");
  expect(response.slice(response.indexOf("\r\n\r\n") + 4)).toBe("/helloooo");
});

// RFC 9112 9.6: a server that receives a "close" connection option MUST NOT
// process any further requests on that connection. The parser must stop at the
// close-flagged request even when a well-formed follow-up sits in the same TCP
// segment; the response to /a is delivered and the socket is then closed.
describe("does not dispatch a pipelined request after Connection: close", () => {
  async function roundTrip(port: number, payload: string, expectedResponses: number) {
    const chunks: Buffer[] = [];
    // Settle once the server has either closed the socket or written the
    // expected number of responses; an unfixed server writes one response too
    // many and never closes, so the second condition keeps the failure fast.
    const { promise: done, resolve } = Promise.withResolvers<void>();
    const count = () =>
      (
        Buffer.concat(chunks)
          .toString("latin1")
          .match(/HTTP\/1\.[01] \d{3} /g) ?? []
      ).length;
    const socket = net.connect(port, "127.0.0.1");
    socket.on("data", c => {
      chunks.push(c as Buffer);
      if (count() >= expectedResponses) resolve();
    });
    socket.on("error", () => {});
    let closed = false;
    socket.on("close", () => {
      closed = true;
      resolve();
    });
    await new Promise<void>((ok, fail) => {
      socket.once("connect", ok);
      socket.once("error", fail);
    });
    socket.write(payload);
    await done;
    // True only when the server closed the socket before `expectedResponses`
    // responses arrived; read before destroy() so it is never our own close.
    const closedByServer = closed;
    socket.destroy();
    const raw = Buffer.concat(chunks).toString("latin1");
    return { raw, responses: count(), closedByServer };
  }

  const pipelinedB = "GET /b HTTP/1.1\r\nHost: x\r\n\r\n";

  it.each([
    ["close", "GET /a HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"],
    ["Close (mixed case)", "GET /a HTTP/1.1\r\nHost: x\r\nConnection: Close\r\n\r\n"],
    ["keep-alive, close", "GET /a HTTP/1.1\r\nHost: x\r\nConnection: keep-alive, close\r\n\r\n"],
    ["close, TE", "GET /a HTTP/1.1\r\nHost: x\r\nConnection: close, TE\r\n\r\n"],
    ["HTTP/1.0 (implicit)", "GET /a HTTP/1.0\r\nHost: x\r\n\r\n"],
  ])("%s", async (_label, requestA) => {
    const handled: string[] = [];
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const p = new URL(req.url).pathname;
        handled.push(p);
        return new Response("body:" + p);
      },
    });

    const { raw, responses, closedByServer } = await roundTrip(server.port!, requestA + pipelinedB, 2);

    expect(raw).toContain("body:/a");
    expect(raw).not.toContain("body:/b");
    expect({ handled, responses, closedByServer }).toEqual({ handled: ["/a"], responses: 1, closedByServer: true });
  });

  // The close-flagged request is not the first of its read. The requests
  // before it are answered, the requests behind it are not, and the server
  // closes after the response to the close-flagged one.
  it("stops at a close-flagged request in the middle of a read", async () => {
    const handled: string[] = [];
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const p = new URL(req.url).pathname;
        handled.push(p);
        return new Response("body:" + p);
      },
    });

    const { raw, responses, closedByServer } = await roundTrip(
      server.port!,
      "GET /0 HTTP/1.1\r\nHost: x\r\n\r\n" +
        "GET /1 HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n" +
        "GET /2 HTTP/1.1\r\nHost: x\r\n\r\n" +
        "GET /3 HTTP/1.1\r\nHost: x\r\n\r\n",
      4,
    );

    expect(raw).toEndWith("body:/1");
    expect({ handled, responses, closedByServer }).toEqual({
      handled: ["/0", "/1"],
      responses: 2,
      closedByServer: true,
    });
  });

  // The response to /a is still pending when the parser reaches /b. Without
  // the discard, /b hits the "request behind a pending response" close and the
  // response to /a is never sent.
  it("delivers the response of an async handler before it closes", async () => {
    const handled: string[] = [];
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const p = new URL(req.url).pathname;
        handled.push(p);
        await new Promise<void>(r => setImmediate(r));
        return new Response("body:" + p);
      },
    });

    const { raw, responses, closedByServer } = await roundTrip(
      server.port!,
      "GET /a HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n" + pipelinedB,
      2,
    );

    expect(raw).toEndWith("body:/a");
    expect({ handled, responses, closedByServer }).toEqual({ handled: ["/a"], responses: 1, closedByServer: true });
  });

  it.each([
    ["five-byte non-close token", "GET /a HTTP/1.1\r\nHost: x\r\nConnection: nope!\r\n\r\n"],
    ["no Connection header (control)", "GET /a HTTP/1.1\r\nHost: x\r\n\r\n"],
  ])("still serves both requests: %s", async (_label, requestA) => {
    const handled: string[] = [];
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const p = new URL(req.url).pathname;
        handled.push(p);
        return new Response("body:" + p);
      },
    });

    // /a keeps the connection alive; /b carries the close so the server
    // closes the socket and roundTrip's `done` settles via the close event.
    const { raw, responses } = await roundTrip(
      server.port!,
      requestA + "GET /b HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
      2,
    );

    expect(raw).toContain("body:/a");
    expect(raw).toContain("body:/b");
    expect({ handled, responses }).toEqual({ handled: ["/a", "/b"], responses: 2 });
  });

  it("discards malformed bytes after the close-flagged request without emitting an error response", async () => {
    const handled: string[] = [];
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const p = new URL(req.url).pathname;
        handled.push(p);
        return new Response("body:" + p);
      },
    });

    const { raw, responses } = await roundTrip(
      server.port!,
      "GET /a HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n@@@ not HTTP\r\n\r\n",
      2,
    );

    expect(raw).toContain("body:/a");
    expect({ handled, responses, has400: raw.includes(" 400 ") }).toEqual({
      handled: ["/a"],
      responses: 1,
      has400: false,
    });
  });
});

describe("streaming", () => {
  describe("error handler", () => {
    // The body source fails before any byte is written. The Response's status
    // and headers are already committed to uWS, so error() cannot replace them
    // and is not called; the connection is closed without a complete response
    // so the client cannot mistake the failed body for an empty one.
    it("throw on pull closes the connection, does not call error handler", async () => {
      let outcome: string | undefined;
      const onMessage = mock(async url => {
        outcome = await fetch(url).then(
          response => `resolved ${response.status}`,
          (err: any) => `rejected ${err.code}`,
        );
        subprocess.kill();
      });

      await using subprocess = Bun.spawn({
        cwd: import.meta.dirname,
        cmd: [bunExe(), "readable-stream-throws.fixture.js"],
        env: bunEnv,
        stdout: "ignore",
        stderr: "pipe",
        ipc: onMessage,
      });

      let [exitCode, stderr] = await Promise.all([subprocess.exited, subprocess.stderr.text()]);
      expect(exitCode).toBeInteger();
      expect(outcome).toBe("rejected ECONNRESET");
      expect(stderr).toContain("error: Oops");
      expect(stderr).not.toContain("error handler called");
      expect(onMessage).toHaveBeenCalled();
    });

    // pull() queues two chunks, requests close, then throws: per the streams
    // spec the error wins and the queued chunks are discarded, so this is the
    // same "failed before any byte" case as above.
    it("throw on pull after writing closes the connection, does not call the error handler", async () => {
      let outcome: string | undefined;
      const onMessage = mock(async href => {
        const url = new URL("write", href);
        outcome = await fetch(url).then(
          response => `resolved ${response.status}`,
          (err: any) => `rejected ${err.code}`,
        );
        subprocess.kill();
      });

      await using subprocess = Bun.spawn({
        cwd: import.meta.dirname,
        cmd: [bunExe(), "readable-stream-throws.fixture.js"],
        env: bunEnv,
        stdout: "ignore",
        stderr: "pipe",
        ipc: onMessage,
      });

      let [exitCode, stderr] = await Promise.all([subprocess.exited, subprocess.stderr.text()]);
      expect(exitCode).toBeInteger();
      expect(outcome).toBe("rejected ECONNRESET");
      expect(stderr).toContain("error: Oops");
      expect(stderr).not.toContain("error handler called");
      expect(onMessage).toHaveBeenCalled();
    });

    it("returning a Response whose body stream is already locked calls the error handler", async () => {
      let captured = null as { code: unknown; name: string; message: string } | null;
      await using server = serve({
        port: 0,
        fetch() {
          const stream = new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("payload"));
              controller.close();
            },
          });
          // Lock the stream before handing it to the response. Constructing a
          // Response from a locked stream throws a TypeError (fetch spec; Node
          // agrees), which must reach the error handler instead of silently
          // returning a 200 with an empty body.
          stream.getReader();
          return new Response(stream);
        },
        error(err: any) {
          captured = { code: err.code, name: err.constructor.name, message: err.message };
          return new Response("handled", { status: 500 });
        },
      });

      const response = await fetch(server.url);
      expect(await response.text()).toBe("handled");
      expect(response.status).toBe(500);
      expect(captured).toEqual({
        code: undefined,
        name: "TypeError",
        message: "Body object should not be disturbed or locked",
      });
    });

    it.each([
      ["null", null],
      ["undefined", undefined],
      ["false", false],
      ["0", 0],
      ["empty string", ""],
    ])("passes rejection reason %s verbatim on every rejection path", async (_, reason) => {
      const received: Record<string, unknown> = {};
      let route = "";
      await using server = serve({
        port: 0,
        development: false,
        routes: {
          "/sync": () => {
            throw reason;
          },
          "/presettled": async () => {
            throw reason;
          },
          "/returned-reject": () => Promise.reject(reason),
          "/awaited": async () => {
            await Bun.sleep(1);
            throw reason;
          },
        },
        error(e) {
          received[route] = e;
          return new Response("handled", { status: 500 });
        },
      });
      for (const p of ["/sync", "/presettled", "/returned-reject", "/awaited"]) {
        route = p;
        const res = await fetch(new URL(p, server.url));
        expect(res.status).toBe(500);
        expect(await res.text()).toBe("handled");
      }
      expect(received).toStrictEqual({
        "/sync": reason,
        "/presettled": reason,
        "/returned-reject": reason,
        "/awaited": reason,
      });
    });
  });

  it("text from JS, one chunk", async () => {
    const relative = new URL("./fetch.js.txt", import.meta.url);
    const textToExpect = readFileSync(relative, "utf-8");
    await runTest(
      {
        fetch(req) {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(textToExpect);
                controller.close();
              },
            }),
          );
        },
      },
      async server => {
        const response = await fetch(server.url.origin);
        const text = await response.text();
        expect(text.length).toBe(textToExpect.length);
        expect(text).toBe(textToExpect);
      },
    );
  });
  it("text from JS, two chunks", async () => {
    const fixture = resolve(import.meta.dir, "./fetch.js.txt");
    const textToExpect = readFileSync(fixture, "utf-8");
    await runTest(
      {
        fetch(req) {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(textToExpect.substring(0, 100));
                controller.enqueue(textToExpect.substring(100));
                controller.close();
              },
            }),
          );
        },
      },
      async server => {
        const response = await fetch(server.url.origin);
        expect(await response.text()).toBe(textToExpect);
      },
    );
  });

  it("Error handler is called when a throwing stream hasn't written anything", async () => {
    await runTest(
      {
        error(e) {
          return new Response("Test Passed", { status: 200 });
        },

        fetch(req) {
          return new Response(
            new ReadableStream({
              start(controller) {
                throw new Error("Test Passed");
              },
            }),
            {
              status: 404,
            },
          );
        },
      },
      async server => {
        const response = await fetch(server.url.origin);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("Test Passed");
      },
    );
  });

  // Also verifies error handler reset in `.reload()` due to test above
  // TODO: rewrite test so uncaught error does not create an annotation in CI
  it.skip("text from JS throws on start with no error handler", async () => {
    await runTest(
      {
        error: undefined,

        fetch(req) {
          return new Response(
            new ReadableStream({
              start(controller) {
                throw new Error("Test Passed");
              },
            }),
            {
              status: 420,
              headers: {
                "x-what": "123",
              },
            },
          );
        },
      },
      async server => {
        const response = await fetch(server.url.origin);
        expect(response.status).toBe(500);
      },
    );
  });

  it("text from JS throws on start has error handler", async () => {
    var pass = false;
    var err: Error;
    await runTest(
      {
        error(e) {
          pass = true;
          err = e;
          return new Response("Fail", { status: 500 });
        },
        fetch(req) {
          return new Response(
            new ReadableStream({
              start(controller) {
                throw new TypeError("error");
              },
            }),
          );
        },
      },
      async server => {
        const response = await fetch(server.url.origin);
        expect(response.status).toBe(500);
        expect(await response.text()).toBe("Fail");
        expect(pass).toBe(true);
        expect(err?.name).toBe("TypeError");
        expect(err?.message).toBe("error");
      },
    );
  });

  it("text from JS, 2 chunks, with delay", async () => {
    const fixture = resolve(import.meta.dir, "./fetch.js.txt");
    const textToExpect = readFileSync(fixture, "utf-8");
    await runTest(
      {
        async fetch(req) {
          return new Response(
            new ReadableStream({
              async start(controller) {
                controller.enqueue(textToExpect.substring(0, 100));
                await Bun.sleep(0);
                queueMicrotask(() => {
                  controller.enqueue(textToExpect.substring(100));
                  controller.close();
                });
              },
            }),
          );
        },
      },
      async server => {
        const response = await fetch(server.url.origin);
        expect(await response.text()).toBe(textToExpect);
      },
    );
  });

  it("text from JS, 1 chunk via pull()", async () => {
    const fixture = resolve(import.meta.dir, "./fetch.js.txt");
    const textToExpect = readFileSync(fixture, "utf-8");
    await runTest(
      {
        fetch(req) {
          return new Response(
            new ReadableStream({
              pull(controller) {
                controller.enqueue(textToExpect);
                controller.close();
              },
            }),
          );
        },
      },
      async server => {
        const response = await fetch(server.url.origin);
        const text = await response.text();
        expect(text).toBe(textToExpect);
      },
    );
  });

  it("text from JS, 2 chunks, with delay in pull", async () => {
    const fixture = resolve(import.meta.dir, "./fetch.js.txt");
    const textToExpect = readFileSync(fixture, "utf-8");
    await runTest(
      {
        fetch(req) {
          return new Response(
            new ReadableStream({
              async pull(controller) {
                controller.enqueue(textToExpect.substring(0, 100));
                await Bun.sleep(0);
                queueMicrotask(() => {
                  controller.enqueue(textToExpect.substring(100));
                  controller.close();
                });
              },
            }),
          );
        },
      },
      async server => {
        const response = await fetch(server.url.origin);
        expect(await response.text()).toBe(textToExpect);
      },
    );
  });

  it("text from JS, 3 chunks, 1 empty, with delay in pull", async () => {
    const textToExpect = "hello world";
    const groups = [
      ["hello", "", " world"],
      ["", "hello ", "world"],
      ["hello ", "world", ""],
      ["hello world", "", ""],
      ["", "", "hello world"],
    ];
    var count = 0;

    for (const chunks of groups) {
      await runTest(
        {
          fetch(req) {
            return new Response(
              new ReadableStream({
                async pull(controller) {
                  for (let chunk of chunks) {
                    controller.enqueue(Buffer.from(chunk));
                    await Bun.sleep(0);
                  }
                  await Bun.sleep(0);
                  controller.close();
                },
              }),
            );
          },
        },
        async server => {
          const response = await fetch(server.url.origin);
          expect(await response.text()).toBe(textToExpect);
          count++;
        },
      );
    }
    expect(count).toBe(groups.length);
  });

  it("text from JS, 2 chunks, with async pull", async () => {
    const fixture = resolve(import.meta.dir, "./fetch.js.txt");
    const textToExpect = readFileSync(fixture, "utf-8");
    await runTest(
      {
        fetch(req) {
          return new Response(
            new ReadableStream({
              async pull(controller) {
                controller.enqueue(textToExpect.substring(0, 100));
                await Bun.sleep(0);
                controller.enqueue(textToExpect.substring(100));
                await Bun.sleep(0);
                controller.close();
              },
            }),
          );
        },
      },
      async server => {
        const response = await fetch(server.url.origin);
        expect(await response.text()).toBe(textToExpect);
      },
    );
  });

  it("text from JS, 10 chunks, with async pull", async () => {
    const fixture = resolve(import.meta.dir, "./fetch.js.txt");
    const textToExpect = readFileSync(fixture, "utf-8");
    await runTest(
      {
        fetch(req) {
          return new Response(
            new ReadableStream({
              async pull(controller) {
                var remain = textToExpect;
                for (let i = 0; i < 10 && remain.length > 0; i++) {
                  controller.enqueue(remain.substring(0, 100));
                  remain = remain.substring(100);
                  await Bun.sleep(0);
                }

                controller.enqueue(remain);
                controller.close();
              },
            }),
          );
        },
      },
      async server => {
        const response = await fetch(server.url.origin);
        expect(await response.text()).toBe(textToExpect);
      },
    );
  });
});

// A handler's Response reaches the server four ways: returned from fetch(),
// returned from fetch() through an already-settled promise, returned from
// error(), and returned from error() through a promise. A Bun.file() or
// ReadableStream body is still being sent after the handler has returned, and
// all four paths have to keep the Response alive for it; each must deliver
// such a body whole.
describe("file and stream bodies arrive whole from every handler path", () => {
  const expected = Buffer.alloc(16 * 1024, "p").toString();
  const chunk = Buffer.alloc(4 * 1024, "p").toString();
  const boom = (): never => {
    throw new Error("boom");
  };
  type Handlers = { fetch: () => Response | Promise<Response>; error?: () => Response | Promise<Response> };
  const paths: [label: string, status: number, handlers: (make: () => Response) => Handlers][] = [
    ["returned from fetch()", 201, make => ({ fetch: make })],
    ["returned from fetch() through a settled promise", 201, make => ({ fetch: async () => make() })],
    ["returned from error()", 597, make => ({ fetch: boom, error: make })],
    ["returned from error() through a settled promise", 597, make => ({ fetch: boom, error: async () => make() })],
  ];
  const bodies: [kind: string, body: (dir: string) => Blob | ReadableStream][] = [
    ["Bun.file()", dir => file(join(dir, "payload.txt"))],
    [
      "ReadableStream",
      () => {
        let remaining = 4;
        return new ReadableStream({
          pull(controller) {
            controller.enqueue(chunk);
            if (--remaining === 0) controller.close();
          },
        });
      },
    ],
  ];

  describe.each(bodies)("%s body", (_kind, body) => {
    it.each(paths)("%s", async (_label, status, handlers) => {
      using dir = tempDir("serve-deferred-body", { "payload.txt": expected });
      using server = serve({
        port: 0,
        development: false,
        ...handlers(() => new Response(body(String(dir)), { status })),
      });
      const response = await fetch(server.url);
      expect({ status: response.status, body: await response.text() }).toEqual({ status, body: expected });
    });
  });
});

it("should work for a hello world", async () => {
  await runTest(
    {
      fetch(req) {
        return new Response(`Hello, world!`);
      },
    },
    async server => {
      const response = await fetch(server.url.origin);
      expect(await response.text()).toBe("Hello, world!");
    },
  );
});

it("should work for a blob", async () => {
  const fixture = resolve(import.meta.dir, "./fetch.js.txt");
  const textToExpect = readFileSync(fixture, "utf-8");
  await runTest(
    {
      fetch(req) {
        return new Response(new Blob([textToExpect]));
      },
    },
    async server => {
      const response = await fetch(server.url.origin);
      expect(await response.text()).toBe(textToExpect);
    },
  );
});

it("should work for a blob stream", async () => {
  const fixture = resolve(import.meta.dir, "./fetch.js.txt");
  const textToExpect = readFileSync(fixture, "utf-8");
  await runTest(
    {
      fetch(req) {
        return new Response(new Blob([textToExpect]).stream());
      },
    },
    async server => {
      const response = await fetch(server.url.origin);
      expect(await response.text()).toBe(textToExpect);
    },
  );
});

it("should work for a file stream", async () => {
  const fixture = resolve(import.meta.dir, "./fetch.js.txt");
  const textToExpect = readFileSync(fixture, "utf-8");
  await runTest(
    {
      fetch(req) {
        return new Response(file(fixture).stream());
      },
    },
    async server => {
      const response = await fetch(server.url.origin);
      expect(await response.text()).toBe(textToExpect);
    },
  );
});

it("fetch should work with headers", async () => {
  const fixture = resolve(import.meta.dir, "./fetch.js.txt");
  await runTest(
    {
      fetch(req) {
        if (req.headers.get("X-Foo") !== "bar") {
          return new Response("X-Foo header not set", { status: 500 });
        }
        return new Response(file(fixture), {
          headers: { "X-Both-Ways": "1" },
        });
      },
    },
    async server => {
      const response = await fetch(server.url.origin, {
        headers: {
          "X-Foo": "bar",
        },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Both-Ways")).toBe("1");
    },
  );
});

it(`should work for a file ${count} times serial`, async () => {
  const fixture = resolve(import.meta.dir, "./fetch.js.txt");
  const textToExpect = readFileSync(fixture, "utf-8");
  await runTest(
    {
      async fetch(req) {
        return new Response(file(fixture));
      },
    },
    async server => {
      for (let i = 0; i < count; i++) {
        const response = await fetch(server.url.origin);
        expect(await response.text()).toBe(textToExpect);
      }
    },
  );
});

it(`should work for ArrayBuffer ${count} times serial`, async () => {
  const textToExpect = "hello";
  await runTest(
    {
      fetch(req) {
        return new Response(new TextEncoder().encode(textToExpect));
      },
    },
    async server => {
      for (let i = 0; i < count; i++) {
        const response = await fetch(server.url.origin);
        expect(await response.text()).toBe(textToExpect);
      }
    },
  );
});

describe("parallel", () => {
  it(`should work for text ${count} times in batches of 5`, async () => {
    const textToExpect = "hello";
    await runTest(
      {
        fetch(req) {
          return new Response(textToExpect);
        },
      },
      async server => {
        for (let i = 0; i < count;) {
          let responses = await Promise.all([
            fetch(server.url.origin),
            fetch(server.url.origin),
            fetch(server.url.origin),
            fetch(server.url.origin),
            fetch(server.url.origin),
          ]);

          for (let response of responses) {
            expect(await response.text()).toBe(textToExpect);
          }
          i += responses.length;
        }
      },
    );
  });
  it(`should work for Uint8Array ${count} times in batches of 5`, async () => {
    const textToExpect = "hello";
    await runTest(
      {
        fetch(req) {
          return new Response(new TextEncoder().encode(textToExpect));
        },
      },
      async server => {
        for (let i = 0; i < count;) {
          let responses = await Promise.all([
            fetch(server.url.origin),
            fetch(server.url.origin),
            fetch(server.url.origin),
            fetch(server.url.origin),
            fetch(server.url.origin),
          ]);

          for (let response of responses) {
            expect(await response.text()).toBe(textToExpect);
          }
          i += responses.length;
        }
      },
    );
  });
});

it("should support reloading", async () => {
  const first: Handler = req => new Response("first");
  const second: Handler = req => new Response("second");
  await runTest(
    {
      fetch: first,
    },
    async server => {
      const response = await fetch(server.url.origin);
      expect(await response.text()).toBe("first");
      server.reload({ fetch: second });
      const response2 = await fetch(server.url.origin);
      expect(await response2.text()).toBe("second");
    },
  );
});

// Reloading a server that was CREATED as a node:http one re-applies node-compat mode to
// the live, already-listening native context (reload -> set_routes); it must be an
// idempotent no-op. On assert-enabled builds a real re-switch aborts the process, so the
// repro runs in a subprocess. `bun --hot` takes this exact path on every reload.
it("reload() of a node:http-backed server is not treated as a mode switch", async () => {
  const code = `
    const noop = function () {};
    const server = Bun.serve({ port: 0, fetch: () => new Response("x"), onNodeHTTPRequest: noop });
    server.reload({ fetch: () => new Response("y"), onNodeHTTPRequest: noop });
    server.stop(true);
    console.log("OK");
  `;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", code], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("OK\n");
  expect(exitCode).toBe(0);
});

// reload() clears the uWS route table; the connection-open filter that backs
// node:http's 'connection' event is not a route and must survive that. `bun --hot`
// on a node:http app takes this reload path on every file change.
it("reload() of a node:http-backed server keeps the 'connection' event firing", async () => {
  let connections = 0;
  const httpServer = createHttpServer((req, res) => res.end("ok"));
  httpServer.on("connection", () => connections++);
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  try {
    const { port } = httpServer.address() as AddressInfo;
    const hit = async () => {
      const socket = net.connect(port, "127.0.0.1");
      socket.on("error", () => {});
      await once(socket, "connect");
      socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
      // Drain the response so 'end' (and then 'close') is delivered.
      socket.resume();
      await once(socket, "close");
    };

    await hit();
    expect(connections).toBe(1);

    const native = (httpServer as any)[Symbol.for("::bunternal::")] as Server<undefined>;
    native.reload({ fetch: () => new Response("x") });

    await hit();
    expect(connections).toBe(2);
  } finally {
    httpServer.closeAllConnections();
    httpServer.close();
  }
});

// Under --hot the module re-evaluates and listen() runs again against the same
// native server from the hot map, setting its onConnection callback again. The JS
// onServerConnection callback dedupes on socketHandle.duplex, so this asserts
// the user-visible contract (exactly one 'connection' per accept) holds across
// hot reloads, not the native filter-vector size.
it("--hot reload of a node:http server fires 'connection' once per socket", async () => {
  using dir = tempDir("hot-node-http-connection", {
    "server.mjs": `
      import { createServer } from "node:http";
      import { once } from "node:events";
      import { connect } from "node:net";
      import { writeFileSync, readFileSync } from "node:fs";

      globalThis.__reloads ??= 0;
      const n = globalThis.__reloads++;

      let fired = 0;
      const server = createServer((req, res) => res.end("ok"));
      server.on("connection", () => fired++);
      await once(server.listen(0, "127.0.0.1"), "listening");

      const s = connect(server.address().port, "127.0.0.1");
      s.on("error", () => {});
      await once(s, "connect");
      s.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");
      s.resume();
      await once(s, "close");

      console.log("[reload " + n + "] " + fired);
      if (n < 3) {
        const self = new URL(import.meta.url);
        writeFileSync(self, readFileSync(self, "utf8"));
      } else {
        process.exit(fired === 1 ? 0 : 1);
      }
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--hot", "server.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr.replaceAll(/^DEBUG:.*\n/gm, "")).toBe("");
  expect(stdout).toBe("[reload 0] 1\n[reload 1] 1\n[reload 2] 1\n[reload 3] 1\n");
  expect(exitCode).toBe(0);
});

it("reload() cannot turn a Bun.serve server into a node:http server", async () => {
  // The server's kind is fixed when listen() sizes its connections' native
  // per-socket block; a reload that smuggles in the node:http handler used by
  // node's http.Server wrapper must be ignored, not flip the context into
  // node-compat mode under connections allocated with the smaller block.
  const clientPorts: number[] = [];
  const respond = (body: string) => (req: Request, server: Server<any>) => {
    clientPorts.push(server.requestIP(req)!.port);
    return new Response(body);
  };
  // Uses its own server, so fetch's only pooled connection to it predates the reload.
  using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: respond("first") });
  expect(await (await fetch(server.url)).text()).toBe("first");
  server.reload({
    fetch: respond("second"),
    // @ts-expect-error internal option used by node:http's Server
    onNodeHTTPRequest: () => {
      throw new Error("must never be routed");
    },
  });
  expect(await (await fetch(server.url)).text()).toBe("second");
  for (let i = 0; i < 8; i++) {
    const res = await fetch(server.url, { keepalive: false });
    expect(await res.text()).toBe("second");
  }
  // The client port identifies the connection.
  const [beforeReload, reused, ...fresh] = clientPorts;
  expect(reused).toBe(beforeReload);
  expect(fresh).toHaveLength(8);
  expect(fresh).not.toContain(beforeReload);
});

it("reload() that drops the node:http handler keeps the server's node:http stop() semantics", async () => {
  // The other direction of the kind invariant: a server created as a node:http
  // one stays one. stop(false) of a node:http server does not sweep idle
  // keep-alive connections (http.Server's close() does that in JavaScript), and
  // a reload() that routes requests to fetch instead of the node handler must
  // not switch the server over to Bun.serve's drain (which closes the idle
  // connection here).
  using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    // @ts-expect-error internal option used by node:http's Server
    onNodeHTTPRequest() {
      throw new Error("replaced by reload() before any request");
    },
  });
  server.reload({ fetch: () => new Response("ok") });

  let received = "";
  let connectionClosed = false;
  let waiter = Promise.withResolvers<void>();
  await using connection = await Bun.connect({
    hostname: "127.0.0.1",
    port: server.port!,
    socket: {
      data(_, data) {
        received += data.toString("latin1");
        waiter.resolve();
      },
      end() {
        connectionClosed = true;
        waiter.resolve();
      },
      close() {
        connectionClosed = true;
        waiter.resolve();
      },
      error() {
        connectionClosed = true;
        waiter.resolve();
      },
    },
  });
  // Sends a keep-alive request and returns "<status line> <body>", or "closed"
  // if the server hung up instead of answering.
  async function request(): Promise<string> {
    connection.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    connection.flush();
    while (true) {
      const headEnd = received.indexOf("\r\n\r\n");
      if (headEnd !== -1) {
        const head = received.slice(0, headEnd);
        const bodyEnd = headEnd + 4 + Number(/^content-length: (\d+)$/im.exec(head)?.[1] ?? 0);
        if (received.length >= bodyEnd) {
          const result = `${head.split("\r\n")[0]} ${received.slice(headEnd + 4, bodyEnd)}`;
          received = received.slice(bodyEnd);
          return result;
        }
      }
      if (connectionClosed) return "closed";
      await waiter.promise;
      waiter = Promise.withResolvers();
    }
  }

  expect(await request()).toBe("HTTP/1.1 200 OK ok");
  // Like Node.js's 'close', the promise settles once every connection is closed.
  const stopped = server.stop(false);
  expect(await request()).toBe("HTTP/1.1 200 OK ok");
  connection.end();
  await stopped;
});

describe("status code text", () => {
  const fixture = {
    200: "OK",
    201: "Created",
    202: "Accepted",
    203: "Non-Authoritative Information",
    204: "No Content",
    205: "Reset Content",
    206: "Partial Content",
    207: "Multi-Status",
    208: "Already Reported",
    226: "IM Used",
    300: "Multiple Choices",
    301: "Moved Permanently",
    302: "Found",
    303: "See Other",
    304: "Not Modified",
    305: "Use Proxy",
    306: "Switch Proxy",
    307: "Temporary Redirect",
    308: "Permanent Redirect",
    400: "Bad Request",
    401: "Unauthorized",
    402: "Payment Required",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    406: "Not Acceptable",
    407: "Proxy Authentication Required",
    408: "Request Timeout",
    409: "Conflict",
    410: "Gone",
    411: "Length Required",
    412: "Precondition Failed",
    413: "Payload Too Large",
    414: "URI Too Long",
    415: "Unsupported Media Type",
    416: "Range Not Satisfiable",
    417: "Expectation Failed",
    418: "I'm a Teapot",
    421: "Misdirected Request",
    422: "Unprocessable Entity",
    423: "Locked",
    424: "Failed Dependency",
    425: "Too Early",
    426: "Upgrade Required",
    428: "Precondition Required",
    429: "Too Many Requests",
    431: "Request Header Fields Too Large",
    451: "Unavailable For Legal Reasons",
    500: "Internal Server Error",
    501: "Not Implemented",
    502: "Bad Gateway",
    503: "Service Unavailable",
    504: "Gateway Timeout",
    505: "HTTP Version Not Supported",
    506: "Variant Also Negotiates",
    507: "Insufficient Storage",
    508: "Loop Detected",
    510: "Not Extended",
    511: "Network Authentication Required",
  } as Record<string, string>;

  for (let code in fixture) {
    it(`should return ${code} ${fixture[code]}`, async () => {
      await runTest(
        {
          fetch(req) {
            return new Response("hey", { status: +code });
          },
        },
        async server => {
          const response = await fetch(server.url.origin);
          expect(response.status).toBe(parseInt(code));
          expect(response.statusText).toBe(fixture[code]);
        },
      );
    });
  }
});

it("does not write body bytes for null body statuses", async () => {
  for (const status of [204, 205, 304]) {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch() {
        return new Response("hey", { status });
      },
    });

    const received: Buffer[] = [];
    const { resolve, reject, promise } = Promise.withResolvers<void>();
    await using connection = await Bun.connect({
      hostname: "127.0.0.1",
      port: server.port!,
      socket: {
        data(socket, data) {
          received.push(data);
        },
        end() {
          resolve();
        },
        error(socket, error) {
          reject(error);
        },
        close() {
          resolve();
        },
      },
    });
    connection.write(`GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    connection.flush();
    await promise;
    const raw = Buffer.concat(received).toString();
    expect(raw).toStartWith(`HTTP/1.1 ${status} `);
    expect(raw.slice(raw.indexOf("\r\n\r\n") + 4)).toBe("");
  }
});

// Response.error() is a WHATWG network error: its status is 0, which has no
// representation in an HTTP status line. It must never be written to the socket.
describe("Response.error()", () => {
  const unsendable =
    "Cannot send a Response with status 0. HTTP status codes must be between 100 and 999 (Response.error() returns status 0).";

  async function rawStatusLine(port: number, method: string): Promise<string> {
    const received: Buffer[] = [];
    const { resolve, reject, promise } = Promise.withResolvers<void>();
    await using connection = await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        data(socket, data) {
          received.push(data);
        },
        end() {
          resolve();
        },
        error(socket, error) {
          reject(error);
        },
        close() {
          resolve();
        },
      },
    });
    connection.write(`${method} / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    connection.flush();
    await promise;
    return Buffer.concat(received).toString().split("\r\n")[0];
  }

  describe.each(["GET", "HEAD"])("%s", method => {
    it.each([
      ["sync", () => Response.error()],
      ["async", async () => Response.error()],
    ])("a %s fetch handler returning it reaches error()", async (_label, fetchImpl) => {
      const errors: Error[] = [];
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        development: false,
        fetch: fetchImpl,
        error(error) {
          errors.push(error);
          return new Response("handled", { status: 502 });
        },
      });

      expect(await rawStatusLine(server.port!, method)).toBe("HTTP/1.1 502 Bad Gateway");
      expect(errors.map(error => error.message)).toEqual([unsendable]);
    });
  });

  // Bun reports the synthesized error the same way it reports a thrown one, which
  // would fail this test process, so the default 500 page is checked in a child.
  it("responds 500 with no error() handler, and when error() returns it too", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const servers = [
          Bun.serve({ port: 0, hostname: "127.0.0.1", development: false, fetch: () => Response.error() }),
          Bun.serve({ port: 0, hostname: "127.0.0.1", development: false, fetch: () => Response.error(), error: () => Response.error() }),
        ];
        for (const server of servers) {
          const response = await fetch(server.url);
          console.log(response.status, await response.text());
          server.stop(true);
        }`,
      ],
      env: bunEnv,
      stderr: "pipe",
    });

    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("500 Something went wrong!\n500 Something went wrong!\n");
    expect(stderr).toContain(unsendable);
  });

  it("is rejected when registered as a static route", () => {
    expect(() =>
      Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        routes: { "/": Response.error() },
      }),
    ).toThrow(
      "Cannot use a Response with status 0 as a static route. HTTP status codes must be between 100 and 999 (Response.error() returns status 0).",
    );
  });
});

describe("response framing", () => {
  type RawResponse = {
    statusLine: string;
    headerNames: string[];
    headers: Record<string, string | undefined>;
    body: string;
  };
  // Read the raw response so that `Content-Length: 0` and an absent
  // Content-Length are distinguishable (fetch normalizes the two cases away),
  // and so body bytes smuggled after a no-body status's header block show up.
  async function rawRequest(port: number, method: string): Promise<RawResponse> {
    const received: Buffer[] = [];
    const { resolve, reject, promise } = Promise.withResolvers<void>();
    await using connection = await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        data(socket, data) {
          received.push(data);
        },
        end() {
          resolve();
        },
        error(socket, error) {
          reject(error);
        },
        close() {
          resolve();
        },
      },
    });
    connection.write(`${method} / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    connection.flush();
    await promise;
    const raw = Buffer.concat(received).toString();
    const headEnd = raw.indexOf("\r\n\r\n");
    const headLines = raw.slice(0, headEnd).split("\r\n");
    const headers: Record<string, string> = {};
    for (const line of headLines.slice(1)) {
      const colon = line.indexOf(":");
      headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim();
    }
    return {
      statusLine: headLines[0],
      headerNames: Object.keys(headers),
      headers,
      body: raw.slice(headEnd + 4),
    };
  }

  // https://github.com/oven-sh/bun/issues/20676
  // RFC 9110 8.6: a server MUST NOT send a Content-Length header field in any
  // response with a status code of 1xx or 204. The Response constructor only
  // accepts 101 out of the 1xx range, so that is the 1xx witness.
  describe.each(["GET", "HEAD"])("%s", method => {
    it.each([101, 204])("a %i response carries no Content-Length header", async status => {
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () => new Response(null, { status }),
      });
      const { statusLine, headerNames } = await rawRequest(server.port!, method);
      expect(statusLine).toStartWith(`HTTP/1.1 ${status} `);
      expect(headerNames).not.toContain("content-length");
      expect(headerNames).not.toContain("transfer-encoding");
    });

    // RFC 9110 15.3.6: a 205 MUST NOT generate content; the explicit 0 it
    // already emitted stays (still conformant, and matches prior releases).
    it("a 205 response keeps Content-Length: 0", async () => {
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () => new Response(null, { status: 205 }),
      });
      const { statusLine, headers } = await rawRequest(server.port!, method);
      expect(statusLine).toStartWith(`HTTP/1.1 205 `);
      expect(headers["content-length"]).toBe("0");
    });

    // RFC 9110 8.6: a 304 MAY carry Content-Length but MUST NOT unless it
    // equals what the 200 would have sent. Only the handler knows that value,
    // so pass its header through; when it sets none, emit none (a fabricated 0
    // poisons caches that update stored headers from a 304, RFC 9111 4.3.4).
    it.each([
      [undefined, null],
      ["1234", "1234"],
      ["0", "0"],
      ["abc", null],
    ])("a 304 response passes the handler's Content-Length through (%p -> %p)", async (appCL, expected) => {
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () =>
          new Response(null, {
            status: 304,
            headers: appCL === undefined ? { etag: '"x"' } : { etag: '"x"', "content-length": appCL },
          }),
      });
      const { statusLine, headers, body } = await rawRequest(server.port!, method);
      expect({ statusLine: statusLine.slice(0, 12), contentLength: headers["content-length"] ?? null, body }).toEqual({
        statusLine: "HTTP/1.1 304",
        contentLength: expected,
        body: "",
      });
      expect(headers["date"]).toBeDefined();
    });
  });

  // RFC 9112 6.3: a 304 is terminated at the blank line regardless of
  // Content-Length, so a non-zero handler value must not desync keep-alive.
  it("a 304 with a handler Content-Length does not desync keep-alive", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const p = new URL(req.url).pathname;
        if (p === "/a") return new Response(null, { status: 304, headers: { "content-length": "1234", etag: '"a"' } });
        return new Response("ok-b");
      },
    });
    const received: Buffer[] = [];
    const { resolve, reject, promise } = Promise.withResolvers<void>();
    await using c = await Bun.connect({
      hostname: "127.0.0.1",
      port: server.port!,
      socket: {
        data: (_, d) => received.push(d) as any,
        close: () => resolve(),
        end: () => resolve(),
        error: (_, e) => reject(e),
      },
    });
    c.write(
      "GET /a HTTP/1.1\r\nHost: x\r\n\r\n" + //
        "GET /b HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    );
    c.flush();
    await promise;
    const raw = Buffer.concat(received).toString();
    const [first, ...rest] = raw.split("HTTP/1.1 ").filter(Boolean);
    expect(first).toMatch(/^304 Not Modified\r\n/);
    expect(first).toMatch(/\r\ncontent-length: 1234\r\n/i);
    expect(rest.join("HTTP/1.1 ")).toMatch(/^200 OK\r\n[\s\S]*\r\n\r\nok-b$/);
  });

  // RFC 9112 6.3 terminates a 1xx/204/304 at the blank line after the header
  // fields, so a stray Response body desyncs keep-alive. `render` already drops
  // it on the `fetch` path; the static `routes:` path must too.
  describe.each(["routes", "fetch"] as const)("%s: a Response body on a null-body status is dropped", kind => {
    const cases: [status: number, method: string, contentLength: string | null][] = [
      [101, "GET", null],
      [101, "HEAD", null],
      [204, "GET", null],
      [204, "HEAD", null],
      [205, "GET", "0"],
      [205, "HEAD", "0"],
      [304, "GET", null],
      [304, "HEAD", null],
    ];
    it.each(cases)("%i %s", async (status, method, contentLength) => {
      const makeResponse = () => new Response("data", { status });
      using server = Bun.serve(
        kind === "routes"
          ? {
              port: 0,
              hostname: "127.0.0.1",
              routes: { "/": makeResponse() },
              fetch: () => new Response("unreachable", { status: 500 }),
            }
          : { port: 0, hostname: "127.0.0.1", fetch: makeResponse },
      );
      const { statusLine, headers, body } = await rawRequest(server.port!, method);
      expect({
        statusLine: statusLine.slice(0, 12),
        contentLength: headers["content-length"] ?? null,
        body,
      }).toEqual({ statusLine: `HTTP/1.1 ${status}`, contentLength, body: "" });
    });
  });

  // `FileRoute` ships its body via sendfile / `HttpResponse::write()`, neither
  // of which goes through `internalEnd`, so it needs its own null-body-status
  // drop. 101 is the one null-body status its bodiless list was missing.
  it.each(["GET", "HEAD"])("a Bun.file route on a null-body status serves no body bytes (%s)", async method => {
    using dir = tempDir("framing-file-route", { "f.bin": "data" });
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      routes: { "/": new Response(Bun.file(join(String(dir), "f.bin")), { status: 101 }) },
      fetch: () => new Response("unreachable", { status: 500 }),
    });
    const { statusLine, headers, body } = await rawRequest(server.port!, method);
    expect({ statusLine: statusLine.slice(0, 12), contentLength: headers["content-length"] ?? null, body }).toEqual({
      statusLine: "HTTP/1.1 101",
      contentLength: null,
      body: "",
    });
  });

  // RFC 9110 9.3.2: a HEAD response carries the same header fields a GET of
  // the same target would have, minus the body. Each body form below used to
  // derive HEAD's framing from a different source than GET's.
  describe("HEAD mirrors GET", () => {
    type Framing = { status: number; contentLength: string | null; transferEncoding: string | null; body: string };
    async function framing(makeResponse: () => Response) {
      using server = Bun.serve({ port: 0, fetch: () => makeResponse() });
      const results: Record<string, Framing> = {};
      for (const method of ["GET", "HEAD"]) {
        const response = await fetch(server.url, { method });
        results[method] = {
          status: response.status,
          contentLength: response.headers.get("content-length"),
          transferEncoding: response.headers.get("transfer-encoding"),
          body: await response.text(),
        };
      }
      return results;
    }

    it("a handler-supplied Content-Length loses to the body's byte count on HEAD, same as GET", async () => {
      const { GET, HEAD } = await framing(() => new Response("hi", { headers: { "Content-Length": "999" } }));
      expect(GET).toEqual({ status: 200, contentLength: "2", transferEncoding: null, body: "hi" });
      expect(HEAD).toEqual({ status: 200, contentLength: "2", transferEncoding: null, body: "" });
    });

    it("a handler-supplied Transfer-Encoding loses to the body's framing on HEAD, same as GET", async () => {
      const { GET, HEAD } = await framing(() => new Response("hi", { headers: { "Transfer-Encoding": "chunked" } }));
      expect(GET).toEqual({ status: 200, contentLength: "2", transferEncoding: null, body: "hi" });
      expect(HEAD).toEqual({ status: 200, contentLength: "2", transferEncoding: null, body: "" });
    });

    // A null-body Response carries no framing of its own, so the
    // handler-supplied Content-Length is the only description of what GET
    // would have sent. HEAD handlers rely on that (issue #15355).
    it("a handler-supplied Content-Length on a null body is still forwarded on HEAD", async () => {
      const { GET, HEAD } = await framing(() => new Response(null, { headers: { "Content-Length": "999" } }));
      expect(GET).toEqual({ status: 200, contentLength: "0", transferEncoding: null, body: "" });
      expect(HEAD).toEqual({ status: 200, contentLength: "999", transferEncoding: null, body: "" });
    });

    it("a body on a no-body status is dropped from HEAD's framing, same as GET", async () => {
      const { GET, HEAD } = await framing(() => new Response("body", { status: 204 }));
      expect(GET).toEqual({ status: 204, contentLength: null, transferEncoding: null, body: "" });
      expect(HEAD).toEqual({ status: 204, contentLength: null, transferEncoding: null, body: "" });
    });

    it("a handler-supplied Content-Length on a 204 is dropped on HEAD, same as GET", async () => {
      const { GET, HEAD } = await framing(
        () => new Response(null, { status: 204, headers: { "Content-Length": "999" } }),
      );
      expect(GET).toEqual({ status: 204, contentLength: null, transferEncoding: null, body: "" });
      expect(HEAD).toEqual({ status: 204, contentLength: null, transferEncoding: null, body: "" });
    });
  });

  // RFC 9110 §9.3.2: a server MUST NOT send content in response to HEAD.
  // RFC 9112 §6.3 rule 1: a HEAD response is terminated at the end of the
  // header section; any octets after it are parsed as the next response on a
  // keep-alive connection, so a body here desynchronizes the connection.
  describe("HEAD on the error path writes no body bytes", () => {
    const boom = () => {
      throw new Error("boom");
    };

    // Paths with an error() handler, or no handler throw at all, can be
    // exercised in-process: the error never reaches on_unhandled_rejection.
    it.each([
      ["sync error()", () => new Response("EBODY", { status: 503, headers: { "x-from": "error" } })],
      ["async error()", async () => new Response("EBODY", { status: 503, headers: { "x-from": "error" } })],
    ])("%s Response mirrors the normal HEAD path", async (_label, errorHandler) => {
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        development: false,
        fetch: boom,
        error: errorHandler,
      });
      const head = await rawRequest(server.port!, "HEAD");
      const get = await rawRequest(server.port!, "GET");
      expect({
        head: {
          statusLine: head.statusLine,
          body: head.body,
          cl: head.headers["content-length"],
          x: head.headers["x-from"],
        },
        get: {
          statusLine: get.statusLine,
          body: get.body,
          cl: get.headers["content-length"],
          x: get.headers["x-from"],
        },
      }).toEqual({
        head: { statusLine: "HTTP/1.1 503 Service Unavailable", body: "", cl: "5", x: "error" },
        get: { statusLine: "HTTP/1.1 503 Service Unavailable", body: "EBODY", cl: "5", x: "error" },
      });
    });

    it("the dev missing-response page is not sent for HEAD", async () => {
      using server = Bun.serve({ port: 0, hostname: "127.0.0.1", development: true, fetch: () => undefined as any });
      const head = await rawRequest(server.port!, "HEAD");
      const get = await rawRequest(server.port!, "GET");
      expect({
        head: { statusLine: head.statusLine, body: head.body },
        get: { statusLine: get.statusLine, body: get.body },
      }).toEqual({
        head: { statusLine: "HTTP/1.1 200 OK", body: "" },
        get: { statusLine: "HTTP/1.1 200 OK", body: "Welcome to Bun! To get started, return a Response object." },
      });
    });

    // node:http and undici reject a response with two Content-Length headers.
    it("sends one Content-Length header on the dev missing-response page", async () => {
      using server = Bun.serve({ port: 0, hostname: "127.0.0.1", development: true, fetch: () => undefined as any });
      const contentLengthLines = (extraHeaders: string) =>
        new Promise<string[]>((resolve, reject) => {
          let raw = "";
          const s = net.connect(server.port, "127.0.0.1", () => {
            s.write(`GET / HTTP/1.1\r\nHost: x\r\n${extraHeaders}Connection: close\r\n\r\n`);
          });
          s.on("data", d => (raw += d.toString("latin1")));
          s.on("error", reject);
          s.on("close", () => {
            const separator = raw.indexOf("\r\n\r\n");
            if (separator < 0) {
              reject(new Error("server closed before sending a complete HTTP header block"));
              return;
            }
            const head = raw.slice(0, separator);
            resolve(head.split("\r\n").filter(l => /^content-length:/i.test(l)));
          });
        });
      expect({
        text: await contentLengthLines(""),
        browser: await contentLengthLines("Sec-Fetch-Dest: document\r\n"),
      }).toEqual({
        text: ["Content-Length: 57"],
        browser: [expect.stringMatching(/^Content-Length: \d+$/)],
      });
    });

    // The default-500 and dev-error-page paths report the thrown error via
    // on_unhandled_rejection, which would fail an in-process test, so run
    // them (and the keep-alive desync witness) in a subprocess.
    it("default 500 / dev error page write no body, and HEAD does not desync a keep-alive connection", async () => {
      const src = `
        import net from "node:net";
        const wire = (port, payload) => new Promise(resolve => {
          let b = Buffer.alloc(0);
          const s = net.connect(port, "127.0.0.1", () => s.write(payload));
          s.on("data", d => { b = Buffer.concat([b, d]); });
          s.on("error", () => resolve(b));
          s.on("close", () => resolve(b));
        });
        const afterHead = w => w.toString("latin1").split("\\r\\n\\r\\n").slice(1).join("\\r\\n\\r\\n");
        const boom = req => {
          if (new URL(req.url).pathname === "/boom") throw new Error("boom");
          return new Response("OKBODY");
        };
        const s1 = Bun.serve({ port: 0, hostname: "127.0.0.1", development: false, fetch: boom });
        const s2 = Bun.serve({ port: 0, hostname: "127.0.0.1", development: true, fetch: boom });
        const head = m => m + " /boom HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n";
        const out = {
          prod_head: afterHead(await wire(s1.port, head("HEAD"))),
          prod_get: afterHead(await wire(s1.port, head("GET"))),
          dev_head_len: afterHead(await wire(s2.port, head("HEAD"))).length,
          dev_get_len: afterHead(await wire(s2.port, head("GET"))).length,
          pipeline: afterHead(await wire(s1.port,
            "HEAD /boom HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n" +
            "GET /ok HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n"
          )).split("\\r\\n")[0],
        };
        console.log(JSON.stringify(out));
        s1.stop(true); s2.stop(true);
        process.exit(0);
      `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", src],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const out = JSON.parse(stdout.trim().split("\n").at(-1)!);
      expect(out).toEqual({
        prod_head: "",
        prod_get: "Something went wrong!",
        dev_head_len: 0,
        dev_get_len: expect.any(Number),
        pipeline: "HTTP/1.1 200 OK",
      });
      expect(out.dev_get_len).toBeGreaterThan(1000);
      expect(exitCode).toBe(0);
    });
  });
});

it.concurrent("dev error page embeds the thrown error, its stack, and build/resolve errors as JSON", async () => {
  using dir = tempDir("serve-dev-error-page", {
    "server.ts": `
      function inner() {
        throw new TypeError("boom <b>&</b>");
      }
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        development: true,
        async fetch(req) {
          const { pathname } = new URL(req.url);
          if (pathname === "/throw") inner();
          if (pathname === "/syntax") await import("./broken.ts");
          if (pathname === "/resolve") await import("./bad-import.ts");
          return new Response("unreachable");
        },
      });
      const out = {};
      for (const path of ["/throw", "/syntax", "/resolve"]) {
        const res = await fetch(server.url + path.slice(1));
        const html = await res.text();
        const match = /<script id="__bunfallback" type="application\\/json">([^<]*)<\\/script>/.exec(html);
        out[path] = {
          status: res.status,
          type: res.headers.get("content-type"),
          payload: match && JSON.parse(match[1]),
          // the page must carry the bun-error renderer (which registers this symbol) plus the call into it
          rendererMentions: html.split('Symbol.for("Bun__renderFallbackError")').length - 1,
          unfilledPlaceholder: /\\{\\[\\w+\\]s?\\}|\\[bun_error_js\\]/.test(html),
        };
      }
      console.log(JSON.stringify(out));
      server.stop(true);
      // The thrown errors were reported through the unhandled-rejection path, which sets the exit code.
      process.exit(0);
    `,
    "broken.ts": `export const a = 1;\nexport const oops = ;\n`,
    "bad-import.ts": `import { nope } from "does-not-exist-pkg";\nexport const b = nope;\n`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const out = JSON.parse(stdout.trim().split("\n").at(-1)!);

  for (const path of ["/throw", "/syntax", "/resolve"]) {
    expect(out[path]).toMatchObject({
      status: 500,
      type: "text/html;charset=utf-8",
      payload: { cwd: String(dir) },
      rendererMentions: 2,
      unfilledPlaceholder: false,
    });
  }

  // Thrown exception: name/message, 1-based frame positions and the source lines around the throw.
  const thrown = out["/throw"].payload.problems;
  expect(thrown.exceptions).toHaveLength(1);
  const [exception] = thrown.exceptions;
  expect({ name: exception.name, message: exception.message }).toEqual({
    name: "TypeError",
    message: "boom <b>&</b>",
  });
  expect(exception.stack.frames[0]).toEqual({
    function_name: "inner",
    file: join(String(dir), "server.ts"),
    // 1-based, pointing at `TypeError` — the same position `bun` prints to the terminal
    position: { line: 3, column: 19 },
    scope: 3, // function
  });
  expect(exception.stack.source_lines).toContainEqual({
    line: 3,
    text: '        throw new TypeError("boom <b>&</b>");',
  });

  // Syntax error in an imported module: reported as a build message with its location.
  const syntax = out["/syntax"].payload.problems;
  expect(syntax.build.errors).toBe(1);
  expect(syntax.build.msgs[0]).toMatchObject({
    level: 1,
    data: {
      text: "Unexpected ;",
      location: { line: 2, line_text: "export const oops = ;" },
    },
    on: { build: true, resolve: "" },
  });
  expect(syntax.build.msgs[0].data.location.file).toEndWith("broken.ts");

  // Failed resolution: reported as a resolve message carrying the specifier.
  const resolution = out["/resolve"].payload.problems;
  expect(resolution.build.errors).toBe(1);
  expect(resolution.build.msgs[0].on).toEqual({ build: false, resolve: "does-not-exist-pkg" });
  expect(resolution.build.msgs[0].data.text).toStartWith("Cannot find package 'does-not-exist-pkg'");

  expect(stderr).toContain("boom <b>&</b>");
  expect(exitCode).toBe(0);
});

it.concurrent("dev error page caps each source line at 1024 bytes", async () => {
  // The 3-byte "€" starts at byte 1023, so the cap lands inside it.
  const head = `var keep=["${Buffer.alloc(1012, "a").toString()}`;
  using dir = tempDir("serve-dev-error-page-long-line", {
    "server.ts": `
      import { boom } from "./minified.js";
      using server = Bun.serve({ port: 0, hostname: "127.0.0.1", development: true, fetch: () => boom() });
      const res = await fetch(server.url);
      const html = await res.text();
      const match = /<script id="__bunfallback" type="application\\/json">([^<]*)<\\/script>/.exec(html);
      console.log(JSON.stringify({
        status: res.status,
        leaked: html.includes("past-the-cap"),
        sourceLines: JSON.parse(match[1]).problems.exceptions[0].stack.source_lines,
      }));
      // The handler's error set the exit code to 1.
      process.exit(0);
    `,
    "minified.js": `${head}€","past-the-cap"];export function boom(){keep.length;throw new Error("long-line boom")}\n`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(JSON.parse(stdout), stderr).toEqual({
    status: 500,
    leaked: false,
    sourceLines: [{ line: 1, text: `${head}…` }],
  });
  expect(exitCode).toBe(0);
});

it.concurrent("dev error page ships a bun-error bundle that evaluates and registers the renderer", async () => {
  using dir = tempDir("serve-dev-error-page-bundle", {
    "server.ts": `
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        development: true,
        fetch() {
          throw new Error("bundle-test boom");
        },
      });
      const html = await (await fetch(server.url)).text();
      // dev-error-page.html inlines one module script: two lines that move the JSON payload out of the
      // document, then the packages/bun-error bundle, then the call into the function the bundle registers.
      const lines = /<script type="module">([^]*?)<\\/script>/.exec(html)[1].trim().split("\\n");
      await Bun.write("bun-error-bundle.mjs", lines.slice(2, -1).join("\\n"));
      console.log(JSON.stringify({ setup: lines.slice(0, 2).map(line => line.trim()), call: lines.at(-1).trim() }));
      server.stop(true);
      // The thrown error was reported through the unhandled-rejection path, which sets the exit code.
      process.exit(0);
    `,
    "renderer-check.ts": `
      import { dismissError, renderFallbackError } from "./bun-error-bundle.mjs";
      const registered = globalThis[Symbol.for("Bun__renderFallbackError")];
      console.log(JSON.stringify({
        registered: typeof registered,
        registeredIsTheExport: registered === renderFallbackError,
        // Nothing is rendered, so dismissing must be a no-op; there is no document to touch here.
        dismissWithoutOverlay: dismissError() === undefined,
        document: typeof document,
      }));
    `,
  });

  await using server = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [serverStdout, serverStderr, serverExitCode] = await Promise.all([
    server.stdout.text(),
    server.stderr.text(),
    server.exited,
  ]);
  expect(JSON.parse(serverStdout.trim().split("\n").at(-1)!)).toEqual({
    setup: [
      'globalThis.__BUN_DATA__ = JSON.parse(document.getElementById("__bunfallback").textContent);',
      'document.getElementById("__bunfallback").remove();',
    ],
    call: 'globalThis[Symbol.for("Bun__renderFallbackError")](globalThis.__BUN_DATA__);',
  });
  expect(serverStderr).toContain("bundle-test boom");
  expect(serverExitCode).toBe(0);

  // The bundle must evaluate outside a browser too: its only top-level side effect is registering the renderer.
  await using check = Bun.spawn({
    cmd: [bunExe(), "renderer-check.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [checkStdout, checkStderr, checkExitCode] = await Promise.all([
    check.stdout.text(),
    check.stderr.text(),
    check.exited,
  ]);
  expect(checkStderr).toBe("");
  expect(JSON.parse(checkStdout.trim())).toEqual({
    registered: "function",
    registeredIsTheExport: true,
    dismissWithoutOverlay: true,
    document: "undefined",
  });
  expect(checkExitCode).toBe(0);
});

it("should support multiple Set-Cookie headers", async () => {
  await runTest(
    {
      fetch(req) {
        return new Response("hello", {
          headers: [
            ["Another-Header", "1"],
            ["Set-Cookie", "foo=bar"],
            ["Set-Cookie", "baz=qux"],
          ],
        });
      },
    },
    async server => {
      const response = await fetch(server.url.origin);
      expect(response.headers.getAll("Set-Cookie")).toEqual(["foo=bar", "baz=qux"]);
      expect(response.headers.get("Set-Cookie")).toEqual("foo=bar, baz=qux");

      const cloned = response.clone().headers as Headers;
      expect(response.headers.getAll("Set-Cookie")).toEqual(["foo=bar", "baz=qux"]);

      response.headers.delete("Set-Cookie");
      expect(response.headers.getAll("Set-Cookie")).toEqual([]);
      response.headers.delete("Set-Cookie");
      expect(cloned.getAll("Set-Cookie")).toEqual(["foo=bar", "baz=qux"]);
      expect(new Headers(cloned).getAll("Set-Cookie")).toEqual(["foo=bar", "baz=qux"]);
    },
  );
});

describe("should support Content-Range with Bun.file()", () => {
  // this must be a big file so we can test potentially multiple chunks
  // more than 65 KB
  const full = (function () {
    const fixture = resolve(import.meta.dir + "/fetch.js.txt");
    const chunk = readFileSync(fixture);
    var whole = new Uint8Array(chunk.byteLength * 128);
    for (var i = 0; i < 128; i++) {
      whole.set(chunk, i * chunk.byteLength);
    }
    writeFileSync(fixture + ".big", whole);
    return whole;
  })();
  const fixture = resolve(import.meta.dir + "/fetch.js.txt") + ".big";
  const getServer = runTest.bind(null, {
    fetch(req) {
      const { searchParams } = new URL(req.url);
      const start = Number(searchParams.get("start"));
      const end = Number(searchParams.get("end"));
      return new Response(Bun.file(fixture).slice(start, end));
    },
  });

  const getServerWithSize = runTest.bind(null, {
    fetch(req) {
      const { searchParams } = new URL(req.url);
      const start = Number(searchParams.get("start"));
      const end = Number(searchParams.get("end"));
      const file = Bun.file(fixture);
      return new Response(file.slice(start, end), {
        headers: {
          "Content-Range": "bytes " + start + "-" + end + "/" + file.size,
        },
      });
    },
  });

  const good = [
    [0, 1],
    [1, 2],
    [0, 10],
    [10, 20],
    [0, Infinity],
    [10, Infinity],
    [NaN, Infinity],
    [full.byteLength - 10, full.byteLength],
    [full.byteLength - 10, full.byteLength - 1],
    [full.byteLength - 1, full.byteLength],
    [0, full.byteLength],
    [10, full.byteLength + 10],
  ] as const;

  for (const [start, end] of good) {
    it(`good range: ${start} - ${end}`, async () => {
      await getServer(async server => {
        const response = await fetch(`${server.url.origin}/?start=${start}&end=${end}`, {
          verbose: true,
        });
        expect(await response.arrayBuffer()).toEqual(full.buffer.slice(start, end));
        expect(response.status).toBe(start > 0 || end < full.byteLength ? 206 : 200);
      });
    });
  }

  for (const [start, end] of good) {
    it(`good range with size: ${start} - ${end}`, async () => {
      await getServerWithSize(async server => {
        const response = await fetch(`${server.url.origin}/?start=${start}&end=${end}`, {
          verbose: true,
        });
        expect(parseInt(response.headers.get("Content-Range")?.split("/")[1]!)).toEqual(full.byteLength);
        expect(await response.arrayBuffer()).toEqual(full.buffer.slice(start, end));
        expect(response.status).toBe(start > 0 || end < full.byteLength ? 206 : 200);
      });
    });
  }

  const emptyRanges = [
    [0, 0],
    [1, 1],
    [10, 10],
    [-Infinity, -Infinity],
    [Infinity, Infinity],
    [NaN, NaN],
    [(full.byteLength / 2) | 0, (full.byteLength / 2) | 0],
    [full.byteLength, full.byteLength],
    [full.byteLength - 1, full.byteLength - 1],
    [full.byteLength, 2 * full.byteLength],
  ];

  for (const [start, end] of emptyRanges) {
    it(`empty range: ${start} - ${end}`, async () => {
      await getServer(async server => {
        const response = await fetch(`${server.url.origin}/?start=${start}&end=${end}`);
        const out = await response.arrayBuffer();
        expect(out).toEqual(new ArrayBuffer(0));
        expect(response.status).toBe(206);
      });
    });
  }

  const badRanges = [
    [10, NaN],
    [10, -Infinity],
    [-(full.byteLength / 2) | 0, Infinity],
    [-(full.byteLength / 2) | 0, -Infinity],
    [full.byteLength + 100, full.byteLength],
    [full.byteLength + 100, full.byteLength + 100],
    [full.byteLength + 100, full.byteLength + 1],
    [full.byteLength + 100, -full.byteLength],
  ];

  for (const [start, end] of badRanges) {
    it(`bad range: ${start} - ${end}`, async () => {
      await getServer(async server => {
        const response = await fetch(`${server.url.origin}/?start=${start}&end=${end}`);
        const out = await response.arrayBuffer();
        expect(out).toEqual(new ArrayBuffer(0));
        expect(response.status).toBe(206);
      });
    });
  }
});

it("formats error responses correctly", async () => {
  const { promise, resolve, reject } = Promise.withResolvers();
  const c = spawn(bunExe(), ["./error-response.js"], {
    cwd: import.meta.dir,
    env: bunEnv,
  });

  var output = "";
  c.stderr.on("data", chunk => {
    output += chunk.toString();
  });
  c.stderr.on("end", () => {
    try {
      expect(output).toContain('throw new Error("1");');
      resolve();
    } catch (e) {
      reject(e);
    } finally {
      c.kill();
    }
  });
  await promise;
});

it("request body and signal life cycle", async () => {
  renderToReadableStream = (await import("react-dom/server.browser")).renderToReadableStream;
  app_jsx = (await import("./app")).default;
  {
    const headers = {
      headers: {
        "Content-Type": "text/html",
      },
    };

    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        return new Response(await renderToReadableStream(app_jsx), headers);
      },
    });

    const batches = 10;
    const batchSize = 64;
    let responses = 0;
    const unexpectedStatuses: number[] = [];
    for (let j = 0; j < batches; j++) {
      const requests: Promise<Response>[] = [];
      for (let i = 0; i < batchSize; i++) {
        requests.push(fetch(server.url.origin));
      }
      // Never read the bodies. The responses get collected while the server is still streaming.
      for (const response of await Promise.all(requests)) {
        responses++;
        if (response.status !== 200) unexpectedStatuses.push(response.status);
      }
      Bun.gc(true);
    }

    await Bun.sleep(10);
    expect({ responses, unexpectedStatuses }).toEqual({ responses: batches * batchSize, unexpectedStatuses: [] });
  }
}, 30_000);

describe("content-type of a response without a body", () => {
  it.each([
    ["new Response()", () => new Response()],
    ["Response.redirect()", () => Response.redirect("http://example.com/", 302)],
    ["a 204", () => new Response(null, { status: 204 })],
    ["a 304", () => new Response(null, { status: 304 })],
    [
      "an untyped ReadableStream",
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("hi"));
              controller.close();
            },
          }),
        ),
    ],
  ])("is omitted for %s", async (_, fetch) => {
    using server = Bun.serve({ port: 0, fetch });
    const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/`, { redirect: "manual" });
    await res.arrayBuffer();
    expect(res.headers.get("content-type")).toBeNull();
  });

  it.each([
    ["an empty Blob's type", () => new Response(new Blob([], { type: "multipart/form-data" }))],
    ["a header", () => new Response(null, { headers: { "content-type": "multipart/form-data" } })],
  ])("is kept when it comes from %s", async (_, fetch) => {
    using server = Bun.serve({ port: 0, fetch });
    const res = await globalThis.fetch(`http://127.0.0.1:${server.port}/`);
    await res.arrayBuffer();
    expect(res.headers.get("content-type")).toBe("multipart/form-data");
  });
});

it("propagates content-type from a Bun.file()'s file path in fetch()", async () => {
  const body = Bun.file(import.meta.dir + "/fetch.js.txt");
  const bodyText = await body.text();

  using server = Bun.serve({
    port: 0,
    development: false,
    async fetch(req) {
      expect(req.headers.get("Content-Type")).toBe("text/plain;charset=utf-8");
      const text = await req.text();
      expect(text).toBe(bodyText);

      return new Response(Bun.file(import.meta.dir + "/fetch.js.txt"));
    },
  });

  // @ts-ignore
  const reqBody = new Request(server.url.origin, {
    body,
    method: "POST",
  });
  const res = await fetch(reqBody);
  expect(res.status).toBe(200);

  // but it does for Response
  expect(res.headers.get("Content-Type")).toBe("text/plain;charset=utf-8");
});

it("does propagate type for Blob", async () => {
  using server = Bun.serve({
    port: 0,
    development: false,
    async fetch(req) {
      expect(req.headers.get("Content-Type")).toBe("text/plain;charset=utf-8");
      return new Response(new Blob(["hey"], { type: "text/plain;charset=utf-8" }));
    },
  });

  const body = new Blob(["hey"], { type: "text/plain;charset=utf-8" });
  // @ts-ignore
  const res = await fetch(server.url.origin, {
    body,
    method: "POST",
  });
  expect(res.status).toBe(200);
  expect(res.headers.get("Content-Type")).toBe("text/plain;charset=utf-8");
});

describe("a reader gives the same result whether or not the request body has arrived", () => {
  // Calls `read` before the body is sent, after all of it arrived, and with the body as a stream.
  // "after the body" gets the head and the body in one write, so the body is there once the handler yields.
  async function readEachWay(contentType: string, body: string, read: (req: Request) => Promise<unknown>) {
    let called = Promise.withResolvers<void>();
    const ways: Record<string, (req: Request) => Promise<unknown>> = {
      "before the body": req => {
        const result = read(req);
        called.resolve();
        return result;
      },
      "after the body": async req => {
        await new Promise(resolve => setImmediate(resolve));
        return read(req);
      },
      "a stream, before the body": req => {
        req.body;
        const result = read(req);
        called.resolve();
        return result;
      },
      "a clone, before the body": req => {
        const result = read(req.clone());
        called.resolve();
        return result;
      },
    };
    using server = Bun.serve({
      port: 0,
      fetch: async req =>
        Response.json(await ways[decodeURIComponent(new URL(req.url).pathname.slice(1))](req).catch(describeError)),
    });
    const results: Record<string, unknown> = {};
    for (const way of Object.keys(ways)) {
      called = Promise.withResolvers();
      const socket = connect(server.port!, "127.0.0.1");
      const chunks: Buffer[] = [];
      socket.on("data", chunk => chunks.push(chunk));
      const head =
        `POST /${encodeURIComponent(way)} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n` +
        `Content-Type: ${contentType}\r\nContent-Length: ${body.length}\r\n\r\n`;
      if (way === "after the body") {
        socket.write(head + body);
      } else {
        socket.write(head);
        await called.promise;
        socket.write(body);
      }
      await once(socket, "close");
      results[way] = JSON.parse(Buffer.concat(chunks).toString().split("\r\n\r\n")[1]);
    }
    return results;
  }
  const describeError = (e: any) => ({ name: e.name, code: e.code, message: e.message });
  const eachWay = (result: unknown) => ({
    "before the body": result,
    "after the body": result,
    "a stream, before the body": result,
    "a clone, before the body": result,
  });

  it.each(["image/png", "application/octet-stream", "multipart/form-data; boundary=x"])(
    "blob().type is %s",
    async type => {
      expect(await readEachWay(type, "0123456789", async req => (await req.blob()).type)).toEqual(eachWay(type));
    },
  );

  it("blob().type is the Content-Type the handler set on the request", async () => {
    const read = async (req: Request) => {
      req.headers.set("Content-Type", "image/png");
      return (await req.blob()).type;
    };
    expect(await readEachWay("text/x-sent", "0123456789", read)).toEqual(eachWay("image/png"));
  });

  it("formData() rejects with ERR_FORMDATA_PARSE_ERROR", async () => {
    expect(await readEachWay("multipart/form-data; boundary=x", "not a form", req => req.formData())).toEqual(
      eachWay({
        name: "TypeError",
        code: "ERR_FORMDATA_PARSE_ERROR",
        message: "FormData parse error missing final boundary",
      }),
    );
  });
});

it.each(["hello", "héllo"])("sends text/plain for the string body %j after .body was read", async body => {
  const shapes: Record<string, (res: Response) => Response> = {
    direct: res => res,
    checked: res => (res.body, res),
    rewrapped: res => new Response(res.body, res),
    cloned: res => res.clone(),
    "the original of a clone": res => (res.clone(), res),
    "checked, then cloned": res => (res.body, res.clone()),
    "a clone, rewrapped": res => new Response(res.clone().body, res),
  };
  using server = Bun.serve({
    port: 0,
    routes: { "/static": shapes.checked(new Response(body)) },
    fetch: req => shapes[decodeURIComponent(new URL(req.url).pathname.slice(1))](new Response(body)),
  });

  const actual: Record<string, unknown> = {};
  const expected: Record<string, unknown> = {};
  for (const shape of [...Object.keys(shapes), "static"]) {
    const res = await fetch(new URL(encodeURIComponent(shape), server.url));
    actual[shape] = { type: res.headers.get("content-type"), text: await res.text() };
    expected[shape] = { type: "text/plain;charset=utf-8", text: body };
  }
  expect(actual).toEqual(expected);
  expect(shapes.checked(new Response(body)).headers.get("content-type")).toBeNull();
  expect(shapes.rewrapped(new Response(body)).headers.get("content-type")).toBeNull();
});

it("unix socket connection in Bun.serve", async () => {
  const unix = join(tmpdir(), "bun." + Date.now() + ((Math.random() * 32) | 0).toString(16) + ".sock");
  using server = Bun.serve({
    unix,

    async fetch(req) {
      expect(req.headers.get("Content-Type")).toBeNull();
      return new Response(new Blob(["hey"], { type: "text/plain;charset=utf-8" }));
    },
  });

  const requestText = `GET / HTTP/1.1\r\nHost: localhost\r\n\r\n`;
  const received: Buffer[] = [];
  const { resolve, promise } = Promise.withResolvers();
  await using connection = await Bun.connect({
    unix,
    socket: {
      data(socket, data) {
        received.push(data);
        resolve();
      },
    },
  });
  connection.write(requestText);
  connection.flush();
  await promise;
  expect(Buffer.concat(received).toString()).toEndWith("\r\n\r\nhey");
  connection.end();
});

it("unix socket connection throws an error on a bad domain without crashing", async () => {
  const unix = "/i/don/tevent/exist/because/the/directory/is/invalid/yes.sock";
  expect(() => {
    using server = Bun.serve({
      port: 0 as any,
      unix,

      async fetch(req) {
        expect(req.headers.get("Content-Type")).toBeNull();
        return new Response(new Blob(["hey"], { type: "text/plain;charset=utf-8" }));
      },
    });
  }).toThrow();
});

it("#5859 text", async () => {
  using server = Bun.serve({
    port: 0,
    development: false,
    async fetch(req) {
      return new Response(await req.text(), {});
    },
  });

  const response = await fetch(server.url.origin, {
    method: "POST",
    body: new Uint8Array([0xfd]),
  });

  expect(await response.text()).toBe("�");
});

it("#5859 json", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      try {
        const json = await req.json();
        console.log({ json });
      } catch (e: any) {
        return new Response(e?.message!, { status: 500 });
      }

      return new Response("SHOULD'VE FAILED", {});
    },
  });

  const response = await fetch(server.url.origin, {
    method: "POST",
    body: new Uint8Array([0xfd]),
  });

  // The body decodes to U+FFFD, so req.json() rejects with the error of JSON.parse("\uFFFD").
  expect(await response.text()).toBe("JSON Parse error: Unrecognized token '\uFFFD'");
  expect(response.ok).toBeFalse();
});

it("#5859 arrayBuffer", async () => {
  const tmp = join(tmpdirSync(), "bad");
  await Bun.write(tmp, new Uint8Array([0xfd]));
  expect(async () => await Bun.file(tmp).json()).toThrow();
});

describe("server.requestIP", () => {
  it.if(isIPv4())("v4", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        const ip = server.requestIP(req);
        console.log(ip);
        return Response.json(ip);
      },
      hostname: "127.0.0.1",
    });

    const response = await fetch(server.url.origin).then(x => x.json());
    expect(response).toMatchObject({
      address: "127.0.0.1",
      family: "IPv4",
      port: expect.any(Number),
    });
  });

  it.if(isIPv6())("v6", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        return Response.json(server.requestIP(req));
      },
      hostname: "::1",
    });

    const response = await fetch(`http://localhost:${server.port}`).then(x => x.json());
    expect(response).toMatchObject({
      address: "::1",
      family: "IPv6",
      port: expect.any(Number),
    });
  });

  it.if(isPosix)("server.requestIP (unix)", async () => {
    const unix = join(tmpdirSync(), "serve.sock");
    using server = Bun.serve({
      unix,
      fetch(req, server) {
        return Response.json(server.requestIP(req));
      },
    });
    const requestText = `GET / HTTP/1.1\r\nHost: localhost\r\n\r\n`;
    const received: Buffer[] = [];
    const { resolve, promise } = Promise.withResolvers<void>();
    const connection = await Bun.connect({
      unix,
      socket: {
        data(socket, data) {
          received.push(data);
          resolve();
        },
      },
    });
    connection.write(requestText);
    connection.flush();
    await promise;
    expect(Buffer.concat(received).toString()).toEndWith("\r\n\r\nnull");
    connection.end();
  });
});

it("should response with HTTP 413 when request body is larger than maxRequestBodySize, issue#6031", async () => {
  using server = Bun.serve({
    port: 0,
    maxRequestBodySize: 10,
    fetch(req, server) {
      return new Response("OK");
    },
  });

  {
    const resp = await fetch(server.url.origin, {
      method: "POST",
      body: "A".repeat(10),
    });
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe("OK");
  }
  {
    const resp = await fetch(server.url.origin, {
      method: "POST",
      body: "A".repeat(11),
    });
    expect(resp.status).toBe(413);
  }
});

// A 100 Continue would start an upload that the 413 behind it resets.
it("answers 413 without 100 Continue when Content-Length exceeds maxRequestBodySize", async () => {
  using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    maxRequestBodySize: 100,
    fetch: async req => new Response("length:" + (await req.text()).length),
  });
  function statusLines(body: string) {
    const { promise, resolve, reject } = Promise.withResolvers<string[]>();
    let received = "";
    const socket = net.connect(server.port!, "127.0.0.1", () => {
      socket.write(
        `POST / HTTP/1.1\r\nHost: x\r\nConnection: close\r\nExpect: 100-continue\r\nContent-Length: ${body.length}\r\n\r\n`,
      );
    });
    socket.on("data", chunk => {
      received += chunk.toString("latin1");
      if (received === "HTTP/1.1 100 Continue\r\n\r\n") socket.write(body);
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(received.match(/^HTTP\/1\.1 .*$/gm) ?? []));
    return promise;
  }
  expect({
    overLimit: await statusLines(Buffer.alloc(101, "x").toString()),
    atLimit: await statusLines(Buffer.alloc(100, "x").toString()),
  }).toEqual({
    overLimit: ["HTTP/1.1 413 Request Entity Too Large"],
    atLimit: ["HTTP/1.1 100 Continue", "HTTP/1.1 200 OK"],
  });
});

it("should support promise returned from error", async () => {
  const { promise, resolve } = Promise.withResolvers<string>();

  await using subprocess = Bun.spawn({
    cwd: import.meta.dirname,
    cmd: [bunExe(), "bun-serve.fixture.js"],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
    ipc(message) {
      resolve(message);
    },
  });

  const url = new URL(await promise);

  {
    const resp = await fetch(new URL("async-fulfilled", url));
    expect(resp.status).toBe(200);
    await expect(resp.text()).resolves.toBe("Async fulfilled");
  }

  {
    const resp = await fetch(new URL("async-rejected", url));
    expect(resp.status).toBe(500);
  }

  {
    const resp = await fetch(new URL("async-pending", url));
    expect(resp.status).toBe(200);
    await expect(resp.text()).resolves.toBe("Async pending");
  }

  {
    const resp = await fetch(new URL("async-rejected-pending", url));
    expect(resp.status).toBe(500);
  }

  subprocess.kill();
});

it("responds 500 when a deferred error() resolves without a Response", async () => {
  using server = Bun.serve({
    port: 0,
    development: false,
    fetch() {
      throw new Error("boom");
    },
    async error() {
      await new Promise(resolve => setImmediate(resolve));
    },
  });
  const res = await fetch(`http://127.0.0.1:${server.port}/`);
  expect({ status: res.status, body: await res.text() }).toEqual({ status: 500, body: "Something went wrong!" });
});

if (process.platform === "linux")
  it("should use correct error when using a root range port(#7187)", () => {
    expect(() => {
      using server = Bun.serve({
        port: 1003,
        fetch(req) {
          return new Response("request answered");
        },
      });
    }).toThrow("permission denied 0.0.0.0:1003");
  });

describe.concurrent("should error with invalid options", async () => {
  it("requestCert", () => {
    expect(() => {
      Bun.serve({
        port: 0,
        fetch(req) {
          return new Response("hi");
        },
        tls: {
          requestCert: "invalid" as any,
        },
      });
    }).toThrow("TLSOptions.requestCert must be a boolean");
  });
  it("rejectUnauthorized", () => {
    expect(() => {
      Bun.serve({
        port: 0,
        fetch(req) {
          return new Response("hi");
        },
        tls: {
          rejectUnauthorized: "invalid" as any,
        },
      });
    }).toThrow("TLSOptions.rejectUnauthorized must be a boolean");
  });
  it("lowMemoryMode", () => {
    expect(() => {
      Bun.serve({
        port: 0,
        fetch(req) {
          return new Response("hi");
        },
        tls: {
          rejectUnauthorized: true,
          lowMemoryMode: "invalid" as any,
        },
      });
    }).toThrow("TLSOptions.lowMemoryMode must be a boolean");
  });
  it("multiple missing server name", () => {
    expect(() => {
      Bun.serve({
        port: 0,
        fetch(req) {
          return new Response("hi");
        },
        tls: [
          {
            key: "lkwejflkwjeflkj",
          },
          {
            key: "lkwjefhwlkejfklwj",
          },
        ],
      });
    }).toThrow("SNI tls object must have a serverName");
  });
});
it.concurrent("should resolve pending promise if requested ended with pending read", async () => {
  let error: Error;
  function shouldError(e: Error) {
    error = e;
  }
  let is_done = false;
  function shouldMarkDone(result: { done: boolean; value: any }) {
    is_done = result.done;
  }
  await runTest(
    {
      fetch(req) {
        // @ts-ignore
        req.body?.getReader().read().then(shouldMarkDone).catch(shouldError);
        return new Response("OK");
      },
    },
    async server => {
      const response = await fetch(server.url.origin, {
        method: "POST",
        body: "1".repeat(64 * 1024),
      });
      const text = await response.text();
      expect(text).toContain("OK");
      expect(is_done).toBe(false);
      expect(error).toBeDefined();
      expect(error.name).toContain("AbortError");
    },
  );
});

it.concurrent("should work with dispose keyword", async () => {
  let url: URL;
  {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("OK");
      },
    });
    url = server.url;
    expect((await fetch(url)).status).toBe(200);
  }
  await expect(fetch(url)).rejects.toThrow();
});

// Fixture serves a >1 MB file (the sendfile threshold). Each iteration reads
// one chunk from several streams so the server is provably mid-send when
// killed; on macOS the old sendfile(2) path could hang uninterruptibly here.
it("should be able to stop in the middle of a file response", async () => {
  const fixture = join(import.meta.dir, "server-bigfile-send.fixture.js");
  for (let i = 0; i < 3; i++) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture],
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
      stdin: "ignore",
    });
    const { value } = await proc.stdout.getReader().read();
    const url = new TextDecoder().decode(value).trim();
    // Deliberately small so macOS CI runners never approach mbuf exhaustion.
    const readers: ReadableStreamDefaultReader[] = [];
    for (let j = 0; j < 16; j++) {
      const res = await fetch(url);
      expect(res.status).toBe(200);
      readers.push((res.body as ReadableStream).getReader() as ReadableStreamDefaultReader);
    }
    await Promise.all(readers.map(r => r.read()));
    expect(proc.exitCode).toBe(null);
    proc.kill();
    await proc.exited;
    expect(proc.signalCode).toBe("SIGTERM");
    for (const r of readers) await r.cancel().catch(() => {});
  }
});

it("should be able to abrupt stop the server", async () => {
  for (let i = 0; i < 10; i++) {
    using server = Bun.serve({
      port: 0,
      error() {
        return new Response("Error", { status: 500 });
      },
      async fetch(req, server) {
        server.stop(true);
        await Bun.sleep(100);
        return new Response("Hello, World!");
      },
    });

    try {
      await fetch(server.url).then(res => res.text());
      expect.unreachable();
    } catch (e: any) {
      expect(e.code).toBe("ECONNRESET");
    }
  }
});

it.concurrent("should not instanciate error instances in each request", async () => {
  const startErrorCount = heapStats().objectTypeCounts.Error || 0;
  using server = Bun.serve({
    port: 0,
    async fetch(req, server) {
      return new Response("bun");
    },
  });
  const batchSize = 100;
  const batch = new Array(batchSize);
  for (let i = 0; i < 1000; i++) {
    batch[i % batchSize] = await fetch(server.url, {
      method: "POST",
      body: "bun",
    });
    if (i % batchSize === batchSize - 1) {
      await Promise.all(batch);
    }
  }
  expect(heapStats().objectTypeCounts.Error || 0).toBeLessThanOrEqual(startErrorCount);
});

it("should be able to abort a sendfile response and streams", async () => {
  const bigfile = join(import.meta.dir, "../../web/encoding/utf8-encoding-fixture.bin");
  using server = serve({
    port: 0,
    tls,
    hostname: "localhost",
    async fetch() {
      return new Response(file(bigfile), {
        headers: { "Content-Type": "text/html" },
      });
    },
  });

  async function doRequest() {
    try {
      const controller = new AbortController();
      const res = await fetch(server.url, {
        signal: controller.signal,
        tls: { rejectUnauthorized: false },
      });
      res.body
        ?.getReader()
        .read()
        .catch(() => {});
      controller.abort();
    } catch {}
  }
  const batchSize = 20;
  const batch: Promise<void>[] = [];

  for (let i = 0; i < 500; i++) {
    batch.push(doRequest());
    if (batch.length === batchSize) {
      await Promise.all(batch);
      batch.length = 0;
    }
  }
  await Promise.all(batch);
  expect().pass();
}, 10_000);

it.concurrent("should not send extra bytes when using sendfile", async () => {
  const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const tmpFile = join(tmpdirSync(), "test.bin");
  await Bun.write(tmpFile, payload);
  using serve = Bun.serve({
    port: 0,
    fetch(req) {
      const pathname = new URL(req.url).pathname;
      if (pathname === "/file") {
        return new Response(Bun.file(tmpFile), {
          headers: {
            "Content-Type": "plain/text",
          },
        });
      }
      return new Response("Not Found", {
        status: 404,
      });
    },
  });

  // manually fetch the file using sockets, and get the whole content
  const { promise, resolve, reject } = Promise.withResolvers();
  const socket = net.connect(serve.port!, "localhost", () => {
    socket.write("GET /file HTTP/1.1\r\nHost: localhost\r\n\r\n");
    setTimeout(() => {
      socket.end(); // wait a bit before closing the connection so we get the whole content
    }, 100);
  });

  let body: Buffer | null = null;
  let content_length = 0;
  let headers = "";

  socket.on("data", (data: Buffer) => {
    if (body) {
      body = Buffer.concat([body as Buffer, data]);

      return;
    }
    // parse headers
    const str = data.toString("utf8");
    const index = str.indexOf("\r\n\r\n");
    if (index === -1) {
      headers += str;
      return;
    }
    headers += str.slice(0, index);
    const lines = headers.split("\r\n");
    for (const line of lines) {
      const [key, value] = line.split(": ");
      if (key.toLowerCase() === "content-length") {
        content_length = Number.parseInt(value, 10);
      }
    }
    body = data.subarray(index + 4);
  });
  socket.on("error", reject);
  socket.on("close", () => {
    resolve(body);
  });

  expect(await promise).toEqual(Buffer.from(payload));
  expect(content_length).toBe(payload.byteLength);
});

// Apache HttpClient 4.x sends "100-Continue" and holds the body back until the interim response arrives.
it.concurrent.each(["100-Continue", "100-CONTINUE"])("sends 100 Continue for Expect: %s", async expectation => {
  using server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async req => new Response("echo:" + (await req.text())),
  });
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let received = "";
  let sentBody = false;
  const socket = net.connect(server.port!, "127.0.0.1", () => {
    socket.write(
      `POST / HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Length: 5\r\nExpect: ${expectation}\r\n\r\n`,
    );
  });
  socket.on("data", chunk => {
    received += chunk.toString("latin1");
    if (!sentBody && received.includes("\r\n\r\n")) {
      sentBody = true;
      socket.write("hello");
    }
  });
  socket.on("error", reject);
  socket.on("close", () => resolve(received));
  const reply = await promise;
  expect(reply).toStartWith("HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\n");
  expect(reply).toEndWith("echo:hello");
});

it.concurrent("we should always send date", async () => {
  const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const tmpFile = join(tmpdirSync(), "test.bin");
  await Bun.write(tmpFile, payload);
  using serve = Bun.serve({
    port: 0,
    fetch(req) {
      const pathname = new URL(req.url).pathname;
      if (pathname === "/file") {
        return new Response(Bun.file(tmpFile), {
          headers: {
            "Content-Type": "plain/text",
          },
        });
      }
      if (pathname === "/file2") {
        return new Response(Bun.file(tmpFile));
      }
      if (pathname === "/stream") {
        return new Response(
          new ReadableStream({
            async pull(controller) {
              await Bun.sleep(10);
              controller.enqueue(payload);
              await Bun.sleep(10);
              controller.close();
            },
          }),
        );
      }
      return new Response("Hello, World!");
    },
  });

  {
    const res = await fetch(new URL("/file", serve.url.origin));
    expect(res.headers.has("Date")).toBeTrue();
  }
  {
    const res = await fetch(new URL("/file2", serve.url.origin));
    expect(res.headers.has("Date")).toBeTrue();
  }

  {
    const res = await fetch(new URL("/", serve.url.origin));
    expect(res.headers.has("Date")).toBeTrue();
  }
  {
    const res = await fetch(new URL("/stream", serve.url.origin));
    expect(res.headers.has("Date")).toBeTrue();
  }
});

// uSockets sweeps for timed-out sockets every 4 seconds (LIBUS_TIMEOUT_GRANULARITY), and a timeout is never
// early. So idleTimeout 4 outlives the first sweep after a connection's last byte and ends at the second.
// The tests that call this aren't concurrent: a forced sweep moves every socket in this process 4 seconds closer
// to its timeout.
async function sweep() {
  // A promise resolved in a request handler continues before uWS has armed that request's timer.
  await new Promise(setImmediate);
  sweepSocketTimers(1);
}

it("should allow use of custom timeout", async () => {
  let stalledRequestAborted = false;
  using server = Bun.serve({
    port: 0,
    idleTimeout: 4,
    fetch(req) {
      const stall = new URL(req.url).pathname === "/timeout";
      const aborted = Promise.withResolvers<void>();
      req.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
      if (stall) aborted.promise.then(() => (stalledRequestAborted = true));
      return new Response(
        new ReadableStream({
          async pull(controller) {
            controller.enqueue("Hello,");
            // Never writes again, so only the idle timeout can close it.
            if (stall) return aborted.promise;
            await Bun.sleep(10);
            controller.enqueue(" World!");
            controller.close();
          },
        }),
        { headers: { "Content-Type": "text/plain" } },
      );
    },
  });

  const stalled = await fetch(new URL("/timeout", server.url));
  expect(stalled.status).toBe(200);
  while (!stalledRequestAborted) await sweep();
  await expect(stalled.text()).rejects.toMatchObject({ code: "ECONNRESET" });

  const ok = await fetch(new URL("/ok", server.url));
  expect({ status: ok.status, body: await ok.text() }).toEqual({ status: 200, body: "Hello, World!" });
});

it("should reset timeout after writes", async () => {
  const payload = Buffer.from("data: tick\n\n");
  let streamAborted = false;
  let canaryAborted = false;
  const canaryArrived = Promise.withResolvers<void>();
  const streamStarted = Promise.withResolvers<ReadableStreamDefaultController>();
  using server = Bun.serve({
    idleTimeout: 4,
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === "/canary") {
        req.signal.addEventListener("abort", () => (canaryAborted = true), { once: true });
        canaryArrived.resolve();
        // Never answered, so the idle timeout closes it.
        return new Promise<Response>(() => {});
      }
      req.signal.addEventListener("abort", () => (streamAborted = true), { once: true });
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(payload);
            streamStarted.resolve(controller);
          },
        }),
        {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
          },
        },
      );
    },
  });

  const response = await fetch(server.url);
  const reader = response.body!.getReader();
  const controller = await streamStarted.promise;
  let chunksWritten = 1;
  let received = 0;
  const canary = fetch(new URL("/canary", server.url)).catch(e => e);
  await canaryArrived.promise;
  // The canary's timeout starts after the stream's. The stream writes ahead of every sweep, and the client has the
  // bytes before the sweep runs. Without the resets the stream would be closed no later than the canary.
  while (!canaryAborted) {
    controller.enqueue(payload);
    chunksWritten++;
    while (received < chunksWritten * payload.byteLength) received += (await reader.read()).value!.byteLength;
    await sweep();
  }
  expect(await canary).toMatchObject({ code: "ECONNRESET" });
  expect(streamAborted).toBe(false);

  controller.close();
  expect({ status: response.status, end: await reader.read() }).toEqual({
    status: 200,
    end: { done: true, value: undefined },
  });
});

it.concurrent("allow requestIP after async operation", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch(req, server) {
      await Bun.sleep(1);
      return new Response(JSON.stringify(server.requestIP(req)));
    },
  });

  const ip: any = await fetch(server.url).then(res => res.json());
  expect(ip).not.toBeNull();
  expect(ip.port).toBeInteger();
  expect(ip.address).toBeString();
  expect(ip.family).toBeString();
});

it("allow custom timeout per request", async () => {
  const longRequestArmed = Promise.withResolvers<void>();
  const canaryArrived = Promise.withResolvers<void>();
  const releaseLongRequest = Promise.withResolvers<void>();
  let longRequestAborted = false;
  let canaryAborted = false;
  using server = Bun.serve({
    idleTimeout: 4,
    port: 0,
    async fetch(req, server) {
      if (new URL(req.url).pathname === "/canary") {
        req.signal.addEventListener("abort", () => (canaryAborted = true), { once: true });
        canaryArrived.resolve();
        // Never answered, so the server-wide idleTimeout closes it.
        return new Promise<Response>(() => {});
      }
      server.timeout(req, 60);
      req.signal.addEventListener("abort", () => (longRequestAborted = true), { once: true });
      longRequestArmed.resolve();
      await releaseLongRequest.promise;
      return new Response("Hello, World!");
    },
  });
  expect(server.timeout).toBeFunction();

  const longRequest = fetch(new URL("/long-timeout", server.url));
  await longRequestArmed.promise;
  // The canary's timeout starts after the long request raised its own. Once the canary is closed,
  // the long request has outlived a sweep that the server-wide idleTimeout would have closed it at.
  const canary = fetch(new URL("/canary", server.url)).catch(e => e);
  await canaryArrived.promise;
  while (!canaryAborted) await sweep();
  releaseLongRequest.resolve();
  expect(await canary).toMatchObject({ code: "ECONNRESET" });
  expect(longRequestAborted).toBe(false);

  const res = await longRequest;
  expect({ status: res.status, body: await res.text() }).toEqual({ status: 200, body: "Hello, World!" });
});

// Not concurrent: a forced sweep moves every socket in this process one tick closer to its timeout.
describe("idle timeout with a forced sweep", () => {
  function rawClient(port: number, secure: boolean, maxVersion?: nodeTls.SecureVersion) {
    const client = secure
      ? nodeTls.connect({ port, host: "127.0.0.1", ca: tls.cert, maxVersion })
      : net.connect(port, "127.0.0.1");
    client.on("error", () => {});
    return client;
  }

  it.each([
    ["never answers the close_notify", 1],
    ["stopped reading the response", 64 * 1024 * 1024],
  ])("idle timeout closes a tls connection whose client %s", async (_name, size) => {
    const received = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,
      tls,
      idleTimeout: 4,
      async fetch(req) {
        req.signal.addEventListener("abort", () => aborted.resolve());
        received.resolve();
        if (size > 1) return new Response(Buffer.alloc(size, "x"));
        await aborted.promise;
        return new Response();
      },
    });
    const client = nodeTls.connect({
      port: server.port,
      host: "127.0.0.1",
      ca: tls.cert,
      allowHalfOpen: true,
    } as nodeTls.ConnectionOptions);
    client.on("error", aborted.reject);
    try {
      await once(client, "secureConnect");
      client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
      await received.promise;
      let closed = false;
      aborted.promise.finally(() => (closed = true)).catch(() => {});
      // A client that still takes bytes is slow, not idle, so this lasts until the kernel's buffers are full.
      while (!closed) await sweep();
      await aborted.promise;
    } finally {
      client.destroy();
    }
  });

  it("closes a connection whose client never answers the FIN behind a closing response", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      idleTimeout: 0,
      fetch: () => new Response("bye", { headers: { Connection: "close" } }),
    });
    const client = net.connect({ port: server.port!, host: "127.0.0.1", allowHalfOpen: true });
    client.on("error", () => {});
    try {
      client.resume();
      client.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
      await once(client, "end");
      // A server that still lingers drops this byte. One that has closed resets the connection for it.
      let closed = false;
      client.on("close", () => (closed = true));
      while (!closed) {
        await sweep();
        if (client.writable) client.write("x");
      }
      expect(closed).toBe(true);
    } finally {
      client.destroy();
    }
  });

  it.each([
    ["http", false],
    ["https", true],
  ] as const)("idleTimeout applies before the first request over %s", async (_protocol, secure) => {
    const serve = (idleTimeout: number) =>
      Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        tls: secure ? tls : undefined,
        idleTimeout,
        fetch: () => new Response("ok"),
      });
    using disabled = serve(0);
    using short = serve(1);
    const closed: string[] = [];
    const connect = (name: string, port: number) => {
      // In TLS 1.2 the server sends the last message of the handshake, so at 'secureConnect' the server is through it too.
      const client = rawClient(port, secure, "TLSv1.2");
      client.on("close", () => closed.push(name));
      // An unfinished head, because the kernel only hands a connection to accept() once it has sent something.
      client.write("GET / HTTP/1.1\r\n");
      return client;
    };
    const clients = [connect("disabled", disabled.port!), connect("short", short.port!)];
    try {
      // The handshake has a deadline of its own, whatever idleTimeout is, and sweeps during it would run that out.
      if (secure) await Promise.all(clients.map(client => once(client, "secureConnect")));
      // However many turns of the loop the accept takes.
      while (closed.length === 0) await sweep();
      // 20 seconds' worth of sweeps for a connection that both servers have accepted by now.
      for (let i = 0; i < 5; i++) await sweep();
      expect(closed).toEqual(["short"]);
      clients[0].write("Host: localhost\r\n\r\n");
      const [head] = await once(clients[0], "data");
      expect(head.toString()).toStartWith("HTTP/1.1 200 OK\r\n");
    } finally {
      for (const client of clients) client.destroy();
    }
  });

  // Winsock takes a first send of any size whole, so these responses don't block there.
  it.skipIf(isWindows)("idleTimeout applies to static, file and directory routes", async () => {
    const size = 32 * 1024 * 1024;
    using dir = tempDir("serve-timeout-routes", { "big.bin": Buffer.alloc(size) });
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      idleTimeout: 1,
      routes: {
        "/static": new Response(new Uint8Array(size)),
        "/file": new Response(Bun.file(join(String(dir), "big.bin"))),
        "/directory/*": { dir: String(dir) },
      },
      fetch: () => new Response("fallback"),
    });
    // Each client reads the start of the response and then stops, so the body can't finish.
    const clients = await Promise.all(
      ["/static", "/file", "/directory/big.bin"].map(async path => {
        const client = rawClient(server.port!, false);
        const outcome = Promise.withResolvers<string>();
        let received = 0;
        client.on("data", chunk => {
          received += chunk.length;
          if (received >= size) outcome.resolve(`${path} completed`);
        });
        client.on("close", () => outcome.resolve(`${path} cut off`));
        client.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
        await once(client, "data");
        client.pause();
        return { client, outcome: outcome.promise };
      }),
    );
    try {
      // The kernel can still be filling a client's receive buffer at the first sweeps, which counts as progress.
      while (server.pendingRequests > 0) await sweep();
      // A paused client only notices the close once it reads again.
      for (const { client } of clients) client.resume();
      expect(await Promise.all(clients.map(({ outcome }) => outcome))).toEqual([
        "/static cut off",
        "/file cut off",
        "/directory/big.bin cut off",
      ]);
    } finally {
      for (const { client } of clients) client.destroy();
    }
  });

  it("server.timeout() applies on a unix socket", async () => {
    using dir = tempDir("serve-timeout-unix", {});
    const unix = join(String(dir), "serve.sock");
    const aborted: string[] = [];
    const pending = Promise.withResolvers<void>();
    let requests = 0;
    using server = Bun.serve({
      unix,
      idleTimeout: 1,
      fetch(req, server) {
        const { pathname } = new URL(req.url);
        if (pathname === "/long") server.timeout(req, 60);
        req.signal.addEventListener("abort", () => aborted.push(pathname));
        if (++requests === 2) pending.resolve();
        return new Promise<Response>(() => {});
      },
    });
    const controller = new AbortController();
    try {
      for (const path of ["/long", "/default"]) {
        fetch("http://localhost" + path, { unix, signal: controller.signal }).catch(pending.reject);
      }
      await pending.promise;
      await sweep();
      await sweep();
      expect(aborted).toEqual(["/default"]);
    } finally {
      controller.abort();
    }
  });

  // Winsock takes a first send of any size whole, so these responses don't block there.
  it.skipIf(isWindows).each([
    ["http", false],
    ["https", true],
  ] as const)("server.timeout() applies to a Bun.file() body over %s", async (_protocol, secure) => {
    using dir = tempDir("serve-timeout-file", { "big.bin": Buffer.alloc(32 * 1024 * 1024) });
    const aborted: string[] = [];
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: secure ? tls : undefined,
      idleTimeout: 1,
      fetch(req, server) {
        const { pathname } = new URL(req.url);
        if (pathname === "/long") server.timeout(req, 60);
        req.signal.addEventListener("abort", () => aborted.push(pathname));
        return new Response(Bun.file(join(String(dir), "big.bin")));
      },
    });
    // Each client reads the start of the response and then stops, so the body can't finish.
    const clients = await Promise.all(
      ["/long", "/default"].map(async path => {
        const client = rawClient(server.port!, secure);
        client.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
        await once(client, "data");
        client.pause();
        return client;
      }),
    );
    try {
      // The kernel can still be filling the client's receive buffer at the first sweeps, which counts as progress.
      for (let i = 0; i < 8 && aborted.length === 0; i++) await sweep();
      expect(aborted).toEqual(["/default"]);
    } finally {
      for (const client of clients) client.destroy();
    }
  });

  it.skipIf(isWindows)("idleTimeout applies while a response write is blocked", async () => {
    const big = new Uint8Array(32 * 1024 * 1024);
    const aborted: string[] = [];
    const pending = Promise.withResolvers<void>();
    let requests = 0;
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      idleTimeout: 1,
      fetch(req) {
        const { pathname } = new URL(req.url);
        req.signal.addEventListener("abort", () => aborted.push(pathname));
        if (++requests === 2) pending.resolve();
        return new Response(big);
      },
    });
    // The server stops reading a body that the handler doesn't consume at 1 MiB.
    const clients = Object.entries({ "/complete": 10, "/paused": 4 * 1024 * 1024 }).map(([path, length]) => {
      const client = rawClient(server.port!, false);
      client.on("close", () => pending.reject(new Error("closed before the request reached the handler")));
      client.pause();
      const head = `POST ${path} HTTP/1.1\r\nHost: localhost\r\nContent-Length: ${length}\r\n\r\n`;
      client.write(Buffer.concat([Buffer.from(head), Buffer.alloc(length, "x")]));
      return client;
    });
    try {
      await pending.promise;
      for (let i = 0; i < 8 && aborted.length < 2; i++) await sweep();
      expect(aborted.sort()).toEqual(["/complete", "/paused"]);
    } finally {
      for (const client of clients) client.destroy();
    }
  });

  // Linux only: macOS sends to a reader that freed less than a segment of its window only at the next persist probe, seconds later.
  describe.skipIf(!isLinux)("a slow reader", () => {
    const size = 16 * 1024 * 1024;
    const bodies = {
      bytes: () => new Uint8Array(size),
      file: (dir: string) => Bun.file(join(dir, "big.bin")),
      stream: () => {
        const chunk = new Uint8Array(64 * 1024);
        let pulls = 0;
        return new ReadableStream({
          pull(controller) {
            controller.enqueue(chunk);
            if (++pulls === size / chunk.length) controller.close();
          },
        });
      },
    };

    it.each([
      ["bytes", "http"],
      ["file", "http"],
      ["stream", "http"],
      ["bytes", "https"],
    ] as const)("of a %s body over %s stays connected until it stalls", async (kind, protocol) => {
      using dir = tempDir("serve-slow-reader", kind === "file" ? { "big.bin": Buffer.alloc(size) } : {});
      const onAbort = mock();
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        tls: protocol === "https" ? tls : undefined,
        // Two sweeps, so each timeout comes a whole read after the timer was armed.
        idleTimeout: 4,
        fetch(req) {
          req.signal.addEventListener("abort", onAbort);
          return new Response(bodies[kind](String(dir)));
        },
      });
      const client = rawClient(server.port!, protocol === "https");
      let received = 0;
      let wake = Promise.withResolvers<void>();
      client.on("close", () => wake.resolve());
      client.on("data", chunk => {
        received += chunk.length;
        wake.resolve();
      });
      try {
        await once(client, protocol === "https" ? "secureConnect" : "connect");
        // A small receive buffer makes every read open the window. The reads stay too small for a writable event on the server.
        setSocketOptions(client, 2 /* SO_RCVBUF */, 128 * 1024);
        client.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
        for (let i = 0; i < 6; i++) {
          const target = received + 256 * 1024;
          client.resume();
          while (received < target && !client.closed) {
            wake = Promise.withResolvers<void>();
            await wake.promise;
          }
          client.pause();
          await sweep();
        }
        expect(onAbort).not.toHaveBeenCalled();

        for (let i = 0; i < 8 && onAbort.mock.calls.length === 0; i++) await sweep();
        expect(onAbort).toHaveBeenCalledTimes(1);
      } finally {
        client.destroy();
      }
    });
  });
});

it.concurrent(
  "TLS: reaps every zero-byte pre-handshake connection in a burst",
  async () => {
    const result = await bunRun(join(import.meta.dirname, "serve-tls-prehandshake-reap-fixture.ts"), {
      TLS_CERT: tls.cert,
      TLS_KEY: tls.key,
      N: "300",
      DEADLINE_MS: "22000",
    });
    expect(result).toSpawn();
    const { opened, held } = JSON.parse(result.stdout);
    // Windows' accept backlog may drop part of the burst; the invariant is
    // that every connection that did complete is reaped.
    expect(opened).toBeGreaterThanOrEqual(100);
    expect(held).toBe(0);
  },
  40_000,
);

it.concurrent("#6462", async () => {
  let headers: [string, string | null][] = [];
  using server = Bun.serve({
    port: 0,
    async fetch(request) {
      for (const key of request.headers.keys()) {
        headers = headers.concat([[key, request.headers.get(key)]]);
      }
      return new Response(
        JSON.stringify({
          "headers": headers,
        }),
        { status: 200 },
      );
    },
  });

  const bytes = Buffer.from(`GET / HTTP/1.1\r\nConnection: close\r\nHost: ${server.hostname}\r\nTest!: test\r\n\r\n`);
  const { promise, resolve } = Promise.withResolvers();
  await Bun.connect({
    port: server.port!,
    hostname: server.hostname!,
    socket: {
      open(socket) {
        const wrote = socket.write(bytes);
        console.log("wrote", wrote);
      },
      data(socket, data) {
        console.log(data.toString("utf8"));
      },
      close(socket) {
        resolve();
      },
    },
  });
  await promise;

  expect(headers).toStrictEqual([
    ["connection", "close"],
    ["host", "localhost"],
    ["test!", "test"],
  ]);
});

it.concurrent("combines duplicate request headers per the Fetch spec", async () => {
  // WHATWG Fetch requires repeated header fields to be combined with ", " when
  // read via Headers.get(). Previously Bun.serve overwrote duplicate non-common
  // request header names with the last value, dropping earlier values.
  let seen: Record<string, string | null> = {};
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      seen = {
        xdup: req.headers.get("x-dup"),
        xonce: req.headers.get("x-once"),
        xgap: req.headers.get("x-gap"),
        xempty: req.headers.get("x-empty"),
        accept: req.headers.get("accept"),
      };
      return new Response("ok");
    },
  });

  const { promise, resolve } = Promise.withResolvers<void>();
  await Bun.connect({
    port: server.port!,
    hostname: server.hostname!,
    socket: {
      open(socket) {
        socket.write(
          "GET / HTTP/1.1\r\n" +
            `Host: ${server.hostname}\r\n` +
            "X-Dup: first\r\n" +
            "X-Dup: second\r\n" +
            "X-Dup: third\r\n" +
            "X-Once: only\r\n" +
            "X-Gap: a\r\n" +
            "X-Gap:\r\n" +
            "X-Gap: c\r\n" +
            "X-Empty:\r\n" +
            "Accept: text/html\r\n" +
            "Accept: application/json\r\n" +
            "Connection: close\r\n" +
            "\r\n",
        );
      },
      data() {},
      close() {
        resolve();
      },
    },
  });
  await promise;

  expect(seen).toEqual({
    xdup: "first, second, third",
    xonce: "only",
    // the combine step has no empty-value exception, and a lone empty header
    // is still visible — Node reports "a, , c" and "", not "a, c" and null
    xgap: "a, , c",
    xempty: "",
    accept: "text/html, application/json",
  });
});

it.concurrent("#6583", async () => {
  const callback = mock();
  using server = Bun.serve({
    fetch: callback,
    port: 0,
    hostname: "localhost",
  });
  const { promise, resolve } = Promise.withResolvers();
  await Bun.connect({
    port: server.port!,
    hostname: server.hostname!,
    tls: true,
    socket: {
      open(socket) {
        socket.write("GET / HTTP/1.1\r\nConnection: close\r\nHost: localhost\r\n\r\n");
      },
      data(socket, data) {
        console.log(data.toString("utf8"));
      },
      close(socket) {
        resolve();
      },
    },
  });
  await promise;
  expect(callback).not.toHaveBeenCalled();
});

it.concurrent("do the best effort to flush everything", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(ctrl) {
            ctrl.write("b");
            await Bun.sleep(10);
            ctrl.write("un");
          },
        }),
      );
    },
  });
  let response = await fetch(server.url);
  expect(await response.text()).toBe("bun");
});

it.concurrent("#20283", async () => {
  using server = Bun.serve({
    routes: {
      "/": async req => {
        // calling clone() with no cookies should not crash
        const cloned = req.clone();
        return Response.json({
          cookies: req.cookies,
          clonedCookies: cloned.cookies,
        });
      },
    },
    port: 0,
  });

  const response = await fetch(server.url);
  const json = await response.json();
  // there should be no cookies and the clone should have succeeded
  expect(json).toEqual({ cookies: {}, clonedCookies: {} });
});

// Regression: hostname containing an interior NUL byte must not abort the process.
// Zig reference: src/runtime/server/ServerConfig.zig — `bun.default_allocator.dupeZ(u8, host_str.slice())`
// copies the raw bytes and the underlying C socket layer truncates at the first NUL, so
// `"127.0.0.1\0ignored"` behaves like `"127.0.0.1"` (or at worst surfaces as a catchable JS error).
// A port that uses CString::new(...).expect(...) would panic and crash the process instead.
it.concurrent("Bun.serve hostname with interior NUL byte does not crash the process", async () => {
  const script = `
    try {
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1\\0ignored",
        fetch() { return new Response("ok"); },
      });
      console.log("listening:" + server.port);
      server.stop(true);
    } catch (e) {
      // A catchable JS error is acceptable; a hard process crash is not.
      console.log("caught:" + (e?.constructor?.name ?? "Error"));
    }
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // Zig behavior: either the server binds (C layer truncates at NUL) or a JS error is thrown
  // and caught. In both cases the subprocess prints a marker line and exits 0. If the config
  // parser hard-panics on the interior NUL, stdout is empty and the exit code is non-zero.
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: expect.stringMatching(/^(listening:\d+|caught:\w+)$/),
    stderr: expect.any(String),
    exitCode: 0,
  });
});

// A "[...]" hostname has its brackets stripped before it is handed to the socket layer.
// That copy used to live in a fixed 1024-byte buffer, so a longer bracketed hostname
// aborted the process instead of failing to listen like any other bogus hostname.
it.concurrent("Bun.serve with a bracketed hostname longer than 1024 bytes throws instead of crashing", async () => {
  const script = `
    const hostname = "[" + Buffer.alloc(1100, "a").toString() + "]";
    let server;
    try {
      server = Bun.serve({ port: 0, hostname, fetch() { return new Response("ok"); } });
    } catch (e) {
      console.log("caught:" + (e instanceof Error));
    }
    if (server) {
      console.log("listening:" + server.port);
      server.stop(true);
    }
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: "caught:true",
    stderr: "",
    exitCode: 0,
  });
});

it.concurrent("development error log prints the request pathname verbatim", async () => {
  const script = `
    const net = require("node:net");
    const server = Bun.serve({
      port: 0,
      development: true,
      fetch() {
        throw new Error("boom");
      },
    });
    const socket = net.connect(server.port, "127.0.0.1", () => {
      socket.write("GET /a<b>c>d HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\nConnection: close\\r\\n\\r\\n");
    });
    socket.on("data", () => {});
    socket.on("close", () => {
      server.stop(true);
      process.exit(0);
    });
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toContain("GET - /a<b>c>d failed");
  expect(exitCode).toBe(0);
});

// The HTTP parser shares HttpParser.h between Bun.serve and node:http. When a request
// handler tears the connection down from inside the request-body data callback, the
// parser must stop consuming the rest of the TCP segment instead of routing a request
// that was pipelined behind the body onto the already-closed socket.
it.concurrent(
  "does not dispatch a pipelined request after the connection is destroyed inside the body data callback",
  async () => {
    const script = `
const http = require("node:http");
const net = require("node:net");

const seen = [];
const server = http.createServer((req, res) => {
  seen.push(req.url);
  if (req.url === "/first") {
    req.on("data", () => {
      // Reject the upload: finish the response and tear down the socket,
      // synchronously, from inside the request body data callback.
      res.writeHead(400);
      res.end();
      req.socket.destroy();
    });
    return;
  }
  res.end("ok");
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  const socket = net.connect(port, "127.0.0.1", () => {
    // One TCP segment: a POST with a body, immediately followed by a pipelined GET.
    socket.write(
      "POST /first HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\nContent-Length: 5\\r\\n\\r\\nhello" +
        "GET /second HTTP/1.1\\r\\nHost: 127.0.0.1\\r\\n\\r\\n",
    );
  });
  socket.on("error", () => {});
  socket.resume();
  socket.on("close", async () => {
    // A fresh connection must still get a normal response afterwards.
    const res = await fetch("http://127.0.0.1:" + port + "/after");
    await res.text();
    console.log(JSON.stringify({ seen, after: res.status }));
    server.close();
    process.exit(0);
  });
});
`;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    // "/second" arrived in the same TCP segment as the POST body, after the handler had
    // already torn the connection down. It must never reach the request listener.
    expect(stdout.trim()).toBe('{"seen":["/first","/after"],"after":200}');
    expect(exitCode).toBe(0);
  },
);

it("only serves /bun:info to loopback clients in development mode", async () => {
  using server = Bun.serve({
    port: 0,
    hostname: "0.0.0.0",
    development: true,
    fetch() {
      return new Response("handled by fetch");
    },
  });

  // Loopback clients still get the runtime info JSON from the development route.
  const loopbackRes = await fetch(`http://127.0.0.1:${server.port}/bun:info`);
  const loopbackText = await loopbackRes.text();
  expect(loopbackText).toContain("bun_version");
  expect(loopbackRes.status).toBe(200);

  // Connections arriving from a non-loopback interface must not be answered by the
  // /bun:info route; the request falls through to the user's fetch handler instead.
  const externalAddress = Object.values(networkInterfaces())
    .flat()
    .find(iface => iface && iface.family === "IPv4" && !iface.internal)?.address;
  if (!externalAddress) {
    // Machine has no non-loopback IPv4 interface; only the loopback case can be exercised here.
    return;
  }

  const externalRes = await fetch(`http://${externalAddress}:${server.port}/bun:info`);
  const externalText = await externalRes.text();
  expect(externalText).toBe("handled by fetch");
  expect(externalText).not.toContain("bun_version");
  expect(externalRes.status).toBe(200);
});

it.if(isPosix)("serves /bun:info over a unix socket in development mode", async () => {
  using dir = tempDir("info", {});
  const unix = join(String(dir), "bun-info.sock");
  using server = Bun.serve({
    unix,
    development: true,
    fetch() {
      return new Response("handled by fetch");
    },
  });

  const res = await fetch("http://localhost/bun:info", { unix });
  const text = await res.text();
  expect(text).toContain("bun_version");
  expect(res.status).toBe(200);
});

it("only serves /bun:info to requests with a local Host header in development mode", async () => {
  using server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    development: true,
    fetch() {
      return new Response("handled by fetch");
    },
  });

  const localHostRes = await fetch(`http://127.0.0.1:${server.port}/bun:info`, {
    headers: { Host: "localhost" },
  });
  const localHostText = await localHostRes.text();
  expect(localHostText).toContain("bun_version");
  expect(localHostRes.status).toBe(200);

  const foreignHostRes = await fetch(`http://127.0.0.1:${server.port}/bun:info`, {
    headers: { Host: "example.com" },
  });
  const foreignHostText = await foreignHostRes.text();
  expect(foreignHostText).toBe("handled by fetch");
  expect(foreignHostRes.status).toBe(200);
});

// https://github.com/oven-sh/bun/issues/32469
it("applies backpressure to a Response(ReadableStream) body when the client stalls", async () => {
  const CHUNK = Buffer.alloc(64 * 1024, 65); // 64 KiB
  // Without backpressure the producer runs to this cap (128 MiB) and closes;
  // with it, pull plateaus at roughly the socket send buffer.
  const CAP_CHUNKS = 2048;
  let pulls = 0;
  let producedEverything = false;

  using server = serve({
    port: 0,
    fetch() {
      const stream = new ReadableStream(
        {
          pull(controller) {
            pulls++;
            controller.enqueue(CHUNK);
            if (pulls >= CAP_CHUNKS) {
              producedEverything = true;
              controller.close();
            }
          },
        },
        { highWaterMark: 1 },
      );
      return new Response(stream);
    },
  });

  // Raw client: send the request, read the head of the response, then stop
  // reading so TCP backpressure propagates back to the server.
  const socket = net.connect(server.port!, "127.0.0.1");
  const { promise: stalled, resolve: onStalled, reject: onSocketError } = Promise.withResolvers<void>();
  socket.on("error", onSocketError);
  socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n"));
  socket.once("data", () => {
    socket.pause();
    onStalled();
  });

  try {
    await stalled;

    // Poll a bounded window for the absence of a runaway: wait until the pull
    // count plateaus (backpressure engaged) or the server produces the whole
    // capped body (the bug).
    let last = -1;
    let stable = 0;
    while (!producedEverything && stable < 12) {
      await Bun.sleep(25);
      if (pulls === last) stable++;
      else {
        stable = 0;
        last = pulls;
      }
    }

    // Without backpressure the producer runs to CAP_CHUNKS and closes; with
    // it, pulls plateau at roughly the kernel send/recv buffer. The exact
    // count depends on per-platform socket sizing, so assert the property
    // (plateau well below the cap) rather than a hard number. The lower bound
    // proves pull() actually ran and was paused, not that nothing happened.
    expect(producedEverything).toBe(false);
    expect(pulls).toBeGreaterThan(0);
    expect(pulls).toBeLessThan(CAP_CHUNKS / 2);
  } finally {
    socket.destroy();
  }
});

// https://github.com/oven-sh/bun/issues/32469
it("resumes a backpressured Response(ReadableStream) once the client drains and delivers the full body", async () => {
  const CHUNK = Buffer.alloc(256 * 1024, 66);
  const TOTAL_CHUNKS = 512; // 128 MiB — well past any kernel socket buffer
  let pulls = 0;

  using server = serve({
    port: 0,
    fetch() {
      let sent = 0;
      const stream = new ReadableStream(
        {
          pull(controller) {
            pulls++;
            controller.enqueue(CHUNK);
            if (++sent === TOTAL_CHUNKS) controller.close();
          },
        },
        { highWaterMark: 1 },
      );
      return new Response(stream);
    },
  });

  const socket = net.connect(server.port!, "127.0.0.1");
  const { promise: stalled, resolve: onStalled, reject: onSocketError } = Promise.withResolvers<void>();
  const { promise: bodyDone, resolve: onBodyDone } = Promise.withResolvers<void>();
  socket.on("error", onSocketError);
  socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
  let received = 0;
  socket.on("data", chunk => {
    received += chunk.length;
  });
  socket.on("close", () => onBodyDone());
  socket.once("data", () => {
    socket.pause();
    onStalled();
  });

  try {
    await stalled;

    // Wait for the producer to pause under backpressure.
    let last = -1;
    let stable = 0;
    while (stable < 8 && pulls < TOTAL_CHUNKS) {
      await Bun.sleep(25);
      if (pulls === last) stable++;
      else {
        stable = 0;
        last = pulls;
      }
    }
    // The producer must have paused well before the full body.
    expect(pulls).toBeLessThan(TOTAL_CHUNKS);

    // Now drain the client and confirm the producer resumes and completes.
    socket.resume();
    await bodyDone;

    expect(pulls).toBe(TOTAL_CHUNKS);
    // received includes HTTP head + chunked framing, so just assert the full
    // payload made it through.
    expect(received).toBeGreaterThanOrEqual(TOTAL_CHUNKS * CHUNK.length);
  } finally {
    socket.destroy();
  }
});

describe.concurrent("request body backpressure", () => {
  // Raw-socket PUT client: connect, send the request head, then pump `total`
  // bytes of `fill`, pausing on `drain`. Resolves once the client's `sent`
  // counter has plateaued for 12×25 ms (backpressure engaged) or it finished
  // the whole body (the bug).
  async function pumpUploadUntilPlateau(port: number, total: number, fill: number, connection = "close") {
    const block = Buffer.alloc(256 * 1024, fill);
    const sock = net.connect(port, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      sock.once("connect", () => resolve());
      sock.once("error", reject);
    });
    sock.on("error", () => {});
    sock.on("data", () => {});
    sock.write(`PUT /up HTTP/1.1\r\nHost: x\r\nContent-Length: ${total}\r\nConnection: ${connection}\r\n\r\n`);

    let sent = 0;
    let drainWaiters = 0;
    const writeMore = () => {
      while (sent < total) {
        const n = Math.min(block.length, total - sent);
        const ok = sock.write(n === block.length ? block : block.subarray(0, n));
        sent += n;
        if (!ok) {
          drainWaiters++;
          sock.once("drain", writeMore);
          return;
        }
      }
    };
    writeMore();

    let last = -1;
    let stable = 0;
    while (sent < total && stable < 12) {
      await Bun.sleep(25);
      if (sent === last) stable++;
      else {
        stable = 0;
        last = sent;
      }
    }
    return { sock, sentBeforeGate: sent, drainWaiters, getSent: () => sent };
  }

  it("applies backpressure to a streamed request body when the handler reads slowly", async () => {
    // The server reads one chunk then stalls on a gate. Without backpressure the
    // client can push the whole body into the ByteStream's internal buffer in
    // that window (one ~TOTAL-sized mega-chunk once the gate opens). With it the
    // socket is paused once ~1 MiB is buffered, so the client's write loop parks
    // on `drain` well short of TOTAL and every delivered chunk stays bounded.
    const TOTAL = 32 * 1024 * 1024;
    const gate = Promise.withResolvers<void>();
    let serverBytes = 0;
    let maxChunk = 0;
    let contentOk = true;
    const serverDone = Promise.withResolvers<void>();

    using server = serve({
      port: 0,
      idleTimeout: 0,
      maxRequestBodySize: TOTAL + 1,
      error(e) {
        serverDone.reject(e);
      },
      async fetch(req) {
        const reader = req.body!.getReader();
        const first = await reader.read();
        if (first.value) {
          serverBytes += first.value.length;
          maxChunk = Math.max(maxChunk, first.value.length);
          if (first.value[0] !== 7 || first.value.at(-1) !== 7) contentOk = false;
        }
        await gate.promise;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          serverBytes += value.length;
          maxChunk = Math.max(maxChunk, value.length);
          if (value[0] !== 7 || value.at(-1) !== 7) contentOk = false;
        }
        serverDone.resolve();
        return new Response("ok");
      },
    });

    const { sock, sentBeforeGate, drainWaiters } = await pumpUploadUntilPlateau(server.port!, TOTAL, 7);
    try {
      gate.resolve();
      await serverDone.promise;

      // With backpressure the client stalls after ~HWM + kernel socket buffers.
      // Without it, the client finishes the whole body before the gate opens.
      expect(sentBeforeGate).toBeGreaterThan(0);
      expect(sentBeforeGate).toBeLessThan(TOTAL);
      expect(drainWaiters).toBeGreaterThan(0);
      // The ByteStream buffer is capped at ~1 MiB, so the largest chunk the
      // handler ever sees is that plus at most one recv buffer. Without
      // backpressure the second read would deliver ~TOTAL bytes in one chunk.
      expect(maxChunk).toBeLessThan(4 * 1024 * 1024);
      expect(serverBytes).toBe(TOTAL);
      expect(contentOk).toBe(true);
    } finally {
      sock.destroy();
    }
  });

  it("applies backpressure to a request body that the handler has not touched yet", async () => {
    // Same shape as above but the handler does not touch req.body until after the
    // client has plateaued, covering the pre-stream request_body_buf path.
    const TOTAL = 32 * 1024 * 1024;
    const gate = Promise.withResolvers<void>();
    let serverBytes = 0;
    let maxChunk = 0;
    let contentOk = true;
    const serverDone = Promise.withResolvers<void>();

    using server = serve({
      port: 0,
      idleTimeout: 0,
      maxRequestBodySize: TOTAL + 1,
      error(e) {
        serverDone.reject(e);
      },
      async fetch(req) {
        await gate.promise;
        for await (const c of req.body!) {
          serverBytes += c.length;
          maxChunk = Math.max(maxChunk, c.length);
          if (c[0] !== 9 || c.at(-1) !== 9) contentOk = false;
        }
        serverDone.resolve();
        return new Response("ok");
      },
    });

    const { sock, sentBeforeGate } = await pumpUploadUntilPlateau(server.port!, TOTAL, 9);
    try {
      gate.resolve();
      await serverDone.promise;

      expect(sentBeforeGate).toBeGreaterThan(0);
      expect(sentBeforeGate).toBeLessThan(TOTAL);
      expect(maxChunk).toBeLessThan(4 * 1024 * 1024);
      expect(serverBytes).toBe(TOTAL);
      expect(contentOk).toBe(true);
    } finally {
      sock.destroy();
    }
  });

  it("resumes a paused request body when the handler calls Bun.write(file, req)", async () => {
    // Bun.write on a Locked body installs on_receive_value without creating a
    // ByteStream; the pre-stream pause must release via on_start_buffering.
    const TOTAL = 32 * 1024 * 1024;
    const gate = Promise.withResolvers<void>();
    const serverDone = Promise.withResolvers<number>();

    using dir = tempDir("serve-request-body-bunwrite", {});
    const out = join(String(dir), "body");

    using server = serve({
      port: 0,
      idleTimeout: 0,
      maxRequestBodySize: TOTAL + 1,
      error(e) {
        serverDone.reject(e);
      },
      async fetch(req) {
        await gate.promise;
        const n = await Bun.write(out, req);
        serverDone.resolve(n);
        return new Response("ok");
      },
    });

    const { sock, sentBeforeGate } = await pumpUploadUntilPlateau(server.port!, TOTAL, 3);
    try {
      expect(sentBeforeGate).toBeLessThan(TOTAL);

      gate.resolve();
      const bytes = await serverDone.promise;
      expect(bytes).toBe(TOTAL);
      const written = await Bun.file(out).bytes();
      expect([written.length, written[0], written.at(-1)]).toEqual([TOTAL, 3, 3]);
    } finally {
      sock.destroy();
    }
  });

  for (const touchBodyFirst of [false, true]) {
    it(`resumes a paused request body when the handler calls .arrayBuffer()${touchBodyFirst ? " after touching req.body" : ""}`, async () => {
      // .arrayBuffer() wants the whole body, so the pre-stream pause must
      // release once it is called instead of leaving the socket wedged. The
      // second variant materializes `req.body` first so `.arrayBuffer()` goes
      // through the ByteStream buffer_action fastpath instead of
      // on_start_buffering.
      const TOTAL = 32 * 1024 * 1024;
      const gate = Promise.withResolvers<void>();
      const serverDone = Promise.withResolvers<number>();

      using server = serve({
        port: 0,
        idleTimeout: 0,
        maxRequestBodySize: TOTAL + 1,
        error(e) {
          serverDone.reject(e);
        },
        async fetch(req) {
          if (touchBodyFirst) void req.body;
          await gate.promise;
          const buf = await req.arrayBuffer();
          serverDone.resolve(buf.byteLength);
          return new Response("ok");
        },
      });

      const { sock, sentBeforeGate } = await pumpUploadUntilPlateau(server.port!, TOTAL, 5);
      try {
        expect(sentBeforeGate).toBeLessThan(TOTAL);

        gate.resolve();
        const bytes = await serverDone.promise;
        expect(bytes).toBe(TOTAL);
      } finally {
        sock.destroy();
      }
    });
  }

  it("releases a paused request body when the handler responds without reading it", async () => {
    // The handler never touches req.body, so the pre-stream pause engages. Once
    // the response is sent detach_response() resumes the socket; without that the
    // keep-alive connection would stay paused and the client's upload could never
    // progress past the plateau. `Connection: close` cannot observe this: uWS
    // force-closes right after the response, and close() with unread body bytes
    // in the kernel recv buffer sends RST on macOS, which both EPIPEs the still-
    // running upload pump and can drop the response before the client reads it.
    const TOTAL = 32 * 1024 * 1024;
    const gate = Promise.withResolvers<void>();
    const serverDone = Promise.withResolvers<void>();

    using server = serve({
      port: 0,
      idleTimeout: 0,
      maxRequestBodySize: TOTAL + 1,
      error(e) {
        serverDone.reject(e);
      },
      async fetch() {
        await gate.promise;
        serverDone.resolve();
        return new Response("ignored");
      },
    });

    const { sock, sentBeforeGate, getSent } = await pumpUploadUntilPlateau(server.port!, TOTAL, 2, "keep-alive");
    try {
      expect(sentBeforeGate).toBeGreaterThan(0);
      expect(sentBeforeGate).toBeLessThan(TOTAL);

      const response = new Promise<string>(resolve => {
        let buf = "";
        sock.removeAllListeners("data");
        sock.on("data", d => {
          buf += d.toString("latin1");
          if (buf.includes("ignored")) resolve(buf);
        });
        sock.once("close", () => resolve(buf));
      });

      gate.resolve();
      await serverDone.promise;
      const resp = await response;
      expect(resp).toStartWith("HTTP/1.1 200 ");
      expect(resp).toContain("ignored");

      // The socket was resumed, so the upload pump (still parked on `drain`)
      // moves past the plateau as the server discards the remaining body.
      const deadline = Date.now() + 2000;
      while (getSent() === sentBeforeGate && Date.now() < deadline) await Bun.sleep(25);
      expect(getSent()).toBeGreaterThan(sentBeforeGate);
    } finally {
      sock.destroy();
    }
  });
});

// https://github.com/oven-sh/bun/issues/32469
it("type: direct stream awaiting flush(true) under backpressure does not re-enter pull", async () => {
  const CHUNK = Buffer.alloc(256 * 1024, 67);
  const TOTAL_CHUNKS = 512; // 128 MiB
  let pullEntries = 0;
  let writes = 0;

  using server = serve({
    port: 0,
    fetch() {
      const stream = new ReadableStream({
        type: "direct",
        async pull(controller) {
          pullEntries++;
          for (let i = 0; i < TOTAL_CHUNKS; i++) {
            // write() returns a pending Promise when the socket is backed up;
            // await flush(true) (the pending-flush promise) to pause until the
            // drain.
            const n = controller.write(CHUNK);
            if (n instanceof Promise) {
              await controller.flush(true);
            }
            writes++;
          }
          await controller.end();
        },
      });
      return new Response(stream);
    },
  });

  const socket = net.connect(server.port!, "127.0.0.1");
  const { promise: stalled, resolve: onStalled, reject: onSocketError } = Promise.withResolvers<void>();
  const { promise: bodyDone, resolve: onBodyDone } = Promise.withResolvers<void>();
  socket.on("error", onSocketError);
  socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
  let received = 0;
  socket.on("data", chunk => {
    received += chunk.length;
  });
  socket.on("close", () => onBodyDone());
  socket.once("data", () => {
    socket.pause();
    onStalled();
  });

  try {
    await stalled;

    // Wait for pull to pause under backpressure.
    let last = -1;
    let stable = 0;
    while (stable < 8 && writes < TOTAL_CHUNKS) {
      await Bun.sleep(25);
      if (writes === last) stable++;
      else {
        stable = 0;
        last = writes;
      }
    }
    expect(writes).toBeLessThan(TOTAL_CHUNKS);

    socket.resume();
    await bodyDone;

    // pull must have been entered exactly once — on drain the sink resolves
    // the flush(true) promise, it must not also re-invoke pull.
    expect(pullEntries).toBe(1);
    expect(writes).toBe(TOTAL_CHUNKS);
    expect(received).toBeGreaterThanOrEqual(TOTAL_CHUNKS * CHUNK.length);
  } finally {
    socket.destroy();
  }
});

// Under backpressure a type:"direct" controller.write() returns a Promise that
// settles once the client drains; awaiting it must suspend pull and resume it
// exactly there, with every chunk delivered once and in order.
it("type: direct controller.write() Promise resolves on drain and resumes pull", async () => {
  const CHUNK = Buffer.alloc(256 * 1024, 71);
  const TOTAL_CHUNKS = 128; // 32 MiB
  let awaited = 0;

  using server = serve({
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            for (let i = 0; i < TOTAL_CHUNKS; i++) {
              const wrote = controller.write(CHUNK);
              if (wrote instanceof Promise) {
                awaited++;
                await wrote;
              }
            }
            await controller.flush();
            controller.close();
          },
        }),
      );
    },
  });

  const socket = net.connect(server.port!, "127.0.0.1");
  const { promise: closed, resolve: onClosed, reject: onSocketError } = Promise.withResolvers<void>();
  socket.on("error", onSocketError);
  socket.on("close", () => onClosed());
  let received = 0;
  socket.on("data", d => (received += d.length));
  socket.on("connect", () => {
    socket.pause();
    socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
  });

  try {
    {
      const t0 = Date.now();
      while (awaited === 0 && Date.now() - t0 < 30000) await Bun.sleep(1);
      expect(awaited).toBeGreaterThan(0);
    }
    // pull is suspended on the drain Promise; releasing the client must
    // resume it and deliver the full body without duplication.
    socket.resume();
    await closed;
    // headers + chunked framing on top; duplication would add >= one CHUNK.
    expect(received).toBeGreaterThanOrEqual(TOTAL_CHUNKS * CHUNK.length);
    expect(received).toBeLessThan(TOTAL_CHUNKS * CHUNK.length + 16 * 1024);
  } finally {
    socket.destroy();
  }
});

// A handler that proxies an upstream response body to a slow client must
// pause the upstream socket instead of buffering the rate difference:
// ByteStream (fetch response) → HttpResponse sink with backpressure.
it.concurrent.each(["chunked", "content-length"] as const)(
  "bounds memory when proxying a %s fetch response body to a stalled client",
  async encoding => {
    const fixture = `
    const net = require("node:net");
    const CHUNK = Buffer.alloc(64 * 1024, 0x47), COUNT = 2048; // 128 MB
    // Upstream: written as fast as the socket accepts it.
    const source = net.createServer(sock => {
      let n = 0;
      if (${JSON.stringify(encoding)} === "chunked") {
        sock.write("HTTP/1.1 200 OK\\r\\ntransfer-encoding: chunked\\r\\nconnection: close\\r\\n\\r\\n");
        const framed = Buffer.concat([Buffer.from("10000\\r\\n"), CHUNK, Buffer.from("\\r\\n")]);
        const pump = () => { while (n < COUNT) { n++; if (!sock.write(framed)) return sock.once("drain", pump); } sock.end("0\\r\\n\\r\\n"); };
        pump();
      } else {
        sock.write("HTTP/1.1 200 OK\\r\\ncontent-length: " + CHUNK.length * COUNT + "\\r\\nconnection: close\\r\\n\\r\\n");
        const pump = () => { while (n < COUNT) { n++; if (!sock.write(CHUNK)) return sock.once("drain", pump); } sock.end(); };
        pump();
      }
    });
    await new Promise(r => source.listen(0, "127.0.0.1", r));

    const proxy = Bun.serve({
      port: 0,
      idleTimeout: 0,
      async fetch() {
        const up = await fetch(\`http://127.0.0.1:\${source.address().port}/\`);
        return new Response(up.body);
      },
    });

    // Downstream client stalls before reading, then drains the whole body.
    let received = 0;
    const { promise: done, resolve } = Promise.withResolvers();
    const client = net.connect(proxy.port, "127.0.0.1", () => {
      client.pause();
      setTimeout(() => client.resume(), 500);
      client.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");
    });
    client.on("data", d => { received += d.length; if (received >= CHUNK.length * COUNT) resolve(); });
    client.on("error", () => {});
    await done;
    client.destroy();
    console.log(JSON.stringify({ received: received >= CHUNK.length * COUNT }));
    process.exit(0);
  `;
    const [fixtureMaxRSS, baselineMaxRSS] = await Promise.all([
      runFixtureMaxRSS(fixture, { received: true }),
      emptyProcessMaxRSS(),
    ]);
    // Without upstream pause the proxy accumulates the whole payload while the
    // client stalls; with it, in-flight bytes are bounded by the socket buffers.
    expect((fixtureMaxRSS - baselineMaxRSS) / 1024 / 1024).toBeLessThan(isASAN || isDebug ? 256 : 96);
  },
  15_000,
);

// Same as the test above but the pull does *not* await flush(true) — it keeps
// writing through backpressure and then parks on an unrelated promise. The
// sink's onWritable drain must not re-invoke pull; a second entry would
// duplicate the already-written bytes into the response body.
it("type: direct stream that ignores backpressure is not re-entered on drain", async () => {
  const CHUNK = Buffer.alloc(256 * 1024, 69);
  const TOTAL_CHUNKS = 128; // 32 MiB — well past any localhost send buffer
  let pullEntries = 0;
  let sawBackpressure = false;
  let parked = false;
  const gate = Promise.withResolvers<void>();

  using server = serve({
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(controller) {
            pullEntries++;
            for (let i = 0; i < TOTAL_CHUNKS; i++) {
              if (controller.write(CHUNK) instanceof Promise) sawBackpressure = true;
              await controller.flush();
            }
            parked = true;
            await gate.promise;
            controller.close();
          },
        }),
      );
    },
  });

  const socket = net.connect(server.port!, "127.0.0.1");
  const { promise: bodyDone, resolve: onBodyDone, reject: onSocketError } = Promise.withResolvers<void>();
  socket.on("error", onSocketError);
  socket.on("close", () => onBodyDone());
  socket.on("connect", () => {
    socket.pause();
    socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
  });

  try {
    // Hold the client paused while pull pushes 32 MiB and parks on `gate`,
    // then drain: onWritable fires while pull is still suspended.
    {
      const t0 = Date.now();
      while (!sawBackpressure && Date.now() - t0 < 30000) await Bun.sleep(1);
      expect(sawBackpressure).toBe(true);
    }
    {
      const t0 = Date.now();
      while (!parked && Date.now() - t0 < 30000) await Bun.sleep(1);
      expect(parked).toBe(true);
    }
    let received = 0;
    socket.on("data", d => (received += d.length));
    socket.resume();
    {
      const t0 = Date.now();
      while (received < TOTAL_CHUNKS * CHUNK.length && Date.now() - t0 < 30000) await Bun.sleep(10);
      expect(received).toBeGreaterThanOrEqual(TOTAL_CHUNKS * CHUNK.length);
    }

    expect(pullEntries).toBe(1);
    gate.resolve();
    await bodyDone;
    expect(pullEntries).toBe(1);
  } finally {
    gate.resolve();
    socket.destroy();
  }
});

// https://github.com/oven-sh/bun/issues/32469
it("applies backpressure to a Response(async generator) body when the client stalls", async () => {
  const CHUNK = Buffer.alloc(64 * 1024, 68);
  const CAP_CHUNKS = 2048;
  let yields = 0;
  let producedEverything = false;

  using server = serve({
    port: 0,
    fetch() {
      async function* body() {
        while (yields < CAP_CHUNKS) {
          yields++;
          yield CHUNK;
        }
        producedEverything = true;
      }
      return new Response(body());
    },
  });

  const socket = net.connect(server.port!, "127.0.0.1");
  const { promise: stalled, resolve: onStalled, reject: onSocketError } = Promise.withResolvers<void>();
  socket.on("error", onSocketError);
  socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n"));
  socket.once("data", () => {
    socket.pause();
    onStalled();
  });

  try {
    await stalled;

    let last = -1;
    let stable = 0;
    while (!producedEverything && stable < 12) {
      await Bun.sleep(25);
      if (yields === last) stable++;
      else {
        stable = 0;
        last = yields;
      }
    }

    expect(producedEverything).toBe(false);
    expect(yields).toBeGreaterThan(0);
    expect(yields).toBeLessThan(CAP_CHUNKS / 2);
  } finally {
    socket.destroy();
  }
});

// https://github.com/oven-sh/bun/issues/32469
it("type: direct stream — small write queued under backpressure is delivered intact after drain", async () => {
  const BIG = Buffer.alloc(512 * 1024, 65);
  const SMALL = Buffer.from("the-tail-marker\n");
  let hitBackpressure = false;

  using server = serve({
    port: 0,
    fetch() {
      const stream = new ReadableStream({
        type: "direct",
        async pull(controller) {
          // Drive the socket into backpressure via the fast path (chunk ≥
          // highWaterMark goes straight to uWS), then queue a small chunk
          // below highWaterMark — it lands in the sink's local buffer while
          // pending_flush is already parked.
          for (let i = 0; i < 256 && !hitBackpressure; i++) {
            const n = controller.write(BIG);
            if (n instanceof Promise) hitBackpressure = true;
          }
          controller.write(SMALL);
          await controller.flush(true);
          await controller.end();
        },
      });
      return new Response(stream);
    },
  });

  const socket = net.connect(server.port!, "127.0.0.1");
  const { promise: stalled, resolve: onStalled, reject: onSocketError } = Promise.withResolvers<void>();
  const { promise: bodyDone, resolve: onBodyDone } = Promise.withResolvers<void>();
  socket.on("error", onSocketError);
  socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
  const chunks: Buffer[] = [];
  socket.on("data", c => chunks.push(c as Buffer));
  socket.on("close", () => onBodyDone());
  socket.once("data", () => {
    socket.pause();
    onStalled();
  });

  try {
    await stalled;
    // Hold the client until the producer has parked on backpressure.
    for (let i = 0; i < 200 && !hitBackpressure; i++) await Bun.sleep(5);
    expect(hitBackpressure).toBe(true);
    socket.resume();
    await bodyDone;

    const body = Buffer.concat(chunks).toString("latin1");
    // on_writable resending from uWS's cumulative write_offset would drop the
    // head of SMALL; it must arrive intact and contiguous.
    expect(body.includes(SMALL.toString("latin1"))).toBe(true);
  } finally {
    socket.destroy();
  }
});

// Aborting an upload mid-body while a req.body.tee() branch is the in-flight
// response body must not crash the server process.
it("survives aborted uploads while responding with a tee()d request-body branch", async () => {
  const script = `
    const net = require("node:net");
    const readAll = async rs => { const rd = rs.getReader(); for (;;) { if ((await rd.read()).done) return; } };
    let seen = 0, settled = 0, notify = () => {};
    const srv = Bun.serve({
      hostname: "127.0.0.1", port: 0, idleTimeout: 0,
      error() { return new Response("err"); },
      async fetch(req) {
        if (!req.body) return new Response("nobody");
        seen++;
        const [a, b] = req.body.tee();
        readAll(b).catch(() => {}).finally(() => { settled++; notify(); });
        return new Response(a);
      },
    });
    const chunk = Buffer.alloc(8192, 66);
    let it = 0;
    for (; it < 40; it++) {
      await new Promise(done => {
        const s = net.connect(srv.port, "127.0.0.1", () => {
          s.write("POST / HTTP/1.1\\r\\nhost: x\\r\\ncontent-length: 262144\\r\\n\\r\\n");
          setImmediate(() => {
            s.write(chunk);
            s.write(chunk);
            s.write(chunk);
            setImmediate(() => { s.destroy(); done(); });
          });
        });
        s.on("data", () => {});
        s.on("error", () => done());
      });
    }
    // One clean request so every aborted connection's header has reached fetch().
    await fetch(srv.url).then(r => r.text());
    // readAll(b) settles only after the tee's source-error reaction has errored branch b,
    // so settled == seen proves every tee reaction for every handled request has run.
    while (settled < seen) await new Promise(r => { notify = r; });
    console.log("SURVIVED", it, seen === settled);
    srv.stop(true);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "SURVIVED 40 true",
    stderr: "",
    exitCode: 0,
    signalCode: null,
  });
});

// A client that half-closes its write side right after the request (the raw
// socket.end(request) pattern) must receive every response byte already handed
// to uWS, not just what the kernel accepted on the first send. No
// Connection: close on the request: the post-drain shutdown is driven by the
// HTTP_NODE_RECEIVED_FIN clause of shouldCloseConnection(), not by
// HTTP_CONNECTION_CLOSE.
describe("a client half-close after the request does not truncate a large response body", () => {
  const BODY = 8 * 1024 * 1024;

  function countBody(socket: net.Socket | nodeTls.TLSSocket) {
    const out = { body: 0, ended: false };
    let head = "";
    let gotHead = false;
    socket.on("data", chunk => {
      if (!gotHead) {
        head += chunk.toString("latin1");
        const i = head.indexOf("\r\n\r\n");
        if (i >= 0) {
          gotHead = true;
          out.body = Buffer.byteLength(head.slice(i + 4), "latin1");
        }
      } else {
        out.body += chunk.length;
      }
    });
    socket.on("end", () => (out.ended = true));
    socket.on("error", () => {});
    return out;
  }

  async function halfCloseRequest(port: number, secure = false): Promise<{ body: number; ended: boolean }> {
    const socket = secure ? nodeTls.connect({ port, host: "127.0.0.1", ca: tls.cert }) : connect(port, "127.0.0.1");
    const out = countBody(socket);
    const closed = new Promise<void>(r => socket.once("close", () => r()));
    await new Promise<void>(r => socket.once(secure ? "secureConnect" : "connect", () => r()));
    socket.end("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await closed;
    return out;
  }

  it("fetch handler (tryEnd tail)", async () => {
    using server = serve({
      port: 0,
      fetch: () => new Response(Buffer.alloc(BODY, "a"), { headers: { "content-length": String(BODY) } }),
    });
    expect(await halfCloseRequest(server.port!)).toEqual({ body: BODY, ended: true });
  });

  it("static route (tryEnd tail)", async () => {
    using server = serve({
      port: 0,
      routes: {
        "/": new Response(Buffer.alloc(BODY, "a"), { headers: { "content-length": String(BODY) } }),
      },
      fetch: () => new Response("miss", { status: 404 }),
    });
    expect(await halfCloseRequest(server.port!)).toEqual({ body: BODY, ended: true });
  });

  it("https fetch handler (tryEnd tail)", async () => {
    using server = serve({
      port: 0,
      tls,
      fetch: () => new Response(Buffer.alloc(BODY, "a"), { headers: { "content-length": String(BODY) } }),
    });
    const socket = nodeTls.connect({ port: server.port, host: "127.0.0.1", rejectUnauthorized: false });
    const out = countBody(socket);
    const closed = new Promise<void>(r => socket.once("close", () => r()));
    await new Promise<void>(r => socket.once("secureConnect", () => r()));
    socket.end("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await closed;
    expect(out).toEqual({ body: BODY, ended: true });
  });

  // Bun sends a file body itself: sendfile() on Linux over plain TCP, read() and write() elsewhere.
  it.each([
    ["fetch handler", false, (path: string) => ({ fetch: () => new Response(file(path)) })],
    ["route", false, (path: string) => ({ routes: { "/": file(path) } })],
    ["https fetch handler", true, (path: string) => ({ tls, fetch: () => new Response(file(path)) })],
  ] as const)("%s (Bun.file() body)", async (_, secure, options) => {
    using dir = tempDir("half-close-file", { "big.bin": Buffer.alloc(BODY, "a") });
    using server = serve({ port: 0, ...options(join(String(dir), "big.bin")) });
    expect(await halfCloseRequest(server.port!, secure)).toEqual({ body: BODY, ended: true });
  });

  it("aborts a Bun.file() body when the peer goes away after its half-close", async () => {
    using dir = tempDir("half-close-file-gone", { "big.bin": Buffer.alloc(BODY, "a") });
    const dispatched = Promise.withResolvers<void>();
    using server = serve({
      port: 0,
      // The idle timeout must not be what ends the request.
      idleTimeout: 60,
      fetch() {
        dispatched.resolve();
        return new Response(file(join(String(dir), "big.bin")));
      },
    });
    const socket = connect(server.port!, "127.0.0.1");
    socket.on("error", () => {});
    await new Promise<void>(r => socket.once("connect", () => r()));
    socket.end("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    socket.once("data", () => socket.destroy());
    await dispatched.promise;
    const deadline = Date.now() + 4000;
    while (server.pendingRequests > 0 && Date.now() < deadline) await Bun.sleep(5);
    expect(server.pendingRequests).toBe(0);
  });

  // The deferred connection must close promptly, not spin the writable
  // dispatch, when the peer goes away mid-drain (tryEnd retry hits EPIPE):
  // half-close to enter the defer, then destroy() on first data. idleTimeout
  // is high so a spin would miss the poll deadline rather than be masked by
  // an idle-timeout close. On platforms whose loopback send buffer swallows
  // the whole body (Windows) there is no tryEnd tail and the response
  // completes before first data; pendingRequests is the portable signal
  // that the connection has closed one way or the other.
  it("closes without spinning when the peer goes away mid-drain", async () => {
    const dispatched = Promise.withResolvers<void>();
    using server = serve({
      port: 0,
      idleTimeout: 60,
      fetch() {
        dispatched.resolve();
        return new Response(Buffer.alloc(BODY, "a"), { headers: { "content-length": String(BODY) } });
      },
    });
    const socket = connect(server.port!, "127.0.0.1");
    socket.on("error", () => {});
    await new Promise<void>(r => socket.once("connect", () => r()));
    socket.end("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    socket.once("data", () => socket.destroy());
    await dispatched.promise;
    const deadline = Date.now() + 4000;
    while (server.pendingRequests > 0 && Date.now() < deadline) await Bun.sleep(5);
    expect(server.pendingRequests).toBe(0);
  });

  // The defer in onEnd is gated on the response being fully determined
  // (HTTP_END_CALLED or a file body). A streaming body the handler is still producing must
  // close on client FIN so onAborted / request.signal fires.
  it("request.signal still fires on client FIN for a streaming body", async () => {
    const aborted = Promise.withResolvers<void>();
    using server = serve({
      port: 0,
      fetch(req) {
        req.signal.addEventListener("abort", () => aborted.resolve());
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("data: hi\n\n"));
            },
            cancel() {},
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    const socket = connect(server.port!, "127.0.0.1");
    const gotData = Promise.withResolvers<void>();
    socket.once("data", () => gotData.resolve());
    socket.on("error", () => {});
    await new Promise<void>(r => socket.once("connect", () => r()));
    socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
    await gotData.promise;
    socket.end();
    await aborted.promise;
    socket.destroy();
  });
});

// The node:http compat parser tolerates empty lines (and a bare CR/LF) before the
// request-line like llhttp's s_start state. That leniency must stay behind the
// node-http flag: Bun.serve still rejects a request that does not begin with the
// request-line.
it.each([
  ["CRLF", "\r\n"],
  ["bare LF", "\n"],
  ["bare CR", "\r"],
])("Bun.serve rejects a leading %s before the request-line", async (_label, prefix) => {
  using server = serve({ port: 0, fetch: () => new Response("ok") });

  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const socket = connect(server.port!, "127.0.0.1", () => {
    socket.write(`${prefix}GET / HTTP/1.1\r\nHost: localhost\r\n\r\n`);
  });
  let received = "";
  socket.on("data", chunk => {
    received += chunk;
  });
  socket.on("error", reject);
  socket.on("close", () => resolve(received));
  const statusLine = (await promise).split("\r\n")[0];
  socket.destroy();

  expect(statusLine).toBe("HTTP/1.1 400 Bad Request");
});

// HTTPServerWritable must stop dequeuing from a JS ReadableStream once uWS reports
// socket backpressure. We observe this by snapshotting how many chunks the server has
// enqueued once the client has consumed only a small prefix: with backpressure the
// producer tracks the consumer + kernel send-buffer; without it the producer drains
// the whole stream into uWS's internal buffer before the client reads anything.
it("applies backpressure to a ReadableStream response while the client drains", async () => {
  const chunk = Buffer.alloc(256 * 1024, 0x61);
  const chunkCount = 64; // 16 MB — well above loopback socket-buffer capacity
  let sent = 0;

  using server = serve({
    port: 0,
    idleTimeout: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(chunk);
            sent++;
            if (sent === chunkCount) controller.close();
          },
        }),
      );
    },
  });

  const response = await fetch(server.url);
  const reader = response.body!.getReader();
  let received = 0;
  let sentAtPartialDrain = -1;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (sentAtPartialDrain < 0 && received >= chunk.byteLength * 4) {
      // Client has consumed 1 MB of 16 MB. Sample the producer's progress.
      sentAtPartialDrain = sent;
    }
  }

  expect(received).toBe(chunk.byteLength * chunkCount);
  expect(sentAtPartialDrain).toBeGreaterThan(0);
  // If the sink ignored backpressure it would have already drained all chunkCount
  // chunks into uWS's buffer by the time the client read 1 MB.
  expect(sentAtPartialDrain).toBeLessThan(chunkCount);
});

describe("the response head doesn't wait for the first body chunk", () => {
  const later = () => new Promise<void>(resolve => setImmediate(resolve));
  type Respond = (req: Request) => Response | Promise<Response>;
  const handlers: Record<string, (respond: Respond) => Respond> = {
    "fetch()": respond => respond,
    "async fetch()": respond => async req => (await later(), respond(req)),
  };
  const x = new TextEncoder().encode("x");
  const kinds: Record<string, (gate: Promise<void>) => Response | Promise<Response>> = {
    "ReadableStream with start()": gate =>
      new Response(
        new ReadableStream({
          start(c) {
            gate.then(() => (c.enqueue(x), c.close()));
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    "ReadableStream with async pull()": gate =>
      new Response(
        new ReadableStream({
          async pull(c) {
            await gate;
            c.enqueue(x);
            c.close();
          },
        }),
      ),
    'ReadableStream with type: "direct"': gate =>
      new Response(
        new ReadableStream({
          type: "direct",
          async pull(c: any) {
            await gate;
            c.write("x");
            c.close();
          },
        } as any),
      ),
    "async generator": gate =>
      new Response(async function* () {
        await gate;
        yield "x";
      } as any),
  };

  describe.each(Object.keys(handlers))("%s", handler => {
    it.concurrent.each(Object.keys(kinds))("%s", async kind => {
      const gate = Promise.withResolvers<void>();
      await using server = Bun.serve({
        port: 0,
        idleTimeout: 0,
        fetch: handlers[handler](() => kinds[kind](gate.promise)),
      });
      const res = await fetch(server.url);
      expect(res.headers.get("transfer-encoding")).toBe("chunked");
      gate.resolve();
      expect(await res.text()).toBe("x");
    });

    it.concurrent("a proxied fetch() whose upstream has only sent its head", async () => {
      const gate = Promise.withResolvers<void>();
      await using upstream = Bun.serve({
        port: 0,
        idleTimeout: 0,
        fetch: () => kinds["ReadableStream with start()"](gate.promise),
      });
      await using server = Bun.serve({
        port: 0,
        idleTimeout: 0,
        fetch: handlers[handler](() => fetch(upstream.url)),
      });
      const res = await fetch(server.url);
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      gate.resolve();
      expect(await res.text()).toBe("x");
    });

    it.concurrent("a body that ends in its first microtask keeps Content-Length", async () => {
      await using server = Bun.serve({
        port: 0,
        fetch: handlers[handler](
          () =>
            new Response(
              new ReadableStream({
                type: "direct",
                async pull(c: any) {
                  await Promise.resolve();
                  c.write("hello");
                  c.close();
                },
              } as any),
            ),
        ),
      });
      const res = await fetch(server.url);
      expect({
        contentLength: res.headers.get("content-length"),
        transferEncoding: res.headers.get("transfer-encoding"),
        body: await res.text(),
      }).toEqual({ contentLength: "5", transferEncoding: null, body: "hello" });
    });

    // An S3 body holds its head until the first byte, so a missing or denied key still reaches error().
    it.concurrent("an S3 download that fails reaches error()", async () => {
      await using bucket = Bun.serve({
        port: 0,
        fetch(req) {
          if (req.url.endsWith("/found")) return new Response("object bytes");
          return new Response(
            `<?xml version="1.0" encoding="UTF-8"?>\n<Error><Code>NoSuchKey</Code><Message>NoSuchKey</Message></Error>`,
            { status: 404, headers: { "Content-Type": "application/xml" } },
          );
        },
      });
      const client = new Bun.S3Client({
        endpoint: `http://127.0.0.1:${bucket.port}`,
        accessKeyId: "id",
        secretAccessKey: "secret",
        bucket: "bucket",
      });
      await using server = Bun.serve({
        port: 0,
        error: (error: Error & { code?: string }) => new Response(`error() got ${error.code}`, { status: 500 }),
        fetch: handlers[handler](req => new Response(client.file(new URL(req.url).pathname.slice(1)).stream())),
      });
      const answers: string[] = [];
      for (const key of ["found", "missing"]) {
        const res = await fetch(new URL(key, server.url));
        answers.push(`${res.status} ${await res.text()}`);
      }
      expect(answers).toEqual(["200 object bytes", "500 error() got NoSuchKey"]);
    });
  });

  it("a graceful stop() right after the body ended still delivers the whole body", async () => {
    const payload = Buffer.alloc(8 * 1024 * 1024, "a");
    const server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch: () =>
        new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller: any) {
              await later();
              controller.write(payload);
              controller.end();
              server.stop();
            },
          } as any),
        ),
    });
    try {
      const res = await fetch(server.url);
      expect((await res.arrayBuffer()).byteLength).toBe(payload.length);
    } finally {
      server.stop(true);
    }
  });
});

// A TLS connection the server accepted before stop() but whose handshake completes afterwards must still
// be served like any connection accepted before a graceful stop — and through a wrapper the server still
// holds strongly. Connections were counted from the end of the handshake, so such a socket was invisible:
// stop() saw the server drained, released the wrapper (and its handlers) to the GC, and the request that
// then arrived dispatched through whatever the GC had left of them.
it("serves a TLS connection whose handshake completes after a graceful stop()", async () => {
  let server: Server<undefined> | null = Bun.serve({ port: 0, tls, fetch: () => new Response("served") });
  const raw = net.connect(server.port!, "127.0.0.1");
  let client: nodeTls.TLSSocket | undefined;
  try {
    await new Promise((res, rej) => (raw.on("connect", res), raw.on("error", rej)));
    // Client→server bytes flow freely; server→client bytes are held until released, so the server has answered
    // the ClientHello and is waiting mid-handshake when stop() runs.
    let hold = true;
    const held: Buffer[] = [];
    const wire = new Duplex({
      read() {},
      write(chunk, enc, cb) {
        raw.write(chunk, cb);
      },
    });
    raw.on("data", d => (hold ? held.push(d as Buffer) : wire.push(d)));
    raw.on("close", () => wire.push(null));
    const c = (client = nodeTls.connect({ socket: wire, rejectUnauthorized: false }));
    c.on("error", () => {});
    for (const t = Date.now(); held.length === 0 && Date.now() - t < 10_000;) await Bun.sleep(5);
    expect(held.length).toBeGreaterThan(0);

    const stopped = server.stop();
    server = null;
    Bun.gc(true);

    hold = false;
    for (const d of held) wire.push(d);
    // Written now, sent once the handshake completes.
    c.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    let response = "";
    await new Promise(res => (c.on("data", d => (response += d)), c.on("end", res), c.on("close", res)));
    expect(response.split("\r\n")[0]).toBe("HTTP/1.1 200 OK");
    expect(response.split("\r\n\r\n")[1]).toBe("served");
    await stopped;
  } finally {
    server?.stop(true);
    client?.destroy();
    raw.destroy();
  }
});

// HTTP/1.1 requests that arrive in one read are dispatched from one onData()
// call. The socket is corked for the whole call. Responses that need no
// JavaScript share one send(), and they leave before the handler of a later
// request runs JavaScript. A response that JavaScript produced leaves when it
// completes.
// RFC 9112 9.3.2: a client can send its next request before the response to the last one. The server
// has one response slot per connection, so it parses that request once the response ahead is out.
describe("requests pipelined behind a pending response", () => {
  const get = (path: string, extraHeaders = "") => `GET ${path} HTTP/1.1\r\nHost: x\r\n${extraHeaders}\r\n`;
  const ok = (body: string) => ({ status: "HTTP/1.1 200 OK", body });
  const echoPath = (req: Request) => new Response(new URL(req.url).pathname);

  // Splits a reply into responses framed by Content-Length.
  function parseResponses(reply: string) {
    const responses: { status: string; body: string }[] = [];
    for (let headEnd: number; (headEnd = reply.indexOf("\r\n\r\n")) !== -1;) {
      const head = reply.slice(0, headEnd);
      const length = Number(/^content-length: (\d+)$/im.exec(head)?.[1] ?? 0);
      if (reply.length < headEnd + 4 + length) break;
      responses.push({
        status: head.slice(0, head.indexOf("\r\n")),
        body: reply.slice(headEnd + 4, headEnd + 4 + length),
      });
      reply = reply.slice(headEnd + 4 + length);
    }
    return responses;
  }

  async function connectRaw(server: Server<undefined>, secure = false) {
    const socket = secure
      ? nodeTls.connect({ port: server.port, host: "127.0.0.1", ca: tls.cert })
      : net.connect(server.port!, "127.0.0.1");
    const client = {
      reply: "",
      closed: false,
      write: (data: string | Uint8Array) => void socket.write(data),
      // Resolves once `done()` returns true, or when the server closes the connection.
      async until(done: () => boolean) {
        while (!client.closed && !done()) await once(socket, "progress");
      },
      untilClosed: () => client.until(() => false),
      async responses(count: number) {
        await client.until(() => parseResponses(client.reply).length >= count);
        return parseResponses(client.reply);
      },
      [Symbol.dispose]: () => void socket.destroy(),
    };
    socket.on("data", chunk => {
      client.reply += chunk.toString("latin1");
      socket.emit("progress");
    });
    socket.on("close", () => {
      client.closed = true;
      socket.emit("progress");
    });
    await once(socket, secure ? "secureConnect" : "connect");
    return client;
  }

  // Answers with the path. A "/hold*" request waits for release(path) first.
  function holdingHandler() {
    const hits: string[] = [];
    const gates = new Map<string, PromiseWithResolvers<void>>();
    const gate = (name: string) => {
      if (!gates.has(name)) gates.set(name, Promise.withResolvers<void>());
      return gates.get(name)!;
    };
    return {
      hits,
      entered: (path: string) => gate("entered " + path).promise,
      release: (path: string) => gate("released " + path).resolve(),
      async fetch(req: Request) {
        const path = new URL(req.url).pathname;
        hits.push(path);
        if (path.startsWith("/hold")) {
          gate("entered " + path).resolve();
          await gate("released " + path).promise;
        }
        return new Response(path);
      },
    };
  }

  // A round trip on another connection. The server has read everything the client wrote before it.
  async function probe(server: Server<undefined>) {
    expect(await (await fetch(new URL("/probe", server.url), { tls: { ca: tls.cert } })).text()).toBe("/probe");
  }

  it.each([
    ["http", false],
    ["https", true],
  ] as const)("dispatches one request at a time, in order (%s)", async (_, secure) => {
    const handler = holdingHandler();
    using server = serve({ port: 0, hostname: "127.0.0.1", tls: secure ? tls : undefined, fetch: handler.fetch });
    using client = await connectRaw(server, secure);
    client.write(get("/hold/1") + get("/hold/2") + get("/last"));
    await Promise.race([handler.entered("/hold/1"), client.untilClosed()]);
    await probe(server);
    expect(handler.hits).toEqual(["/hold/1", "/probe"]);

    handler.release("/hold/1");
    await Promise.race([handler.entered("/hold/2"), client.untilClosed()]);
    await probe(server);
    expect(handler.hits).toEqual(["/hold/1", "/probe", "/hold/2", "/probe"]);

    handler.release("/hold/2");
    expect(await client.responses(3)).toEqual([ok("/hold/1"), ok("/hold/2"), ok("/last")]);
    expect(client.closed).toBe(false);
  });

  it("holds a request that arrives in a later read", async () => {
    const handler = holdingHandler();
    using server = serve({ port: 0, hostname: "127.0.0.1", fetch: handler.fetch });
    using client = await connectRaw(server);
    client.write(get("/hold"));
    await handler.entered("/hold");
    client.write(get("/after"));
    await probe(server);
    expect(handler.hits).toEqual(["/hold", "/probe"]);

    handler.release("/hold");
    expect(await client.responses(2)).toEqual([ok("/hold"), ok("/after")]);
    // The connection reads again.
    client.write(get("/again"));
    expect(await client.responses(3)).toEqual([ok("/hold"), ok("/after"), ok("/again")]);
  });

  // The handler returned, but the body doesn't fit in the socket buffer and is still draining.
  describe.each([
    ["http", false],
    ["https", true],
  ] as const)("delivers a large body whole, then answers the request behind it (%s)", (_, secure) => {
    const big = Buffer.alloc(8 * 1024 * 1024, "x");
    it.each([
      ["Buffer", () => new Response(big)],
      ["Bun.file()", (path: string) => new Response(file(path))],
    ] as const)("%s", async (_, respond) => {
      using dir = tempDir("serve-pipelining", { "big.bin": big });
      using server = serve({
        port: 0,
        hostname: "127.0.0.1",
        tls: secure ? tls : undefined,
        fetch: req => (req.url.endsWith("/big") ? respond(join(String(dir), "big.bin")) : echoPath(req)),
      });
      using client = await connectRaw(server, secure);
      client.write(get("/big") + get("/small"));
      const responses = await client.responses(2);
      expect(responses.map(({ status, body }) => ({ status, length: body.length }))).toEqual([
        { status: "HTTP/1.1 200 OK", length: big.length },
        { status: "HTTP/1.1 200 OK", length: "/small".length },
      ]);
      expect(client.closed).toBe(false);
    });
  });

  it("answers the request behind a streaming response once the stream ends", async () => {
    const streaming = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    const hits: string[] = [];
    using server = serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        hits.push(new URL(req.url).pathname);
        if (!req.url.endsWith("/stream")) return echoPath(req);
        let pulls = 0;
        return new Response(
          new ReadableStream({
            async pull(controller) {
              if (pulls++ === 0) {
                controller.enqueue("first,");
                streaming.resolve();
                return;
              }
              await finish.promise;
              controller.enqueue("second");
              controller.close();
            },
          }),
        );
      },
    });
    using client = await connectRaw(server);
    client.write(get("/stream") + get("/after", "Connection: close\r\n"));
    await Promise.race([streaming.promise, client.untilClosed()]);
    await probe(server);
    expect(hits).toEqual(["/stream", "/probe"]);

    finish.resolve();
    await client.untilClosed();
    expect(hits).toEqual(["/stream", "/probe", "/after"]);
    expect(client.reply).toContain("\r\n\r\n6\r\nfirst,\r\n6\r\nsecond\r\n0\r\n\r\nHTTP/1.1 200 OK\r\n");
    expect(client.reply).toEndWith("\r\n\r\n/after");
  });

  it("gives the body to the handler that is reading it and holds the request behind it", async () => {
    const release = Promise.withResolvers<void>();
    const bodyRead = Promise.withResolvers<void>();
    using server = serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        if (req.method !== "POST") return echoPath(req);
        const body = await req.text();
        bodyRead.resolve();
        await release.promise;
        return new Response("uploaded " + body);
      },
    });
    using client = await connectRaw(server);
    client.write("POST /upload HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\n");
    await probe(server);
    client.write("hello" + get("/after"));
    await Promise.race([bodyRead.promise, client.untilClosed()]);
    await probe(server);
    release.resolve();
    expect(await client.responses(2)).toEqual([ok("uploaded hello"), ok("/after")]);
  });

  it("dispatches a held request with its body, then the request behind that one", async () => {
    const handler = holdingHandler();
    using server = serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        if (req.method !== "POST") return handler.fetch(req);
        // One event loop turn, so "/last" is held a second time.
        await new Promise(resolve => setImmediate(resolve));
        return new Response("uploaded " + (await req.text()));
      },
    });
    using client = await connectRaw(server);
    client.write(get("/hold") + "POST /upload HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nhello" + get("/last"));
    await Promise.race([handler.entered("/hold"), client.untilClosed()]);
    await probe(server);
    handler.release("/hold");
    expect(await client.responses(3)).toEqual([ok("/hold"), ok("uploaded hello"), ok("/last")]);
  });

  // The parser reports no end of message for this head, so the decision to hold can't depend on that report.
  it("holds a request behind a Content-Length: 0 head that was split across reads", async () => {
    const handler = holdingHandler();
    using server = serve({ port: 0, hostname: "127.0.0.1", fetch: handler.fetch });
    using client = await connectRaw(server);
    client.write("POST /hold HTTP/1.1\r\nHost: x\r\nContent-Le");
    await probe(server);
    client.write("ngth: 0\r\n\r\n" + get("/after"));
    await Promise.race([handler.entered("/hold"), client.untilClosed()]);
    await probe(server);
    expect(handler.hits).toEqual(["/probe", "/hold", "/probe"]);
    handler.release("/hold");
    expect(await client.responses(2)).toEqual([ok("/hold"), ok("/after")]);
  });

  it("sends the error response for a malformed held request after the response ahead of it", async () => {
    const handler = holdingHandler();
    using server = serve({ port: 0, hostname: "127.0.0.1", fetch: handler.fetch });
    using client = await connectRaw(server);
    client.write(get("/hold") + "GET /bad HTTP/9.9\r\nHost: x\r\n\r\n");
    await Promise.race([handler.entered("/hold"), client.untilClosed()]);
    await probe(server);
    handler.release("/hold");
    await client.untilClosed();
    expect(parseResponses(client.reply)).toEqual([
      ok("/hold"),
      { status: "HTTP/1.1 505 HTTP Version Not Supported", body: "" },
    ]);
  });

  it("drops a held request when the response ahead of it closes the connection", async () => {
    const handler = holdingHandler();
    using server = serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        const response = await handler.fetch(req);
        response.headers.set("Connection", "close");
        return response;
      },
    });
    using client = await connectRaw(server);
    client.write(get("/hold") + get("/never"));
    await Promise.race([handler.entered("/hold"), client.untilClosed()]);
    await probe(server);
    handler.release("/hold");
    await client.untilClosed();
    expect({ hits: handler.hits, responses: parseResponses(client.reply) }).toEqual({
      hits: ["/hold", "/probe"],
      responses: [ok("/hold")],
    });
  });

  it("answers a held request before a graceful stop() closes the connection", async () => {
    const handler = holdingHandler();
    using server = serve({ port: 0, hostname: "127.0.0.1", fetch: handler.fetch });
    using client = await connectRaw(server);
    client.write(get("/hold") + get("/after"));
    await Promise.race([handler.entered("/hold"), client.untilClosed()]);
    await probe(server);
    const stopped = server.stop();
    handler.release("/hold");
    await client.untilClosed();
    await stopped;
    expect(parseResponses(client.reply)).toEqual([ok("/hold"), ok("/after")]);
  });

  it("closes a connection the client reset before the response ahead was sent", async () => {
    let socket!: net.Socket;
    using server = serve({
      port: 0,
      hostname: "127.0.0.1",
      idleTimeout: 0,
      async fetch() {
        // "/after" is held by now. The reset lands before the loop polls again, so the response's send() is what fails.
        await new Promise(resolve => setImmediate(resolve));
        socket.resetAndDestroy();
        return new Response("late");
      },
    });
    socket = net.connect(server.port!, "127.0.0.1");
    await once(socket, "connect");
    socket.write(get("/first") + get("/after"));
    await once(socket, "close");
    // A graceful stop() waits for every connection to close.
    await server.stop();
  });

  it("aborts the pending request when the client leaves with a request held behind it", async () => {
    const hits: string[] = [];
    const entered = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    using server = serve({
      port: 0,
      hostname: "127.0.0.1",
      idleTimeout: 0,
      async fetch(req) {
        hits.push(new URL(req.url).pathname);
        req.signal.addEventListener("abort", () => aborted.resolve());
        entered.resolve();
        await aborted.promise;
        return new Response("late");
      },
    });
    const socket = net.connect(server.port!, "127.0.0.1");
    await once(socket, "connect");
    socket.write(get("/first") + get("/after"));
    await entered.promise;
    socket.end();
    await Promise.all([aborted.promise, once(socket, "close")]);
    expect(hits).toEqual(["/first"]);
  });

  it("upgrades a held WebSocket request and gives it the frame behind the handshake", async () => {
    const handler = holdingHandler();
    using server = serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: (req, server) => (req.url.endsWith("/ws") && server.upgrade(req) ? undefined : handler.fetch(req)),
      websocket: { message: (ws, message) => void ws.send(message) },
    });
    using client = await connectRaw(server);
    // A masked text frame: "hi".
    const frame = Buffer.from([0x81, 0x82, 1, 2, 3, 4, 0x68 ^ 1, 0x69 ^ 2]).toString("latin1");
    client.write(
      Buffer.from(
        get("/hold") +
          get(
            "/ws",
            "Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n",
          ) +
          frame,
        "latin1",
      ),
    );
    await Promise.race([handler.entered("/hold"), client.untilClosed()]);
    await probe(server);
    handler.release("/hold");
    await client.until(() => client.reply.endsWith("\x81\x02hi"));
    expect(client.reply.match(/HTTP\/1\.1 [^\r]*/g)).toEqual(["HTTP/1.1 200 OK", "HTTP/1.1 101 Switching Protocols"]);
    expect(client.reply).toEndWith("\r\n\r\n\x81\x02hi");
  });
});

describe("requests pipelined in one read", () => {
  const get = (path: string, extraHeaders = "") => `GET ${path} HTTP/1.1\r\nHost: x\r\n${extraHeaders}\r\n`;

  // Writes `payload` in one write. Collects the reply until `complete(reply)` or the peer closes.
  function exchange(
    connect: (onConnect: () => void) => net.Socket,
    payload: string,
    complete: (reply: string) => boolean = () => false,
  ) {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    let reply = "";
    const socket = connect(() => socket.write(payload));
    socket.on("data", chunk => {
      reply += chunk.toString("latin1");
      if (complete(reply)) socket.destroy();
    });
    socket.on("error", reject);
    socket.on("close", () => resolve(reply));
    return promise;
  }
  const plain = (port: number) => (onConnect: () => void) => net.connect(port, "127.0.0.1", onConnect);

  function parseResponses(reply: string) {
    const responses: { status: string; body: string }[] = [];
    while (reply.length) {
      const headEnd = reply.indexOf("\r\n\r\n");
      if (headEnd === -1) {
        responses.push({ status: "incomplete head", body: reply });
        break;
      }
      const head = reply.slice(0, headEnd);
      const length = Number(/^content-length: (\d+)$/im.exec(head)?.[1] ?? 0);
      responses.push({
        status: head.slice(0, head.indexOf("\r\n")),
        body: reply.slice(headEnd + 4, headEnd + 4 + length),
      });
      reply = reply.slice(headEnd + 4 + length);
    }
    return responses;
  }

  const echoPath = (req: Request) => new Response(new URL(req.url).pathname);

  // Each send() is one TCP segment on loopback (TCP_NODELAY). The client counts
  // the segments with TCP_INFO. A handler that runs JavaScript first sends the
  // responses completed before it, and its own response leaves when it
  // completes. Responses that need no JavaScript (static routes) collect until
  // a handler runs JavaScript, or until the read is consumed.
  it.skipIf(!isLinux && !isAndroid)("share one send() until a handler runs JavaScript", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          import { dlopen, ptr } from "bun:ffi";
          const libc = dlopen(${JSON.stringify(libcPathForDlopen())}, {
            getsockopt: { args: ["int", "int", "int", "ptr", "ptr"], returns: "int" },
          });
          // struct tcp_info: tcpi_data_segs_in is a u32 at byte 152 (linux/tcp.h, since 4.6).
          function dataSegmentsIn(fd) {
            const info = new Uint8Array(280);
            const len = new Uint32Array([info.length]);
            if (libc.symbols.getsockopt(fd, 6 /* IPPROTO_TCP */, 11 /* TCP_INFO */, ptr(info), ptr(len)) !== 0) {
              throw new Error("getsockopt(TCP_INFO) failed");
            }
            if (len[0] < 156) throw new Error("tcp_info has no tcpi_data_segs_in: " + len[0] + " bytes");
            return new DataView(info.buffer).getUint32(152, true);
          }
          const request = path => "GET " + path + " HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n";
          async function run(options, paths = ["/", "/", "/", "/", "/", "/", "/", "/"]) {
            const server = Bun.serve({ port: 0, hostname: "127.0.0.1", ...options });
            const done = Promise.withResolvers();
            let reply = "";
            const responses = () => reply.split("HTTP/1.1 200 OK").length - 1;
            const socket = await Bun.connect({
              hostname: "127.0.0.1",
              port: server.port,
              socket: {
                open(socket) {
                  socket.write(paths.map(request).join(""));
                },
                data(socket, chunk) {
                  reply += chunk.toString("latin1");
                  if (responses() === paths.length && reply.endsWith("hello")) done.resolve();
                },
                error(socket, error) {
                  done.reject(error);
                },
                close() {
                  done.resolve();
                },
              },
            });
            await done.promise;
            const result = { responses: responses(), segments: dataSegmentsIn(socket.fd) };
            socket.end();
            server.stop(true);
            return result;
          }
          // The 413 for a body over maxRequestBodySize runs no JavaScript.
          async function runTooLarge() {
            const server = Bun.serve({
              port: 0,
              hostname: "127.0.0.1",
              maxRequestBodySize: 1024,
              fetch: () => new Response("hello"),
            });
            const done = Promise.withResolvers();
            let reply = "";
            let segments = 0;
            await Bun.connect({
              hostname: "127.0.0.1",
              port: server.port,
              socket: {
                open(socket) {
                  socket.write(
                    "POST / HTTP/1.1\\r\\nHost: x\\r\\nExpect: 100-continue\\r\\nContent-Length: 2000000\\r\\n\\r\\n",
                  );
                },
                data(socket, chunk) {
                  reply += chunk.toString("latin1");
                  segments = dataSegmentsIn(socket.fd);
                },
                error(socket, error) {
                  done.reject(error);
                },
                close() {
                  done.resolve();
                },
              },
            });
            await done.promise;
            server.stop(true);
            return { statuses: reply.split("\\r\\n").filter(line => line.startsWith("HTTP/1.1 ")), segments };
          }
          console.log(JSON.stringify({
            fetch: await run({ fetch: () => new Response("hello", { headers: { "X-Custom": "1" } }) }),
            route: await run({ routes: { "/": () => new Response("hello") } }),
            static: await run({ routes: { "/": new Response("hello") } }),
            // One send() before each "/js" handler, one for its response, and one when the read is consumed:
            // [static static static] [js] [static static] [js] [static]
            mixed: await run(
              { routes: { "/static": new Response("hello"), "/js": () => new Response("hello") } },
              ["/static", "/static", "/static", "/js", "/static", "/static", "/js", "/static"],
            ),
            tooLarge: await runTooLarge(),
          }));
        `,
      ],
      env: bunEnv,
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ result: stdout.trim() ? JSON.parse(stdout) : stdout, exitCode }).toEqual({
      result: {
        fetch: { responses: 8, segments: 8 },
        route: { responses: 8, segments: 8 },
        static: { responses: 8, segments: 1 },
        mixed: { responses: 8, segments: 5 },
        tooLarge: { statuses: ["HTTP/1.1 413 Request Entity Too Large"], segments: 1 },
      },
      exitCode: 0,
    });
  });

  // On Windows the exit resets the connection (the client reads ECONNRESET), and
  // the reset can discard what the client has not read yet.
  it.skipIf(isWindows)("delivers the completed responses when a later handler ends the process", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const server = Bun.serve({
            port: 0,
            hostname: "127.0.0.1",
            routes: { "/static": new Response("/static") },
            fetch(req) {
              const { pathname } = new URL(req.url);
              if (pathname === "/exit") process.exit(0);
              return new Response(pathname);
            },
          });
          console.log(server.port);
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    let stdout = "";
    for await (const chunk of proc.stdout) {
      stdout += Buffer.from(chunk).toString();
      if (stdout.includes("\n")) break;
    }
    // The static response needs no JavaScript. It is still in the cork buffer when "/exit" is dispatched.
    const reply = await exchange(plain(Number(stdout)), get("/a") + get("/static") + get("/exit"));
    expect(parseResponses(reply)).toEqual([
      { status: "HTTP/1.1 200 OK", body: "/a" },
      { status: "HTTP/1.1 200 OK", body: "/static" },
    ]);
    expect(await proc.exited).toBe(0);
  });

  it("sends the completed responses before a later handler blocks", async () => {
    // The "/wait" handler blocks the server's thread until the client has the
    // responses before it, so the server runs in a worker.
    using dir = tempDir("serve-pipelined-blocked-handler", {
      "server.mjs": `
        import { parentPort, workerData as released } from "node:worker_threads";
        const server = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          routes: { "/static": new Response("/static") },
          fetch(req) {
            const { pathname } = new URL(req.url);
            if (pathname !== "/wait") return new Response(pathname);
            return new Response(Atomics.wait(released, 0, 0, 2000) === "timed-out" ? "timed-out" : "released");
          },
        });
        parentPort.postMessage(server.port);
      `,
    });
    const released = new Int32Array(new SharedArrayBuffer(4));
    const worker = new Worker(join(String(dir), "server.mjs"), { workerData: released });
    try {
      const [port] = await once(worker, "message");
      // The static response needs no JavaScript. It is still in the cork buffer when "/wait" is dispatched.
      const reply = await exchange(
        plain(port),
        get("/a") + get("/static") + get("/wait", "Connection: close\r\n"),
        reply => {
          if (parseResponses(reply).length >= 2 && reply.includes("\r\n\r\n/static")) {
            Atomics.store(released, 0, 1);
            Atomics.notify(released, 0);
          }
          return false;
        },
      );
      expect(parseResponses(reply)).toEqual([
        { status: "HTTP/1.1 200 OK", body: "/a" },
        { status: "HTTP/1.1 200 OK", body: "/static" },
        { status: "HTTP/1.1 200 OK", body: "released" },
      ]);
    } finally {
      await worker.terminate();
    }
  });

  // One request, no pipelining. Its body arrives with it, so the handler resumes from the
  // body callback and the response completes inside onData(). The work that the handler
  // leaves behind runs after that, before onData() returns.
  const postJson = `POST / HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 7\r\n\r\n{"a":1}`;
  // More awaits than the handler's promise needs to reach the server, so that the
  // response is complete when the last one resumes.
  const trailingWork = (work: string) => `
    async function trailing() {
      for (let i = 0; i < 4; i++) await null;
      ${work}
    }
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      async fetch(req) {
        await req.json();
        trailing();
        return new Response("accepted", { status: 202 });
      },
    });
  `;

  it("sends a response before the JavaScript that runs after it", async () => {
    // The trailing work blocks the server's thread until the client has the
    // response, so the server runs in a worker.
    using dir = tempDir("serve-response-before-trailing-js", {
      "server.mjs": `
        import { parentPort, workerData as received } from "node:worker_threads";
        ${trailingWork(`parentPort.postMessage(Atomics.wait(received, 0, 0, 2000) === "timed-out" ? "timed-out" : "released");`)}
        parentPort.postMessage(server.port);
      `,
    });
    const received = new Int32Array(new SharedArrayBuffer(4));
    const worker = new Worker(join(String(dir), "server.mjs"), { workerData: received });
    try {
      const messages = on(worker, "message");
      const [port] = (await messages.next()).value!;
      const reply = await exchange(plain(port), postJson, reply => {
        if (!reply.endsWith("accepted")) return false;
        Atomics.store(received, 0, 1);
        Atomics.notify(received, 0);
        return true;
      });
      const [outcome] = (await messages.next()).value!;
      expect({ responses: parseResponses(reply), outcome }).toEqual({
        responses: [{ status: "HTTP/1.1 202 Accepted", body: "accepted" }],
        outcome: "released",
      });
    } finally {
      await worker.terminate();
    }
  });

  // Skipped on Windows for the same reason as the test above that ends the process.
  it.skipIf(isWindows)("delivers a response when the JavaScript that runs after it ends the process", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", `${trailingWork("process.exit(0);")} console.log(server.port);`],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    let stdout = "";
    for await (const chunk of proc.stdout) {
      stdout += Buffer.from(chunk).toString();
      if (stdout.includes("\n")) break;
    }
    const reply = await exchange(plain(Number(stdout)), postJson);
    expect(parseResponses(reply)).toEqual([{ status: "HTTP/1.1 202 Accepted", body: "accepted" }]);
    expect(await proc.exited).toBe(0);
  });

  // The tests below pass without the batching too. They cover the paths that
  // have to send the cork buffer before they close or hand over the socket.

  it("keeps the order when a response is larger than the cork buffer", async () => {
    // Twice the 16 KB cork buffer.
    const big = Buffer.alloc(32 * 1024, "b").toString();
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: req => (req.url.endsWith("/big") ? new Response(big) : echoPath(req)),
    });
    const reply = await exchange(
      plain(server.port!),
      get("/a") + get("/b") + get("/big") + get("/c") + get("/d", "Connection: close\r\n"),
    );
    const ok = "HTTP/1.1 200 OK";
    expect(parseResponses(reply)).toEqual([
      { status: ok, body: "/a" },
      { status: ok, body: "/b" },
      { status: ok, body: big },
      { status: ok, body: "/c" },
      { status: ok, body: "/d" },
    ]);
  });

  it("keeps the order over TLS", async () => {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", tls, fetch: echoPath });
    const reply = await exchange(
      onConnect => nodeTls.connect({ port: server.port, host: "127.0.0.1", rejectUnauthorized: false }, onConnect),
      get("/a") + get("/b") + get("/c", "Connection: close\r\n"),
    );
    const ok = "HTTP/1.1 200 OK";
    expect(parseResponses(reply)).toEqual([
      { status: ok, body: "/a" },
      { status: ok, body: "/b" },
      { status: ok, body: "/c" },
    ]);
  });

  it("sends the completed responses before the response to a malformed request", async () => {
    using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: echoPath });
    // The third request has no Host header.
    const reply = await exchange(plain(server.port!), get("/a") + get("/b") + "GET /c HTTP/1.1\r\n\r\n");
    expect(parseResponses(reply)).toEqual([
      { status: "HTTP/1.1 200 OK", body: "/a" },
      { status: "HTTP/1.1 200 OK", body: "/b" },
      { status: "HTTP/1.1 400 Bad Request", body: "" },
    ]);
  });

  it("sends the completed responses while a request waits behind a pending response", async () => {
    const pending = Promise.withResolvers<Response>();
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: req => (req.url.endsWith("/pending") ? pending.promise : echoPath(req)),
    });
    try {
      const reply = await exchange(
        plain(server.port!),
        get("/a") + get("/b") + get("/pending") + get("/c"),
        reply => parseResponses(reply).length >= 2 && reply.endsWith("/b"),
      );
      expect(parseResponses(reply)).toEqual([
        { status: "HTTP/1.1 200 OK", body: "/a" },
        { status: "HTTP/1.1 200 OK", body: "/b" },
      ]);
    } finally {
      pending.resolve(new Response("late"));
    }
  });

  it("sends the completed responses before the 101 of a WebSocket upgrade", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        if (req.url.endsWith("/ws")) {
          if (server.upgrade(req)) return;
          return new Response("upgrade failed", { status: 500 });
        }
        return echoPath(req);
      },
      websocket: {
        open(ws) {
          ws.send("hello");
        },
        message() {},
      },
    });
    const frame = "\x81\x05hello";
    const reply = await exchange(
      plain(server.port!),
      get("/a") +
        get(
          "/ws",
          "Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n",
        ),
      reply => reply.endsWith(frame),
    );
    const [first, ...rest] = reply.split("HTTP/1.1 ");
    expect(first).toBe("");
    expect(rest.map(part => part.slice(0, part.indexOf("\r\n")))).toEqual(["200 OK", "101 Switching Protocols"]);
    expect(rest[0]).toEndWith("\r\n\r\n/a");
    expect(rest[1]).toEndWith("\r\n\r\n" + frame);
  });

  it("sends the completed responses before an upgrade that open() terminates", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        if (req.url.endsWith("/ws")) {
          if (server.upgrade(req)) return;
          return new Response("upgrade failed", { status: 500 });
        }
        return echoPath(req);
      },
      websocket: {
        open(ws) {
          ws.terminate();
        },
        message() {},
      },
    });
    const reply = await exchange(
      plain(server.port!),
      get("/a") +
        get("/b") +
        get(
          "/ws",
          "Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n",
        ),
    );
    expect(parseResponses(reply).slice(0, 2)).toEqual([
      { status: "HTTP/1.1 200 OK", body: "/a" },
      { status: "HTTP/1.1 200 OK", body: "/b" },
    ]);
  });

  it("sends the completed response before a graceful stop() closes the idle connection", async () => {
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req, server) {
        // The response completes before the body arrives. That rejects this
        // read, and its handler runs before onData uncorks.
        req.text().catch(() => server.stop());
        return new Response("done");
      },
    });
    const reply = await exchange(plain(server.port!), "POST / HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\n");
    expect(parseResponses(reply)).toEqual([{ status: "HTTP/1.1 200 OK", body: "done" }]);
  });

  // RFC 9112 9.6: a response that carries Connection: close is the last one on its connection.
  // The request head does not show that, so the parser latch for a Connection: close request
  // ("does not dispatch a pipelined request after Connection: close") does not cover it.
  describe("does not run the requests behind a response that closes the connection", () => {
    const secure = (port: number) => (onConnect: () => void) =>
      nodeTls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false }, onConnect);
    const close = { headers: { Connection: "close" } };
    const post = (path: string) => `POST ${path} HTTP/1.1\r\nHost: x\r\nContent-Length: 5\r\n\r\nhello`;
    const lastChunk = "0\r\n\r\n";
    // Larger than a socket buffer, so the first write can't finish the response.
    const big = Buffer.alloc(8 * 1024 * 1024, "x");
    big.write("END!", big.length - 4);

    // `payload` ends with the request whose response closes. Two more requests follow it.
    // `end` is the tail of that response. The client must receive all of it.
    it.each([
      { name: "at the start of the read", payload: get("/close"), ran: ["/close"], end: "/close" },
      { name: "in the middle of the read", payload: get("/a") + get("/close"), ran: ["/a", "/close"], end: "/close" },
      {
        name: "in the middle of the read, over TLS",
        payload: get("/a") + get("/close"),
        ran: ["/a", "/close"],
        end: "/close",
        options: { tls },
        connect: secure,
      },
      // The paths below complete the response outside the request handler call.
      { name: "completed by the request body", payload: get("/a") + post("/body"), ran: ["/a", "/body"], end: "/body" },
      { name: "with a stream body", payload: get("/a") + get("/stream"), ran: ["/a", "/stream"], end: "/stream" },
      { name: "without a body", payload: get("/a") + get("/204"), ran: ["/a", "/204"], end: "\r\n\r\n" },
      // The responses below are still in flight when the server reaches the next request in the read.
      {
        name: "with a stream that is still open",
        payload: get("/a") + get("/open"),
        ran: ["/a", "/open"],
        end: lastChunk,
      },
      { name: "larger than the socket buffer", payload: get("/a") + get("/big"), ran: ["/a", "/big"], end: "END!" },
      {
        name: "with a file larger than the socket buffer",
        payload: get("/a") + get("/file"),
        ran: ["/a", "/file"],
        end: "END!",
        file: true,
      },
    ])("$name", async ({ payload, ran: expected, end, file = false, options = {}, connect = plain }) => {
      using dir = file ? tempDir("serve-closing-file", { "big.bin": big }) : undefined;
      const ran: string[] = [];
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        ...options,
        fetch(req) {
          const { pathname } = new URL(req.url);
          ran.push(pathname);
          switch (pathname) {
            case "/close":
              return new Response(pathname, close);
            case "/body":
              return req.text().then(() => new Response(pathname, close));
            case "/stream":
              return new Response(
                new ReadableStream({
                  start(controller) {
                    controller.enqueue(pathname);
                    controller.close();
                  },
                }),
                close,
              );
            case "/204":
              return new Response(null, { status: 204, ...close });
            case "/open":
              return new Response(
                new ReadableStream({
                  async start(controller) {
                    controller.enqueue(pathname);
                    await new Promise(resolve => setImmediate(resolve));
                    controller.close();
                  },
                }),
                close,
              );
            case "/big":
              return new Response(big, close);
            case "/file":
              return new Response(Bun.file(join(String(dir), "big.bin")), close);
            default:
              return new Response(pathname);
          }
        },
      });
      const responses = (reply: string) => reply.split("HTTP/1.1 ").length - 1;
      // Resolves when the server closes. One response too many ends a small reply early.
      const reply = await exchange(
        connect(server.port!),
        payload + get("/b") + get("/c"),
        reply => reply.length < 4096 && responses(reply) > expected.length,
      );
      expect({ ran, responses: responses(reply), end: reply.slice(-end.length) }).toEqual({
        ran: expected as any,
        responses: expected.length,
        end,
      });
    });

    // Nothing behind that response is parsed, so what isn't a request gets no error response either.
    it.each([
      ["a request line with a bad version", "GET /b http/1.1\r\nHost: x\r\n\r\n"],
      ["bytes that are no request", "JUNK\r\n\r\n"],
      ["a request with no Host", "GET /b HTTP/1.1\r\n\r\n"],
    ])("sends nothing for %s", async (_name, behind) => {
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: req => new Response(new URL(req.url).pathname, close),
      });
      const reply = await exchange(plain(server.port!), get("/close") + behind);
      expect(reply.match(/HTTP\/1\.1 [^\r]*/g)).toEqual(["HTTP/1.1 200 OK"]);
      expect(reply).toEndWith("\r\n\r\n/close");
    });

    // close(2) over unread input resets the connection, and the client then loses the response or fails its next write.
    it("lets the client finish an upload that the closing response didn't wait for", async () => {
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () => new Response("refused", { status: 400, ...close }),
      });
      const chunk = Buffer.alloc(64 * 1024, "u");
      const chunks = 64;
      const client = net.connect(server.port!, "127.0.0.1");
      const errors: string[] = [];
      client.on("error", error => errors.push((error as NodeJS.ErrnoException).code!));
      const closed = once(client, "close");
      let reply = "";
      const replied = Promise.withResolvers<void>();
      client.on("data", data => {
        reply += data.toString("latin1");
        if (reply.endsWith("refused")) replied.resolve();
      });
      closed.then(() => replied.resolve());
      client.write(`POST / HTTP/1.1\r\nHost: x\r\nContent-Length: ${chunk.length * chunks}\r\n\r\n`);
      await replied.promise;
      // The server has sent its FIN by now. It still takes the rest of the body.
      for (let i = 0; i < chunks && !client.destroyed; i++) {
        if (!client.write(chunk)) await Promise.race([once(client, "drain"), closed]);
      }
      client.end();
      const [hadError] = await closed;
      expect({ status: reply.slice(0, 12), errors, hadError }).toEqual({
        status: "HTTP/1.1 400",
        errors: [],
        hadError: false,
      });
    });
  });
});

// The server keeps a refused connection open until the client has closed its side. The request doesn't wait for that.
describe("a body read fails as soon as the request is refused", () => {
  const readers = {
    "text()": (req: Request) => req.text(),
    "json()": (req: Request) => req.json(),
    "arrayBuffer()": (req: Request) => req.arrayBuffer(),
    "a reader": async (req: Request) => {
      const reader = req.body!.getReader();
      while (!(await reader.read()).done);
    },
    "for await": async (req: Request) => {
      for await (const _ of req.body!);
    },
    "no read, only req.signal": (req: Request) =>
      new Promise((_, reject) => req.signal.addEventListener("abort", () => reject(req.signal.reason))),
  };
  const long = Buffer.alloc(40_000, "a").toString();
  const refusals = {
    "400": "zz\r\n",
    "400 behind a chunk": "5\r\nhelloXX",
    "400 at the end of the body": "0\r\nno colon\r\n\r\n",
    "431": `0\r\nx-a: ${long}\r\n\r\n`,
    "413": `5;${long}\r\nhello\r\n`,
  };

  async function refuse(read: (req: Request) => Promise<unknown>, rest: string, secure: boolean) {
    const reading = Promise.withResolvers<void>();
    let outcome: string | undefined;
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      tls: secure ? tls : undefined,
      idleTimeout: 0,
      async fetch(req) {
        const pending = read(req);
        reading.resolve();
        outcome = await pending.then(
          () => "resolved",
          error => error.name,
        );
        return new Response();
      },
    });
    const options = { port: server.port!, host: "127.0.0.1", allowHalfOpen: true };
    const client = secure ? nodeTls.connect({ ...options, ca: tls.cert }) : net.connect(options);
    let closed = false;
    let reply = "";
    client.on("error", () => {});
    client.on("close", () => (closed = true));
    client.on("data", data => (reply += data.toString("latin1")));
    try {
      client.write("POST / HTTP/1.1\r\nHost: x\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n");
      await reading.promise;
      client.write(rest);
      // The client has the server's answer and its FIN, and hasn't closed its own side.
      await once(client, "end");
      const settledAtTheRefusal = outcome;
      while (server.pendingRequests > 0) await new Promise(setImmediate);
      return { status: reply.slice(9, 12), outcome: settledAtTheRefusal, closed };
    } finally {
      client.destroy();
    }
  }

  describe.each(["http", "https"])("over %s", protocol => {
    it.concurrent.each(Object.keys(readers) as (keyof typeof readers)[])("%s", async reader => {
      expect(await refuse(readers[reader], refusals["400"], protocol === "https")).toEqual({
        status: "400",
        outcome: "AbortError",
        closed: false,
      });
    });
  });

  it.concurrent.each(Object.keys(refusals) as (keyof typeof refusals)[])("with %s", async refusal => {
    expect(await refuse(readers["text()"], refusals[refusal], false)).toEqual({
      status: refusal.slice(0, 3),
      outcome: "AbortError",
      closed: false,
    });
  });
});

it("survives a handler that import()s a request path longer than the path buffer", async () => {
  // Joined to the routes directory, this is longer than the path buffer but shorter than the specifier length that
  // import() rejects up front. A request line is too short to overflow a Windows path buffer.
  const pathLength = isWindows ? 4090 : MAX_PATH_BYTES - 6;
  using dir = tempDir("serve-import-request-path", {
    "routes/hello.js": `export default "hello";`,
    "server.js": `
      import { join } from "node:path";
      const ROOT = join(import.meta.dir, "routes");
      using server = Bun.serve({
        port: 0,
        async fetch(req) {
          try {
            const route = await import(join(ROOT, new URL(req.url).pathname));
            return new Response(route.default);
          } catch {
            return new Response("no such route", { status: 404 });
          }
        },
      });
      const long = await fetch(new URL("/" + Buffer.alloc(${pathLength}, "a").toString(), server.url));
      const good = await fetch(new URL("/hello.js", server.url));
      console.log(JSON.stringify({ long: long.status, good: [good.status, await good.text()] }));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify({ long: 404, good: [200, "hello"] }),
    stderr: "",
    exitCode: 0,
  });
});

// node:http reads "close" from Proxy-Connection too, like llhttp. That is not a Bun.serve default.
it("Proxy-Connection: close does not end a Bun.serve connection", async () => {
  using server = serve({ port: 0, fetch: req => new Response(new URL(req.url).pathname) });
  const socket = connect(server.port!, "127.0.0.1");
  try {
    let received = "";
    socket.write(
      "GET /a HTTP/1.1\r\nHost: x\r\nProxy-Connection: close\r\n\r\nGET /b HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n",
    );
    socket.on("data", chunk => (received += chunk));
    await once(socket, "close");
    expect(received.match(/\r\n\r\n\/[ab]/g)).toEqual(["\r\n\r\n/a", "\r\n\r\n/b"]);
  } finally {
    socket.destroy();
  }
});

// The default error path prints the thrown value with the native formatter, and the client controls its shape.
it("keeps serving after a handler throws a deeply nested request body", async () => {
  using dir = tempDir("serve-throw-deep-array", {});
  // A file, not a pipe. Without the formatter's depth cap this request prints hundreds of MB.
  const errPath = join(String(dir), "stderr.log");
  const script = `
    using server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      development: false,
      async fetch(req) {
        if (req.method === "GET") return new Response("pong");
        throw await req.json();
      },
    });
    const body = Buffer.alloc(50_000, "[").toString() + Buffer.alloc(50_000, "]").toString();
    const res = await fetch(server.url, { method: "POST", body });
    const ping = await fetch(server.url);
    console.log(JSON.stringify({ status: res.status, ping: await ping.text() }));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: Bun.file(errPath),
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout.trim()).toBe(JSON.stringify({ status: 500, ping: "pong" }));
  const printed = readFileSync(errPath, "utf8");
  expect(printed.length).toBeLessThan(64 * 1024);
  expect(printed).toContain("[Array ...]");
  // An error that reached the default handler sets the exit code.
  expect(exitCode).toBe(1);
});

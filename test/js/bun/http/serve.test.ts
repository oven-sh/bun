import { file, gc, Serve, serve, Server } from "bun";
import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import {
  bunEnv,
  bunExe,
  dumpStats,
  isBroken,
  isIntelMacOS,
  isIPv4,
  isIPv6,
  isPosix,
  tempDir,
  tls,
  tmpdirSync,
} from "harness";
import { connect } from "net";
import { join, resolve } from "path";
// import { renderToReadableStream } from "react-dom/server";
// import app_jsx from "./app.jsx";
import { heapStats } from "bun:jsc";
import { spawn } from "child_process";
import net from "node:net";
import { networkInterfaces } from "node:os";
import { tmpdir } from "os";

let renderToReadableStream: any = null;
let app_jsx: any = null;

type Handler = (req: Request) => Response;
afterEach(() => {
  gc(true);
});

const count = 200;
let server: Server | undefined;

async function runTest({ port, ...serverOptions }: Serve<any>, test: (server: Server) => Promise<void> | void) {
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
        server = undefined;
        if (stopped.resolve) {
          stopped.resolve();
          stopped.resolve = undefined;
        }

        return new Response("Hello, World!");
      },
    });
    const url = server.url;

    async function request() {
      try {
        await fetch(url, { keepalive: true }).then(res => res.text());
        expect.unreachable();
      } catch (e) {
        expect(["ECONNRESET", "ConnectionRefused"]).toContain(e.code);
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
      const request = fetch(server.url, { signal });
      await onIncomingRequest.promise;
      controller.abort();
      expect(async () => await request).toThrow();
      // Delay for one run of the event loop.
      await Bun.sleep(1);

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
                for await (const chunk of req.body) {
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
              async function callback() {
                const response = await fetch(server.url, {
                  body: blob,
                  method: "POST",
                });

                // We are testing for ReadableStream leaks, so we use the ReadableStream here.
                const chunks = [];
                for await (const chunk of response.body) {
                  chunks.push(chunk);
                }

                const digest = Buffer.from(Bun.concatArrayBuffers(chunks)).toString();

                expect(digest).toBe(expected);
                Bun.gc(false);
              }
              {
                let remaining = count;

                const batchSize = 64;
                while (remaining > 0) {
                  const promises = new Array(count);
                  for (let i = 0; i < batchSize && remaining > 0; i++) {
                    promises[i] = callback();
                  }
                  await Promise.all(promises);
                  remaining -= batchSize;
                }
              }

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
          return new Response("Foo Bar", { status: statusCode });
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
            return new Response("Foo Bar", { status: statusCode });
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

  const socket = net.connect(server.port, "127.0.0.1");
  const response = await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    socket.on("error", reject);
    socket.on("data", chunk => chunks.push(chunk));
    socket.on("close", () => resolve(Buffer.concat(chunks).toString()));
    socket.write(payload);
  });
  socket.destroy();
  expect(response).toStartWith("HTTP/1.1 200");
  expect(response.slice(response.indexOf("\r\n\r\n") + 4)).toBe("/helloooo");
});

describe("streaming", () => {
  describe("error handler", () => {
    it("throw on pull renders headers, does not call error handler", async () => {
      const onMessage = mock(async url => {
        const response = await fetch(url);
        expect(response.status).toBe(402);
        expect(response.headers.get("X-Hey")).toBe("123");
        expect(response.text()).resolves.toBe("");
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
      expect(stderr).toContain("error: Oops");
      expect(onMessage).toHaveBeenCalled();
    });

    it("throw on pull after writing should not call the error handler", async () => {
      const onMessage = mock(async href => {
        const url = new URL("write", href);
        const response = await fetch(url);
        expect(response.status).toBe(402);
        expect(response.headers.get("X-Hey")).toBe("123");
        expect(response.text()).resolves.toBe("");
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
      expect(stderr).toContain("error: Oops");
      expect(onMessage).toHaveBeenCalled();
    });

    it("returning a Response whose body stream is already locked calls the error handler", async () => {
      let captured: { code: unknown; name: string; message: string } | null = null;
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
        for (let i = 0; i < count; ) {
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
        for (let i = 0; i < count; ) {
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

it("reload() cannot turn a Bun.serve server into a node:http server", async () => {
  // The server's kind is fixed when listen() sizes its connections' native
  // per-socket block; a reload that smuggles in the node:http handler used by
  // node's http.Server wrapper must be ignored, not flip the context into
  // node-compat mode under connections allocated with the smaller block.
  const first: Handler = () => new Response("first");
  const second: Handler = () => new Response("second");
  await runTest(
    {
      fetch: first,
    },
    async server => {
      expect(await (await fetch(server.url.origin)).text()).toBe("first");
      server.reload({
        fetch: second,
        // @ts-expect-error internal option used by node:http's Server
        onNodeHTTPRequest: () => {
          throw new Error("must never be routed");
        },
      });
      // Fresh connections after the reload (fetch pools per-origin, so mix in
      // explicit no-keepalive requests to force new native sockets).
      for (let i = 0; i < 8; i++) {
        const res = await fetch(server.url.origin, { headers: { connection: "close" } });
        expect(await res.text()).toBe("second");
      }
    },
  );
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
      port: server.port,
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

      expect(await rawStatusLine(server.port, method)).toBe("HTTP/1.1 502 Bad Gateway");
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
  type RawResponse = { statusLine: string; headerNames: string[]; headers: Record<string, string>; body: string };
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
      const { statusLine, headerNames } = await rawRequest(server.port, method);
      expect(statusLine).toStartWith(`HTTP/1.1 ${status} `);
      expect(headerNames).not.toContain("content-length");
      expect(headerNames).not.toContain("transfer-encoding");
    });

    // 205 MUST indicate a zero-length body (RFC 9110 15.3.6) and 304 MAY carry
    // a Content-Length (RFC 9110 15.4.5) -- both keep the explicit 0.
    it.each([205, 304])("a %i response keeps Content-Length: 0", async status => {
      using server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: () => new Response(null, { status }),
      });
      const { statusLine, headerNames } = await rawRequest(server.port, method);
      expect(statusLine).toStartWith(`HTTP/1.1 ${status} `);
      expect(headerNames).toContain("content-length");
    });
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
      [304, "GET", "0"],
      [304, "HEAD", "0"],
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
      const { statusLine, headers, body } = await rawRequest(server.port, method);
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
    const { statusLine, headers, body } = await rawRequest(server.port, method);
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
      const head = await rawRequest(server.port, "HEAD");
      const get = await rawRequest(server.port, "GET");
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
      const head = await rawRequest(server.port, "HEAD");
      const get = await rawRequest(server.port, "GET");
      expect({
        head: { statusLine: head.statusLine, body: head.body },
        get: { statusLine: get.statusLine, body: get.body },
      }).toEqual({
        head: { statusLine: "HTTP/1.1 200 OK", body: "" },
        get: { statusLine: "HTTP/1.1 200 OK", body: "Welcome to Bun! To get started, return a Response object." },
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

      const cloned = response.clone().headers;
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
        expect(parseInt(response.headers.get("Content-Range")?.split("/")[1])).toEqual(full.byteLength);
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

    for (let j = 0; j < 10; j++) {
      const batchSize = 64;
      const requests = [];
      for (let i = 0; i < batchSize; i++) {
        requests.push(fetch(server.url.origin));
      }
      await Promise.all(requests);
      Bun.gc(true);
    }

    await Bun.sleep(10);
    expect().pass();
  }
}, 30_000);

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
      port: 0,
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
      } catch (e) {
        return new Response(e?.message!, { status: 500 });
      }

      return new Response("SHOULD'VE FAILED", {});
    },
  });

  const response = await fetch(server.url.origin, {
    method: "POST",
    body: new Uint8Array([0xfd]),
  });

  expect(await response.text()).toBe("Failed to parse JSON");
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
    expect(resp.text()).resolves.toBe("Async fulfilled");
  }

  {
    const resp = await fetch(new URL("async-rejected", url));
    expect(resp.status).toBe(500);
  }

  {
    const resp = await fetch(new URL("async-pending", url));
    expect(resp.status).toBe(200);
    expect(resp.text()).resolves.toBe("Async pending");
  }

  {
    const resp = await fetch(new URL("async-rejected-pending", url));
    expect(resp.status).toBe(500);
  }

  subprocess.kill();
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
          requestCert: "invalid",
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
          rejectUnauthorized: "invalid",
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
          lowMemoryMode: "invalid",
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
  let url: string;
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
  expect(fetch(url)).rejects.toThrow();
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
      readers.push((res.body as ReadableStream).getReader());
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
    } catch (e) {
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
  const batch = [];

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
  const socket = net.connect(serve.port, "localhost", () => {
    socket.write("GET /file HTTP/1.1\r\nHost: localhost\r\n\r\n");
    setTimeout(() => {
      socket.end(); // wait a bit before closing the connection so we get the whole content
    }, 100);
  });

  let body: Buffer | null = null;
  let content_length = 0;
  let headers = "";

  socket.on("data", data => {
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

it.concurrent(
  "should allow use of custom timeout",
  async () => {
    using server = Bun.serve({
      port: 0,
      idleTimeout: 8, // uws precision is in seconds, and lower than 4 seconds is not reliable its timer is not that accurate
      async fetch(req) {
        const url = new URL(req.url);
        return new Response(
          new ReadableStream({
            async pull(controller) {
              controller.enqueue("Hello,");
              if (url.pathname === "/timeout") {
                await Bun.sleep(10000);
              } else {
                await Bun.sleep(10);
              }
              controller.enqueue(" World!");

              controller.close();
            },
          }),
          { headers: { "Content-Type": "text/plain" } },
        );
      },
    });
    async function testTimeout(pathname: string, success: boolean) {
      const res = await fetch(new URL(pathname, server.url.origin));
      expect(res.status).toBe(200);
      if (success) {
        expect(res.text()).resolves.toBe("Hello, World!");
      } else {
        expect(res.text()).rejects.toThrow(/The socket connection was closed unexpectedly./);
      }
    }
    await Promise.all([testTimeout("/ok", true), testTimeout("/timeout", false)]);
  },
  15_000,
);

it.concurrent(
  "should reset timeout after writes",
  async () => {
    // the default is 10s so we send 15
    // this test should take 15s at most
    const CHUNKS = 15;
    const payload = Buffer.from(`data: ${Date.now()}\n\n`);
    using server = Bun.serve({
      idleTimeout: 5,
      port: 0,
      fetch(request, server) {
        let controller!: ReadableStreamDefaultController;
        let count = CHUNKS;
        let interval = setInterval(() => {
          controller.enqueue(payload);
          count--;
          if (count == 0) {
            clearInterval(interval);
            interval = null;
            controller.close();
            return;
          }
        }, 1000);
        return new Response(
          new ReadableStream({
            start(_controller) {
              controller = _controller;
            },
            cancel(controller) {
              if (interval) clearInterval(interval);
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
    let received = 0;
    const response = await fetch(server.url);
    const stream = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await stream.read();
      received += value?.length || 0;
      if (done) break;
    }

    expect(received).toBe(CHUNKS * payload.byteLength);
  },
  20_000,
);

it.concurrent("allow requestIP after async operation", async () => {
  using server = Bun.serve({
    port: 0,
    async fetch(req, server) {
      await Bun.sleep(1);
      return new Response(JSON.stringify(server.requestIP(req)));
    },
  });

  const ip = await fetch(server.url).then(res => res.json());
  expect(ip).not.toBeNull();
  expect(ip.port).toBeInteger();
  expect(ip.address).toBeString();
  expect(ip.family).toBeString();
});

it.concurrent(
  "allow custom timeout per request",
  async () => {
    using server = Bun.serve({
      idleTimeout: 1,
      port: 0,
      async fetch(req, server) {
        server.timeout(req, 60);
        await Bun.sleep(10000); //uWS precision is not great

        return new Response("Hello, World!");
      },
    });
    expect(server.timeout).toBeFunction();
    const res = await fetch(new URL("/long-timeout", server.url.origin));
    expect(res.status).toBe(200);
    expect(res.text()).resolves.toBe("Hello, World!");
  },
  20_000,
);

it.concurrent("#6462", async () => {
  let headers: string[] = [];
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
    port: server.port,
    hostname: server.hostname,
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
    port: server.port,
    hostname: server.hostname,
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
    port: server.port,
    hostname: server.hostname,
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
it("Bun.serve hostname with interior NUL byte does not crash the process", async () => {
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

// The HTTP parser shares HttpParser.h between Bun.serve and node:http. When a request
// handler tears the connection down from inside the request-body data callback, the
// parser must stop consuming the rest of the TCP segment instead of routing a request
// that was pipelined behind the body onto the already-closed socket.
it("does not dispatch a pipelined request after the connection is destroyed inside the body data callback", async () => {
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
});

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
  const socket = net.connect(server.port, "127.0.0.1");
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

  const socket = net.connect(server.port, "127.0.0.1");
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
            // write() returns a negative number when the socket is backed up;
            // await flush(true) (the pending-flush promise) to pause until the
            // drain.
            const n = controller.write(CHUNK);
            if (typeof n === "number" && n < 0) {
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

  const socket = net.connect(server.port, "127.0.0.1");
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

  const socket = net.connect(server.port, "127.0.0.1");
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
            if (typeof n === "number" && n < 0) hitBackpressure = true;
          }
          controller.write(SMALL);
          await controller.flush(true);
          await controller.end();
        },
      });
      return new Response(stream);
    },
  });

  const socket = net.connect(server.port, "127.0.0.1");
  const { promise: stalled, resolve: onStalled, reject: onSocketError } = Promise.withResolvers<void>();
  const { promise: bodyDone, resolve: onBodyDone } = Promise.withResolvers<void>();
  socket.on("error", onSocketError);
  socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
  const chunks: Buffer[] = [];
  socket.on("data", c => chunks.push(c));
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
// socket.end(request) pattern) must receive every response byte already queued,
// not just what the kernel accepted on the first send.
it("a client FIN right after the request does not truncate a large response body", async () => {
  const BODY = 8 * 1024 * 1024;
  using server = serve({
    port: 0,
    fetch: () => new Response(Buffer.alloc(BODY, "a"), { headers: { "content-length": String(BODY) } }),
  });
  const socket = connect(server.port, "127.0.0.1");
  let body = 0;
  let head = "";
  let gotHead = false;
  let ended = false;
  socket.on("data", chunk => {
    if (!gotHead) {
      head += chunk.toString("latin1");
      const i = head.indexOf("\r\n\r\n");
      if (i >= 0) {
        gotHead = true;
        body = Buffer.byteLength(head.slice(i + 4), "latin1");
      }
    } else {
      body += chunk.length;
    }
  });
  socket.on("end", () => (ended = true));
  socket.on("error", () => {});
  const closed = new Promise<void>(r => socket.once("close", () => r()));
  await new Promise<void>(r => socket.once("connect", () => r()));
  socket.end("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
  await closed;
  expect({ body, ended }).toEqual({ body: BODY, ended: true });
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
  const socket = connect(server.port, "127.0.0.1", () => {
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

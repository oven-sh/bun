import { file, gc, Serve, serve, Server } from "bun";
import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, dumpStats, isIPv4, isIPv6, isPosix, tls, tmpdirSync } from "harness";
import { join, resolve } from "path";
// import { renderToReadableStream } from "react-dom/server";
// import app_jsx from "./app.jsx";
import { heapStats } from "bun:jsc";
import { spawn } from "child_process";
import net from "node:net";
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
        expect(["ConnectionClosed", "ConnectionRefused"]).toContain(e.code);
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
describe("1000 uploads & downloads in batches of 64 do not leak ReadableStream", () => {
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
});

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

describe("streaming", () => {
  describe("error handler", () => {
    it("throw on pull renders headers, does not call error handler", async () => {
      let subprocess;

      afterAll(() => {
        subprocess?.kill();
      });

      const onMessage = mock(async url => {
        const response = await fetch(url);
        expect(response.status).toBe(402);
        expect(response.headers.get("X-Hey")).toBe("123");
        expect(response.text()).resolves.toBe("");
        subprocess.kill();
      });

      subprocess = Bun.spawn({
        cwd: import.meta.dirname,
        cmd: [bunExe(), "readable-stream-throws.fixture.js"],
        env: bunEnv,
        stdout: "ignore",
        stderr: "pipe",
        ipc: onMessage,
      });

      let [exitCode, stderr] = await Promise.all([subprocess.exited, new Response(subprocess.stderr).text()]);
      expect(exitCode).toBeInteger();
      expect(stderr).toContain("error: Oops");
      expect(onMessage).toHaveBeenCalled();
    });

    it("throw on pull after writing should not call the error handler", async () => {
      let subprocess;

      afterAll(() => {
        subprocess?.kill();
      });

      const onMessage = mock(async href => {
        const url = new URL("write", href);
        const response = await fetch(url);
        expect(response.status).toBe(402);
        expect(response.headers.get("X-Hey")).toBe("123");
        expect(response.text()).resolves.toBe("");
        subprocess.kill();
      });

      subprocess = Bun.spawn({
        cwd: import.meta.dirname,
        cmd: [bunExe(), "readable-stream-throws.fixture.js"],
        env: bunEnv,
        stdout: "ignore",
        stderr: "pipe",
        ipc: onMessage,
      });

      let [exitCode, stderr] = await Promise.all([subprocess.exited, new Response(subprocess.stderr).text()]);
      expect(exitCode).toBeInteger();
      expect(stderr).toContain("error: Oops");
      expect(onMessage).toHaveBeenCalled();
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
      expect(req.headers.get("Content-Type")).toBeNull();
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

it.if(isIPv4())("server.requestIP (v4)", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req, server) {
      return Response.json(server.requestIP(req));
    },
    hostname: "127.0.0.1",
  });

  const response = await fetch(server.url.origin).then(x => x.json());
  expect(response).toEqual({
    address: "127.0.0.1",
    family: "IPv4",
    port: expect.any(Number),
  });
});

it.if(isIPv6())("server.requestIP (v6)", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req, server) {
      return Response.json(server.requestIP(req));
    },
    hostname: "::1",
  });

  const response = await fetch(`http://localhost:${server.port}`).then(x => x.json());
  expect(response).toEqual({
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

  const subprocess = Bun.spawn({
    cwd: import.meta.dirname,
    cmd: [bunExe(), "bun-serve.fixture.js"],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
    ipc(message) {
      resolve(message);
    },
  });

  afterAll(() => {
    subprocess.kill();
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

describe("should error with invalid options", async () => {
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
    }).toThrow("Expected requestCert to be a boolean");
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
    }).toThrow("Expected rejectUnauthorized to be a boolean");
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
    }).toThrow("Expected lowMemoryMode to be a boolean");
  });
});
it("should resolve pending promise if requested ended with pending read", async () => {
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

it("should work with dispose keyword", async () => {
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

// prettier-ignore
it("should be able to stop in the middle of a file response", async () => {
  async function doRequest(url: string) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10) });
      const read = (response.body as ReadableStream<any>).getReader();
      while (true) {
        const { value, done } = await read.read();
        if (done) break;
      }
      expect(response.status).toBe(200);
    } catch {}
  }
  const fixture = join(import.meta.dir, "server-bigfile-send.fixture.js");
  for (let i = 0; i < 3; i++) {
    const process = Bun.spawn([bunExe(), fixture], {
      env: bunEnv,
      stderr: "inherit",
      stdout: "pipe",
      stdin: "ignore",
    });
    const { value } = await process.stdout.getReader().read();
    const url = new TextDecoder().decode(value).trim();
    const requests = [];
    for (let j = 0; j < 5_000; j++) {
      requests.push(doRequest(url));
    }
    // only await for 1k requests (and kill the process)
    await Promise.all(requests.slice(0, 1_000));
    expect(process.exitCode || 0).toBe(0);
    process.kill();
  }
}, 60_000);

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
      expect(e.code).toBe("ConnectionClosed");
    }
  }
});

it("should not instanciate error instances in each request", async () => {
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

it("should not send extra bytes when using sendfile", async () => {
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

it("we should always send date", async () => {
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

it("should allow use of custom timeout", async () => {
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
}, 15_000);

it("should reset timeout after writes", async () => {
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
}, 20_000);

it("allow requestIP after async operation", async () => {
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

it("allow custom timeout per request", async () => {
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
}, 20_000);

import { sleep } from "bun";
import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tls } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";

test("HTTPResponseSink displays correct message", async () => {
  let leakedCtrl: any;
  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(ctrl) {
            await ctrl.write("a");
            await sleep(10);
            await ctrl.write("b");
            ctrl.flush();
            leakedCtrl = ctrl;
          },
        } as any),
      );
    },
  });
  let response = await fetch(server.url);
  expect(await response.text()).toBe("ab");
  expect(() => leakedCtrl.write("c")).toThrow(
    'This HTTPResponseSink has already been closed. A "direct" ReadableStream terminates its underlying socket once `async pull()` returns.',
  );
  expect(() => leakedCtrl.write.call({}, "c")).toThrow("Expected HTTPResponseSink");
});

// Sentry BUN-2WJA / BUN-2WKB: JSReadable*Controller.end() ran the onClose
// callback (via detach()) before calling endWithSink() on the stashed sink
// pointer. If the stream's pull() promise had already settled, the queued
// on_resolve_stream reaction frees the sink when microtasks drain during
// onClose, leaving endWithSink() to dereference a freed HTTPServerWritable.
//
// The repro forces the microtask drain from inside the stream's cancel()
// callback (which is what detach()'s onClose invokes for a direct stream).
// Under ASAN this is a heap-use-after-free without the fix; in release it
// segfaults on the scrubbed buffer pointer.
test.skipIf(!isASAN)(
  "controller.end() after pull() resolved does not use the sink after free",
  async () => {
    const fixture = `
    const { drainMicrotasks } = require("bun:jsc");

    const big = Buffer.alloc(128 * 1024, 0x61);
    let capturedController;
    let resolvePull;
    const pullSettled = Promise.withResolvers();

    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(
          new ReadableStream({
            type: "direct",
            pull(controller) {
              capturedController = controller;
              controller.write(big);
              const p = new Promise(r => { resolvePull = r; });
              p.then(() => pullSettled.resolve());
              return p;
            },
            cancel() {
              // Reached from controller.end() -> detach() -> onClose.
              // Draining here runs on_resolve_stream, which destroys the
              // native sink while endWithSink() still holds a pointer to it.
              drainMicrotasks();
            },
          }),
        );
      },
    });

    const res = await fetch(server.url);
    const reader = res.body.getReader();
    // Read the body to completion so the client never applies backpressure
    // and the server-side write drains without parking a pending_flush.
    const drained = (async () => { while (!(await reader.read()).done); })();

    // Wait until pull() has been invoked and the controller is live.
    while (!resolvePull) await Bun.sleep(0);

    // Queue on_resolve_stream: pull()'s promise -> .then(() => {}) wrapper
    // inside readDirectStream -> then_with_value(on_resolve_stream, ...).
    resolvePull();
    await pullSettled.promise;

    // controller.end(): stashes ptr, detach() fires onClose -> cancel()
    // -> drainMicrotasks() -> on_resolve_stream frees the sink, then
    // endWithSink(ptr) runs on the freed allocation.
    capturedController.end();

    await drained;
    server.stop(true);
    console.log("ok");
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "ok\n",
      stderr: "",
      exitCode: 0,
    });
  },
  30_000,
);

// https://github.com/oven-sh/bun/issues/32137
// react-dom/server.bun's renderToReadableStream returns a direct ReadableStream
// whose pull() writes the shell, captures the controller, and returns
// synchronously (no promise). Resolved Suspense boundaries are written through
// the captured controller later, followed by end(). Bun.serve must keep the
// response open until end() instead of finalizing it when pull() returns.
test("sync pull() that ends later streams the whole body", async () => {
  const SHELL = "<div>SHELL</div>";
  const RESOLVED = "<div>RESOLVED</div>";
  let controller: any;
  const pulled = Promise.withResolvers<void>();
  using server = Bun.serve({
    port: 0,
    fetch() {
      const stream = new ReadableStream(
        {
          type: "direct",
          pull(c: any) {
            c.write(SHELL);
            c.flush();
            controller = c;
            pulled.resolve();
            // returns undefined synchronously; more writes come later
          },
        } as any,
        { highWaterMark: 2048 },
      );
      return new Response(stream, { headers: { "Content-Type": "text/html" } });
    },
  });

  const response = await fetch(server.url);
  await pulled.promise;

  // the shell must arrive while the server is still waiting for end()
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let body = "";
  while (body.length < SHELL.length) {
    const { done, value } = await reader.read();
    if (done) break;
    body += decoder.decode(value, { stream: true });
  }
  expect(body).toBe(SHELL);

  controller.write(RESOLVED);
  controller.flush();
  controller.end();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    body += decoder.decode(value, { stream: true });
  }
  expect(body).toBe(SHELL + RESOLVED);
  expect(response.status).toBe(200);
});

test("sync pull() that writes nothing and ends later still responds", async () => {
  let controller: any;
  const pulled = Promise.withResolvers<void>();
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          type: "direct",
          pull(c: any) {
            controller = c;
            pulled.resolve();
          },
        } as any),
      );
    },
  });

  const responsePromise = fetch(server.url);
  await pulled.promise;
  controller.write("LATER");
  controller.end();

  const response = await responsePromise;
  expect(await response.text()).toBe("LATER");
  expect(response.status).toBe(200);
});

test("cancel() fires when the client disconnects while waiting for end()", async () => {
  const pulled = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  using server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(
        new ReadableStream({
          type: "direct",
          pull(c: any) {
            c.write("partial");
            c.flush();
            pulled.resolve();
          },
          cancel() {
            cancelled.resolve();
          },
        } as any),
      );
    },
  });

  const abort = new AbortController();
  const response = await fetch(server.url, { signal: abort.signal });
  await pulled.promise;
  abort.abort();
  // the server must tear down the stream (aborting e.g. React's render)
  // instead of waiting for an end() that will never come
  await cancelled.promise;
  await response.text().catch(() => {});
});

// endFromJS() can hit transport backpressure right after the HEADERS frame on
// QUIC and park a pending flush; the server must drain it instead of
// finalizing the sink and truncating the response (HTTP3ContentLengthMismatch).
describe("end() under transport backpressure over h3", () => {
  function serveH3(body: () => ReadableStream) {
    return Bun.serve({
      port: 0,
      tls,
      // @ts-expect-error http3 is not in the public types yet
      http3: true,
      http1: false,
      fetch: () => new Response(body()),
    });
  }
  const h3fetch = (server: any) =>
    fetch(`https://${server.hostname}:${server.port}/`, {
      // @ts-expect-error protocol is bun-specific
      protocol: "http3",
      tls: { rejectUnauthorized: false },
    });

  test("async pull() that ends synchronously", async () => {
    using server = serveH3(
      () =>
        new ReadableStream({
          type: "direct",
          async pull(c: any) {
            c.write("hey");
            c.end();
          },
        } as any),
    );
    const res = await h3fetch(server);
    expect(await res.text()).toBe("hey");
  });

  test("sync pull() that ends from a microtask", async () => {
    using server = serveH3(
      () =>
        new ReadableStream({
          type: "direct",
          pull(c: any) {
            c.write("hey");
            queueMicrotask(() => c.end());
          },
        } as any),
    );
    const res = await h3fetch(server);
    expect(await res.text()).toBe("hey");
  });
});

// The controller's detach() used to skip the close callback when it was
// wrapped in an AsyncContextFrame (stream constructed inside
// AsyncLocalStorage.run()), so the request context waiting for end() was
// never released and every request leaked its ReadableStream.
test("sync pull() under AsyncLocalStorage releases the request on end()", async () => {
  const als = new AsyncLocalStorage();
  let controller: any;
  let pulled: any;
  using server = Bun.serve({
    port: 0,
    fetch() {
      return als.run(
        {},
        () =>
          new Response(
            new ReadableStream({
              type: "direct",
              pull(c: any) {
                c.write("hey");
                controller = c;
                pulled.resolve();
              },
            } as any),
          ),
      );
    },
  });

  async function once() {
    pulled = Promise.withResolvers();
    const responsePromise = fetch(server.url);
    await pulled.promise;
    controller.end();
    const response = await responsePromise;
    expect(await response.text()).toBe("hey");
  }

  // Baseline-delta so the assertion measures only this test's streams, not
  // VM-global residue from earlier tests in the file.
  const baseline = heapStats().objectTypeCounts.ReadableStream ?? 0;
  for (let i = 0; i < 20; i++) await once();
  Bun.gc(true);
  await Bun.sleep(10);
  Bun.gc(true);
  const counts = heapStats().objectTypeCounts;
  expect((counts.ReadableStream ?? 0) - baseline).toBeLessThan(10);
});

// https://github.com/oven-sh/bun/issues/28019
// A close-delimited HTTP/1.0 streaming response has no framing, so nothing but
// body bytes may be written once the body starts. Ending the sink while it
// still held buffered data used to route through uWS::internalEnd's
// content-length branch and inject "Content-Length: <n>\r\n\r\n" into the body.
test("ending an HTTP/1.0 streaming response does not inject a Content-Length header", async () => {
  const first = Buffer.alloc(65536, "x");
  const expectedBody = first.toString() + "Hello Bun!\n";
  const firstBytesReceived = Promise.withResolvers<void>();
  await using server = Bun.serve({
    port: 0,
    async fetch() {
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(ctrl) {
            // At or above the sink's highWaterMark: flushed to the socket
            // immediately, so the response body is started on the wire.
            ctrl.write(first);
            // Wait until the client holds body bytes before finishing.
            await firstBytesReceived.promise;
            // Below the highWaterMark: stays in the sink's buffer, so ending
            // the sink ends the response with buffered data left over.
            ctrl.write("Hello Bun!\n");
            ctrl.end();
          },
        } as any),
      );
    },
  });

  const { promise, resolve, reject } = Promise.withResolvers<string>();
  let received = "";
  let headerEnd = -1;
  await Bun.connect({
    hostname: server.hostname,
    port: server.port!,
    socket: {
      open(socket) {
        // HTTP/1.0 without keep-alive: the response is delimited by the
        // connection close, so the server streams it without chunked framing.
        socket.write(`GET / HTTP/1.0\r\nHost: ${server.hostname}\r\n\r\n`);
      },
      data(socket, data) {
        received += data.toString("latin1");
        if (headerEnd === -1) {
          headerEnd = received.indexOf("\r\n\r\n");
        }
        if (headerEnd !== -1) {
          const body = received.slice(headerEnd + 4);
          if (body.length > 0) {
            firstBytesReceived.resolve();
          }
          // A corrupted body has extra injected bytes, so it reaches the
          // expected length too; compare as soon as the length is there.
          if (body.length >= expectedBody.length) {
            resolve(body);
            socket.end();
          }
        }
      },
      close() {
        reject(new Error(`connection closed after ${received.length} bytes, before the full body arrived`));
      },
      error(_socket, error) {
        reject(error);
      },
    },
  });

  const body = await promise;
  // The first 64 KiB were already on the wire when the stream ended; anything
  // injected by the end path lands right after them.
  expect(body.slice(65536)).toBe(expectedBody.slice(65536));
  expect(body).toBe(expectedBody);
});

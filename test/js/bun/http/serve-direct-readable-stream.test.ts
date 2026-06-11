import { sleep } from "bun";
import { describe, expect, test } from "bun:test";
import { tls } from "harness";
import { heapStats } from "bun:jsc";
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
      return als.run({}, () =>
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

  for (let i = 0; i < 20; i++) await once();
  Bun.gc(true);
  await Bun.sleep(10);
  Bun.gc(true);
  const counts = heapStats().objectTypeCounts;
  expect(counts.ReadableStream ?? 0).toBeLessThan(10);
});

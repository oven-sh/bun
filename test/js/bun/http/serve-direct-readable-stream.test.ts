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
// The ASAN-only subprocess repros below are independent (own Bun.spawn, no shared
// state) so they run concurrently to avoid serial ASAN startup cost per spawn.
test.concurrent.skipIf(!isASAN)(
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

// Once controller.end() fully ends the response, uWS markDone() drops its
// onAborted handler, so a peer that closes the plain-TCP socket afterwards
// never reaches RequestContext::on_abort. uSockets frees the socket at the
// end of that loop tick (us_internal_free_closed_sockets), but resp was never
// detached; the stream-resolution microtask for the still parked pull() then
// dereferenced the freed us_socket_t:
//   AddressSanitizer: heap-use-after-free (READ of size 1)
//     uws_res_state <- AnyResponse::should_close_connection
//     <- RequestContext::should_close_connection
//     <- RequestContext::handle_resolve_stream
test.concurrent.skipIf(!isASAN)(
  "client disconnect after controller.end() with a parked pull() does not use the socket after free",
  async () => {
    const fixture = `
    const { connect } = require("node:net");
    const CRLF = "\\r\\n";

    let release1, release2;
    const gate1 = new Promise(r => (release1 = r));
    const gate2 = new Promise(r => (release2 = r));

    const server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/probe") return new Response("probe");
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller) {
              controller.write("hello");
              // Suspend so assignToStream sees a pending promise and the
              // resolution goes through the on_resolve_stream microtask.
              await gate1;
              // Fully ends the uWS response: markDone() drops onAborted.
              controller.end();
              // Parks the resolution microtask past the socket close.
              await gate2;
            },
          }),
        );
      },
    });

    // Raw TCP so this side controls exactly when the connection closes.
    await new Promise((resolve, reject) => {
      let buf = "";
      let sawBody = false;
      const sock = connect(server.port, "127.0.0.1", () => {
        sock.write("GET / HTTP/1.1" + CRLF + "Host: a" + CRLF + CRLF);
      });
      sock.on("error", reject);
      sock.on("data", d => {
        buf += d.toString("latin1");
        if (!sawBody && buf.includes("hello")) {
          sawBody = true;
          release1();
        }
        // Terminating chunk: controller.end() has fully responded server-side.
        if (sawBody && buf.endsWith("0" + CRLF + CRLF)) sock.destroy();
      });
      sock.on("close", resolve);
    });

    // A round-trip through the server proves its event loop finished the
    // iteration that closed the first socket; the matching
    // us_internal_free_closed_sockets ran at the end of that iteration.
    await (await fetch(server.url + "probe")).text();

    release2();
    await Bun.sleep(0);
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
  60_000,
);

// Same setup, but the parked pull() rejects after controller.end(). The
// rejection goes through handle_reject_stream, which had the same stale
// `resp` dereference on its tail (`end_stream(should_close_connection())`).
test.concurrent.skipIf(!isASAN)(
  "client disconnect after controller.end() with a parked rejecting pull() does not use the socket after free",
  async () => {
    const fixture = `
    const { connect } = require("node:net");
    const CRLF = "\\r\\n";

    let release1, release2;
    const gate1 = new Promise(r => (release1 = r));
    const gate2 = new Promise(r => (release2 = r));

    const server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      // development:false keeps the late rejection out of stderr; the dev
      // reporter is irrelevant to the lifetime bug under test.
      development: false,
      fetch(req) {
        if (new URL(req.url).pathname === "/probe") return new Response("probe");
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller) {
              controller.write("hello");
              await gate1;
              controller.end();
              await gate2;
              throw new Error("late stream failure");
            },
          }),
        );
      },
    });

    await new Promise((resolve, reject) => {
      let buf = "";
      let sawBody = false;
      const sock = connect(server.port, "127.0.0.1", () => {
        sock.write("GET / HTTP/1.1" + CRLF + "Host: a" + CRLF + CRLF);
      });
      sock.on("error", reject);
      sock.on("data", d => {
        buf += d.toString("latin1");
        if (!sawBody && buf.includes("hello")) {
          sawBody = true;
          release1();
        }
        if (sawBody && buf.endsWith("0" + CRLF + CRLF)) sock.destroy();
      });
      sock.on("close", resolve);
    });

    await (await fetch(server.url + "probe")).text();

    release2();
    await Bun.sleep(0);
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
  60_000,
);

// The HTTP/3 sibling must NOT take the ended_response short-circuit.
// Http3Response::markDone() deliberately leaves onAborted armed (unlike
// HTTP/1's markDone()) so that Http3Context's on_stream_close can notify the
// holder; end_stream() -> detach_response() -> clear_aborted() is what disarms
// it. Skipping that leaves the callback pointing at a RequestContext the
// stream-resolution microtask has already released, and lsquic's later
// on_stream_close invokes it on the freed slot.
test.concurrent.skipIf(!isASAN)(
  "h3: controller.end() from a parked pull() disarms onAborted before the context is released",
  async () => {
    const fixture = `
    const tls = ${JSON.stringify(tls)};
    const gate = Promise.withResolvers();

    const server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      tls,
      http3: true,
      http1: false,
      fetch() {
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller) {
              controller.write("hello");
              controller.flush();
              // Suspend so assignToStream sees a pending promise. The
              // resolution then runs as an on_resolve_stream microtask AFTER
              // controller.end() has markDone()d the H3 stream, before
              // lsquic can fire on_stream_close.
              await gate.promise;
              controller.end();
            },
          }),
        );
      },
    });

    const res = await fetch("https://" + server.hostname + ":" + server.port + "/", {
      protocol: "http3",
      tls: { rejectUnauthorized: false },
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let body = "";
    // First chunk received => pull() is parked at the gate.
    while (!body.includes("hello")) {
      const { value, done } = await reader.read();
      if (done) break;
      body += decoder.decode(value, { stream: true });
    }
    gate.resolve();
    // Drain to completion; both sides have FINned, so lsquic's next ticks
    // run on_stream_close for this stream.
    while (!(await reader.read()).done);
    for (let i = 0; i < 20; i++) await Bun.sleep(5);
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
  60_000,
);

// A direct stream's pull() that throws synchronously reaches handle_reject
// AFTER do_render_stream already wrote the 200 status+headers. handle_reject
// gated only on has_responded() (response ended), not has_written_status(),
// so the server's error() handler was asked to produce a second Response and
// render_metadata wrote its status/headers into the in-flight body. Debug
// builds hit the !has_written_status assert in do_write_status and aborted;
// release builds spliced the error() header block into the chunked body.
describe("sync pull() throw after status is written does not re-render error()", () => {
  function fixture(pullBody: string) {
    return `
      const net = require("node:net");
      let errorHandlerCalls = 0;
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        development: false,
        error() {
          errorHandlerCalls++;
          return new Response("FROM-ERROR-HANDLER", { status: 500, headers: { "x-err": "1" } });
        },
        fetch() {
          return new Response(new ReadableStream({
            type: "direct",
            pull(c) { ${pullBody} },
          }));
        },
      });
      const wire = await new Promise(resolve => {
        let buf = "";
        const s = net.connect(server.port, "127.0.0.1", () => {
          s.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");
        });
        s.on("data", d => (buf += d.toString("latin1")));
        s.on("close", () => resolve(buf));
        s.on("error", () => resolve(buf));
      });
      server.stop(true);
      console.log(JSON.stringify({ wire, errorHandlerCalls }));
    `;
  }

  test("body bytes already flushed: connection is force-closed", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture(`c.write("PARTIAL-BYTES"); c.flush(); throw new Error("boom");`)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("error: boom");
    const { wire, errorHandlerCalls } = JSON.parse(stdout);
    // error() cannot replace a response whose status is committed; the
    // connection is force-closed so the client observes failure instead of
    // the error() header block spliced where a chunk-size line belongs.
    expect(wire).not.toContain("x-err");
    expect(wire).not.toContain("FROM-ERROR-HANDLER");
    expect(wire).not.toContain("Something went wrong");
    expect(errorHandlerCalls).toBe(0);
    expect(exitCode).toBe(0);
  });

  test("no body bytes flushed: stream is ended without splicing error() headers", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture(`throw new Error("boom");`)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("error: boom");
    const { wire, errorHandlerCalls } = JSON.parse(stdout);
    // Status 200 was already written; the stream is ended empty. The error()
    // response's status (500), headers, and body must not appear on the wire.
    expect(wire).not.toContain("x-err");
    expect(wire).not.toContain("FROM-ERROR-HANDLER");
    expect(wire.startsWith("HTTP/1.1 200 OK\r\n")).toBe(true);
    expect(errorHandlerCalls).toBe(0);
    expect(exitCode).toBe(0);
  });
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

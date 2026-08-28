import { sleep } from "bun";
import { heapStats } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, tls } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import net from "node:net";

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
test.skipIf(!isASAN)(
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
test.skipIf(!isASAN)(
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

// The third way a parked pull() can end: the client goes away first. The
// sink's abort fires the stream's cancel() and marks the sink aborted; the
// rejection that follows still reaches handle_reject_stream, which must see
// the sink as aborted (not merely done) and drop the request silently. The
// first request is the control: with the client still connected, the same
// rejection is reported and the connection is force-closed.
test.concurrent(
  "pull() rejecting after the client aborted releases the request without reporting the error",
  async () => {
    const fixture = `
    const net = require("node:net");

    let gate, cancelled;

    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      idleTimeout: 0,
      // handle_reject_stream only reports the rejection in development mode.
      development: true,
      fetch(req) {
        if (new URL(req.url).pathname === "/probe") return new Response("probe");
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller) {
              controller.write("partial");
              controller.flush();
              await gate.promise;
              throw new Error("PULL-REJECTED-" + new URL(req.url).pathname.slice(1));
            },
            cancel() {
              cancelled.resolve();
            },
          }),
        );
      },
    });

    function request(path) {
      gate = Promise.withResolvers();
      cancelled = Promise.withResolvers();
      const socket = net.connect(server.port, "127.0.0.1", () => {
        socket.write("GET /" + path + " HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
      });
      // The control request ends in a server-side RST (ECONNRESET here).
      socket.on("error", () => {});
      return socket;
    }
    const waitFor = (socket, event) => new Promise(resolve => socket.once(event, resolve));

    // Control: "partial" on the wire means the status is committed and pull()
    // is parked. Rejecting now force-closes the connection.
    {
      const socket = request("connected");
      await waitFor(socket, "data");
      gate.resolve();
      await waitFor(socket, "close");
    }

    let pendingAfterAbort;
    {
      const socket = request("aborted");
      await waitFor(socket, "data");
      socket.resetAndDestroy();
      // cancel() is fired by the sink's abort, so once it has run the sink is
      // aborted and the rejection below lands on an aborted sink. The parked
      // pull() still holds the request at this point; the rejection is what
      // releases it.
      await cancelled.promise;
      pendingAfterAbort = server.pendingRequests;
      gate.resolve();
      while (server.pendingRequests > 0) await Bun.sleep(0);
    }

    const probe = await (await fetch(new URL("/probe", server.url))).text();
    server.stop(true);
    console.log(JSON.stringify({ pendingAfterAbort, probe }));
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("PULL-REJECTED-connected");
    expect(stderr).not.toContain("PULL-REJECTED-aborted");
    expect(JSON.parse(stdout)).toEqual({ pendingAfterAbort: 1, probe: "probe" });
    expect(exitCode).toBe(0);
  },
  60_000,
);

// The request context used to arm its uWS onAborted callback only once the
// fetch handler had returned (toAsync). A direct stream runs pull() before
// that, while the request is still being dispatched, which left two gaps:
//
// - pull() writes and close()s: the auto-flusher completes the response before
//   the dispatch returns, uWS markDone() drops its callbacks, and toAsync then
//   armed onAborted anyway. The keep-alive socket outlives the request, so the
//   callback pointed at a context already returned to the pool; closing the
//   connection later (server.stop(true) here, a client disconnect in general)
//   invoked it on the freed slot:
//     panic: infallible: server bound            (RequestContext::server)
//     AddressSanitizer: use-after-poison          RequestContext::ref_ <- on_abort
//                                                 <- uWS::HttpContext::onClose
// - pull() calls server.stop(true): the socket is closed on the spot, but with
//   nothing armed neither the context nor its sink heard about it. uSockets
//   frees the socket at the end of the tick and the sink's next write()/end()
//   used it:
//     AddressSanitizer: heap-use-after-free       uws_res_has_responded
//                                                 <- HTTPServerWritable::end_from_js
//
// The callbacks are now armed before the stream is attached, so markDone()
// disarming them is final and a stop() from inside pull() aborts the sink.
// The remaining tests pin down what follows from markDone() being final: while
// pull() is still parked after the response completed, nothing tells the
// request when its socket goes away, so both a later stop() and the Request
// based APIs have to cope with that on their own.
describe("direct stream whose pull() runs while its Response is being attached", () => {
  // Raw socket so the test decides when the connection goes away (it stays
  // open after the response until the test or server.stop(true) closes it).
  // Always reading, so a close that arrives behind response bytes is seen too.
  const client = `
    const net = require("node:net");
    const socket = net.connect(server.port, "127.0.0.1", () => {
      socket.write("GET / HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n");
    });
    socket.on("error", () => {});
    const closed = new Promise(resolve => socket.once("close", resolve));
    const responded = Promise.withResolvers();
    let received = "";
    socket.on("data", chunk => {
      received += chunk.toString("latin1");
      // Content-Length: 4, so the response is complete once "seed" is in.
      if (received.endsWith("seed")) responded.resolve(received.slice(received.indexOf("\\r\\n\\r\\n") + 4));
    });
    const responseBody = () => responded.promise;
  `;

  // pull() parks after close(): the response completes inside the dispatch,
  // the request itself stays pending until the gate opens.
  const closeThenPark = `
    const gate = Promise.withResolvers();
    let request;
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      idleTimeout: 0,
      fetch(req) {
        if (new URL(req.url).pathname === "/probe") return new Response("probe");
        request = req;
        return new Response(
          new ReadableStream({
            type: "direct",
            async pull(controller) {
              controller.write("seed");
              controller.close();
              await gate.promise;
            },
          }),
        );
      },
    });
  `;

  async function run(fixture: string) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("closing the connection after the request was released does not reach the request", async () => {
    const result = await run(`
      ${closeThenPark}
      ${client}
      const body = await responseBody();
      gate.resolve();
      // The parked pull() settles and the request is released; the keep-alive
      // connection is still open.
      while (server.pendingRequests > 0) await Bun.sleep(0);
      server.stop(true);
      await closed;
      console.log(JSON.stringify({ body, pendingRequests: server.pendingRequests }));
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({ body: "seed", pendingRequests: 0 }) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // Companion to the above: once the response has completed, closing the
  // connection no longer notifies the request, so a server.stop(true) issued
  // while pull() is still parked must not keep the request (and so the stop()
  // promise) pending forever once pull() settles.
  test.concurrent("stop(true) after the response completed still releases the parked request", async () => {
    const result = await run(`
      ${closeThenPark}
      ${client}
      const body = await responseBody();
      const stopped = server.stop(true);
      await closed;
      const pendingWhileParked = server.pendingRequests;
      gate.resolve();
      await stopped;
      console.log(JSON.stringify({ body, pendingWhileParked, pendingRequests: server.pendingRequests }));
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({ body: "seed", pendingWhileParked: 1, pendingRequests: 0 }) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // Same window, reached through the Request object: the client is gone and
  // uSockets has freed the socket, but pull() still holds the request, so the
  // APIs that look at its socket must treat it as gone instead of reading it
  // (heap-use-after-free in us_get_remote_address_info <- requestIP).
  test.concurrent("requestIP()/timeout() after the response completed and the client left", async () => {
    const result = await run(`
      ${closeThenPark}
      ${client}
      const body = await responseBody();
      socket.destroy();
      await closed;
      // A round trip through the server proves it has run the event loop turn
      // that processed the close above; uSockets frees the socket at the end
      // of that turn.
      const probe = await (await fetch(new URL("/probe", server.url))).text();
      const requestIP = server.requestIP(request);
      server.timeout(request, 1);
      const pendingWhileParked = server.pendingRequests;
      gate.resolve();
      while (server.pendingRequests > 0) await Bun.sleep(0);
      server.stop(true);
      console.log(JSON.stringify({ body, probe, requestIP, pendingWhileParked }));
    `);
    expect(result).toEqual({
      stdout: JSON.stringify({ body: "seed", probe: "probe", requestIP: null, pendingWhileParked: 1 }) + "\n",
      stderr: "",
      exitCode: 0,
    });
  });

  // A handler that returns (or whose promise is already settled once the
  // dispatch drains microtasks) has its Response attached inside the request's
  // dispatch, which keeps the context alive; one that is still pending when the
  // dispatch returns has it attached later from the promise reaction, which
  // holds its own ref and has already armed the request's callbacks (toAsync).
  // Both have to cope with whatever pull() does to the request while it runs.
  const handlers = [
    ["fetch()", "fetch() {"],
    ["async fetch()", "async fetch() { await Bun.sleep(0);"],
  ];

  // pull() runs `body` with "seed" buffered, yields one event loop turn
  // (uSockets frees a closed socket at the end of the turn that closed it),
  // runs `afterwards` and finishes. The request count is sampled one more turn
  // later, once the microtasks queued by pull() finishing (the stream
  // settling) have run as well.
  function stopFromPull(handler: string, body: string, afterwards = "") {
    return `
      const events = [];
      const pulled = Promise.withResolvers();
      const stop = () => {
        events.push("stop(true)");
        server.stop(true);
        events.push("stop(true) returned");
      };
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        idleTimeout: 0,
        ${handler}
          return new Response(
            new ReadableStream({
              type: "direct",
              async pull(controller) {
                controller.write("seed");
                ${body}
                await Bun.sleep(0);
                ${afterwards}
                pulled.resolve();
              },
              cancel() {
                events.push("cancel()");
              },
            }),
          );
        },
      });
      ${client}
      await closed;
      await pulled.promise;
      await Bun.sleep(0);
      console.log(JSON.stringify({ events, pendingRequests: server.pendingRequests }));
    `;
  }

  const lateWrites = `
    try {
      controller.write("late");
      events.push("write() returned");
    } catch (error) {
      events.push("write() threw: " + error.message);
    }
    controller.end();
    events.push("end() returned");
  `;
  const abortedEvents = [
    "stop(true)",
    "cancel()",
    "stop(true) returned",
    'write() threw: This HTTPResponseSink has already been closed. A "direct" ReadableStream terminates its underlying socket once `async pull()` returns.',
    "end() returned",
  ];

  // Called directly, the stop runs while the stream is being attached. From a
  // microtask it runs inside the microtask drain that follows the attach (sync
  // handler) or once the stream's promise reactions are in place (async one).
  test.concurrent.each(
    handlers.flatMap(([label, handler]) => [
      [label, "directly", handler, "stop();"],
      [label, "from a microtask", handler, "queueMicrotask(stop);"],
    ]),
  )(
    "server.stop(true) from inside pull() (%s, %s) aborts the stream before the socket is freed",
    async (_label, _where, handler, body) => {
      const result = await run(stopFromPull(handler, body, lateWrites));
      expect(result).toEqual({
        stdout: JSON.stringify({ events: abortedEvents, pendingRequests: 0 }) + "\n",
        stderr: "",
        exitCode: 0,
      });
    },
  );

  // end() completes the response, so uWS has already dropped the abort
  // callback when the stop closes the socket: nothing aborts the request, and
  // it has to be released the way a completed response normally is.
  test.concurrent.each(handlers)(
    "server.stop(true) from inside pull() after end() still releases the request (%s)",
    async (_label, handler) => {
      const result = await run(stopFromPull(handler, `events.push("end()"); controller.end(); stop();`));
      expect(result).toEqual({
        stdout:
          JSON.stringify({ events: ["end()", "cancel()", "stop(true)", "stop(true) returned"], pendingRequests: 0 }) +
          "\n",
        stderr: "",
        exitCode: 0,
      });
    },
  );
});

// The HTTP/3 sibling must NOT take the ended_response short-circuit.
// Http3Response::markDone() deliberately leaves onAborted armed (unlike
// HTTP/1's markDone()) so that Http3Context's on_stream_close can notify the
// holder; end_stream() -> detach_response() -> clear_aborted() is what disarms
// it. Skipping that leaves the callback pointing at a RequestContext the
// stream-resolution microtask has already released, and lsquic's later
// on_stream_close invokes it on the freed slot.
test.skipIf(!isASAN)(
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

  test("no body bytes flushed: connection is force-closed without splicing error() headers", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture(`throw new Error("boom");`)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("error: boom");
    const { wire, errorHandlerCalls } = JSON.parse(stdout);
    // Status 200 was already written to the corked response, so error() cannot
    // replace it. Ending the stream here would send that 200 with an empty
    // chunked body and a clean terminator: a complete-looking response for a
    // body that failed. The connection is closed instead, and since the status
    // never left the cork buffer the client sees an empty reply.
    expect(wire).toBe("");
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

// https://github.com/oven-sh/bun/issues/36940
// close() while the sink still holds unflushed bytes deferred the final send
// to the auto-flusher, which ended the response through uWS (writing the
// terminating 0\r\n\r\n chunk) and then finalize() ended the stream a second
// time, writing another terminator. On a keep-alive connection the stray
// terminator is parsed as the start of the next response.
test("close() with unflushed data writes the chunked terminator exactly once", async () => {
  using server = Bun.serve({
    port: 0,
    fetch(req) {
      if (new URL(req.url).pathname === "/plain") {
        return new Response("ok");
      }
      return new Response(
        new ReadableStream({
          type: "direct",
          async pull(c) {
            // Write enough for chunked encoding, in pieces small enough that
            // bytes are still buffered below the high-water mark when close()
            // runs.
            for (let i = 0; i < 8; i++) {
              await c.write(new Uint8Array(100).fill(0x78));
            }
            c.close();
          },
        }),
        { headers: { "content-type": "text/plain" } },
      );
    },
  });

  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const sock = net.connect(server.port, "127.0.0.1");
  let raw = "";
  let sentSecond = false;
  sock.setNoDelay(true);
  sock.on("connect", () => {
    sock.write("GET / HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n");
  });
  sock.on("data", d => {
    raw += d.toString("latin1");
    // Once the first (chunked) response has terminated, reuse the connection.
    // The stray terminator was flushed together with the real one, so it is
    // already in `raw` by the time the second response arrives.
    if (!sentSecond && raw.includes("0\r\n\r\n")) {
      sentSecond = true;
      sock.write("GET /plain HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    }
  });
  sock.on("close", () => resolve(raw));
  sock.on("error", reject);
  const data = await promise;

  // The chunked body is all "x"; the second response is framed by
  // Content-Length. Exactly one terminating chunk must appear in the stream.
  expect(data.split("0\r\n\r\n").length - 1).toBe(1);
  // The bytes right after the terminator are the next response, not another
  // terminator.
  const afterTerminator = data.slice(data.indexOf("0\r\n\r\n") + 5);
  expect(afterTerminator.slice(0, 12)).toBe("HTTP/1.1 200");
  expect(afterTerminator).toEndWith("ok");
});

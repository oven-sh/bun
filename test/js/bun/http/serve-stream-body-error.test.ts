// A `Response` body backed by a `ReadableStream` whose source errors must not
// take the whole server down. Before the fix:
//   1. The rejection from the stream pump was never given a handler, so it
//      reached the global unhandledRejection reporter, whose default policy
//      exits the process: one bad request was a whole-process outage.
//   2. With `development: false` that unhandled rejection was also the only
//      thing that reported the error at all.
//   3. A body that errored after chunks were already sent was still terminated
//      with a clean `0\r\n\r\n`, so the client could not tell the truncated
//      body apart from a complete one.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import { join } from "node:path";

const fixture = join(import.meta.dir, "serve-stream-body-error-fixture.ts");

async function runFixture(variant: string, ...extra: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), fixture, variant, ...extra],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

// A stream source that errors before producing any body bytes is routed to
// `error()`: no status line has been committed yet, so the handler's Response
// can replace the original one in full. The rejection must still not reach the
// unhandledRejection reporter.
test.concurrent.each([
  "pull-throw",
  "pull-async-reject",
  "controller-error",
  "start-async-reject",
  "deferred-pull-throw",
])("%s: error() is invoked and its Response is sent", async variant => {
  const { stdout, stderr, exitCode } = await runFixture(variant);
  expect({ result: JSON.parse(stdout), stderr, exitCode }).toEqual({
    result: {
      statusLine: "HTTP/1.1 500 Internal Server Error",
      cleanChunkedTerminator: false,
      body: "err-body",
      errorCb: 2,
      unhandled: 0,
      secondStatusLine: "HTTP/1.1 500 Internal Server Error",
    },
    stderr: "",
    exitCode: 0,
  });
});

// Same under `development: true` (the DEBUG RequestContext monomorphization).
test.concurrent("pull-throw in development mode: error() is invoked", async () => {
  const { stdout, stderr, exitCode } = await runFixture("pull-throw", "development");
  expect({ result: JSON.parse(stdout), stderr, exitCode }).toEqual({
    result: {
      statusLine: "HTTP/1.1 500 Internal Server Error",
      cleanChunkedTerminator: false,
      body: "err-body",
      errorCb: 2,
      unhandled: 0,
      secondStatusLine: "HTTP/1.1 500 Internal Server Error",
    },
    stderr: "",
    exitCode: 0,
  });
});

// The body errors after a chunk has already been flushed to the client. The
// 200 is irrevocable at that point, but the connection must be closed without
// the terminating `0\r\n\r\n` chunk (RFC 9112 section 7) so the client can
// tell the body is incomplete. `error()` is not invoked (a second status line
// cannot be sent) but the failure is reported to stderr.
test.concurrent("mid-stream error: the chunked body is not terminated as complete", async () => {
  const { stdout, stderr, exitCode } = await runFixture("mid-stream-reject");
  expect(stderr).toContain("boom");
  expect({ result: JSON.parse(stdout), exitCode }).toEqual({
    result: {
      statusLine: "HTTP/1.1 200 OK",
      cleanChunkedTerminator: false,
      body: "7\r\nchunk-a\r\n",
      errorCb: 0,
      unhandled: 0,
      secondStatusLine: "HTTP/1.1 200 OK",
    },
    exitCode: 0,
  });
});

// Under `development: true` (the default for a plain script) the mid-stream
// error is reported by handle_reject_stream, and the connection must still be
// aborted: development mode never has a dev_server() for a plain Bun.serve,
// so the dev fallback page cannot swallow the force-close.
test.concurrent("mid-stream error in development mode: reported and not terminated as complete", async () => {
  const { stdout, stderr, exitCode } = await runFixture("mid-stream-reject", "development");
  expect({ result: JSON.parse(stdout), exitCode }).toEqual({
    result: {
      statusLine: "HTTP/1.1 200 OK",
      cleanChunkedTerminator: false,
      body: "7\r\nchunk-a\r\n",
      errorCb: 0,
      unhandled: 0,
      secondStatusLine: "HTTP/1.1 200 OK",
    },
    exitCode: 0,
  });
  expect(stderr).toContain("boom");
});

// The client aborts the download mid-stream, which makes Bun cancel the body
// ReadableStream. The source's cancel() throws, but the rejected promise is
// one Bun created internally: it must be marked handled rather than surfacing
// as an unhandledRejection (which, under Bun's default policy, would exit the
// whole server process because a remote peer hung up).
test.concurrent.each(["cancel-throw", "cancel-async-reject", "cancel-byte-throw"])(
  "%s: a throwing cancel() on client abort is not an unhandledRejection",
  async variant => {
    const { stdout, stderr, exitCode } = await runFixture(variant);
    const result = JSON.parse(stdout);
    expect({
      result: {
        statusLine: result.statusLine,
        errorCb: result.errorCb,
        unhandled: result.unhandled,
        secondStatusLine: result.secondStatusLine,
      },
      stderr,
      exitCode,
    }).toEqual({
      result: {
        statusLine: "HTTP/1.1 200 OK",
        errorCb: 0,
        unhandled: 0,
        secondStatusLine: "HTTP/1.1 200 OK",
      },
      stderr: "",
      exitCode: 0,
    });
  },
);

// Same under `development: true` (the DEBUG RequestContext monomorphization).
test.concurrent("cancel-throw in development mode: not an unhandledRejection", async () => {
  const { stdout, stderr, exitCode } = await runFixture("cancel-throw", "development");
  const result = JSON.parse(stdout);
  expect({ unhandled: result.unhandled, errorCb: result.errorCb, stderr, exitCode }).toEqual({
    unhandled: 0,
    errorCb: 0,
    stderr: "",
    exitCode: 0,
  });
});

// With Bun's default unhandledRejection policy (no handler installed), a
// throwing cancel() triggered by a remote peer disconnecting mid-download
// must not exit the server process.
test.concurrent("a throwing cancel() on client abort does not kill the server process", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `import net from "node:net";
      const cancelRan = Promise.withResolvers();
      const server = Bun.serve({
        port: 0,
        development: false,
        fetch() {
          return new Response(new ReadableStream({
            async pull(c) { c.enqueue("chunk-a"); await Bun.sleep(4); },
            cancel() { queueMicrotask(cancelRan.resolve); throw new Error("boom"); },
          }));
        },
      });
      await new Promise(resolve => {
        const sock = net.connect(server.port, "127.0.0.1", () => {
          sock.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");
        });
        let buf = "";
        sock.on("data", d => { buf += d; if (buf.includes("chunk-a")) sock.resetAndDestroy(); });
        sock.on("error", () => {});
        sock.on("close", resolve);
      });
      await cancelRan.promise;
      // Tick the event loop past the unhandledRejection checkpoint that used
      // to exit the process before this line was reached.
      for (let i = 0; i < 10; i++) await Bun.sleep(0);
      const res = await fetch(new URL("/ok", server.url));
      console.log("alive", res.status);
      server.stop(true);`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "alive 200\n", stderr: "", exitCode: 0 });
});

// The whole point: with Bun's default unhandledRejection policy (no handler
// installed), a single request whose Response body errors must not exit the
// server process. With no error() handler the failure is reported like a
// fetch() throw (500 + stderr report + process.exitCode set), but the server
// keeps serving.
test.concurrent("a stream body error does not kill the server process", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const server = Bun.serve({
        port: 0,
        development: false,
        fetch(req) {
          if (new URL(req.url).pathname === "/ok") return new Response("ok");
          return new Response(new ReadableStream({ pull() { throw new Error("boom"); } }));
        },
      });
      const res = await fetch(server.url);
      await res.arrayBuffer();
      // Tick the event loop past the unhandledRejection checkpoint that used
      // to exit the process before this line was reached.
      for (let i = 0; i < 10; i++) await Bun.sleep(0);
      const ok = await fetch(new URL("/ok", server.url));
      console.log("alive", res.status, ok.status, await ok.text());
      server.stop(true);`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // exitCode is 1: the default error reporter sets it, exactly as it does when
  // fetch() itself throws with no error() handler.
  expect({ stdout, exitCode }).toEqual({ stdout: "alive 500 200 ok\n", exitCode: 1 });
  expect(stderr).toContain("boom");
});

// An already-rejected async fetch handler reaches handle_reject synchronously
// inside the uWS request callback. If error() then returns a Response whose
// body is a ReadableStream that goes pending, do_render_stream attaches a
// sink holding a raw uWS response pointer and returns. handle_reject's
// "did the error handler respond?" check used to miss the pending stream and
// call render_missing(), which ended the uWS response while the sink still
// held the pointer. The socket was then freed in us_internal_free_closed_sockets,
// and the stream's later rejection drove controller.close() -> sink.end()
// -> uws_res_has_responded on the freed socket:
//   AddressSanitizer: heap-use-after-free (READ of size 1)
//     uws_res_has_responded <- HTTPServerWritable::end <- JSSink::js_close
//     <- rsisSinkClose <- rsisAbrupt
test.skipIf(!isASAN)(
  "error() returning a pending stream after an already-rejected handler does not use-after-free the socket",
  async () => {
    const fixture = `
      const net = require("node:net");
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        development: false,
        // async + throw-before-await: an already-rejected promise, unwrapped
        // synchronously in on_response -> handle_reject.
        fetch: async () => { throw new Error("boom"); },
        error() {
          let i = 0;
          return new Response(
            new ReadableStream({
              async pull(c) {
                if (i++ === 0) { c.enqueue("EB"); await Bun.sleep(1); }
                else throw new Error("nested");
              },
            }),
            { status: 597 },
          );
        },
      });

      function rawRequest() {
        return new Promise(resolve => {
          const chunks = [];
          const sock = net.connect(server.port, "127.0.0.1", () => {
            sock.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nConnection: close\\r\\n\\r\\n");
          });
          sock.on("data", d => chunks.push(d));
          sock.on("error", () => {});
          sock.on("close", () => resolve(Buffer.concat(chunks).toString("latin1")));
        });
      }

      const results = [];
      for (let i = 0; i < 6; i++) {
        const wire = await rawRequest();
        results.push({
          status: wire.split("\\r\\n")[0],
          terminated: wire.endsWith("0\\r\\n\\r\\n"),
        });
        // Let the stream's rejection microtask and the socket-free loop post run.
        for (let j = 0; j < 4; j++) await Bun.sleep(0);
      }
      console.log(JSON.stringify(results));
      server.stop(true);
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The stream errors after "EB" is on the wire, so the body is force-closed
    // without the terminating 0\r\n\r\n chunk (RFC 9112 section 7). The
    // nested failure is reported to stderr (error() already ran for the outer
    // rejection and is not re-invoked).
    const expected = Array(6).fill({ status: "HTTP/1.1 597 HM", terminated: false });
    expect({ results: stdout.trim() ? JSON.parse(stdout) : stdout, exitCode }).toEqual({
      results: expected,
      exitCode: 0,
    });
    expect(stderr).toContain("nested");
  },
  30_000,
);

// A Response body driven by an async iterable (async generator or
// `[Symbol.asyncIterator]` object). Before the fix:
//   * throw before the first yield -> a complete `200 OK` with an empty
//     chunked body (cacheable as a successful response);
//   * synchronous yields then throw -> connection reset with zero bytes
//     (the already-yielded chunks discarded along with the status line);
//   * awaited yields then throw -> chunked body truncated (the only case a
//     client could detect);
// and error() was never invoked in any of them.
describe("Response body errors reach error() until the first body byte is written", () => {
  const fixture = join(import.meta.dir, "serve-body-error-before-first-byte-fixture.ts");

  async function run(route: string, ...extra: string[]) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture, route, ...extra],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { result: JSON.parse(stdout), stderr, exitCode };
  }

  test.concurrent.each([
    ["iter-throw-first", "boom-first"],
    ["iter-throw-first-slow", "boom-slow"],
    ["rs-pull-throw", "rs-boom"],
  ])("%s: error() is invoked and the original headers are not sent", async (route, message) => {
    // No body byte reached uWS: error() replaces the response entirely.
    expect(await run(route)).toEqual({
      result: {
        statusLine: "HTTP/1.1 500 Internal Server Error",
        xErr: true,
        xOrig: false,
        xCustom: false,
        body: "E:" + message,
        resetAfterBytes: false,
        errorCalls: [message],
        unhandled: 0,
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // An async fetch() that goes Pending past the initial drain reaches
  // do_render_stream with is_async()=true, so its own drain_microtasks is a
  // no-op: small yields stay in the sink buffer, and on_reject_stream can
  // fire in the same microtask drain as the yields, before the deferred
  // auto-flusher runs. Those bytes never reached the client; error() must
  // still replace the response.
  test.concurrent.each([
    ["iter-throw-first", "boom-first"],
    ["iter-yield-then-throw", "boom-fast"],
  ])("async fetch %s: error() is invoked", async (r, message) => {
    expect(await run(r, "async-fetch")).toEqual({
      result: {
        statusLine: "HTTP/1.1 500 Internal Server Error",
        xErr: true,
        xOrig: false,
        xCustom: false,
        body: "E:" + message,
        resetAfterBytes: false,
        errorCalls: [message],
        unhandled: 0,
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // An async error() handler goes through process_on_error_promise; the
  // original (protected) fetch() Response must be released first or it leaks
  // one GC root per request (and trips handle_resolve's debug_assert).
  test.concurrent("iter-throw-first with an async error(): the handler's Response is sent", async () => {
    expect(await run("iter-throw-first", "async-error-handler")).toEqual({
      result: {
        statusLine: "HTTP/1.1 500 Internal Server Error",
        xErr: true,
        xOrig: false,
        xCustom: false,
        body: "E:boom-first",
        resetAfterBytes: false,
        errorCalls: ["boom-first"],
        unhandled: 0,
      },
      stderr: "",
      exitCode: 0,
    });
  });

  test.concurrent("iter-throw-first without error(): the default 500 is sent and the failure is reported", async () => {
    const { result, stderr, exitCode } = await run("iter-throw-first", "no-error-handler");
    expect({ result, exitCode }).toEqual({
      result: {
        statusLine: "HTTP/1.1 500 Internal Server Error",
        xErr: false,
        xOrig: false,
        xCustom: false,
        body: "Something went wrong!",
        resetAfterBytes: false,
        errorCalls: [],
        unhandled: 0,
      },
      exitCode: 1,
    });
    expect(stderr).toContain("boom-first");
  });

  // Yields then throws: by the time the error is observed the status line
  // and the yielded chunks have been written to uWS, so error() cannot
  // replace the response. The chunked body must be left unterminated; the
  // failure is reported to stderr.
  //
  // iter-yield-then-throw reaches the force-close inside do_render_stream's
  // cork; the uncork lets those bytes drain on POSIX, but Windows'
  // SO_LINGER{1,0} reset may discard them, so only the invariants that hold
  // on every platform are asserted there.
  test.concurrent.each([
    ["iter-yield-then-throw", ["", "8\r\nAAAABBBB\r\n"], "boom-fast"],
    ["iter-yield-slow-then-throw", ["4\r\nAAAA\r\n"], "boom-mid"],
  ] as const)("%s: error() is not invoked and the body is not terminated", async (route, bodies, message) => {
    const { result, stderr, exitCode } = await run(route);
    expect({
      errorCalls: result.errorCalls,
      unhandled: result.unhandled,
      xErr: result.xErr,
      terminated: result.body.endsWith("0\r\n\r\n"),
      bodyIsExpected: bodies.includes(result.body),
      body: result.body,
      exitCode,
    }).toEqual({
      errorCalls: [],
      unhandled: 0,
      xErr: false,
      terminated: false,
      bodyIsExpected: true,
      body: result.body,
      exitCode: 0,
    });
    expect(stderr).toContain(message);
  });

  // Deferring the status write must not lose a successful empty body's own
  // status/headers: on_first_write fires from the sink's empty-end paths
  // (end_from_js and finalize()'s !done branch).
  test.concurrent.each(["iter-empty-ok", "rs-empty-ok", "direct-empty-ok"])(
    "%s: an empty body keeps the Response's own status and headers",
    async route => {
      const { result, stderr, exitCode } = await run(route);
      expect({
        statusLine: result.statusLine,
        xCustom: result.xCustom,
        xErr: result.xErr,
        errorCalls: result.errorCalls,
        unhandled: result.unhandled,
        stderr,
        exitCode,
      }).toEqual({
        statusLine: "HTTP/1.1 202 Accepted",
        xCustom: true,
        xErr: false,
        errorCalls: [],
        unhandled: 0,
        stderr: "",
        exitCode: 0,
      });
    },
  );
});

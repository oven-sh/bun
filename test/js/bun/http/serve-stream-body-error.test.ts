// A `Response` body backed by a `ReadableStream` whose source errors must not
// take the whole server down, and must never reach the client as a complete
// message. Before the fixes:
//   1. The rejection from the stream pump was never given a handler, so it
//      reached the global unhandledRejection reporter, whose default policy
//      exits the process: one bad request was a whole-process outage.
//   2. With `development: false` that unhandled rejection was also the only
//      thing that reported the error at all.
//   3. A body that errored after chunks were already sent was still terminated
//      with a clean `0\r\n\r\n`, so the client could not tell the truncated
//      body apart from a complete one.
//   4. A body that errored before any chunk was sent went out as the
//      Response's status and headers plus an empty chunked body with a clean
//      terminator: a complete, successful-looking response for a body that
//      failed.
// The natively streamed bodies further down (HTMLRewriter, proxied fetch) pin
// the same contract for the non-ReadableStream path, which also dropped the
// producer's error without reporting it.
import { expect, test } from "bun:test";
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

// A stream source that errors before producing any body bytes. The status and
// headers were already handed to uWS (corked) when the error arrives, so the
// server `error()` callback cannot supply a replacement and is NOT invoked.
// The connection is closed before anything reaches the wire: the client sees
// an empty reply, never a complete 200 with an empty body. The rejection does
// not reach the unhandledRejection reporter; it is reported directly instead.
test.concurrent.each([
  "pull-throw",
  "pull-async-reject",
  "controller-error",
  "start-async-reject",
  "deferred-pull-throw",
])("%s: the connection is closed without a complete response and the error is reported", async variant => {
  const { stdout, stderr, exitCode } = await runFixture(variant);
  expect(JSON.parse(stdout)).toEqual({
    statusLine: "",
    cleanChunkedTerminator: false,
    body: "",
    errorCb: 0,
    unhandled: 0,
    secondStatusLine: "HTTP/1.1 200 OK",
  });
  // With `development: false` the unhandledRejection report used to be the
  // only place the error surfaced; it must still reach stderr without it.
  expect(stderr).toContain("boom");
  expect(exitCode).toBe(0);
});

// Same under `development: true` (the DEBUG RequestContext monomorphization).
test.concurrent("pull-throw in development mode: the connection is closed without a complete response", async () => {
  const { stdout, stderr, exitCode } = await runFixture("pull-throw", "development");
  expect(JSON.parse(stdout)).toEqual({
    statusLine: "",
    cleanChunkedTerminator: false,
    body: "",
    errorCb: 0,
    unhandled: 0,
    secondStatusLine: "HTTP/1.1 200 OK",
  });
  expect(stderr).toContain("boom");
  expect(exitCode).toBe(0);
});

// The headers are already on the wire (the first pull() was still pending
// when the server flushed them) and the source then errors without ever
// producing a chunk. The 200 is irrevocable, so the connection is closed
// without the terminating chunk: headers, then an incomplete body.
//
// No stderr assertion: see the mid-stream test below for why this path is
// quiet with `development: false`.
test.concurrent("pending-error-after-headers: headers go out, the body is not terminated as complete", async () => {
  const { stdout, exitCode } = await runFixture("pending-error-after-headers");
  expect(JSON.parse(stdout)).toEqual({
    statusLine: "HTTP/1.1 200 OK",
    cleanChunkedTerminator: false,
    body: "",
    errorCb: 0,
    unhandled: 0,
    secondStatusLine: "HTTP/1.1 200 OK",
  });
  expect(exitCode).toBe(0);
});

// Bodies that Bun.serve streams natively (an HTMLRewriter transform, a proxied
// fetch() Response) reach the server through RequestContext::end_chunk rather
// than handle_reject_stream. Their status is committed before the body starts,
// so error() cannot answer. Before the fix end_chunk dropped the error (a
// rewriter handler that threw after the first byte left no trace anywhere) and
// a producer that failed before its first chunk went out as a clean, empty 200.
// Now the failure is reported in both modes and the connection is closed
// without the terminating chunk, with whatever body bytes were already out.
//
// [variant, body bytes on the wire, what the report must name]
const nativeBodies = [
  ["rewriter-mid-stream-throw", "e\r\n<b>chunk-a</b>\r\n", "boom"],
  ["rewriter-mid-stream-reject", "e\r\n<b>chunk-a</b>\r\n", "boom"],
  ["proxied-fetch-mid-stream", "7\r\nchunk-a\r\n", "ECONNRESET"],
  ["proxied-fetch-after-status", "", "ECONNRESET"],
] as const;

for (const flags of [[], ["development"]]) {
  const mode = flags.length ? "development" : "production";
  test.concurrent.each(nativeBodies)(
    `%s in ${mode} mode: reported, and the body is not terminated as complete`,
    async (variant, body, reported) => {
      const { stdout, stderr, exitCode } = await runFixture(variant, ...flags);
      expect({ result: JSON.parse(stdout), exitCode }).toEqual({
        result: {
          statusLine: "HTTP/1.1 200 OK",
          cleanChunkedTerminator: false,
          body,
          errorCb: 0,
          unhandled: 0,
          secondStatusLine: "HTTP/1.1 200 OK",
        },
        exitCode: 0,
      });
      expect(stderr).toContain(reported);
    },
  );
}

// When the development server also runs a bake dev server (it has an HTML
// route), the report additionally renders the dev error page as the rest of
// the body and ends the response normally, so the browser shows the error
// after whatever was already streamed. The JS stream has always taken this
// branch; the native body now goes through the same code.
test.concurrent.each([
  ["rewriter-mid-stream-throw", "e\r\n<b>chunk-a</b>\r\n"],
  ["mid-stream-reject", "7\r\nchunk-a\r\n"],
])("%s under a dev server: the error page is appended to the body", async (variant, firstChunk) => {
  const { stdout, stderr, exitCode } = await runFixture(variant, "development", "dev-server");
  const { body, ...result } = JSON.parse(stdout);
  expect({ result, exitCode }).toEqual({
    result: {
      statusLine: "HTTP/1.1 200 OK",
      cleanChunkedTerminator: true,
      errorCb: 0,
      unhandled: 0,
      secondStatusLine: "HTTP/1.1 200 OK",
    },
    exitCode: 0,
  });
  expect(body).toStartWith(firstChunk);
  expect(body).toContain("Stream error during server-side rendering");
  expect(body).toContain("boom");
  expect(stderr).toContain("boom");
});

// The body errors after a chunk has already been flushed to the client. The
// 200 is irrevocable at that point, but the connection must be closed without
// the terminating `0\r\n\r\n` chunk (RFC 9112 section 7) so the client can
// tell the body is incomplete.
//
// No stderr assertion: a rejection on this path already had a reaction
// attached (it never became an unhandledRejection), so there is no lost
// report for this change to restore. `development: false` intentionally
// keeps handle_reject_stream quiet here, which the existing
// serve-direct-readable-stream.test.ts and serve-stream-reject-flush-leak
// tests rely on. The development-mode variant below asserts the report.
test.concurrent("mid-stream error: the chunked body is not terminated as complete", async () => {
  const { stdout, exitCode } = await runFixture("mid-stream-reject");
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
// server process.
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
      // The failed body closes the connection without a complete response.
      const first = await fetch(server.url).then(
        res => res.arrayBuffer().then(() => "complete"),
        err => "rejected " + err.code,
      );
      // Tick the event loop past the unhandledRejection checkpoint that used
      // to exit the process before this line was reached.
      for (let i = 0; i < 10; i++) await Bun.sleep(0);
      const res = await fetch(new URL("/ok", server.url));
      console.log("alive", first, res.status);
      server.stop(true);`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("alive rejected ECONNRESET 200\n");
  // The error must still be surfaced to the operator.
  expect(stderr).toContain("boom");
  expect(exitCode).toBe(0);
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
    // without the terminating 0\r\n\r\n chunk (RFC 9112 section 7).
    const expected = Array(6).fill({ status: "HTTP/1.1 597 HM", terminated: false });
    expect({ stderr, results: stdout.trim() ? JSON.parse(stdout) : stdout, exitCode }).toEqual({
      stderr: "",
      results: expected,
      exitCode: 0,
    });
  },
  30_000,
);

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
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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

// The wire-level contract for a stream source that errors before producing any
// body bytes is unchanged: the Response's own status and headers go out with
// an empty chunked body and the server `error()` callback is NOT invoked (see
// "throw on pull renders headers, does not call error handler" in
// serve.test.ts). What changes is that the rejection no longer reaches the
// unhandledRejection reporter; it is reported directly instead.
test.concurrent.each([
  "pull-throw",
  "pull-async-reject",
  "controller-error",
  "start-async-reject",
  "deferred-pull-throw",
])("%s: the rejection is handled and the error is still reported", async variant => {
  const { stdout, stderr, exitCode } = await runFixture(variant);
  expect({ result: JSON.parse(stdout), exitCode }).toEqual({
    result: {
      statusLine: "HTTP/1.1 200 OK",
      cleanChunkedTerminator: true,
      body: "0\r\n\r\n",
      errorCb: 0,
      unhandled: 0,
      secondStatusLine: "HTTP/1.1 200 OK",
    },
    exitCode: 0,
  });
  // With `development: false` the unhandledRejection report used to be the
  // only place the error surfaced; it must still reach stderr without it.
  expect(stderr).toContain("boom");
});

// Same under `development: true` (the DEBUG RequestContext monomorphization).
test.concurrent("pull-throw in development mode: the rejection is handled", async () => {
  const { stdout, stderr, exitCode } = await runFixture("pull-throw", "development");
  expect({ result: JSON.parse(stdout), exitCode }).toEqual({
    result: {
      statusLine: "HTTP/1.1 200 OK",
      cleanChunkedTerminator: true,
      body: "0\r\n\r\n",
      errorCb: 0,
      unhandled: 0,
      secondStatusLine: "HTTP/1.1 200 OK",
    },
    exitCode: 0,
  });
  expect(stderr).toContain("boom");
});

// The body errors after a chunk has already been flushed to the client. The
// 200 is irrevocable at that point, but the connection must be closed without
// the terminating `0\r\n\r\n` chunk (RFC 9112 section 7) so the client can
// tell the body is incomplete.
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
        fetch() {
          return new Response(new ReadableStream({ pull() { throw new Error("boom"); } }));
        },
      });
      const res = await fetch(server.url);
      await res.arrayBuffer();
      // Tick the event loop past the unhandledRejection checkpoint that used
      // to exit the process before this line was reached.
      for (let i = 0; i < 10; i++) await Bun.sleep(0);
      console.log("alive", res.status);
      server.stop(true);`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, exitCode }).toEqual({ stdout: "alive 200\n", exitCode: 0 });
  // The error must still be surfaced to the operator.
  expect(stderr).toContain("boom");
});

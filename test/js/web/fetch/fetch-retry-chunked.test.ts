// Regression guard for the HTTP client panic in
// handle_response_body_chunked_encoding when the body output buffer pointer
// is unset (Sentry BUN-3BZF: "called Option::unwrap() on a None value" in
// `InternalState::get_body_buffer`). The panic fires on `body_out_str.unwrap()`
// when a chunked, uncompressed response is processed while the client's
// state has no owner buffer attached.
//
// The None state is only reachable on the HTTP thread via a race between
// request teardown and stale socket data delivery that cannot be driven
// deterministically from fetch(), so the accessor is exercised directly via
// a `bun:internal-for-testing` probe that builds an `InternalState::default()`
// and calls `get_body_buffer()` / `chunked_decoder_and_body_buffer()` /
// `process_body_buffer()`. Before the fix, the first call panics.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import net from "node:net";
import type { AddressInfo } from "node:net";

test("InternalState body-buffer accessors tolerate body_out_str == None", async () => {
  // Run in a subprocess so a Rust panic (the pre-fix behavior) is observed as
  // a non-zero exit rather than aborting the whole test process.
  const script = [
    `const { httpInternalStateBodyBufferProbe } = require("bun:internal-for-testing");`,
    `const ok = httpInternalStateBodyBufferProbe();`,
    `if (ok !== true) throw new Error("probe returned " + ok);`,
    `console.log("ok");`,
  ].join("\n");
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);
  expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "ok", exitCode: 0 });
  expect(stderr).not.toContain("unwrap");
});

// End-to-end guard: drive the keep-alive retry path with a chunked,
// uncompressed response. The server drops every third request without
// responding, so the client that adopted the pooled socket observes
// on_close with response_stage == Pending and allow_retry == true, runs
// the retry, reconnects, and processes a chunked body. This exercises
// `get_body_buffer()` on the retried request.
test("chunked uncompressed body over a retried keep-alive connection", async () => {
  let reqNo = 0;
  const sockets = new Set<net.Socket>();
  const server = net.createServer(socket => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buf = "";
    socket.on("data", chunk => {
      buf += chunk.toString("latin1");
      let idx: number;
      while ((idx = buf.indexOf("\r\n\r\n")) !== -1) {
        buf = buf.slice(idx + 4);
        reqNo++;
        if (reqNo % 3 === 0) {
          // Close without responding: client retries on a fresh connection.
          socket.destroy();
          return;
        }
        socket.write(
          "HTTP/1.1 200 OK\r\n" +
            "Connection: keep-alive\r\n" +
            "Transfer-Encoding: chunked\r\n" +
            "\r\n" +
            "5\r\nhello\r\n" +
            "6\r\n world\r\n" +
            "0\r\n\r\n",
        );
      }
    });
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    for (let i = 0; i < 40; i++) {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("hello world");
    }
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise<void>(r => server.close(() => r()));
  }
});

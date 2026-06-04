// process.exit() while fetch() requests are still in flight exercises the
// HTTP-thread shutdown path: VirtualMachine::global_exit ->
// bun_http::shutdown_for_exit -> HttpThread::dealloc_in_flight_for_exit ->
// FetchTasklet::release_at_shutdown, which must balance the tasklet's
// cross-thread refs and reclaim the in-flight AsyncHTTP boxes without
// touching freed memory. A mistake in that protocol surfaces here as a
// crash/ASAN abort (wrong exit code) or a hung exit (test timeout), on
// three distinct in-flight states:
//
//   1. response headers + partial body received, more body pending
//      (metadata accepted, progress updates cycling)
//   2. request sent, no response bytes yet (no metadata, nothing queued)
//   3. streaming request-body upload mid-flight (ResumableSink attached)
//
// Each fixture runs in a child process and exits with a distinctive code
// only reachable after the in-flight state is established.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function runFixture(code: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // ASAN debug builds unconditionally print a signal-handler warning to
  // stderr at startup; ignore that line.
  const filteredStderr = stderr
    .split("\n")
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  return { stdout, stderr: filteredStderr, exitCode };
}

test.concurrent("process.exit() mid-download with more response body pending", async () => {
  const { stdout, stderr, exitCode } = await runFixture(/* js */ `
    import { createServer } from "net";
    import { once } from "events";

    // Send headers plus one chunk of a chunked body, then hold the socket
    // open so the response stays in-flight (has_more) forever.
    const server = createServer(socket => {
      socket.on("data", () => {
        socket.write("HTTP/1.1 200 OK\\r\\nTransfer-Encoding: chunked\\r\\n\\r\\n5\\r\\nhello\\r\\n");
      });
    });
    server.listen(0);
    await once(server, "listening");
    const url = "http://127.0.0.1:" + server.address().port + "/";

    const res = await fetch(url);
    const reader = res.body.getReader();
    const { done, value } = await reader.read();
    if (done || Buffer.from(value).toString() !== "hello") {
      console.error("unexpected first chunk:", done, value);
      process.exit(1);
    }
    // The body stream is live and the HTTP thread is still waiting on more
    // chunks; exit now so the request is reclaimed by the shutdown path.
    console.log("OK: body streaming, exiting mid-download");
    process.exit(42);
  `);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK: body streaming, exiting mid-download");
  expect(exitCode).toBe(42);
});

test.concurrent("process.exit() with a request in flight before any response bytes", async () => {
  const { stdout, stderr, exitCode } = await runFixture(/* js */ `
    import { createServer } from "net";
    import { once } from "events";

    // Accept the connection and read the request, but never respond.
    let sawRequest = () => {};
    const server = createServer(socket => {
      socket.on("data", () => sawRequest());
    });
    server.listen(0);
    await once(server, "listening");
    const url = "http://127.0.0.1:" + server.address().port + "/hang";

    const seen = new Promise(resolve => (sawRequest = resolve));
    fetch(url).catch(() => {});
    // The request bytes reached the server, so the task is registered
    // in-flight on the HTTP thread; no metadata or body ever arrives.
    await seen;
    console.log("OK: request in flight with no response, exiting");
    process.exit(42);
  `);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK: request in flight with no response, exiting");
  expect(exitCode).toBe(42);
});

test.concurrent("process.exit() mid streaming request-body upload", async () => {
  const { stdout, stderr, exitCode } = await runFixture(/* js */ `
    import { createServer } from "net";
    import { once } from "events";

    // Read the request headers and first body bytes, then stall without
    // ever responding, keeping the upload sink attached and in-flight.
    let gotBodyBytes = () => {};
    const server = createServer(socket => {
      let buf = "";
      socket.on("data", d => {
        buf += d.toString("binary");
        const headerEnd = buf.indexOf("\\r\\n\\r\\n");
        if (headerEnd !== -1 && buf.length > headerEnd + 4) gotBodyBytes();
      });
    });
    server.listen(0);
    await once(server, "listening");
    const url = "http://127.0.0.1:" + server.address().port + "/upload";

    const bodySent = new Promise(resolve => (gotBodyBytes = resolve));
    const body = new ReadableStream({
      pull(c) {
        // Keep enqueueing without ever closing so the ResumableSink stays
        // live; socket backpressure bounds how much is buffered.
        c.enqueue(new TextEncoder().encode("chunk-of-request-body"));
      },
    });
    fetch(url, {
      method: "POST",
      body,
      // @ts-ignore
      duplex: "half",
    }).catch(() => {});

    // First body bytes are on the wire: the request-body sink is attached
    // and the request is in-flight on the HTTP thread.
    await bodySent;
    console.log("OK: upload in flight, exiting");
    process.exit(42);
  `);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("OK: upload in flight, exiting");
  expect(exitCode).toBe(42);
});

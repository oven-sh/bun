// The response body is a native-source ReadableStream (a subprocess stdout
// pipe) that produces one chunk and then stalls, so the client abort arrives
// while a native pull is in flight. The abort path (RequestContext::on_abort
// -> HTTPServerWritable::abort -> signal.close) runs the stream's JS onClose,
// which cancels the stream; cancelling a native source settles its pending
// pull and drains microtasks, so the stream's settled reaction
// (handle_resolve_stream -> destroy_sink) frees the sink while abort() is
// still executing. ASAN: heap-use-after-free in
// HTTPServerWritable::flush_promise.

const children: Bun.Subprocess[] = [];

// Writes a single chunk, then holds its stdout pipe open without writing.
// The 30s timer is a backstop so nothing outlives a crashed run.
function spawnStalledChild() {
  const child = Bun.spawn({
    cmd: [process.execPath, "-e", 'process.stdout.write("x"); setTimeout(() => {}, 30_000)'],
    stdout: "pipe",
    stdin: "ignore",
    stderr: "ignore",
  });
  children.push(child);
  return child;
}

const server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/ping") return new Response("pong");
    return new Response(spawnStalledChild().stdout);
  },
});

let aborted = 0;
try {
  for (let i = 0; i < 3; i++) {
    const controller = new AbortController();
    const response = await fetch(`http://127.0.0.1:${server.port}/`, { signal: controller.signal });
    // Wait for the first chunk so the server is provably streaming and parked
    // on the next (never-arriving) chunk of the pipe, then abort.
    await response.body!.getReader().read();
    controller.abort();
    aborted++;

    // A full request/response round-trip after the abort guarantees the server
    // processed the aborted socket's close event and is still functional.
    const pong = await (await fetch(`http://127.0.0.1:${server.port}/ping`)).text();
    if (pong !== "pong") {
      throw new Error(`expected pong, got ${JSON.stringify(pong)}`);
    }
  }

  console.log(JSON.stringify({ ok: true, aborted }));
} finally {
  for (const child of children) child.kill();
  await Promise.all(children.map(child => child.exited));
  server.stop(true);
}

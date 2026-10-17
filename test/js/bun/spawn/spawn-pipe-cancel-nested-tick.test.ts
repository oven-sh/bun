// A chunk that completes a pending read on a subprocess pipe is handed to JS
// from inside that pipe's read callback, and the `for await` body resumes
// there, in the microtask drain that follows. Breaking out of the loop cancels
// the stream, which closes the pipe. A synchronous `expect().resolves` then
// runs the event loop again, still inside the same read callback.
//
// On Windows the pipe is a libuv uv_pipe_t that its reader frees in the
// uv_close() callback. libuv's uv__process_pipe_read_req() dropped the pipe's
// pending-request count before it called the read callback, so the uv_close()
// from the cancel queued the close callback right away, the nested loop run ran
// it, and the uv_pipe_t was freed while uv__process_pipe_read_req() was still
// using it: it reads handle->flags after the callback returns and, on reused
// memory, queues another read on the freed handle. That crashed `bun test`
// itself in test/cli/inspect/inspect.test.ts, in uv_timer_stop through
// eof_timer_start and in the zero-read worker thread, both on a freed pipe.
//
// The nesting here comes from the un-awaited `expect().resolves`, which waits
// for its promise in place (#33261). Once matchers stop doing that (#33289),
// or pipe reads are dispatched outside libuv callbacks (#40023), this sequence
// no longer re-enters the loop and the test only checks the plain cancel path.
import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("cancelling a subprocess pipe and running the event loop from inside its read callback", async () => {
  await using server = Bun.serve({
    port: 0,
    fetch: () => new Response("ok"),
  });
  const url = `http://127.0.0.1:${server.port}/`;

  // Writes one line now and one line per millisecond after that, so the second
  // chunk lands while the stream's read is pending.
  const child = `
    process.stderr.write("ready\\n");
    setInterval(() => process.stderr.write("tick\\n"), 1);
  `;

  // Spawned together so the children start up in parallel: the cancel below
  // only needs a pipe with a write end that stays open.
  const procs = Array.from({ length: 3 }, () =>
    Bun.spawn({
      cmd: [bunExe(), "-e", child],
      env: bunEnv,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    }),
  );

  try {
    const decoder = new TextDecoder();
    for (const proc of procs) {
      let stderr = "";
      let chunks = 0;
      for await (const chunk of proc.stderr) {
        stderr += decoder.decode(chunk, { stream: true });
        if (++chunks >= 2 && stderr.includes("tick")) break;
      }
      expect(stderr).toStartWith("ready\n");

      // Both of these run the event loop synchronously (`expect().resolves`
      // waits for the promise in place), from inside the read callback the
      // `break` above returned into. The timer is the loop turn that used to
      // run the freed pipe's close callback; the request reuses native memory in
      // the same window, which is what turned the freed handle into a crash.
      expect(Bun.sleep(1)).resolves.toBeUndefined();
      expect(fetch(url).then(r => r.text())).resolves.toBe("ok");

      proc.kill();
      await proc.exited;
      expect(proc.killed).toBe(true);
    }
  } finally {
    // The children never exit on their own; reap them even when an assertion
    // above failed.
    for (const proc of procs) proc.kill();
    await Promise.all(procs.map(proc => proc.exited));
  }
});

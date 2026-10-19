import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";

async function runFixture(name: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, name), ...args],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr, exitCode, signalCode: proc.signalCode };
}

// Each test spawns an independent fixture subprocess (own server, own port 0),
// so they run concurrently to overlap the debug/ASAN startup cost.

// An async-rejecting fetch() whose error() handler returns a streaming
// Response must not have that stream ended underneath it by handle_reject's
// render_missing() fallback: that truncated the body on the happy path and,
// after a client abort, left the sink pointing at a freed uWS response
// (ASAN: heap-use-after-free in uws_res_has_responded via end_from_js).
test.concurrent(
  "streaming error() response from an async-rejecting fetch is not ended by render_missing",
  async () => {
    const { stdout, stderr, exitCode, signalCode } = await runFixture("serve-error-stream-client-abort-fixture.ts");

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      ok: true,
      lateCloseResults: [
        expect.stringContaining("Controller is already closed"),
        expect.stringContaining("Controller is already closed"),
        expect.stringContaining("Controller is already closed"),
      ],
    });
    expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null });
  },
  60_000,
);

// https://github.com/oven-sh/bun/issues/32111
test.concurrent(
  "client aborting an async-pull ReadableStream response does not crash the server",
  async () => {
    const { stdout, stderr, exitCode, signalCode } = await runFixture("serve-async-stream-client-abort-fixture.ts");

    expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    expect(result).toEqual({ ok: true, completed: expect.any(Number), aborted: expect.any(Number) });
    expect(result.aborted).toBeGreaterThan(0);
    expect(result.completed + result.aborted).toBe(600);
    expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null });
  },
  60_000,
);

// Client abort while a native-source ReadableStream body (subprocess stdout
// pipe) has a pull in flight. The sink's abort fires the stream's onClose,
// whose cancel drains microtasks and frees the sink; the rest of abort()
// then ran on the freed allocation (ASAN: heap-use-after-free in
// HTTPServerWritable::flush_promise).
test.concurrent(
  "client aborting a native-source stream response does not use the sink after free",
  async () => {
    const { stdout, stderr, exitCode, signalCode } = await runFixture("serve-native-stream-client-abort-fixture.ts");

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ ok: true, aborted: 3 });
    expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null });
  },
  60_000,
);

// A `req.signal` abort listener runs after the server has given the response
// up. A write to the direct stream's controller from there still reached that
// response: the socket was freed with the write corked on it (ASAN:
// heap-use-after-free in us_socket_group via AsyncSocket::uncork).
test.concurrent(
  "a req.signal abort listener that writes to a direct stream does not reach the closed response",
  async () => {
    const { stdout, stderr, exitCode, signalCode } = await runFixture("serve-abort-listener-write-fixture.ts", "write");

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      heard: ["write:0", "flush:0", "cancel:AbortError: The connection was closed."],
      pendingRequests: 0,
    });
    expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null });
  },
);

// The listener ends the stream instead. The end does not reach the response
// either, and a stream that its own producer ended is not cancelled.
test.concurrent(
  "a req.signal abort listener that ends a direct stream does not reach the closed response",
  async () => {
    const { stdout, stderr, exitCode, signalCode } = await runFixture("serve-abort-listener-write-fixture.ts", "end");

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ heard: ["end:0"], pendingRequests: 0 });
    expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null });
  },
);

// The listener's flush(true) finds an earlier flush(true) that still waits and
// a later write that is still buffered. It gets the promise of the earlier
// flush and sends nothing. Windows takes a write of any size at once, so no
// flush waits there.
test.concurrent.skipIf(isWindows)(
  "a req.signal abort listener that flushes a direct stream does not send what is buffered",
  async () => {
    const { stdout, stderr, exitCode, signalCode } = await runFixture("serve-abort-listener-write-fixture.ts", "flush");

    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      heard: [
        "flush(true):pending",
        "flush(true) again:pending",
        "write:0",
        "flush:0",
        "cancel:AbortError: The connection was closed.",
      ],
      pendingRequests: 0,
    });
    expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null });
  },
);

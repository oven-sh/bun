import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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

test.concurrent("a req.signal abort listener cannot write to the direct stream of a closed response", async () => {
  const { stdout, stderr, exitCode, signalCode } = await runFixture("serve-abort-listener-write-fixture.ts");

  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    heard: ["write:0", "flush:0", "cancel:AbortError: The connection was closed."],
    pendingRequests: 0,
  });
  expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null });
});

test.concurrent.each([
  { transport: "TCP", how: "FIN", answer: "file", target: "a:1", heard: ["end"] },
  { transport: "TCP", how: "FIN", answer: "stream", target: "a:1", heard: ["end", "abort"] },
  { transport: "TCP", how: "FIN", answer: "failing stream", target: "a:1", heard: ["end"] },
  { transport: "TCP", how: "RST", answer: "direct stream", target: "a:1", heard: ["end"] },
  { transport: "TLS", how: "RST", answer: "stream", target: "a:1", heard: ["end", "abort"] },
  // Not a tunnel: the body has a length.
  { transport: "TCP", how: "FIN", answer: "file", target: "/", heard: ["abort", "AbortError"] },
])(
  "the body of CONNECT $target settles on $how and the handler answers with a $answer ($transport)",
  async ({ transport, how, answer, target, heard }) => {
    const { stdout, stderr, exitCode, signalCode } = await runFixture(
      "serve-connect-body-close-fixture.ts",
      transport,
      how,
      answer,
      target,
    );

    if (answer === "failing stream") expect(stderr).toContain("error: failing stream");
    else expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ heard, status: "", pendingRequests: 0, later: "ok" });
    expect({ exitCode, signalCode }).toEqual({ exitCode: 0, signalCode: null });
  },
);

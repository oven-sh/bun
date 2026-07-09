import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "node:path";

// https://github.com/oven-sh/bun/issues/32111
test("client aborting an async-pull ReadableStream response does not crash the server", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "serve-async-stream-client-abort-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stderr, stdout: stdout.trim(), exitCode, signalCode: proc.signalCode }).toEqual({
    stderr: "",
    stdout: expect.stringContaining('"ok":true'),
    exitCode: 0,
    signalCode: null,
  });
}, 60_000);

// Client abort while a native-source ReadableStream body (subprocess stdout
// pipe) has a pull in flight. The sink's abort fires the stream's onClose,
// whose cancel drains microtasks and frees the sink; the rest of abort()
// then ran on the freed allocation (ASAN: heap-use-after-free in
// HTTPServerWritable::flush_promise).
test("client aborting a native-source stream response does not use the sink after free", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "serve-native-stream-client-abort-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stderr, stdout: stdout.trim(), exitCode, signalCode: proc.signalCode }).toEqual({
    stderr: "",
    stdout: expect.stringContaining('"ok":true'),
    exitCode: 0,
    signalCode: null,
  });
}, 60_000);

// An async fetch handler that rejects routes the error() Response through
// handle_reject(). When error() returns a ReadableStream body, handle_reject()
// wrongly called render_missing() after starting the stream, ending the uWS
// response out from under the still-pumping HTTPResponseSink. ASAN:
// heap-use-after-free in uws_res_has_responded via HTTPServerWritable::write.
test("client aborting a streaming error() response from a rejected async handler does not use-after-free", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "serve-error-stream-client-abort-fixture.ts")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stderr, stdout: stdout.trim(), exitCode, signalCode: proc.signalCode }).toEqual({
    stderr: "",
    stdout: JSON.stringify({ ok: true, arej: 4, await: 4 }),
    exitCode: 0,
    signalCode: null,
  });
}, 60_000);

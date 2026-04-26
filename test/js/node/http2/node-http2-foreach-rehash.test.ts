import { expect, it } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "node:path";

// H2FrameParser.forEachStream() held a raw HashMap valueIterator() across a
// user-supplied JS callback. On session socket timeout, #onTimeout() calls
// parser.forEachStream(emitTimeout), which emits 'timeout' on every open
// stream. A 'timeout' listener that calls session.request() reaches
// handleReceivedStreamID() -> streams.getOrPut(), which can grow/rehash the
// hashmap and free the backing storage the iterator is still walking. Under
// ASAN this is a heap-use-after-free in hash_map.FieldIterator.next.
it("session.request() from a stream 'timeout' listener during forEachStream does not UAF on hashmap rehash", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--smol", path.join(import.meta.dir, "node-http2-foreach-rehash-fixture.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const filteredStderr = stderr
    .split("\n")
    .filter(l => l && !l.startsWith("WARNING: ASAN interferes"))
    .join("\n");
  expect(filteredStderr).toBe("");
  expect(stdout).toBe("OK\n");
  expect(exitCode).toBe(0);
}, 30_000);

// https://github.com/oven-sh/bun/issues/29787
//
// NativeReadableStreamSource used a single `const closer = [false]` at
// factory scope, so every instance backed by the same native-handle
// prototype (e.g. `Bun.stdin.stream()` + `fetch(file://...)` bodies)
// shared one EOF signal slot.
//
// Race:
//   1. Stream A (stdin pipe) pulls → returns pending Promise. Its `.then`
//      will later read `closer[0]` back.
//   2. Stream B (fetch file body) pulls → returns synchronously
//      `into_array_and_done`, which makes the native code write
//      `closer[0] = true`.
//   3. Data eventually arrives for A. A's `.then` fires, reads the stale
//      `closer[0] === true` left behind by B, and calls `close()` on A's
//      controller — closing stdin even though the pipe has more data and
//      is not at EOF.
//
// The test spawns a child that reads `Bun.stdin.stream()` concurrently
// with 100 `fetch(file://...)` bodies — each body sync-completes with EOF,
// flipping the (pre-fix) shared closer flag to true. Synchronization is
// via stderr ACK/handshake, no wall-clock sleeps: the child signals
// "READY" when fetches are done and writes one byte back on stderr for
// each stdin chunk it receives. The parent writes bytes one-by-one,
// waiting for each ack before sending the next, then closes stdin.
//
// With the bug, stdin's queued pending pull reads the stale closer=true
// when the first parent write wakes it, and closes itself — the child's
// reader pushes `done` and exits, so only one data event is recorded
// and the second ack never arrives.
//
// With the fix, each instance owns its own closer array so all five
// bytes round-trip and the final `done` comes from the parent's real
// `stdin.end()`.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";
import { pathToFileURL } from "node:url";

test("stdin stream stays open while concurrent fetch(file://) bodies finish (#29787)", async () => {
  const dir = tempDirWithFiles("issue-29787-stdin-race", {
    "data.bin": Buffer.alloc(4096, 0x41).toString(),
  });
  const fileUrl = pathToFileURL(`${dir}/data.bin`).href;

  const totalWrites = 5;

  const childScript = `
    const fileUrl = ${JSON.stringify(fileUrl)};
    const events = [];
    const reader = Bun.stdin.stream().getReader();

    // reader.read() in the IIFE below runs synchronously up to its first
    // await, so the native stdin pull reaches its pending state before
    // this line returns — no sleep needed to set up the race window.
    const readerLoop = (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) { events.push({ kind: "done" }); break; }
          events.push({ kind: "data", bytes: value.byteLength });
          // Ack so the parent knows this chunk landed before it sends
          // the next byte. Without acks, the parent has no way to know
          // when the closer-flag race has resolved for this round.
          process.stderr.write("A");
        }
      } catch (err) {
        events.push({ kind: "err", message: err.message });
      }
    })();

    // Concurrent fetch(file://) bodies share the same
    // NativeReadableStreamSource class as stdin. Each body sync-completes
    // with EOF, flipping the (pre-fix) shared closer flag to true.
    const fetches = [];
    for (let i = 0; i < 100; i++) {
      fetches.push((async () => {
        const res = await fetch(fileUrl);
        const rd = res.body.getReader();
        while (true) {
          const { done } = await rd.read();
          if (done) break;
        }
      })());
    }
    await Promise.all(fetches);

    // Closer flag is now in its racy state. Tell the parent to start
    // writing; each byte will either reach the reader (fix) or trip the
    // spurious close (bug).
    process.stderr.write("READY\\n");

    // Exit only when the reader has actually terminated — real EOF from
    // parent's stdin.end() (fix path) or spurious close from reading a
    // stale closer[0] = true (bug path).
    await readerLoop;
    process.stdout.write(JSON.stringify(events));
    process.exit(0);
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", childScript],
    env: bunEnv,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderrReader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  let stderrBuf = "";
  let childExited = false;
  proc.exited.then(() => {
    childExited = true;
  });

  // Pull stderr until `token` is in the buffer, OR the child has
  // exited. The caller checks `stderrBuf.includes(token)` afterwards.
  async function waitForStderrToken(token: string): Promise<void> {
    while (!stderrBuf.includes(token) && !childExited) {
      const { value, done } = await stderrReader.read();
      if (done) return;
      stderrBuf += decoder.decode(value);
    }
  }

  // Handshake before the first write.
  await waitForStderrToken("READY\n");

  // Write one byte, wait for exactly (i+1) acks, repeat. With the bug,
  // the first ack never arrives after the first byte because the reader
  // loop resolved with `done` — the child exits, `childExited` flips,
  // the wait short-circuits, and `dataBytes` comes out < totalWrites.
  for (let i = 0; i < totalWrites; i++) {
    proc.stdin.write(Buffer.from([0x41 + i]));
    await waitForStderrToken("READY\n" + "A".repeat(i + 1));
    if (childExited) break;
  }

  proc.stdin.end();
  stderrReader.releaseLock();

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  const events = JSON.parse(stdout) as (
    | { kind: "data"; bytes: number }
    | { kind: "done" }
    | { kind: "err"; message: string }
  )[];

  // No internal errors from the stdin reader.
  const err = events.find(e => e.kind === "err") as { kind: "err"; message: string } | undefined;
  expect(err).toBeUndefined();

  // Every byte the parent wrote was delivered to the child. With the bug
  // we'd see only one data event before a spurious `done`.
  const dataBytes = events
    .filter((e): e is { kind: "data"; bytes: number } => e.kind === "data")
    .reduce((acc, e) => acc + e.bytes, 0);
  expect(dataBytes).toBe(totalWrites);

  expect(exitCode).toBe(0);
});

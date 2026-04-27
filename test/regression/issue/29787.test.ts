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
// This test spawns a child that reads `Bun.stdin.stream()`. The child
// first issues many concurrent `fetch(file://...)` calls (each of which
// sync-completes with EOF, flipping the shared `closer[0] = true`). The
// child then signals the parent via stderr; the parent replies by
// writing bytes down stdin. With the bug present, stdin's queued pending
// pull reads the stale `true` when it resolves and closes itself — only
// the first byte reaches `data` before a spurious `done` arrives, even
// though the parent is still writing and never ended stdin.
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

    // Background drain of stdin — we'll check this record at the end.
    (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) { events.push({ kind: "done" }); break; }
          events.push({ kind: "data", bytes: value.byteLength });
        }
      } catch (err) {
        events.push({ kind: "err", message: err.message });
      }
    })();

    // Let stdin's first pull reach the pending-promise state before we
    // trip the closer flag with concurrent file reads.
    await Bun.sleep(50);

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

    // Signal the parent that the closer flag is now in its racy state.
    // The parent will respond by writing bytes to stdin; with the bug,
    // stdin's pending pull resolves and reads the stale closer=true,
    // closing itself.
    process.stderr.write("READY\\n");

    // Give the parent time to write all bytes and for any spurious close
    // to surface.
    await Bun.sleep(1500);

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

  // Wait for the child's "READY" signal on stderr before writing to stdin.
  const stderrReader = proc.stderr.getReader();
  const decoder = new TextDecoder();
  let stderrBuf = "";
  while (!stderrBuf.includes("READY")) {
    const { value, done } = await stderrReader.read();
    if (done) break;
    stderrBuf += decoder.decode(value);
  }

  // Now write bytes one at a time with small gaps. Each byte forces a
  // fresh pending-pull cycle on the child's stdin; with the bug, the
  // first pending pull resolves to close-the-stream because of the
  // stale closer flag left by the earlier fetches, and the remaining
  // bytes never reach the child.
  for (let i = 0; i < totalWrites; i++) {
    await Bun.sleep(40);
    proc.stdin.write(Buffer.from([0x41 + i]));
  }

  // Give the child its tail sleep to flush events and exit.
  await Bun.sleep(700);
  proc.stdin.end();

  // Release the stderr reader lock so `proc.stderr` can be drained elsewhere
  // (or, more relevantly, so the `await using` cleanup doesn't trip on a
  // still-locked stream). We don't care about stderr contents past READY —
  // ASAN builds emit a warning there and that's fine.
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

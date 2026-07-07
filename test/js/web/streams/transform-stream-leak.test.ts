import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Spawning a debug/ASAN child plus two synchronous full GCs is slow.
const timeout = 60_000;

// DOMGuardedObject GC-root cycle leaks every unclosed TransformStream.
//
// InternalWritableStream was registering itself in the global object's
// m_guardedObjects set, which the global object marks on every GC. The
// guarded internal stream object reaches back to the JSWritableStream
// wrapper via @controller.@writeAlgorithm -> TransformStream -> @writable,
// so JSWritableStream could never be swept, ~InternalWritableStream never
// ran, and the m_guardedObjects entry was never removed.
test(
  "dropped TransformStream is collectable",
  async () => {
    const src = `
    const { heapStats } = require("bun:jsc");

    const count = type => heapStats().objectTypeCounts[type] || 0;

    const N = 1000;
    (function () {
      for (let i = 0; i < N; i++) new TransformStream();
    })();

    // Let the start() promise settle so nothing pins them from the
    // microtask queue, then collect.
    await Promise.resolve();
    await Promise.resolve();
    Bun.gc(true);
    await Bun.sleep(1);
    Bun.gc(true);

    console.log(JSON.stringify({
      WritableStream: count("WritableStream"),
      TransformStream: count("TransformStream"),
    }));
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const counts = JSON.parse(stdout.trim());

    // Before the fix every one of the 1000 TransformStreams (and their
    // WritableStreams) survived GC. A handful may be legitimately live
    // (prototypes, lazily-initialized singletons), so allow small slack.
    expect(counts.WritableStream).toBeLessThan(50);
    expect(counts.TransformStream).toBeLessThan(50);
    expect(exitCode).toBe(0);
  },
  timeout,
);

test(
  "dropped WritableStream is collectable",
  async () => {
    const src = `
    const { heapStats } = require("bun:jsc");

    const count = type => heapStats().objectTypeCounts[type] || 0;

    const N = 1000;
    (function () {
      for (let i = 0; i < N; i++) new WritableStream();
    })();

    await Promise.resolve();
    await Promise.resolve();
    Bun.gc(true);
    await Bun.sleep(1);
    Bun.gc(true);

    console.log(JSON.stringify({
      WritableStream: count("WritableStream"),
    }));
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    const counts = JSON.parse(stdout.trim());
    expect(counts.WritableStream).toBeLessThan(50);
    expect(exitCode).toBe(0);
  },
  timeout,
);

// Regression guard for the opposite failure mode: now that the global
// object no longer roots the internal stream, JSWritableStream must keep
// it alive via visitChildren while the wrapper itself is reachable.
test(
  "WritableStream internal state survives GC while wrapper is live",
  async () => {
    const src = `
    const ws = new WritableStream();
    Bun.gc(true);
    await Bun.sleep(1);
    Bun.gc(true);
    // If the internal stream object were collected, .locked would
    // misbehave (throw or return a bogus value) and getWriter() would
    // fail to set up the writer<->stream link.
    if (ws.locked !== false) throw new Error("locked=" + ws.locked);
    const w = ws.getWriter();
    if (ws.locked !== true) throw new Error("locked after getWriter=" + ws.locked);
    w.releaseLock();

    const received = [];
    const ws2 = new WritableStream({ write(chunk) { received.push(chunk); } });
    Bun.gc(true);
    await Bun.sleep(1);
    Bun.gc(true);
    const w2 = ws2.getWriter();
    await w2.write("a");
    await w2.write("b");
    await w2.close();
    if (received.join(",") !== "a,b") throw new Error("received=" + received.join(","));

    console.log("ok");
  `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toBe("");
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  },
  timeout,
);

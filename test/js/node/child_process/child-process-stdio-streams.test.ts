// https://github.com/oven-sh/bun/issues/30831
// https://github.com/oven-sh/bun/issues/25498
//
// `child_process.spawn` / `spawnSync` could not pipe one subprocess's stdio
// stream into another: `spawn(..., { stdio: [..., otherProc.stdin, ...] })`
// threw `stream.Readable stdio @ N` because `nodeToBun()` in
// `node:child_process` looked for `.fd` / `_handle.fd` on the stream (Node's
// `subprocess.stdin` is a `net.Socket` that exposes its pipe fd there), but
// Bun's `subprocess.stdin` is a `WriteStream` wrapping a `FileSink` and
// `subprocess.stdout`/`stderr` is a `Readable` wrapping a native
// `ReadableStream`, neither of which surfaced the underlying pipe fd.
//
// The fix surfaces `.fd` on both wrappers, records forwarded streams so they
// can be quiesced after `Bun.spawn` succeeds (mirroring Node's `getValidStdio`
// `readStop`/`pause`, so the parent's `PipeReader` does not race the child for
// the pipe bytes), clears `O_NONBLOCK` on the caller-supplied fd before `dup2`
// (so a synchronous child reader does not get `EAGAIN`), and rejects destroyed
// streams so a stale fd is never forwarded.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { spawn, spawnSync } from "node:child_process";

// Windows: inter-process stdio-fd hand-off is not implemented. `FileReader`'s
// pipe handle is a system-kind `HANDLE` and `Fd::uv()` panics on the non-stdio
// HANDLEs that subprocess pipes produce, so `get_fd()` returns `-1` on Windows
// and `nodeToBun` falls back to the unsupported-stream-stdio error. Each test
// below is `test.skipIf(isWindows)` for that reason.

// Tiny uppercasing filter implemented in bun itself so the test doesn't
// depend on `perl`/`tr`/`awk` being installed on the runner.
const UPPER = `
const chunks = [];
process.stdin.on("data", c => chunks.push(c));
process.stdin.on("end", () => {
  process.stdout.write(Buffer.concat(chunks).toString("utf8").toUpperCase());
});
`;

test.skipIf(isWindows)("spawn({ stdio: [..., childB.stdin, ...] }) pipes A's stdout into B's stdin", async () => {
  using pFilter = spawn(bunExe(), ["-e", UPPER], {
    stdio: ["pipe", "pipe", "pipe"],
    env: bunEnv,
  });
  const filterStdout = collect(pFilter.stdout!);
  const filterStderr = collect(pFilter.stderr!);

  // Spawning pSource with pFilter.stdin as its stdout means pSource's fd 1
  // is dup2'd onto the same pipe pFilter's stdin writes to, so pSource's
  // output arrives in pFilter as stdin. The parent keeps its write end
  // (pFilter.stdin) and must `.end()` it after pSource exits so pFilter sees
  // EOF.
  using pSource = spawn(bunExe(), ["-e", 'process.stdout.write("hello world")'], {
    stdio: ["ignore", pFilter.stdin!, "pipe"],
    env: bunEnv,
  });
  const sourceStderr = collect(pSource.stderr!);

  await new Promise<void>((resolve, reject) => {
    pSource.once("error", reject);
    pSource.once("exit", () => {
      pFilter.stdin!.end();
      resolve();
    });
  });

  const [out, filterErr, sourceErr, filterExit] = await Promise.all([
    filterStdout,
    filterStderr,
    sourceStderr,
    new Promise<number | null>(r => {
      if (pFilter.exitCode != null) return r(pFilter.exitCode);
      pFilter.once("exit", code => r(code));
    }),
  ]);
  expect(filterErr).toBe("");
  expect(sourceErr).toBe("");
  expect(out).toBe("HELLO WORLD");
  expect(pSource.exitCode).toBe(0);
  expect(filterExit).toBe(0);
});

test.skipIf(isWindows)(
  "spawn({ stdio: [otherProc.stdout, ...] }) pipes A's stdout into B's stdin (reverse direction)",
  async () => {
    // Flip the direction: pSource owns the pipe (its stdout is piped), and
    // pFilter is spawned with pSource.stdout as its stdin. Node supports both
    // shapes; before the fix Bun raised the same unsupported-stream-stdio
    // error here too.
    using pSource = spawn(bunExe(), ["-e", 'process.stdout.write("hello world")'], {
      stdio: ["ignore", "pipe", "pipe"],
      env: bunEnv,
    });
    const sourceStderr = collect(pSource.stderr!);
    // `markStreamsAsStdio` unregisters the FilePoll on `pSource.stdout`, so
    // without the close-accounting fix in `#handleOnExit` this `'close'`
    // promise never resolves even after `pSource` exits; guard that path.
    const sourceClose = new Promise<void>(r => pSource.once("close", () => r()));

    using pFilter = spawn(bunExe(), ["-e", UPPER], {
      stdio: [pSource.stdout!, "pipe", "pipe"],
      env: bunEnv,
    });
    const filterStdout = collect(pFilter.stdout!);
    const filterStderr = collect(pFilter.stderr!);

    const [out, filterErr, sourceErr, sourceExit, filterExit] = await Promise.all([
      filterStdout,
      filterStderr,
      sourceStderr,
      new Promise<number | null>(r => {
        if (pSource.exitCode != null) return r(pSource.exitCode);
        pSource.once("exit", code => r(code));
      }),
      new Promise<number | null>(r => {
        if (pFilter.exitCode != null) return r(pFilter.exitCode);
        pFilter.once("exit", code => r(code));
      }),
    ]);
    // `'close'` should also fire, otherwise libraries like `execa` that await
    // close (not exit) hang indefinitely. If this promise never resolves
    // (pre-fix behavior), the test times out rather than racing its own
    // setTimeout.
    await sourceClose;
    expect(filterErr).toBe("");
    expect(sourceErr).toBe("");
    expect(out).toBe("HELLO WORLD");
    expect(sourceExit).toBe(0);
    expect(filterExit).toBe(0);
  },
);

test.skipIf(isWindows)(
  "spawn({ stdio: [..., process.stdout, process.stderr] }) forwards via the stream→fd path",
  async () => {
    // `process.stdout.fd === 1` / `process.stderr.fd === 2` are set by
    // `getStdioWriteStream`. These have always been numeric-fd objects in
    // Bun, so they were already accepted by `nodeToBun`'s `.fd` lookup; this
    // PR routes them through the new `extractStreamFd` + `streamsToQuiesce`
    // path too, and a later refactor could accidentally drop them. A
    // sub-bun runner actually performs the passthrough spawn and prints
    // whether it succeeded to *its* stdout, which the outer test captures.
    const RUNNER = `
    const { spawn } = require("child_process");
    const child = spawn(${JSON.stringify(bunExe())}, ["-e", 'process.stderr.write("from-grandchild")'], {
      stdio: ["ignore", process.stdout, process.stderr],
    });
    child.on("error", err => { process.stderr.write("SPAWN-ERROR:" + err.message); process.exit(2); });
    child.on("exit", code => process.exit(code));
  `;
    using runner = spawn(bunExe(), ["-e", RUNNER], {
      stdio: ["ignore", "pipe", "pipe"],
      env: bunEnv,
    });
    const [stdout, stderr, code] = await Promise.all([
      collect(runner.stdout!),
      collect(runner.stderr!),
      new Promise<number | null>(r => {
        if (runner.exitCode != null) return r(runner.exitCode);
        runner.once("exit", c => r(c));
      }),
    ]);
    // Grandchild writes "from-grandchild" to its stderr (which is the
    // runner's process.stderr, which is this test's runner.stderr).
    expect(stdout).toBe("");
    expect(stderr).toBe("from-grandchild");
    expect(code).toBe(0);
  },
);

test.skipIf(isWindows)("spawn failure (ENOENT) does not leave a passed-in source stream stuck", async () => {
  // The quiesce step (setFlowing(false) + pause) MUST NOT run before
  // Bun.spawn succeeds: `setFlowing(false)` has no user-recoverable
  // counterpart, so running it on the failure path would leave
  // `pSource.stdout` permanently unreadable. Assert the stream is still
  // fully consumable after a failed spawn.
  using pSource = spawn(
    bunExe(),
    ["-e", 'setTimeout(() => { process.stdout.write("hello world"); process.stdout.end(); }, 50)'],
    { stdio: ["ignore", "pipe", "pipe"], env: bunEnv },
  );
  const sourceStderr = collect(pSource.stderr!);

  const failed = spawn("/this/binary/does/not/exist", [], {
    stdio: [pSource.stdout!, "pipe", "pipe"],
    env: bunEnv,
  });
  const spawnErr = await new Promise<NodeJS.ErrnoException>(r => failed.once("error", r));
  expect(spawnErr.code).toBe("ENOENT");

  // pSource.stdout should still flow normally after the failed spawn.
  const [data, stderr, sourceExit] = await Promise.all([
    collect(pSource.stdout!),
    sourceStderr,
    new Promise<number | null>(r => {
      if (pSource.exitCode != null) return r(pSource.exitCode);
      pSource.once("exit", code => r(code));
    }),
  ]);
  expect(stderr).toBe("");
  expect(data).toBe("hello world");
  expect(sourceExit).toBe(0);
});

test.skipIf(isWindows)("a destroyed subprocess stdout does not leak a stale fd to a later spawn", async () => {
  // `constructNativeReadable` caches the pipe fd on `stream.fd` for stdio
  // hand-off. `destroy()` closes that fd, so it must also clear `stream.fd`;
  // otherwise the destroyed stream reports a stale (closed or kernel-reused)
  // fd and a later `spawn` would `dup2` the wrong descriptor into the child.
  using pSource = spawn(bunExe(), ["-e", 'process.stdout.write("hi")'], {
    stdio: ["ignore", "pipe", "ignore"],
    env: bunEnv,
  });
  // Drain to EOF so the stream auto-destroys, then wait for `'close'`.
  const drained = collect(pSource.stdout!);
  await new Promise<void>(r => pSource.once("close", () => r()));
  expect(await drained).toBe("hi");

  expect(pSource.stdout!.destroyed).toBe(true);
  // The fix nulls `fd` on destroy; before it, `fd` stayed a stale number.
  expect((pSource.stdout as any).fd).toBeNull();

  // The destroyed stream must not be accepted as stdio with that stale fd:
  // `extractStreamFd` returns undefined for it, so `spawn` raises a
  // destroyed-stream error instead of `dup2`'ing a closed fd.
  expect(() => spawn(bunExe(), ["-e", ""], { stdio: [pSource.stdout!, "pipe", "ignore"], env: bunEnv })).toThrow(
    /Cannot use a destroyed stream/,
  );
});

test.skipIf(isWindows)("spawnSync does not brick a stream passed as stdio", async () => {
  // `Bun.spawnSync` blocks the JS thread until the child exits, so there is no
  // parent/child read race to prevent, and the quiesce step runs only after
  // the child is already gone. Its irreversible `setFlowing(false)` must not
  // run on the sync path, or a stream handed to `spawnSync` would be left
  // permanently unreadable. Hand a live subprocess's stdout to `spawnSync` and
  // assert its flowing state is untouched; before the fix `markStreamsAsStdio`
  // flipped it to `false`.
  using pSource = spawn(bunExe(), ["-e", "setInterval(() => {}, 1 << 30)"], {
    stdio: ["ignore", "pipe", "ignore"],
    env: bunEnv,
  });
  pSource.stdout!.resume();
  const before = (pSource.stdout as any).readableFlowing;
  // Hand pSource.stdout's fd to a sync child that exits without reading it.
  spawnSync(bunExe(), ["-e", ""], { stdio: [pSource.stdout!, "ignore", "ignore"], env: bunEnv });
  const after = (pSource.stdout as any).readableFlowing;

  expect(before).toBe(true);
  // After the fix the sync path does not quiesce; before it, flowing was false.
  expect(after).toBe(true);
});

test.skipIf(isWindows)("a destroyed subprocess stdin does not leak a stale fd to a later spawn", async () => {
  // Writable-side analogue of the readable test above. `writableFromFileSink`
  // caches the pipe fd on `stdin.fd`. The WriteStream `_destroy` only nulls it
  // via `close()`, which it skips on the async path (the sink still has
  // buffered bytes), so a destroyed stdin can retain a stale fd. `extractStreamFd`
  // rejects destroyed streams, so `spawn` raises a destroyed-stream error
  // instead of `dup2`'ing a closed (or kernel-reused) fd into the child.
  using pSink = spawn(bunExe(), ["-e", "setInterval(() => {}, 1 << 30)"], {
    stdio: ["pipe", "ignore", "ignore"],
    env: bunEnv,
  });
  // Write more than the pipe buffer (child never reads) so the FileSink keeps
  // pending bytes; `destroy()` then takes the async `_destroy` path that never
  // reaches `close()`, leaving `fd` set without the `extractStreamFd` guard.
  // The unflushed bytes surface as EPIPE when the sink closes; swallow it, the
  // stream is `destroyed` synchronously regardless.
  pSink.stdin!.on("error", () => {});
  pSink.stdin!.write(Buffer.alloc(1 << 20, 0x61));
  pSink.stdin!.destroy();
  expect(pSink.stdin!.destroyed).toBe(true);

  expect(() => spawn(bunExe(), ["-e", ""], { stdio: ["ignore", pSink.stdin!, "ignore"], env: bunEnv })).toThrow(
    /Cannot use a destroyed stream/,
  );
});

function collect(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.once("error", reject);
  });
}

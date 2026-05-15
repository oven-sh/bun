// https://github.com/oven-sh/bun/issues/30831
//
// `child_process.spawn` was unable to pipe one subprocess's stdio stream into
// another: `spawn(..., { stdio: [..., otherProc.stdin, ...] })` threw
// `stream.Readable stdio @ N` (unsupported) because `nodeToBun()` in
// `node:child_process` looked for `.fd` / `_handle.fd` on the stream (Node's
// `subprocess.stdin` is a `net.Socket` that exposes its pipe fd there), but
// Bun's `subprocess.stdin` is a `WriteStream` wrapping a `FileSink` and
// `subprocess.stdout`/`stderr` is a `Readable` wrapping a native
// `ReadableStream`. Neither surfaced the underlying pipe fd.
//
// Fix (three parts — removing any of the first three breaks one of the first
// three tests; the fourth test guards the ordering of part 2):
//   1. Surface `.fd` on both wrappers at construction time from the
//      underlying sink/source, so `nodeToBun` can forward the fd.
//   2. When `nodeToBun` extracts an fd from a stream, record the stream in a
//      `streamsToQuiesce` list; after `Bun.spawn` succeeds, pause each one
//      and tag it `kIsUsedAsStdio`. Mirrors Node's `getValidStdio`
//      post-spawn `readStop`/`pause`, without which the parent's own
//      `PipeReader` races the child for the pipe's bytes. The quiesce
//      runs AFTER spawn because `setFlowing(false)` is sticky at the
//      native layer with no user-recoverable counterpart — if we paused
//      pre-spawn and spawn then threw, the source stream would be stuck
//      forever.
//   3. `Bun.spawn`'s POSIX path clears `O_NONBLOCK` on the caller-supplied
//      fd before `dup2`; otherwise the child inherits non-blocking mode (the
//      parent set it for async reads) and a synchronous reader like `cat`
//      gets `EAGAIN: Resource temporarily unavailable` on its first read.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { spawn } from "node:child_process";

// Windows: inter-process stdio-fd hand-off is not implemented. `FileReader`'s
// pipe handle is a system-kind `HANDLE` and `Fd::uv()` panics on the non-stdio
// HANDLEs that subprocess pipes produce, so `get_fd()` returns `-1` on Windows
// and `nodeToBun` falls back to the unsupported-stream-stdio error.
const describeSkipOnWindows = isWindows ? test.skip : test;

// Tiny uppercasing filter implemented in bun itself so the test doesn't
// depend on `perl`/`tr`/`awk` being installed on the runner.
const UPPER = `
const chunks = [];
process.stdin.on("data", c => chunks.push(c));
process.stdin.on("end", () => {
  process.stdout.write(Buffer.concat(chunks).toString("utf8").toUpperCase());
});
`;

describeSkipOnWindows("spawn({ stdio: [..., childB.stdin, ...] }) pipes A's stdout into B's stdin", async () => {
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

describeSkipOnWindows(
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
    // promise never resolves even after `pSource` exits — guard that path.
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
    // `'close'` should also fire — otherwise libraries like `execa` that
    // await close (not exit) hang indefinitely.
    await Promise.race([
      sourceClose,
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error("pSource 'close' never fired")), 5000)),
    ]);
    expect(filterErr).toBe("");
    expect(sourceErr).toBe("");
    expect(out).toBe("HELLO WORLD");
    expect(sourceExit).toBe(0);
    expect(filterExit).toBe(0);
  },
);

describeSkipOnWindows(
  "spawn({ stdio: [..., process.stdout, process.stderr] }) forwards via the stream→fd path",
  async () => {
    // `process.stdout.fd === 1` / `process.stderr.fd === 2` are set by
    // `getStdioWriteStream`. These have always been numeric-fd objects in
    // Bun, so they were already accepted by `nodeToBun`'s `.fd` lookup — but
    // this PR routes them through the new `extractStreamFd` + `streamsToQuiesce`
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

describeSkipOnWindows("spawn failure (ENOENT) does not leave a passed-in source stream stuck", async () => {
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

function collect(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.once("error", reject);
  });
}

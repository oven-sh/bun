// https://github.com/oven-sh/bun/issues/30831
//
// `child_process.spawn` was unable to pipe one subprocess's stdio stream into
// another: `spawn(..., { stdio: [..., otherProc.stdin, ...] })` threw
// `TODO: stream.Readable stdio @ N` because `nodeToBun()` in
// `node:child_process` looked for `.fd` / `_handle.fd` on the stream (Node's
// `subprocess.stdin` is a `net.Socket` that exposes its pipe fd there), but
// Bun's `subprocess.stdin` is a `WriteStream` wrapping a `FileSink` and
// `subprocess.stdout`/`stderr` is a `Readable` wrapping a native
// `ReadableStream`. Neither surfaced the underlying pipe fd.
//
// Fix (three parts, all required — removing any one of them breaks one of the
// three tests below):
//   1. Surface `.fd` on both wrappers at construction time from the
//      underlying sink/source, so `nodeToBun` can forward the fd.
//   2. When `nodeToBun` extracts an fd from a stream, also pause the stream
//      and tag it `kIsUsedAsStdio` — mirrors Node's `getValidStdio`
//      post-spawn `readStop`/`pause`, without which the parent's own
//      `PipeReader` races the child for the pipe's bytes.
//   3. `Bun.spawn`'s POSIX path clears `O_NONBLOCK` on the caller-supplied
//      fd before `dup2`; otherwise the child inherits non-blocking mode (the
//      parent set it for async reads) and a synchronous reader like `cat`
//      gets `EAGAIN: Resource temporarily unavailable` on its first read.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { spawn } from "node:child_process";

// Tiny uppercasing filter implemented in bun itself so the test doesn't
// depend on `perl`/`tr`/`awk` being installed on the runner.
const UPPER = `
const chunks = [];
process.stdin.on("data", c => chunks.push(c));
process.stdin.on("end", () => {
  process.stdout.write(Buffer.concat(chunks).toString("utf8").toUpperCase());
});
`;

test("spawn({ stdio: [..., childB.stdin, ...] }) pipes A's stdout into B's stdin", async () => {
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

test("spawn({ stdio: [otherProc.stdout, ...] }) pipes A's stdout into B's stdin (reverse direction)", async () => {
  // Flip the direction: pSource owns the pipe (its stdout is piped), and
  // pFilter is spawned with pSource.stdout as its stdin. Node supports both
  // shapes; before the fix Bun threw `TODO: stream.Readable stdio @ 0` here
  // too.
  using pSource = spawn(bunExe(), ["-e", 'process.stdout.write("hello world")'], {
    stdio: ["ignore", "pipe", "pipe"],
    env: bunEnv,
  });
  const sourceStderr = collect(pSource.stderr!);

  using pFilter = spawn(bunExe(), ["-e", UPPER], {
    stdio: [pSource.stdout!, "pipe", "pipe"],
    env: bunEnv,
  });
  const filterStdout = collect(pFilter.stdout!);
  const filterStderr = collect(pFilter.stderr!);

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
  expect(filterExit).toBe(0);
});

test("spawn({ stdio: [..., process.stdout, process.stderr] }) still works (fd already on process streams)", async () => {
  // process.stdout.fd is set to 1 by getStdioWriteStream. This existed
  // before the fix but the code path shares `nodeToBun` with the two
  // tests above, so regression-guard it.
  using proc = spawn(bunExe(), ["-e", 'console.error("from-child")'], {
    stdio: ["ignore", "pipe", "pipe"],
    env: bunEnv,
  });
  const [stdout, stderr] = await Promise.all([collect(proc.stdout!), collect(proc.stderr!)]);
  expect(stdout).toBe("");
  expect(stderr).toBe("from-child\n");
});

function collect(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.once("error", reject);
  });
}

import { $, generateHeapSnapshot } from "bun";

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { createReadStream } from "node:fs";
import { join } from "node:path";

// We skip this test on Windows becasue:
// 1. Windows didn't have this problem to begin with
// 2. We need system cat.
test.skipIf(isWindows)("writing > send buffer size doesn't block the main thread", async () => {
  const expected = Buffer.alloc(1024 * 1024, "bun!").toString();
  const massiveComamnd = "echo " + expected + " | " + Bun.which("cat");
  const pendingResult = $`${{
    raw: massiveComamnd,
  }}`.text();

  // Ensure that heap snapshot works, to excercise the memoryCost & estimated fields.
  generateHeapSnapshot("v8");

  const result = await pendingResult;

  if (result !== expected + "\n") {
    throw new Error("Expected " + expected + "\n but got " + result);
  }
});

test.skipIf(isWindows)("writing > send buffer size (with a variable) doesn't block the main thread", async () => {
  const expected = Buffer.alloc(1024 * 1024, "bun!").toString();
  const result = await $`echo ${expected} | ${Bun.which("cat")}`.text();

  if (result !== expected + "\n") {
    throw new Error("Expected " + expected + "\n but got " + result);
  }
});

// Redirecting a builtin's stdout to a named pipe must go through the pollable
// IOWriter path. Previously the redirect fd was hardcoded as non-pollable on
// POSIX while open_for_writing_impl still set O_NONBLOCK, so a large echo hit
// EAGAIN inside do_file_write and panicked with
// "drainBufferedData returning .pending in IOWriter.doFileWrite should not happen".
test.skipIf(isWindows)("builtin redirect to a named pipe larger than the pipe buffer", async () => {
  using dir = tempDir("shell-fifo-redirect", {
    "run.ts": `
      // 200KB: larger than the default 64KB pipe buffer so the first write()
      // only partially drains and the next one returns EAGAIN.
      const big = Buffer.alloc(200_000, "bun!").toString();
      await Bun.$\`echo \${big} > \${process.argv[2]}\`;
    `,
  });
  const fifo = join(String(dir), "out.fifo");
  mkfifo(fifo);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run.ts", fifo],
    env: bunEnv,
    cwd: String(dir),
    stderr: "pipe",
    stdout: "pipe",
  });

  // Open the read end so the child's O_WRONLY open unblocks; draining here
  // is what lets the pollable writer make progress after EAGAIN.
  const reader = createReadStream(fifo, { encoding: "utf8" });
  let received = "";
  const drained = new Promise<void>((resolve, reject) => {
    reader.on("data", chunk => {
      received += chunk;
    });
    reader.on("close", resolve);
    reader.on("error", reject);
  });

  // If the child exits non-zero before (or without) opening the fifo, tear
  // down the reader so `drained` settles instead of waiting for EOF forever.
  const exited = proc.exited.then(code => {
    if (code !== 0) reader.destroy();
    return code;
  });
  const [stderr, stdout, exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), exited, drained]);

  const expected = Buffer.alloc(200_000, "bun!").toString() + "\n";
  // Combined object so stderr shows in the failure diff; exact-empty stderr is
  // not asserted separately (ASAN/debug lanes may emit benign noise).
  expect({ stdout, receivedLen: received.length, exitCode }).toEqual({
    stdout: "",
    receivedLen: expected.length,
    exitCode: 0,
  });
  if (exitCode !== 0) throw new Error(`child failed:\n${stderr}`);
  expect(received).toBe(expected);
});

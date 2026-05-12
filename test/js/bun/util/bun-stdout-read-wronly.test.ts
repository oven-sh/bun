import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tmpdirSync } from "harness";
import { closeSync, constants, openSync, unlinkSync } from "node:fs";
import { join } from "node:path";

// Reading a Blob wrapping a write-only pollable fd (like the write end of a
// pipe) used to hang forever: the ReadFile code would poll for readability,
// get "not ready", and then register for EPOLLIN/EVFILT_READ on the write end,
// which never fires. Now it rejects with EBADF instead of waiting.
test.skipIf(isWindows)("Bun.file(fd).text() rejects on a write-only FIFO instead of hanging", async () => {
  const dir = tmpdirSync();
  const fifo = join(dir, "fifo");
  Bun.spawnSync({ cmd: ["mkfifo", fifo], env: bunEnv });

  // Open a non-blocking reader so opening the write side doesn't block.
  const reader = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
  const writer = openSync(fifo, constants.O_WRONLY);
  try {
    let result: unknown;
    try {
      result = await Bun.file(writer).text();
    } catch (e) {
      result = e;
    }
    expect(result).toBeInstanceOf(Error);
    expect((result as NodeJS.ErrnoException).code).toBe("EBADF");
  } finally {
    closeSync(writer);
    closeSync(reader);
    unlinkSync(fifo);
  }
});

// This is the fuzzer-reduced case: HTMLRewriter picks up Blob.prototype.text as
// the document text handler and synchronously waits on the returned promise.
// When stdout is a shell pipe (O_WRONLY FIFO) this used to wedge the process.
test.skipIf(isWindows)("HTMLRewriter.onDocument(Bun.stdout).transform() does not hang when stdout is a pipe", async () => {
  const script = `
    const r = new HTMLRewriter();
    r.onDocument(Bun.stdout);
    try { r.transform(new SharedArrayBuffer(16)); } catch {}
    console.error("done");
  `;
  // Use a shell pipeline so the child's stdout is a real FIFO (write-only),
  // matching how shells / fuzzilli set up stdio.
  await using proc = Bun.spawn({
    cmd: ["sh", "-c", `"$0" -e "$1" | cat > /dev/null`, bunExe(), script],
    env: bunEnv,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });

  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

  expect(stderr.trim()).toBe("done");
  expect(exitCode).toBe(0);
});

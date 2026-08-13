import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isDebug, isMacOS, isWindows, tempDir, waitForFileToContain } from "harness";
import { mkfifo } from "mkfifo";
import { randomBytes } from "node:crypto";
import { closeSync, constants, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

it("offset should work in Bun.file() #4963", async () => {
  const filename = tmpdir() + "/bun.test.offset.txt";
  await Bun.write(filename, "contents");
  const file = Bun.file(filename);
  const slice = file.slice(2, file.size);
  const contents = await slice.text();
  expect(contents).toBe("ntents");
});

// ReadFile::read_until_blocked picks its read target per iteration: the 64 KB stack buffer
// when self.buffer's spare capacity is smaller, otherwise the Vec's spare
// capacity directly. Cover both branches plus the max_length cap so the
// branch selection and the commit_spare path stay tied to the same decision.
describe("Bun.file read-loop target selection", () => {
  function pattern(size: number, seed: number) {
    const out = Buffer.alloc(size);
    for (let i = 0; i < size; i++) out[i] = (i * seed + 7) & 0xff;
    return out;
  }

  it.each([
    ["small file (stack-buffer path)", 1024],
    ["64 KB boundary", 64 * 1024],
    ["large file (spare-capacity path)", 256 * 1024 + 17],
  ] as const)("%s", async (_label, size) => {
    const bytes = pattern(size, 131);
    using dir = tempDir("bun-file-read-target", {});
    const p = path.join(String(dir), "data.bin");
    await Bun.write(p, bytes);

    const buf = new Uint8Array(await Bun.file(p).arrayBuffer());
    expect(buf.length).toBe(size);
    expect(Bun.hash(buf)).toBe(Bun.hash(bytes));
  });

  it("slice(offset, end) honours max_length across the stack/spare split", async () => {
    const size = 256 * 1024;
    const bytes = pattern(size, 97);
    using dir = tempDir("bun-file-read-slice", {});
    const p = path.join(String(dir), "data.bin");
    await Bun.write(p, bytes);

    // 70_000 bytes: larger than one stack-buffer fill, smaller than the whole
    // file, and not a multiple of 64 KB.
    const start = 10;
    const end = 70_010;
    const buf = new Uint8Array(await Bun.file(p).slice(start, end).arrayBuffer());
    expect(buf.length).toBe(end - start);
    expect(Bun.hash(buf)).toBe(Bun.hash(bytes.subarray(start, end)));
  });
});

// Reading a FIFO by path. Nothing is written until the child has found the pipe
// empty and handed its ReadFile to the io thread, so the read goes through at
// least one io-thread round trip, and (on Linux) through one more at the end to
// unregister the fd before the fd it opened is closed. In debug builds the
// child's ReadFile trace is what proves those hand-overs happened; in release
// builds the logging is compiled out and only the result is checked.
//
// macOS: the child never finishes this read (the test times out with the child
// still alive) while the same setup completes on Linux; reading a FIFO by path
// on macOS is also what "Bun.file() read text from pipe" in
// test/js/web/streams/streams.test.js is todo'd for. The read-side hand-overs
// are covered on macOS by the Bun.stdin pipe tests (test/regression/issue/07500,
// bun-stdin-slice.test.ts); what this adds is the path-opened variant.
describe.skipIf(isWindows || isMacOS)("Bun.file(fifo)", () => {
  const count = (trace: string, marker: string) => trace.split(marker).length - 1;

  it("bytes() waits for the writer, reads what it writes and ends when it closes", async () => {
    const payload = randomBytes(256 * 1024);
    using dir = tempDir("bun-file-read-fifo", {});
    const fifo = path.join(String(dir), "in.fifo");
    const trace = path.join(String(dir), "trace.log");
    mkfifo(fifo);
    // The write end can only be opened, and written to without EPIPE, while
    // some reader has the FIFO open; `holder` is that reader until the child
    // has opened its own. It never reads, so every byte goes to the child.
    let holder = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
    const closeHolder = () => {
      if (holder !== -1) closeSync(holder);
      holder = -1;
    };
    let writer = openSync(fifo, "w");
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const bytes = await Bun.file(process.env.FIFO).bytes(); process.stdout.write(bytes.length + " " + Bun.hash(bytes));`,
        ],
        // ReadFile logs under the WriteFile scope; BUN_DEBUG sends the scoped logs to a file.
        env: { ...bunEnv, FIFO: fifo, ...(isDebug ? { BUN_DEBUG_WriteFile: "1", BUN_DEBUG: trace } : {}) },
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = proc.stderr.text();
      // The child cannot exit before the payload is written unless it failed;
      // dropping `holder` then leaves the pipe without readers, so a write
      // blocked on it fails with EPIPE instead of waiting forever.
      const childDied = proc.exited.then(async exitCode => {
        closeHolder();
        throw new Error(`child exited with ${exitCode} before the payload was written: ${await stderr}`);
      });
      if (isDebug) {
        // The io thread has run the child's request: it is waiting for data that does not exist yet.
        await Promise.race([waitForFileToContain(trace, "ReadFile.onRequestReadable"), childDied]);
      }
      // The write end is blocking, so this completes as the child drains the
      // pipe; closing it afterwards is what ends the child's read.
      const written = await Promise.race([Bun.write(Bun.file(writer), payload), childDied]);
      closeSync(writer);
      writer = -1;
      const [stdout, stderrText, exitCode] = await Promise.all([proc.stdout.text(), stderr, proc.exited]);

      expect({ written, stdout, stderr: stderrText }).toEqual({
        written: payload.length,
        stdout: `${payload.length} ${Bun.hash(payload)}`,
        stderr: "",
      });
      expect(exitCode).toBe(0);

      if (isDebug) {
        const log = readFileSync(trace, "utf8");
        const waits = count(log, "ReadFile.waitForReadable");
        expect(waits).toBeGreaterThanOrEqual(1);
        // Every wait is one request popped by the io thread and one readiness
        // callback; the close then round-trips through the io thread once
        // (deferred) before the read completes (immediately).
        expect({
          requests: count(log, "ReadFile.onRequestReadable"),
          readies: count(log, "ReadFile.onReady"),
          ioErrors: count(log, "ReadFile.onIOError"),
          deferredCloses: count(log, "ReadFile.onFinish() = deferred"),
          completions: count(log, "ReadFile.onFinish() = immediately"),
        }).toEqual({ requests: waits, readies: waits, ioErrors: 0, deferredCloses: 1, completions: 1 });
      }
    } finally {
      if (writer !== -1) closeSync(writer);
      closeHolder();
    }
  });
});

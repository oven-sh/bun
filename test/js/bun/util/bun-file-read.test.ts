import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { existsSync } from "node:fs";
import { open } from "node:fs/promises";
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

// do_read_loop picks its read target per iteration: the 64 KB stack buffer
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

  // A character device never ends, so only the slice can end the read. It is
  // read 64 KB at a time, and each read may ask for no more than what is left
  // of the slice.
  it.skipIf(isWindows).each([
    ["one read fills it", 64 * 1024],
    ["the second read takes one byte", 64 * 1024 + 1],
    ["the second read is cut short", 70_000],
    ["the fourth read is cut short", 200_000],
  ] as const)("slice(0, N) of /dev/zero reads N bytes: %s", async (_label, n) => {
    const slice = Bun.file("/dev/zero").slice(0, n);
    const bytes = await slice.bytes();
    expect({
      bytes: bytes.length,
      zeros: Buffer.alloc(bytes.length).equals(bytes),
      arrayBuffer: (await slice.arrayBuffer()).byteLength,
      text: (await slice.text()).length,
    }).toEqual({ bytes: n, zeros: true, arrayBuffer: n, text: n });
  });

  // A procfs file is a regular file with st_size 0, and one read() of it
  // returns at most a page of whole lines. A regular file is not polled: the
  // loop reads again at once, for what is left of the slice.
  it.skipIf(!existsSync("/proc/kallsyms")).each([
    ["the second read is cut short", 5000],
    ["short reads into the stack buffer, then into the spare capacity", 400_000],
  ] as const)("slice(0, N) of /proc/kallsyms reads its first N bytes: %s", async (_label, n) => {
    const expected = Buffer.alloc(n);
    {
      await using kallsyms = await open("/proc/kallsyms");
      for (let got = 0, r; got < n && (r = (await kallsyms.read(expected, got, n - got)).bytesRead) > 0;) got += r;
    }

    const slice = Bun.file("/proc/kallsyms").slice(0, n);
    const bytes = await slice.bytes();
    expect({
      bytes: bytes.length,
      same: expected.equals(bytes),
      arrayBuffer: (await slice.arrayBuffer()).byteLength,
      text: (await slice.text()).length,
    }).toEqual({ bytes: n, same: true, arrayBuffer: n, text: n });
  });

  // A FIFO holds less than the slice, so the read takes several reads and
  // waits for the writer in between. The bytes after the slice stay in the
  // pipe for the next reader.
  it.skipIf(isWindows)("slice(0, N) of a FIFO reads N bytes and leaves the rest in the pipe", async () => {
    const n = 70_000;
    const data = pattern(200_000, 131);
    using dir = tempDir("bun-file-read-fifo", {});
    const fifo = path.join(String(dir), "fifo");
    mkfifo(fifo);
    // Read and write: the slice's own open() finds a writer, and this handle reads what the slice leaves.
    await using pipe = await open(fifo, "r+");

    // 4 KB per write(): on macOS a FIFO wakes a reader that waits for it only when a write() returns,
    // and one write() of all the data returns after its last byte.
    async function write() {
      for (let sent = 0; sent < data.length;) {
        sent += (await pipe.write(data, sent, Math.min(4096, data.length - sent))).bytesWritten;
      }
    }
    async function read() {
      const slice = Buffer.from(await Bun.file(fifo).slice(0, n).bytes());
      const rest = Buffer.alloc(data.length - slice.length);
      for (let got = 0; got < rest.length;) got += (await pipe.read(rest, got, rest.length - got)).bytesRead;
      return { slice, rest };
    }
    const [{ slice, rest }] = await Promise.all([read(), write()]);

    expect({ slice: slice.length, rest: rest.length, inOrder: Buffer.concat([slice, rest]).equals(data) }).toEqual({
      slice: n,
      rest: data.length - n,
      inOrder: true,
    });
  });

  // Nothing is ever written to this FIFO: an empty slice has no byte to wait for.
  it.skipIf(isWindows)("slice(0, 0) of a FIFO that stays open and silent reads nothing without waiting", async () => {
    using dir = tempDir("bun-file-read-fifo-empty", {});
    const fifo = path.join(String(dir), "fifo");
    mkfifo(fifo);
    // Held open for writing too, so the pipe never becomes readable: not by a byte, not by a hang-up.
    await using pipe = await open(fifo, "r+");

    expect((await Bun.file(fifo).slice(0, 0).bytes()).length).toBe(0);
  });
});

// The same slices on the one pipe that every platform has: the stdin of a
// child process. The read is ReadFile on POSIX and ReadFileUV on Windows. The
// child prints the slice as <...>, then "|", then what it reads from the same
// stdin next.
describe("Bun.stdin.slice(0, N) read into memory from a pipe that stays open", () => {
  function spawnSliceThenRest(n: number) {
    const proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.stdout.write("<" + (await Bun.stdin.slice(0, ${n}).text()) + ">|");
         process.stdout.write(await Bun.stdin.text());`,
      ],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let stdout = "";
    // Drained from the start so a failing child can never block on a full stderr pipe while stdout is being waited on.
    const stderr = proc.stderr.text();
    async function drain(until?: string) {
      for (let r; !(until && stdout.includes(until)) && !(r = await reader.read()).done;) {
        stdout += decoder.decode(r.value, { stream: true });
      }
      return stdout;
    }
    return {
      proc,
      stdoutUntil: (marker: string) => drain(marker),
      // stdout is drained while stdin is flushed: the child prints what it reads.
      async finish() {
        const [, exitCode] = await Promise.all([drain(), proc.exited, proc.stdin.end()]);
        return { stdout, stderr: await stderr, exitCode };
      },
    };
  }

  it.concurrent("a slice that takes more than one read", async () => {
    const n = 70_000;
    const data = Buffer.alloc(200_000, "0123456789abcdefghijklmnopqrstuvwxyz").toString();
    const child = spawnSliceThenRest(n);
    await using proc = child.proc;
    proc.stdin.write(data);

    const { stdout, stderr, exitCode } = await child.finish();
    const [slice, rest = ""] = stdout.slice(1).split(">|");
    expect({ slice: slice.length, rest: rest.length, inOrder: slice + rest === data, stderr, exitCode }).toEqual({
      slice: n,
      rest: data.length - n,
      inOrder: true,
      stderr: "",
      exitCode: 0,
    });
  });

  it.concurrent("a write that fills the slice exactly ends the read", async () => {
    const child = spawnSliceThenRest(4);
    await using proc = child.proc;
    proc.stdin.write("0123");
    await proc.stdin.flush();
    // "|" means the read ended while stdin was still open, with nothing more in it.
    expect(await child.stdoutUntil("|")).toBe("<0123>|");

    proc.stdin.write("456");
    expect(await child.finish()).toEqual({ stdout: "<0123>|456", stderr: "", exitCode: 0 });
  });

  it.concurrent("an empty slice ends without waiting for any input", async () => {
    const child = spawnSliceThenRest(0);
    await using proc = child.proc;
    // Nothing has been written: only the slice itself can end the read.
    expect(await child.stdoutUntil("|")).toBe("<>|");

    proc.stdin.write("xyz");
    expect(await child.finish()).toEqual({ stdout: "<>|xyz", stderr: "", exitCode: 0 });
  });
});

import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { randomBytes } from "node:crypto";
import { closeSync, constants, openSync } from "node:fs";
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

// Reading a FIFO by path. The payload is several pipe buffers long, so the
// ReadFile is handed to the io thread every time it drains the pipe and has to
// wait for more, and once the writer closes it is (on Linux) handed over once
// more to unregister the fd before the fd it opened is closed.
describe.skipIf(isWindows)("Bun.file(fifo)", () => {
  it("bytes() reads a pipe that is filled in pieces and ends when the writer closes", async () => {
    const payload = randomBytes(256 * 1024);
    using dir = tempDir("bun-file-read-fifo", {});
    const fifo = path.join(String(dir), "in.fifo");
    mkfifo(fifo);
    // Opening the write end needs a reader to exist. The holder stays open so
    // the child finds a connected writer (rather than EOF) whenever it opens
    // the FIFO; it never reads, so every byte goes to the child.
    const holder = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
    let writer = openSync(fifo, "w");
    try {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          "-e",
          `const bytes = await Bun.file(process.env.FIFO).bytes(); process.stdout.write(bytes.length + " " + Bun.hash(bytes));`,
        ],
        env: { ...bunEnv, FIFO: fifo },
        stdout: "pipe",
        stderr: "pipe",
      });
      // The write end is blocking, so this only completes as the child drains
      // the pipe; closing it afterwards is what ends the child's read.
      const written = await Bun.write(Bun.file(writer), payload);
      closeSync(writer);
      writer = -1;
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect({ written, stdout, stderr }).toEqual({
        written: payload.length,
        stdout: `${payload.length} ${Bun.hash(payload)}`,
        stderr: "",
      });
      expect(exitCode).toBe(0);
    } finally {
      if (writer !== -1) closeSync(writer);
      closeSync(holder);
    }
  });
});

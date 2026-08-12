import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
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
//
// macOS: the child never finishes this read (the test times out with the child
// still alive) while the same setup completes on Linux; reading a FIFO by path
// on macOS is also what "Bun.file() read text from pipe" in
// test/js/web/streams/streams.test.js is todo'd for. The read-side hand-overs
// are covered on macOS by the Bun.stdin pipe tests (test/regression/issue/07500,
// bun-stdin-slice.test.ts); what this adds is the path-opened variant.
describe.skipIf(isWindows || isMacOS)("Bun.file(fifo)", () => {
  it("bytes() reads a pipe that is filled in pieces and ends when the writer closes", async () => {
    const payload = randomBytes(256 * 1024);
    using dir = tempDir("bun-file-read-fifo", {});
    const fifo = path.join(String(dir), "in.fifo");
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
        env: { ...bunEnv, FIFO: fifo },
        stdout: "pipe",
        stderr: "pipe",
      });
      const stderr = proc.stderr.text();
      // The write end is blocking, so the write only completes as the child
      // drains the pipe, and closing it afterwards is what ends the child's
      // read. The child cannot exit before that unless it failed; dropping
      // `holder` then leaves the pipe without readers, so the blocked write
      // fails with EPIPE instead of waiting forever.
      const childDied = proc.exited.then(async exitCode => {
        closeHolder();
        throw new Error(`child exited with ${exitCode} before the payload was written: ${await stderr}`);
      });
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
    } finally {
      if (writer !== -1) closeSync(writer);
      closeHolder();
    }
  });
});

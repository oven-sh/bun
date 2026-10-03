import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
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
});

// After `fs.closeSync(N)` with N = 0, 1 or 2, the next open(2) of the process returns N. So the file
// that a read of Bun.file(path) opens can get that number. The read must still close the file at
// its end: the number does not make it the stdio of the process.
// On Windows libuv's close does nothing for fd 0, 1 and 2, so the number is never free there.
describe.skipIf(isWindows)("Bun.file(path) read while fd 0, 1 or 2 is closed", () => {
  it.concurrent.each([0, 1, 2])("each kind of read closes the file it opened at fd %d", async fd => {
    using dir = tempDir("bun-file-read-closed-stdio", { "src.txt": "hello world" });
    if (isLinux) mkfifo(path.join(String(dir), "fifo"));
    const script = `
      import fs from "node:fs";
      import { basename, join } from "node:path";
      const dir = ${JSON.stringify(String(dir))};
      const src = join(dir, "src.txt");
      const fifo = join(dir, "fifo");
      // What is open at a fd number: "closed", or the name of the file.
      const at = fd => {
        let stat;
        try {
          stat = fs.fstatSync(fd);
        } catch (e) {
          return e.code === "EBADF" ? "closed" : e.code;
        }
        const file = [src, fifo].find(file => {
          const s = fs.statSync(file, { throwIfNoEntry: false });
          return s && s.dev === stat.dev && s.ino === stat.ino;
        });
        return file ? basename(file) : "open";
      };
      const reads = {
        "text()": () => Bun.file(src).text(),
        "bytes()": async () => (await Bun.file(src).bytes()).length,
        "slice(1, 3).text()": () => Bun.file(src).slice(1, 3).text(),
        "new Response(file).text()": () => new Response(Bun.file(src)).text(),
        "text() of a directory": () => Bun.file(dir).text(),
      };
      if (process.platform === "linux") {
        // The FIFO is empty and this end has it open for writing, so the read waits on the io thread.
        const writer = fs.openSync(fifo, fs.constants.O_RDWR);
        // /proc shows the wait: the fd of the read is in an epoll set.
        const waits = fd =>
          fs.readdirSync("/proc/self/fdinfo").some(name => {
            try {
              const lines = fs.readFileSync("/proc/self/fdinfo/" + name, "utf8").split("\\n");
              return lines.some(line => line.startsWith("tfd:") && parseInt(line.slice(4)) === fd);
            } catch {
              return false;
            }
          });
        reads["text() of a FIFO"] = async () => {
          const text = Bun.file(fifo).text();
          // Only the read opens a file now, so the free number goes to it.
          while (at(${fd}) !== "fifo") await new Promise(resolve => setImmediate(resolve));
          while (!waits(${fd})) await new Promise(resolve => setImmediate(resolve));
          fs.writeSync(writer, "from a fifo");
          fs.closeSync(writer);
          return await text;
        };
      }
      // The thread pool starts before the fd number is free.
      await Bun.file(src).text();
      fs.closeSync(${fd});
      const result = {};
      for (const [name, read] of Object.entries(reads)) {
        const outcome = await read().catch(e => e.code);
        result[name] = [outcome, at(${fd})];
        // A file that this read left there must not hide what the next read does.
        if (at(${fd}) !== "closed") fs.closeSync(${fd});
      }
      // The report goes to a fd that the script did not close.
      fs.writeSync(${fd === 2 ? 1 : 2}, "REPORT " + JSON.stringify(result) + "\\n");
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdio: ["ignore", "pipe", "pipe"] });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Match the line: a sanitizer build can add its own warnings to stderr.
    const line = (stdout + "\n" + stderr).match(/^REPORT (.*)$/m)?.[1];
    expect({ report: line ? JSON.parse(line) : { stdout, stderr }, exitCode }).toEqual({
      report: {
        "text()": ["hello world", "closed"],
        "bytes()": [11, "closed"],
        "slice(1, 3).text()": ["el", "closed"],
        "new Response(file).text()": ["hello world", "closed"],
        "text() of a directory": ["EISDIR", "closed"],
        ...(isLinux && { "text() of a FIFO": ["from a fifo", "closed"] }),
      },
      exitCode: 0,
    });
  });
});

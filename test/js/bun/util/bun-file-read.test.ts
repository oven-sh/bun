import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { randomBytes } from "node:crypto";
import { closeSync, constants, openSync, writeSync } from "node:fs";
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

// Whole-file reads of a named pipe. All but the last end with the reader
// having drained the pipe and then learning that the last writer closed; on
// macOS that EOF is invisible to kqueue and poll(2) (they only see buffered
// bytes on a FIFO), so the reader has to wait for it differently than it does
// for a pipe(2) pipe, and each of these used to leave the child blocked
// forever there.
describe.skipIf(isWindows)("reading a named pipe", () => {
  function readFifoInChild(script: string, fifo: string, stdin: number | "ignore" = "ignore") {
    return Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: { ...bunEnv, FIFO: fifo },
      stdin,
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  // When a FIFO end gets closed is what these tests are about, so each one is
  // closed explicitly at the right moment; `using` only covers the failure paths.
  function openFd(file: string, flags: number | string) {
    let fd = openSync(file, flags);
    return {
      get fd() {
        return fd;
      },
      close() {
        if (fd !== -1) closeSync(fd);
        fd = -1;
      },
      [Symbol.dispose]() {
        this.close();
      },
    };
  }

  // The child must already have the FIFO open for reading before a writer can
  // connect to it: a non-blocking open for writing fails with ENXIO until then.
  async function openWriterOnceChildIsReading(fifo: string, child: Bun.Subprocess) {
    const deadline = performance.now() + 10_000;
    while (true) {
      try {
        return openFd(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
      } catch (err: any) {
        if (err.code !== "ENXIO") throw err;
      }
      const exited = child.exitCode ?? child.signalCode;
      if (exited !== null || performance.now() > deadline) {
        throw new Error(
          `nothing opened ${fifo} for reading; child ${exited === null ? "is still running" : `exited (${exited})`}`,
        );
      }
      await Bun.sleep(5);
    }
  }

  it.concurrent("bytes() collects a payload that arrives in pieces and ends when the writer closes", async () => {
    const payload = randomBytes(256 * 1024);
    using dir = tempDir("bun-file-read-fifo", {});
    const fifo = path.join(String(dir), "in.fifo");
    mkfifo(fifo);
    // The write end can only be opened, and written to without EPIPE, while
    // some reader has the FIFO open; `holder` is that reader until the child
    // has opened its own. It never reads, so every byte goes to the child.
    using holder = openFd(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
    using writer = openFd(fifo, "w");
    await using proc = readFifoInChild(
      `const bytes = await Bun.file(process.env.FIFO).bytes(); process.stdout.write(bytes.length + " " + Bun.hash(bytes));`,
      fifo,
    );
    const stderr = proc.stderr.text();
    // The write end is blocking, so this write only completes as the child
    // drains the pipe, and closing it afterwards is what ends the child's
    // read. The child cannot exit before that unless it failed; dropping
    // `holder` then leaves the pipe without readers, so the blocked write
    // fails with EPIPE instead of waiting forever.
    const childDied = proc.exited.then(async exitCode => {
      holder.close();
      throw new Error(`child exited with ${exitCode} before the payload was written: ${await stderr}`);
    });
    const written = await Promise.race([Bun.write(Bun.file(writer.fd), payload), childDied]);
    writer.close();
    const [stdout, stderrText, exitCode] = await Promise.all([proc.stdout.text(), stderr, proc.exited]);

    expect({ written, stdout, stderr: stderrText }).toEqual({
      written: payload.length,
      stdout: `${payload.length} ${Bun.hash(payload)}`,
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  it.concurrent("text() waits for a writer that connects after the read started", async () => {
    using dir = tempDir("bun-file-read-fifo-late-writer", {});
    const fifo = path.join(String(dir), "late.fifo");
    mkfifo(fifo);

    await using proc = readFifoInChild(`process.stdout.write(await Bun.file(process.env.FIFO).text());`, fifo);
    using writer = await openWriterOnceChildIsReading(fifo, proc);
    writeSync(writer.fd, "written after the reader opened\n");
    writer.close();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "written after the reader opened\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  it.concurrent("text() resolves empty when the writer connects and closes without writing", async () => {
    using dir = tempDir("bun-file-read-fifo-empty", {});
    const fifo = path.join(String(dir), "empty.fifo");
    mkfifo(fifo);

    await using proc = readFifoInChild(
      `const text = await Bun.file(process.env.FIFO).text(); process.stdout.write(JSON.stringify(text));`,
      fifo,
    );
    using writer = await openWriterOnceChildIsReading(fifo, proc);
    writer.close();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: '""', stderr: "" });
    expect(exitCode).toBe(0);
  });

  it.concurrent("Bun.stdin.text() reads a FIFO inherited as stdin to EOF", async () => {
    using dir = tempDir("bun-file-read-fifo-stdin", {});
    const fifo = path.join(String(dir), "stdin.fifo");
    mkfifo(fifo);

    // Same dance as above: a reader has to exist before the write end can be
    // opened; here that reader becomes the child's stdin.
    using readEnd = openFd(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
    using writer = openFd(fifo, "w");
    await using proc = readFifoInChild(
      `process.stdout.write(JSON.stringify(await Bun.stdin.text()));`,
      fifo,
      readEnd.fd,
    );
    // The child has its own descriptor for the read end now.
    readEnd.close();
    writeSync(writer.fd, "stdin is a named pipe\n");
    writer.close();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: JSON.stringify("stdin is a named pipe\n"), stderr: "" });
    expect(exitCode).toBe(0);
  });

  // The macOS wait is a select(2); this is the case where a plain fd_set
  // would not hold the descriptor (FD_SETSIZE is 1024 there).
  it.concurrent("Bun.file(fd) reads a FIFO whose descriptor number is above FD_SETSIZE", async () => {
    using dir = tempDir("bun-file-read-fifo-high-fd", {});
    const fifo = path.join(String(dir), "high.fifo");
    mkfifo(fifo);

    await using proc = readFifoInChild(
      `import { constants, openSync } from "node:fs";
       while (openSync("/dev/null", "r") < 1024) {}
       const fd = openSync(process.env.FIFO, constants.O_RDONLY | constants.O_NONBLOCK);
       const text = await Bun.file(fd).text();
       process.stdout.write(JSON.stringify({ fd, text }));`,
      fifo,
    );
    using writer = await openWriterOnceChildIsReading(fifo, proc);
    writeSync(writer.fd, "read through a high fd\n");
    writer.close();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { fd, text } = JSON.parse(stdout);
    expect(fd).toBeGreaterThanOrEqual(1024);
    expect(text).toBe("read through a high fd\n");
    expect(exitCode).toBe(0);
  });

  // A read that is waiting for a writer which never shows up must not keep
  // its VM from shutting down: the wait has to happen outside the job's VM
  // borrow, which terminate() waits for.
  it.concurrent("terminate() completes while a worker's read is waiting on an idle writer", async () => {
    using dir = tempDir("bun-file-read-fifo-worker", {
      "main.fixture.ts": `
        const worker = new Worker(new URL("./worker.fixture.ts", import.meta.url).href);
        const closed = new Promise(resolve => worker.addEventListener("close", resolve));
        worker.addEventListener("message", ({ data }) => console.log(data));
        // Our stdin is closed once the test has connected a writer to the FIFO.
        await Bun.stdin.text();
        worker.terminate();
        await closed;
        console.log("terminated");
      `,
      "worker.fixture.ts": `
        const read = Bun.file(process.env.FIFO!).text();
        postMessage("reading");
        await read;
        postMessage("the read finished, which it should not have");
      `,
    });
    const fifo = path.join(String(dir), "idle.fifo");
    mkfifo(fifo);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.fixture.ts"],
      cwd: String(dir),
      env: { ...bunEnv, FIFO: fifo },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    // Connecting a writer proves the worker's read has the FIFO open; never
    // writing to it keeps that read waiting for the rest of the test.
    using _idleWriter = await openWriterOnceChildIsReading(fifo, proc);
    proc.stdin.end();

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "reading\nterminated\n", stderr: "" });
    expect(exitCode).toBe(0);
  });
});

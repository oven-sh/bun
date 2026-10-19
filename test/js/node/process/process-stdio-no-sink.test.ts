import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import fs from "node:fs";
import path from "path";

// process.stdout / process.stderr with no FileSink. Bun.file(fd).writer() throws when its dup fails (the fd table is
// full when the stream is first read) or when the event loop cannot poll the fd. The stream then writes with
// fs.writeSync, and its callers must see the same stream as with a FileSink.
//
// POSIX only: on Windows the writer cannot fail for fd 1 or 2.
// Not concurrent: each test starts one bun, and on a debug build several at once come close to the test timeout.
describe.skipIf(isWindows)("process.stdout/stderr with no FileSink", () => {
  const fixture = path.join(import.meta.dir, "process-stdio-no-sink-fixture.mjs");
  // The fixture fills the fd table before it reads the stream. `ulimit -n` keeps that table small.
  const atFdLimit = (...args: string[]) => ["/bin/sh", "-c", 'ulimit -n 64 && exec "$@"', "sh", bunExe(), ...args];
  // A debug build prints other lines on stderr too. With no report, show them all.
  const reportIn = (output: string) => {
    const line = output.split("\n").find(line => line.startsWith('{"type":'));
    return line === undefined ? output : JSON.parse(line);
  };
  const EPIPE6 = ["EPIPE", "EPIPE", "EPIPE", "EPIPE", "EPIPE", "EPIPE"];

  // Runs a scenario whose writes fail: the parent closes its end of the stream before the child writes.
  async function withReaderGone(which: "stdout" | "stderr", scenario: string) {
    await using proc = Bun.spawn({
      cmd: atFdLimit(fixture, which, scenario),
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [data, report] = which === "stdout" ? [proc.stdout, proc.stderr] : [proc.stderr, proc.stdout];
    await data.cancel();
    proc.stdin.write("go");
    await proc.stdin.end();
    const [output, exitCode] = await Promise.all([report.text(), proc.exited]);
    return { report: reportIn(output), exitCode };
  }

  test.each(["stdout", "stderr"] as const)(
    "process.%s: every write gets its callback when the reader is gone",
    async which => {
      expect(await withReaderGone(which, "failed-writes")).toEqual({
        report: { type: "fs", sink: false, callbacks: EPIPE6, errors: ["EPIPE", "EPIPE"], writableLength: 0 },
        exitCode: 0,
      });
    },
  );

  // Node never runs these end() callbacks: its reset leaves errorEmitted set, and end() waits on it.
  test("process.stdout: end() after failed writes finishes and stays final", async () => {
    expect(await withReaderGone("stdout", "failed-writes-then-end")).toEqual({
      report: {
        type: "fs",
        sink: false,
        callbacks: [...EPIPE6, "ERR_STREAM_WRITE_AFTER_END"],
        errors: ["EPIPE", "EPIPE", "ERR_STREAM_WRITE_AFTER_END"],
        end: null,
        finished: null,
        writableEnded: true,
      },
      exitCode: 0,
    });
  });

  test("process.stdout: end() after a failed corked batch finishes", async () => {
    expect(await withReaderGone("stdout", "failed-batch-then-end")).toEqual({
      report: {
        type: "fs",
        sink: false,
        callbacks: ["EPIPE", "EPIPE", "EPIPE"],
        errors: ["EPIPE", "EPIPE", "EPIPE"],
        end: null,
        writableEnded: true,
      },
      exitCode: 0,
    });
  });

  // Pinned for a stream with a FileSink in process-stdout-write-after-end.test.ts.
  test("process.stdout: a write after a finished end() is rejected", async () => {
    await using proc = Bun.spawn({
      cmd: atFdLimit(fixture, "stdout", "end-then-write"),
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(reportIn(stderr)).toEqual({
      type: "fs",
      sink: false,
      callbacks: [null, "ERR_STREAM_WRITE_AFTER_END", "ERR_STREAM_WRITE_AFTER_END"],
      errors: ["ERR_STREAM_WRITE_AFTER_END"],
      writableEnded: true,
    });
    expect(stdout).toBe("AB");
    expect(exitCode).toBe(0);
  });

  test("process.stdout: end(chunk) in the tick that first reads the stream delivers the chunk", async () => {
    await using proc = Bun.spawn({
      cmd: atFdLimit(fixture, "stdout", "end-in-first-tick"),
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(reportIn(stderr)).toEqual({
      type: "fs",
      sink: false,
      callbacks: ["ERR_STREAM_WRITE_AFTER_END"],
      errors: ["ERR_STREAM_WRITE_AFTER_END"],
    });
    expect(stdout).toBe("E");
    expect(exitCode).toBe(0);
  });

  test.each(["stdout", "stderr"] as const)(
    "process.%s: bytes written before process.exit() reach a pipe",
    async which => {
      await using proc = Bun.spawn({
        cmd: atFdLimit(fixture, which, "write-then-exit"),
        env: bunEnv,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const [data, report] = which === "stdout" ? [stdout, stderr] : [stderr, stdout];
      expect(reportIn(report)).toEqual({ type: "fs", sink: false });
      expect(data).toContain("written before exit\n");
      expect(exitCode).toBe(0);
    },
  );

  test("process.stdout: bytes written before process.exit() reach a file", async () => {
    using dir = tempDir("stdio-no-sink", {});
    const out = path.join(String(dir), "out.txt");
    const fd = fs.openSync(out, "w");
    try {
      await using proc = Bun.spawn({
        cmd: atFdLimit(fixture, "stdout", "write-then-exit"),
        env: bunEnv,
        stdin: "ignore",
        stdout: fd,
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(reportIn(stderr)).toEqual({ type: "fs", sink: false });
      expect(fs.readFileSync(out, "utf8")).toBe("written before exit\n");
      expect(exitCode).toBe(0);
    } finally {
      fs.closeSync(fd);
    }
  });

  // Every stdio fd is the terminal here, so the bytes of the stream and the report arrive in one output.
  test.each(["end-then-write", "write-then-exit"] as const)("process.stdout on a TTY: %s", async scenario => {
    let output = "";
    const closed = Promise.withResolvers<void>();
    await using proc = Bun.spawn({
      cmd: atFdLimit(fixture, "stdout", scenario),
      env: bunEnv,
      terminal: {
        data(_terminal, chunk) {
          output += Buffer.from(chunk).toString();
        },
        exit() {
          closed.resolve();
        },
      },
    });
    await closed.promise;
    output = output.replaceAll("\r\n", "\n");
    const at = output.indexOf('{"type":');
    // With no report, show everything the child printed.
    const seen = at < 0 ? output : { written: output.slice(0, at), report: reportIn(output.slice(at)) };
    const rejected = {
      type: "tty",
      sink: false,
      callbacks: [null, "ERR_STREAM_WRITE_AFTER_END", "ERR_STREAM_WRITE_AFTER_END"],
      errors: ["ERR_STREAM_WRITE_AFTER_END"],
      writableEnded: true,
    };
    expect(seen).toEqual(
      scenario === "end-then-write"
        ? { written: "AB", report: rejected }
        : { written: "written before exit\n", report: { type: "tty", sink: false } },
    );
    expect(await proc.exited).toBe(0);
  });

  // Bun.file(1).writer() puts O_NONBLOCK on the stdout description and stays open, so the stream meets EAGAIN once
  // the pipe is full. The parent starts to read only after the child has reported, just before its write.
  test("process.stdout: a write larger than a non-blocking pipe waits for the reader", async () => {
    const size = 1 << 20;
    const script = /* js */ `
      const fs = require("fs");
      void fs.WriteStream;
      globalThis.writer = Bun.file(1).writer();
      const held = [];
      try {
        for (;;) held.push(fs.openSync("/dev/null", "r"));
      } catch {}
      const stdout = process.stdout;
      for (const fd of held) fs.closeSync(fd);
      const sink = Object.getOwnPropertySymbols(stdout).some(s => s.description === "kWriteStreamFastPath");
      fs.writeSync(2, JSON.stringify({ type: stdout._type, sink }) + "\\n");
      stdout.write(Buffer.alloc(${size}, "x"));
      process.exit(0);
    `;
    await using proc = Bun.spawn({
      cmd: atFdLimit("-e", script),
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    let stderr = "";
    for await (const chunk of proc.stderr) {
      stderr += Buffer.from(chunk).toString();
      if (/\{"type":.*\n/.test(stderr)) break;
    }
    const [stdout, exitCode] = await Promise.all([proc.stdout.bytes(), proc.exited]);
    expect(reportIn(stderr)).toEqual({ type: "fs", sink: false });
    expect(stdout.length).toBe(size);
    expect(Buffer.from(stdout).equals(Buffer.alloc(size, "x"))).toBe(true);
    expect(exitCode).toBe(0);
  });

  // An O_PATH descriptor on a FIFO cannot be polled (epoll_ctl reports EBADF), so the stream has no FileSink and every
  // write fails. Node has no such stream: its getter throws `open EBADF` for this fd.
  const onFifo = /* js */ `
    const fs = require("fs");
    const [which, fifo] = process.argv.slice(1);
    const fd = which === "stdout" ? 1 : 2;
    fs.closeSync(fd);
    const O_PATH = 0o10000000;
    if (fs.openSync(fifo, O_PATH) !== fd) throw new Error("the fifo did not land on fd " + fd);
    const stream = process[which];
    const sink = Object.getOwnPropertySymbols(stream).some(s => s.description === "kWriteStreamFastPath");
    const callbacks = [], errors = [];
    const write = chunk => stream.write(chunk, e => callbacks.push(e?.code ?? null));
    stream.on("error", e => {
      if (errors.push(e.code) === 1) for (let i = 0; i < 5; i++) write("y");
    });
    write("x");
    process.on("exit", () => {
      const report = { type: stream._type, sink, callbacks, errors, writableLength: stream.writableLength };
      fs.writeSync(fd === 1 ? 2 : 1, JSON.stringify(report) + "\\n");
    });
  `;
  const EBADF6 = ["EBADF", "EBADF", "EBADF", "EBADF", "EBADF", "EBADF"];

  test.skipIf(!isLinux).each(["stdout", "stderr"] as const)("process.%s on an O_PATH fifo", async which => {
    using dir = tempDir("stdio-no-sink", {});
    const fifo = path.join(String(dir), "fifo");
    mkfifo(fifo);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", onFifo, which, fifo],
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const expected = { type: "fs", sink: false, callbacks: EBADF6, errors: ["EBADF", "EBADF"], writableLength: 0 };
    expect(reportIn(which === "stdout" ? stderr : stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
  });
});

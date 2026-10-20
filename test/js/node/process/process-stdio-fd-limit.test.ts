import { spawn } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import fs from "node:fs";
import path from "path";

// The sink of process.stdout, process.stderr and tty.WriteStream always starts. With no descriptor to spare (the fd table
// is full when the stream is first read) it writes to the fd in place. When the event loop refuses the fd it writes
// without a poll. Each stream must then behave as it does with a free fd table.
//
// POSIX only: on Windows the sink of these streams cannot fail.
// Not concurrent: each test starts a bun, and a debug build that starts twenty at once goes past the test timeout.
describe.skipIf(isWindows)("process.stdout/stderr when the sink cannot duplicate or poll the fd", () => {
  const fixture = path.join(import.meta.dir, "process-stdio-fd-limit-fixture.mjs");
  // With "full" the fixture fills the fd table before it reads the stream. `ulimit -n` keeps that table small.
  const atFdLimit = (...args: string[]) => ["/bin/sh", "-c", 'ulimit -n 64 && exec "$@"', "sh", bunExe(), ...args];
  // A debug build prints other lines on stderr too.
  const reportsIn = (output: string) =>
    output
      .split("\n")
      .filter(line => line.startsWith('{"type":'))
      .map(line => JSON.parse(line));
  // What every report starts with. "EMFILE" is Bun.file(fd).writer() at the full table: it still throws.
  const stream = (table: "full" | "free", type = "fs") => ({
    type,
    sink: "FileSink",
    writer: table === "full" ? "EMFILE" : "not tried",
  });
  const six = (code: string) => [code, code, code, code, code, code];
  // The reports of a child as they arrive: `first(n)` waits for n of them, `all()` for the end of the stream.
  function reportsFrom(stream: ReadableStream<Uint8Array>) {
    const reader = stream.getReader();
    let text = "";
    const more = async () => {
      const { value, done } = await reader.read();
      if (!done) text += Buffer.from(value).toString();
      return !done;
    };
    return {
      async first(count: number) {
        while (reportsIn(text).length < count && (await more()));
        return reportsIn(text);
      },
      async all() {
        while (await more());
        return reportsIn(text);
      },
    };
  }

  // Runs a scenario whose writes fail. The stream is a FIFO, and the parent closes its only reader before the child
  // writes: the child waits for a byte on stdin first.
  async function withReaderGone(which: "stdout" | "stderr", scenario: string, table: "full" | "free") {
    using dir = tempDir("stdio-fd-limit", {});
    const fifo = path.join(String(dir), "fifo");
    mkfifo(fifo);
    // The write end opens only while the FIFO has a reader.
    const reader = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const writer = fs.openSync(fifo, "w");
    await using proc = spawn({
      cmd: atFdLimit(fixture, which, scenario, table),
      env: bunEnv,
      stdin: "pipe",
      stdout: which === "stdout" ? writer : "pipe",
      stderr: which === "stderr" ? writer : "pipe",
    });
    fs.closeSync(writer);
    fs.closeSync(reader);
    proc.stdin.write("go");
    await proc.stdin.end();
    const report = (which === "stdout" ? proc.stderr : proc.stdout) as ReadableStream<Uint8Array>;
    const [output, exitCode] = await Promise.all([report.text(), proc.exited]);
    return { reports: reportsIn(output), exitCode };
  }

  const tables = [
    ["stdout", "full"],
    ["stderr", "full"],
    ["stdout", "free"],
  ] as const;

  test.each(tables)(
    "process.%s, fd table %s: every write gets its callback when the reader is gone",
    async (which, table) => {
      expect(await withReaderGone(which, "failed-writes", table)).toEqual({
        reports: [{ ...stream(table), callbacks: six("EPIPE"), errors: ["EPIPE"], writableLength: 0 }],
        exitCode: 0,
      });
    },
  );

  test.each(tables)("process.%s, fd table %s: end() after failed writes reports the error", async (which, table) => {
    expect(await withReaderGone(which, "failed-writes-then-end", table)).toEqual({
      reports: [
        {
          ...stream(table),
          callbacks: six("EPIPE"),
          errors: ["EPIPE"],
          end: "EPIPE",
          finished: "EPIPE",
          writableEnded: false,
        },
      ],
      exitCode: 0,
    });
  });

  // Runs a scenario at the full table with a reader on both streams.
  async function atFullTable(which: "stdout" | "stderr", scenario: string) {
    await using proc = spawn({
      cmd: atFdLimit(fixture, which, scenario, "full"),
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const [written, report] = which === "stdout" ? [stdout, stderr] : [stderr, stdout];
    return { written: written.replace(/^\{"type":.*\n/gm, ""), reports: reportsIn(report), exitCode };
  }

  // Pinned for a free fd table in process-stdout-write-after-end.test.ts.
  test("process.stdout: a write after a finished end() is rejected", async () => {
    expect(await atFullTable("stdout", "end-then-write")).toEqual({
      written: "AB",
      reports: [
        {
          ...stream("full"),
          callbacks: [null, "ERR_STREAM_WRITE_AFTER_END", "ERR_STREAM_WRITE_AFTER_END"],
          errors: ["ERR_STREAM_WRITE_AFTER_END"],
          writableEnded: true,
        },
      ],
      exitCode: 0,
    });
  });

  test("process.stdout: end(chunk) in the tick that first reads the stream delivers the chunk", async () => {
    expect(await atFullTable("stdout", "end-in-first-tick")).toEqual({
      written: "E",
      reports: [
        { ...stream("full"), callbacks: ["ERR_STREAM_WRITE_AFTER_END"], errors: ["ERR_STREAM_WRITE_AFTER_END"] },
      ],
      exitCode: 0,
    });
  });

  test.each(["stdout", "stderr"] as const)(
    "process.%s: bytes written before process.exit() reach a pipe",
    async which => {
      const { written, reports, exitCode } = await atFullTable(which, "write-then-exit");
      expect(reports).toEqual([stream("full")]);
      // A debug build prints other lines on stderr too.
      expect(written).toContain("written before exit\n");
      expect(exitCode).toBe(0);
    },
  );

  test("process.stdout: bytes written before process.exit() reach a file", async () => {
    using dir = tempDir("stdio-fd-limit", {});
    const out = path.join(String(dir), "out.txt");
    const fd = fs.openSync(out, "w");
    try {
      await using proc = spawn({
        cmd: atFdLimit(fixture, "stdout", "write-then-exit", "full"),
        env: bunEnv,
        stdin: "ignore",
        stdout: fd,
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      expect(reportsIn(stderr)).toEqual([stream("full")]);
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
    await using proc = spawn({
      cmd: atFdLimit(fixture, "stdout", scenario, "full"),
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
    const seen = at < 0 ? output : { written: output.slice(0, at), reports: reportsIn(output.slice(at)) };
    const rejected = {
      ...stream("full", "tty"),
      callbacks: [null, "ERR_STREAM_WRITE_AFTER_END", "ERR_STREAM_WRITE_AFTER_END"],
      errors: ["ERR_STREAM_WRITE_AFTER_END"],
      writableEnded: true,
    };
    expect(seen).toEqual(
      scenario === "end-then-write"
        ? { written: "AB", reports: [rejected] }
        : { written: "written before exit\n", reports: [stream("full", "tty")] },
    );
    expect(await proc.exited).toBe(0);
  });

  // A pipe or a socket on fd 1 stays asynchronous: at the first full pipe the sink takes a descriptor and a poll.
  test("process.stdout: a write larger than the pipe returns false and emits 'drain'", async () => {
    await using proc = spawn({
      cmd: atFdLimit(fixture, "stdout", "big-write", "full"),
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      lazy: true,
    });
    // Nothing reads stdout until the child has reported what write() returned.
    const reports = reportsFrom(proc.stderr);
    expect(await reports.first(1)).toEqual([{ ...stream("full"), ret: false }]);
    const [stdout, all, exitCode] = await Promise.all([proc.stdout.bytes(), reports.all(), proc.exited]);
    expect(stdout.byteLength).toBe(1 << 20);
    expect(all).toEqual([
      { ...stream("full"), ret: false },
      { ...stream("full"), drained: true },
    ]);
    expect(exitCode).toBe(0);
  });

  // An fd that cannot take a write: closed, or an O_PATH descriptor on a FIFO (which the event loop also refuses to
  // poll). The stream exists and every write fails at write time. Node differs: a closed fd gives it a stream that
  // discards, and its getter throws `open EBADF` for the O_PATH fd.
  // A closed fd counts as a file, and file stdio resets after a failed write: it reports the next failure again.
  const onBadFd = /* js */ `
    const fs = require("fs");
    const [which, fifo] = process.argv.slice(1);
    const fd = which === "stdout" ? 1 : 2;
    fs.closeSync(fd);
    const O_PATH = 0o10000000;
    if (fifo && fs.openSync(fifo, O_PATH) !== fd) throw new Error("the fifo did not land on fd " + fd);
    const stream = process[which];
    const callbacks = [], errors = [];
    const write = chunk => stream.write(chunk, e => callbacks.push(e?.code ?? null));
    stream.on("error", e => {
      if (errors.push(e.code) === 1) for (let i = 0; i < 5; i++) write("y");
    });
    write("x");
    process.on("exit", () => {
      const sink = stream[Object.getOwnPropertySymbols(stream).find(s => s.description === "kWriteStreamFastPath")];
      const report = { type: stream._type, sink: sink?.constructor?.name, callbacks, errors, writableLength: stream.writableLength };
      fs.writeSync(fd === 1 ? 2 : 1, JSON.stringify(report) + "\\n");
    });
  `;
  async function onBadFdReports(which: "stdout" | "stderr", fifo?: string) {
    await using proc = spawn({
      cmd: [bunExe(), "-e", onBadFd, which, ...(fifo ? [fifo] : [])],
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { reports: reportsIn(which === "stdout" ? stderr : stdout), exitCode };
  }
  const everyWriteFails = (errors: string[]) => ({
    reports: [{ type: "fs", sink: "FileSink", callbacks: six("EBADF"), errors, writableLength: 0 }],
    exitCode: 0,
  });

  test.each(["stdout", "stderr"] as const)("process.%s on a closed fd: every write fails with EBADF", async which => {
    expect(await onBadFdReports(which)).toEqual(everyWriteFails(["EBADF", "EBADF"]));
  });

  test.skipIf(!isLinux).each(["stdout", "stderr"] as const)(
    "process.%s on an O_PATH fifo: every write fails with EBADF",
    async which => {
      using dir = tempDir("stdio-fd-limit", {});
      const fifo = path.join(String(dir), "fifo");
      mkfifo(fifo);
      expect(await onBadFdReports(which, fifo)).toEqual(everyWriteFails(["EBADF"]));
    },
  );

  const fillFdTable = /* js */ `
    const fs = require("fs"), tty = require("tty");
    void fs.WriteStream;
    void tty.WriteStream.prototype;
    const held = [];
    try {
      for (;;) held.push(fs.openSync("/dev/null", "r"));
    } catch {}
    const freeFdTable = () => held.forEach(fd => fs.closeSync(fd));
    const report = value => fs.writeSync(2, JSON.stringify({ type: "report", ...value }) + "\\n");
  `;

  // The first full pipe is when the sink needs a poll, and a poll needs a descriptor of its own. With none to spare
  // the write finishes without a poll: write() returns when every byte is out.
  test("process.stdout: a write larger than the pipe is delivered while the fd table is still full", async () => {
    const script = /* js */ `${fillFdTable}
      const stdout = process.stdout;
      let callback = "not called";
      const ret = stdout.write(Buffer.alloc(1 << 20, "x"), e => (callback = e?.code ?? null));
      freeFdTable();
      stdout.write("tail");
      process.on("exit", () => report({ ret, callback }));
    `;
    await using proc = spawn({
      cmd: atFdLimit("-e", script),
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
    expect(reportsIn(stderr)).toEqual([{ type: "report", ret: true, callback: null }]);
    expect(stdout.byteLength).toBe((1 << 20) + 4);
    expect(Buffer.from(stdout.subarray(1 << 20)).toString()).toBe("tail");
    expect(exitCode).toBe(0);
  });

  // The sink writes to fd 3 itself and must leave it open: it is the caller's.
  test.each(["full", "free"] as const)(
    "tty.WriteStream on a pipe, fd table %s: writes, and leaves the fd open",
    async table => {
      const script = /* js */ `${fillFdTable}
      if (process.argv[1] === "free") freeFdTable();
      const stream = new tty.WriteStream(3);
      if (process.argv[1] === "full") freeFdTable();
      const log = [];
      stream.on("error", e => log.push("error " + e.code));
      stream.on("close", () => {
        log.push("close");
        let after = "open";
        try {
          fs.writeSync(3, "after destroy");
        } catch (e) {
          after = e.code;
        }
        const sink = stream[Object.getOwnPropertySymbols(stream).find(s => s.description === "kWriteStreamFastPath")];
        report({ sink: sink?.constructor?.name, ret, log, after });
      });
      const ret = stream.write("from the stream, ", e => log.push("callback " + (e?.code ?? null)));
      stream.destroy();
    `;
      await using proc = spawn({
        cmd: ["/bin/sh", "-c", 'ulimit -n 64 && exec "$@" 3>&1', "sh", bunExe(), "-e", script, table],
        env: bunEnv,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(reportsIn(stderr)).toEqual([
        { type: "report", sink: "FileSink", ret: true, log: ["callback null", "close"], after: "open" },
      ]);
      expect(stdout).toBe("from the stream, after destroy");
      expect(exitCode).toBe(0);
    },
  );
});

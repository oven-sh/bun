import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import fs from "node:fs";
import { release } from "node:os";
import path from "path";
import { isatty } from "tty";
describe.concurrent("process-stdio", () => {
  test("process.stdin", () => {
    expect(process.stdin).toBeDefined();
    expect(process.stdin.isTTY).toBe<boolean | undefined>(isatty(0) ? true : undefined);
    expect(process.stdin.on("close", function () {})).toBe(process.stdin);
    expect(process.stdin.once("end", function () {})).toBe(process.stdin);
  });

  const files = {
    echo: path.join(import.meta.dir, "process-stdin-echo.js"),
  };

  test("process.stdin - read", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), files.echo],
      stdout: "pipe",
      stdin: "pipe",
      stderr: "inherit",
      env: {
        ...bunEnv,
      },
    });
    expect(stdin).toBeDefined();
    expect(stdout).toBeDefined();
    var lines = ["Get Emoji", "— All Emojis to ✂️ Copy and 📋 Paste", "👌", ""];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setTimeout(() => {
        if (line) {
          stdin?.write(line + "\n");
          stdin?.flush();
        } else {
          stdin?.end();
        }
      }, i * 200);
    }
    var text = await stdout.text();
    expect(text).toBe(lines.join("\n") + "ENDED");
  });

  test("process.stdin - resume", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), files.echo, "resume"],
      stdout: "pipe",
      stdin: "pipe",
      stderr: null,
      env: bunEnv,
    });
    expect(stdin).toBeDefined();
    expect(stdout).toBeDefined();
    var lines = ["Get Emoji", "— All Emojis to ✂️ Copy and 📋 Paste", "👌", ""];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setTimeout(() => {
        if (line) {
          stdin?.write(line + "\n");
          stdin?.flush();
        } else {
          stdin?.end();
        }
      }, i * 200);
    }
    var text = await stdout.text();
    expect(text).toBe("RESUMED" + lines.join("\n") + "ENDED");
  });

  test("process.stdin - close(#6713)", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), files.echo, "close-event"],
      stdout: "pipe",
      stdin: "pipe",
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });
    expect(stdin).toBeDefined();
    expect(stdout).toBeDefined();
    var lines = ["Get Emoji", "— All Emojis to ✂️ Copy and 📋 Paste", "👌", ""];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      setTimeout(() => {
        if (line) {
          stdin?.write(line + "\n");
          stdin?.flush();
        } else {
          stdin?.end();
        }
      }, i * 200);
    }
    var text = await stdout.text();
    expect(text).toBe(lines.join("\n") + "ENDED-CLOSE");
  });

  test("process.stdout", () => {
    expect(process.stdout).toBeDefined();
    // isTTY returns true or undefined in Node.js
    expect(process.stdout.isTTY).toBe((isatty(1) || undefined) as any);
  });

  test("process.stderr", () => {
    expect(process.stderr).toBeDefined();
    // isTTY returns true or undefined in Node.js
    expect(process.stderr.isTTY).toBe((isatty(2) || undefined) as any);
  });

  test("process.stdout - write", () => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });

    expect(stdout?.toString()).toBe(`hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`);
  });

  test("process.stdout - write a lot (string)", () => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance-a-lot.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
        TEST_STDIO_STRING: "1",
      },
    });

    expect(stdout?.toString()).toBe(
      `hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`.repeat(9999),
    );
  });

  test("process.stdout - write a lot (bytes)", () => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance-a-lot.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });
    expect(stdout?.toString()).toBe(
      `hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`.repeat(9999),
    );
  });
});

// Like Node, process.stdout/stderr put O_NONBLOCK on fd 1/2 when they are pipes or sockets. The flag lives on the shared open
// file description, so spawn clears it again for a child's fds 0-2 (libuv does the same), and the native console writer must
// wait on EAGAIN instead of dropping the rest of the line.
describe.concurrent.skipIf(isWindows)(
  "O_NONBLOCK on process.stdout/stderr does not leak to children or truncate console output",
  () => {
    const probe = path.join(import.meta.dir, "fd-nonblock-fixture.js");

    // Newline-delimited JSON events from a child's stderr, one at a time, plus the raw remainder at EOF.
    function jsonLines(stream: ReadableStream<Uint8Array>) {
      const reader = stream.getReader();
      const seen: any[] = [];
      let buf = "";
      return {
        seen,
        async next() {
          while (true) {
            const nl = buf.indexOf("\n");
            if (nl >= 0) {
              const v = JSON.parse(buf.slice(0, nl));
              buf = buf.slice(nl + 1);
              seen.push(v);
              return v;
            }
            const { value, done } = await reader.read();
            if (done) throw new Error("stderr closed early: " + JSON.stringify(seen) + " " + JSON.stringify(buf));
            buf += Buffer.from(value).toString();
          }
        },
        async rest() {
          while (true) {
            const { value, done } = await reader.read();
            if (done) return buf;
            buf += Buffer.from(value).toString();
          }
        },
      };
    }

    // Child that writes 1 MiB to stdout and reports write()'s return, then 'drain' (plus `drainExtra`, evaluated then) on stderr.
    const writerScript = (prelude: string, drainExtra = "{}") => `${prelude}
      const ret = process.stdout.write(Buffer.alloc(1 << 20, "A"));
      require("fs").writeSync(2, JSON.stringify({ ret }) + "\\n");
      process.stdout.once("drain", () => require("fs").writeSync(2, JSON.stringify({ drained: true, ...(${drainExtra}) }) + "\\n"));`;
    // Reader end of a shell pipe that only starts draining stdin on SIGUSR1, so the writer is guaranteed to hit a full pipe.
    const gatedReader = `process.on("SIGUSR1", async () => { for await (const c of Bun.stdin.stream()) require("fs").writeSync(1, c); process.exit(0); });
      setInterval(() => {}, 1 << 30);
      require("fs").writeSync(2, JSON.stringify({ reader: process.pid }) + "\\n");`;

    // Socketpair stdout (Bun.spawn "pipe") with a lazy parent: nothing reads stdout until write() has reported.
    async function expectDrainOverSocket(prelude: string, expectedBytes: number) {
      await using proc = spawn({
        cmd: [bunExe(), "-e", writerScript(prelude)],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
        lazy: true,
      });
      const events = jsonLines(proc.stderr);
      expect(await events.next()).toEqual({ ret: false });
      const [stdout, drained, exitCode] = await Promise.all([proc.stdout.bytes(), events.next(), proc.exited]);
      expect(stdout.byteLength).toBe(expectedBytes);
      expect(drained).toEqual({ drained: true });
      expect(exitCode).toBe(0);
    }

    // Real pipe(2) via sh, reader gated on SIGUSR1.
    async function expectDrainOverPipe(
      prelude: string,
      drainExtra: string,
      expectedDrain: object,
      expectedBytes: number,
    ) {
      await using proc = spawn({
        cmd: ["sh", "-c", `"$0" -e "$1" | "$0" -e "$2"`, bunExe(), writerScript(prelude, drainExtra), gatedReader],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const events = jsonLines(proc.stderr);
      let readerPid: number | undefined, ret: boolean | undefined;
      while (readerPid === undefined || ret === undefined) {
        const v = await events.next();
        if ("reader" in v) readerPid = v.reader;
        if ("ret" in v) ret = v.ret;
      }
      expect(ret).toBe(false);
      process.kill(readerPid!, "SIGUSR1");
      expect(await events.next()).toEqual(expectedDrain);
      const [stdout, exitCode] = await Promise.all([proc.stdout.bytes(), proc.exited]);
      expect(stdout.byteLength).toBe(expectedBytes);
      expect(exitCode).toBe(0);
    }

    test("an inherit child sees blocking fd 1 and 2 after the parent wrote to process.stdout/stderr", async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `process.stdout.write("out\\n");
         process.stderr.write("err\\n");
         const r = Bun.spawnSync([process.execPath, ${JSON.stringify(probe)}, "1", "2"], { stdio: ["inherit", "inherit", "inherit"] });
         process.exit(r.exitCode);`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("err\n");
      expect(stdout).toBe("out\n1:blocking 2:blocking\n");
      expect(exitCode).toBe(0);
    });

    test("a plain tool with inherited stdout can write more than a pipe holds after process.stdout was used", async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `process.stdout.write("start\\n");
         const r = Bun.spawnSync(["head", "-c", "1000000", "/dev/zero"], { stdio: ["inherit", "inherit", "inherit"] });
         process.stderr.write("rc=" + r.exitCode + "\\n");`,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("rc=0\n");
      expect(stdout).toEqual(new Uint8Array(Buffer.concat([Buffer.from("start\n"), Buffer.alloc(1000000)])));
      expect(exitCode).toBe(0);
    });

    // A single 1 MiB line is larger than any pipe buffer, so the console writer's second write(2) hits EAGAIN regardless of how
    // fast the reader is; it used to drop the rest of the line there.
    test("console.log is not truncated after process.stdout was used", async () => {
      await using proc = spawn({
        cmd: [bunExe(), "-e", `void process.stdout.isTTY; console.log(Buffer.alloc(1 << 20, "A").toString());`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.bytes(), proc.exited]);
      expect(stdout.byteLength).toBe((1 << 20) + 1);
      expect(exitCode).toBe(0);
    });

    test("console.error is not truncated after process.stderr was used", async () => {
      await using proc = spawn({
        cmd: [bunExe(), "-e", `void process.stderr.isTTY; console.error(Buffer.alloc(1 << 20, "B").toString());`],
        env: bunEnv,
        stdout: "inherit",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([proc.stderr.bytes(), proc.exited]);
      expect(stderr.byteLength).toBe((1 << 20) + 1);
      expect(exitCode).toBe(0);
    });

    test("process.stdout.write to a full pipe still returns false and emits drain", async () => {
      await expectDrainOverSocket("", 1 << 20);
    });

    // Bun.spawn's "pipe" is a socketpair; these go through sh so fd 1 is a real pipe(2).
    test("console.log and process.stdout.write are not truncated over a real pipe", async () => {
      await using proc = spawn({
        cmd: [
          "sh",
          "-c",
          `"$0" -e 'void process.stdout.isTTY; console.log(Buffer.alloc(1 << 20, "A").toString()); process.stdout.write(Buffer.alloc(1 << 20, "B"));' | cat`,
          bunExe(),
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toEqual(
        new Uint8Array(Buffer.concat([Buffer.alloc(1 << 20, "A"), Buffer.from("\n"), Buffer.alloc(1 << 20, "B")])),
      );
      expect(exitCode).toBe(0);
    });

    test("process.stdout.write to a full real pipe returns false and emits drain; a child spawned after still gets a blocking fd 1", async () => {
      const probeFd1 = `{ probe: Bun.spawnSync([process.execPath, ${JSON.stringify(probe)}, "1"], { stdio: ["inherit", "inherit", "pipe"], env: { ...process.env, PROBE_OUT_FD: "2" } }).stderr.toString().trim() }`;
      await expectDrainOverPipe("", probeFd1, { drained: true, probe: "1:blocking" }, 1 << 20);
    });

    // Spawning an inherit child clears O_NONBLOCK on the shared description (above). The parent's own process.stdout must
    // stay asynchronous after that where the OS has a per-call nonblocking write: sockets everywhere (send + MSG_DONTWAIT /
    // MSG_NBIO), pipes on Linux (pwritev2 + RWF_NOWAIT). macOS pipes have no such call, so they behave like Node there.
    const afterInheritSpawn = `process.stdout.write("x"); Bun.spawnSync(["true"], { stdio: ["inherit", "inherit", "inherit"] });`;
    test("process.stdout.write on a socket stays asynchronous after an inherit spawn cleared O_NONBLOCK", async () => {
      await expectDrainOverSocket(afterInheritSpawn, 1 + (1 << 20));
    });

    // pwritev2(RWF_NOWAIT) works on pipes from Linux 6.4 (FMODE_NOWAIT on pipes); older kernels behave like macOS/Node here.
    const pipesHaveNowait =
      isLinux &&
      (() => {
        const [maj, min] = release().split(".").map(Number);
        return maj > 6 || (maj === 6 && min >= 4);
      })();
    test.skipIf(!pipesHaveNowait)(
      "process.stdout.write on a pipe stays asynchronous after an inherit spawn cleared O_NONBLOCK (RWF_NOWAIT)",
      async () => {
        await expectDrainOverPipe(afterInheritSpawn, "{}", { drained: true }, 1 + (1 << 20));
      },
    );
  },
);

// The sink of process.stdout, process.stderr and tty.WriteStream always starts. With no descriptor to spare (the fd table
// is full when the stream is first read) it writes to the fd in place. When the event loop refuses the fd it writes
// without a poll. Each stream must then behave as it does with a free fd table.
describe.concurrent.skipIf(isWindows)("process.stdout/stderr when the sink cannot duplicate or poll the fd", () => {
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

  // Runs a scenario whose writes fail: the parent closes its end of the stream before the child writes.
  async function withReaderGone(which: "stdout" | "stderr", scenario: string, table: "full" | "free") {
    await using proc = spawn({
      cmd: atFdLimit(fixture, which, scenario, table),
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

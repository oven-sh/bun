import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import fs from "node:fs";
import path from "path";

test.concurrent.each(["stdout", "stderr"] as const)(
  "process.%s - write after end() errors and is not delivered (piped)",
  async which => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "process-stdout-write-after-end-fixture.mjs"), which],
      stdout: "pipe",
      stdin: "ignore",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The fixture writes its data to `which` and the JSON report to the other
    // stream. The report stream may carry benign ASAN/debug noise, so parse
    // only the last non-empty line.
    const dataPipe = which === "stderr" ? stderr : stdout;
    const reportPipe = which === "stderr" ? stdout : stderr;
    const lines = reportPipe.trim().split("\n");
    const report = JSON.parse(lines[lines.length - 1]);

    expect(report).toEqual({
      writableEnded: true,
      writable: false,
      ret: false,
      cbErr: "ERR_STREAM_WRITE_AFTER_END",
      ev: ["err:ERR_STREAM_WRITE_AFTER_END"],
    });

    // The post-end write must not reach the pipe reader. stdout (fd 1) is
    // clean; stderr (fd 2) can carry benign ASAN/debug noise, so there assert
    // only that the distinctive post-end marker never arrives.
    if (which === "stdout") {
      expect(dataPipe).toBe("AB");
    } else {
      expect(dataPipe).not.toContain("POST_END_MARKER");
    }
    expect(exitCode).toBe(0);
  },
);

test.concurrent.each(["stdout", "stderr"] as const)(
  "process.%s - write after end() succeeds and is delivered (file)",
  async which => {
    using dir = tempDir("stdio-write-after-end-file", {});
    const outPath = path.join(String(dir), "out.txt");
    const fd = fs.openSync(outPath, "w");
    try {
      // Redirect the fixture's target stream to a regular file; the report
      // stream stays piped so we can read the JSON facts.
      await using proc = Bun.spawn({
        cmd: [bunExe(), path.join(import.meta.dir, "process-stdout-write-after-end-file-fixture.mjs"), which],
        stdout: which === "stdout" ? fd : "pipe",
        stderr: which === "stderr" ? fd : "pipe",
        stdin: "ignore",
        env: bunEnv,
      });

      const reportStream = (which === "stderr" ? proc.stdout : proc.stderr) as ReadableStream<Uint8Array>;
      const [reportText, exitCode] = await Promise.all([reportStream.text(), proc.exited]);
      const lines = reportText.trim().split("\n");
      const report = JSON.parse(lines[lines.length - 1]);

      // Node's file-backed stdio is never-closing: end() runs the finish ->
      // destroy -> _undestroy cycle, which resets writable state, so a later
      // write() succeeds with no error and writableEnded is false again.
      expect(report).toEqual({
        writableEnded: false,
        writable: true,
        ret: true,
        cbErr: null,
        ev: [],
      });

      const fileContents = fs.readFileSync(outPath, "latin1");
      // stderr may carry benign ASAN/debug noise on fd 2; stdout is clean.
      if (which === "stdout") {
        expect(fileContents).toBe("ABCD\n");
      } else {
        expect(fileContents).toContain("ABCD\n");
      }
      expect(exitCode).toBe(0);
    } finally {
      fs.closeSync(fd);
    }
  },
);

// An O_PATH descriptor on a FIFO cannot be polled (epoll_ctl reports EBADF), so Bun.file(fd).writer() throws and
// process.stdout / process.stderr have no FileSink. The stream must reset after a failed write, as it does after
// end() above. If it does not, every later write stays in the buffer with no callback.
// Not concurrent: more debug-build children at once push the tests above toward their timeout.
describe.skipIf(!isLinux)("process.stdout/stderr on a descriptor that cannot get a FileSink", () => {
  const script = /* js */ `
    const fs = require("fs");
    const [which, fifo] = process.argv.slice(1);
    const fd = which === "stdout" ? 1 : 2;
    fs.closeSync(fd);
    const O_PATH = 0o10000000;
    if (fs.openSync(fifo, O_PATH) !== fd) throw new Error("the fifo did not land on fd " + fd);
    const stream = process[which];
    const callbacks = [], errors = [];
    const write = chunk => stream.write(chunk, e => callbacks.push(e?.code ?? null));
    // Write again only after the stream has reported the first failure. A write made while the first one is
    // still in flight fails together with it, on every build.
    stream.on("error", e => {
      if (errors.push(e.code) === 1) for (let i = 0; i < 5; i++) write("y");
    });
    write("x");
    process.on("exit", () => {
      const report = { callbacks, errors, writableLength: stream.writableLength };
      fs.writeSync(fd === 1 ? 2 : 1, JSON.stringify(report) + "\\n");
    });
  `;

  test.each(["stdout", "stderr"] as const)("process.%s - every write gets its callback", async which => {
    using dir = tempDir("stdio-no-sink", {});
    const fifo = path.join(String(dir), "fifo");
    mkfifo(fifo);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script, which, fifo],
      env: bunEnv,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // The report is on the other stream. A debug build prints other lines on stderr too. With no report, show them all.
    const output = which === "stdout" ? stderr : stdout;
    const report = output.split("\n").find(line => line.startsWith('{"callbacks":'));
    expect(report === undefined ? output : JSON.parse(report)).toEqual({
      callbacks: ["EBADF", "EBADF", "EBADF", "EBADF", "EBADF", "EBADF"],
      errors: ["EBADF", "EBADF"],
      writableLength: 0,
    });
    expect(exitCode).toBe(0);
  });
});

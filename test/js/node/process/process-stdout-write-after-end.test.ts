import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

// Over a pipe node's process.stdout is a net.Socket: 'finish' comes from the event loop, after the promise jobs of the
// turn that called end(). Over a file it is a SyncWriteStream, which finishes on the next tick, ahead of them.
test.each(["stdout", "stderr"] as const)(
  "process.%s - a 'finish' listener added one promise job after end() (piped, file)",
  async which => {
    const other = which === "stdout" ? "stderr" : "stdout";
    const script = `
      const stream = process.${which};
      let heard = "not heard";
      stream.end("end\\n");
      Promise.resolve().then(() => stream.on("finish", () => (heard = "heard")));
      setImmediate(() => setImmediate(() => process.${other}.write("\\n" + heard)));
    `;
    using dir = tempDir("stdio-finish-after-end", {});
    async function run(target: "pipe" | Bun.BunFile) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        stdout: which === "stdout" ? target : "pipe",
        stderr: which === "stderr" ? target : "pipe",
        stdin: "ignore",
        env: bunEnv,
      });
      const reportStream = proc[other] as ReadableStream<Uint8Array>;
      const [reportText, exitCode] = await Promise.all([reportStream.text(), proc.exited]);
      // The report stream may carry benign ASAN/debug noise: the report is its last line.
      return { heard: reportText.trim().split("\n").at(-1), exitCode };
    }
    const [piped, file] = await Promise.all([run("pipe"), run(Bun.file(path.join(String(dir), "out.txt")))]);
    expect({ piped, file }).toEqual({
      piped: { heard: "heard", exitCode: 0 },
      file: { heard: "not heard", exitCode: 0 },
    });
  },
);

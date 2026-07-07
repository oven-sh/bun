import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import path from "path";

test.each(["stdout", "stderr"] as const)(
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

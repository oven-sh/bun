import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import path from "path";
import { isatty } from "tty";
describe.concurrent("process-stdio", () => {
  test("process.stdin", () => {
    expect(process.stdin).toBeDefined();
    expect(process.stdin.isTTY).toBe(isatty(0) ? true : undefined);
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

  // #23061: the FileSink fast path used for stdio handed chunks straight to the
  // sink without touching this.bytesWritten, so the counter stayed at 0. Node
  // (net.Socket/tty.WriteStream) reports the encoded byte count synchronously.
  test("process.stdout/stderr.bytesWritten tracks fast-path writes", async () => {
    using dir = tempDir("stdio-bytes-written", {});
    const reportPath = path.join(String(dir), "report.json");
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const fs = require("node:fs");
          const before = { stdout: process.stdout.bytesWritten, stderr: process.stderr.bytesWritten };
          process.stdout.write("out-🚀");              // 8 UTF-8 bytes (4 + 4)
          process.stdout.write(Buffer.from([65, 66])); // 2 bytes -> stdout total 10
          process.stderr.write("err-⚡");              // 7 UTF-8 bytes (4 + 3)
          fs.writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify({
            before,
            stdout: process.stdout.bytesWritten,
            stderr: process.stderr.bytesWritten,
          }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("out-🚀AB");
    expect(stderr).toBe("err-⚡");
    expect(JSON.parse(readFileSync(reportPath, "utf8"))).toEqual({
      before: { stdout: 0, stderr: 0 },
      stdout: 10,
      stderr: 7,
    });
    expect(exitCode).toBe(0);
  });

  // A write that the sink rejects (EPIPE) must not bump the counter. Node's
  // net.Socket only adds to _bytesDispatched after a successful low-level
  // write, so bytesWritten stays at whatever the last successful write left it.
  test.skipIf(isWindows)("process.stdout.bytesWritten does not count a rejected write", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          process.stdout.on("error", () => {});
          process.stdout.write("abc");
          process.stderr.write("after-ok:" + process.stdout.bytesWritten + "\\n");
          process.stdin.once("data", () => {
            process.stdout.write("xxxxxxxxxxxx", err => {
              process.stderr.write(JSON.stringify({
                errored: err != null,
                bytesWritten: process.stdout.bytesWritten,
              }) + "\\n");
              process.exit(0);
            });
          });
          process.stdin.resume();
        `,
      ],
      env: bunEnv,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    // Drain the child's first write so "abc" is out of the pipe buffer, then
    // close the read end so the child's next stdout write fails with EPIPE.
    const reader = proc.stdout.getReader();
    let seen = 0;
    while (seen < 3) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += value!.length;
    }
    await reader.cancel();

    proc.stdin.write("go\n");
    proc.stdin.flush();

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
    const lines = stderr.trim().split("\n");
    expect(lines[0]).toBe("after-ok:3");
    expect(JSON.parse(lines[1])).toEqual({ errored: true, bytesWritten: 3 });
    expect(exitCode).toBe(0);
  });
});

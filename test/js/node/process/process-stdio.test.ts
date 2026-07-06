import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
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

  test("process.stdout - write after end()", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          process.stdout.on("error", e => process.stderr.write("error-event:" + e.code + "\\n"));
          process.stdout.write("kept\\n");
          process.stdout.end();
          const ret = process.stdout.write("dropped\\n", err => {
            process.stderr.write("cb:" + (err && err.code) + "\\n");
          });
          process.stderr.write("ret:" + ret + "\\n");
        `,
      ],
      stdout: "pipe",
      stderr: "pipe",
      stdin: null,
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The chunk written after end() is dropped, and the failure is reported
    // through the write callback and an 'error' event, like node.
    expect(stdout).toBe("kept\n");
    expect(stderr.split("\n").filter(Boolean)).toEqual([
      "ret:false",
      "cb:ERR_STREAM_WRITE_AFTER_END",
      "error-event:ERR_STREAM_WRITE_AFTER_END",
    ]);
    expect(exitCode).toBe(0);
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

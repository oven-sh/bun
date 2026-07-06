import { spawn, spawnSync } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import fs from "node:fs";
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

  test.skipIf(isWindows)("process.stdout - write callbacks run in write order under backpressure", async () => {
    using dir = tempDir("stdout-write-order", {});
    const fifo = path.join(String(dir), "stdout.fifo");
    expect(spawnSync({ cmd: ["mkfifo", fifo] }).exitCode).toBe(0);

    // Hold the read end open so opening the write end succeeds. Nothing here ever
    // reads it: the fixture drains the pipe itself, synchronously.
    const readFd = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    let writeFd = fs.openSync(fifo, fs.constants.O_WRONLY);
    try {
      await using proc = spawn({
        cmd: [bunExe(), path.join(import.meta.dir, "process-stdout-write-order-fixture.js")],
        stdin: "ignore",
        stdout: writeFd,
        stderr: "pipe",
        env: { ...bunEnv, BUN_TEST_FIFO: fifo },
      });
      fs.closeSync(writeFd);
      writeFd = -1;

      const [stderrText, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      const lines = stderrText.trim().split("\n");
      const { backpressured, lastWriteAccepted, order } = JSON.parse(lines[lines.length - 1]);

      // Guards the setup: without these the fixture never reached the racy path.
      expect({ backpressured, lastWriteAccepted, wroteEnough: order.length > 2, exitCode }).toEqual({
        backpressured: true,
        lastWriteAccepted: true,
        wroteEnough: true,
        exitCode: 0,
      });
      expect(order).toEqual(Array.from({ length: order.length }, (_, i) => i));
    } finally {
      if (writeFd !== -1) fs.closeSync(writeFd);
      fs.closeSync(readFd);
    }
  });

  // readline reports a no-op cursor move with process.nextTick(), so a write
  // callback that runs during write() itself jumps ahead of it.
  test("process.stdout - write callbacks run in call order with readline cursor callbacks", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const readline = require("node:readline");
          const order = [];
          let pending = 5;
          const done = name => {
            order.push(name);
            if (--pending === 0) process.stderr.write(order.join(","));
          };
          process.stdout.write("A", () => done("w1"));
          readline.moveCursor(process.stdout, 0, 0, () => done("m0")); // no-op move
          process.stdout.write("B", () => done("w2"));
          readline.cursorTo(process.stdout, 3, undefined, () => done("c"));
          readline.moveCursor(process.stdout, 1, 0, () => done("m1"));
        `,
      ],
      stdout: "pipe",
      stderr: "pipe",
      env: bunEnv,
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // cursorTo(3) writes CSI 4G and moveCursor(1, 0) writes CSI 1C.
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "AB\x1b[4G\x1b[1C",
      stderr: "w1,m0,w2,c,m1",
      exitCode: 0,
    });
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

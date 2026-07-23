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
    for (const line of lines) {
      if (line) {
        stdin?.write(line + "\n");
        stdin?.flush();
      } else {
        stdin?.end();
      }
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
    for (const line of lines) {
      if (line) {
        stdin?.write(line + "\n");
        stdin?.flush();
      } else {
        stdin?.end();
      }
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
    for (const line of lines) {
      if (line) {
        stdin?.write(line + "\n");
        stdin?.flush();
      } else {
        stdin?.end();
      }
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

  // spawnSync blocks the event loop while a debug build boots, which starves
  // the other concurrent tests in this file.
  test("process.stdout - write", async () => {
    await using proc = spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });

    expect(await proc.stdout.text()).toBe(
      `hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`,
    );
  });

  test("process.stdout - write a lot (string)", async () => {
    await using proc = spawn({
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

    expect(await proc.stdout.text()).toBe(
      `hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`.repeat(9999),
    );
  });

  test("process.stdout - write a lot (bytes)", async () => {
    await using proc = spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "stdio-test-instance-a-lot.js")],
      stdout: "pipe",
      stdin: null,
      stderr: null,
      env: {
        ...process.env,
        BUN_DEBUG_QUIET_LOGS: "1",
      },
    });
    expect(await proc.stdout.text()).toBe(
      `hello worldhello again|😋 Get Emoji — All Emojis to ✂️ Copy and 📋 Paste 👌`.repeat(9999),
    );
  });

  // A write callback must never run during the write() call itself.
  for (const name of ["stdout", "stderr"] as const) {
    test(`process.${name}.write - callback is not called synchronously`, async () => {
      await using proc = spawn({
        cmd: [
          bunExe(),
          "-e",
          `
            const order = [];
            process.${name}.write("A", () => {
              order.push("callback");
              process.stdout.write(order.join(","));
            });
            order.push("write-returned");
          `,
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const written = name === "stdout" ? "A" : "";
      expect({ stdout, exitCode }).toEqual({ stdout: `${written}write-returned,callback`, exitCode: 0 });
    });
  }

  // A write the sink accepts outright must still report completion behind the writes
  // it is already buffering, whose callbacks are parked on a promise. Each mode
  // perturbs what runs while that promise's reactions are still queued.
  const backpressureModes = [
    ["", "", 1],
    [" (drain listener writes)", "write-on-drain", 1],
    [" (write callback writes)", "write-in-callback", 1],
    [" (two writes parked, second callback writes)", "two-parked-in-cb", 2],
  ] as const;

  for (const [suffix, mode, parkTarget] of backpressureModes) {
    test.skipIf(isWindows)(
      `process.stdout - write callbacks run in write order under backpressure${suffix}`,
      async () => {
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
            env: { ...bunEnv, BUN_TEST_FIFO: fifo, BUN_TEST_MODE: mode },
          });
          fs.closeSync(writeFd);
          writeFd = -1;

          const [stderrText, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
          // Scan back for the report: a sanitizer build can print after the fixture has
          // already written it. A fixture that died before reporting leaves its crash here
          // instead, which is worth saying rather than burying it in a parse error.
          const report = stderrText.split("\n").findLast(line => /^\{.*\}$/.test(line));
          if (report === undefined) {
            throw new Error(`fixture did not report (exit code ${exitCode}):\n${stderrText}`);
          }
          const { parkedCount, reentrant, order } = JSON.parse(report);
          const reenters = mode !== "";

          // Guards the setup: without these the fixture never reached the racy path.
          // Whether the trailing write is accepted outright or itself parks depends on
          // the platform's pipe capacity, so it is not asserted; the order is what holds.
          expect({
            parkedCount,
            wroteEnough: order.length > 2,
            reentered: reentrant !== -1,
            exitCode,
          }).toEqual({
            parkedCount: parkTarget,
            wroteEnough: true,
            reentered: reenters,
            exitCode: 0,
          });
          expect(order).toEqual(Array.from({ length: order.length }, (_, i) => i));
        } finally {
          if (writeFd !== -1) fs.closeSync(writeFd);
          fs.closeSync(readFd);
        }
      },
    );
  }

  // Each fixture reports {"order": [...]} on stderr; the write is issued first, so
  // its callback must land first.
  async function expectFixtureOrder(fixture: string, expected: readonly string[]) {
    using dir = tempDir("stdout-write-order-cursor", {});
    const fifo = path.join(String(dir), "stdout.fifo");
    expect(spawnSync({ cmd: ["mkfifo", fifo] }).exitCode).toBe(0);

    const readFd = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    let writeFd = fs.openSync(fifo, fs.constants.O_WRONLY);
    try {
      await using proc = spawn({
        cmd: [bunExe(), path.join(import.meta.dir, fixture)],
        stdin: "ignore",
        stdout: writeFd,
        stderr: "pipe",
        env: { ...bunEnv, BUN_TEST_FIFO: fifo },
      });
      fs.closeSync(writeFd);
      writeFd = -1;

      const [stderrText, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
      const report = stderrText.split("\n").findLast(line => /^\{.*\}$/.test(line));
      if (report === undefined) {
        throw new Error(`fixture did not report (exit code ${exitCode}):\n${stderrText}`);
      }
      expect({ order: JSON.parse(report).order, exitCode }).toEqual({ order: [...expected], exitCode: 0 });
    } finally {
      if (writeFd !== -1) fs.closeSync(writeFd);
      fs.closeSync(readFd);
    }
  }

  // A parked write whose callback throws must still settle its report accounting, or
  // the sink stays parked forever and later writes are reordered for the stream's life.
  test.skipIf(isWindows)("process.stdout - a throwing parked write callback does not wedge ordering", () =>
    expectFixtureOrder("process-stdout-write-order-leak-fixture.js", ["write", "tick"]),
  );

  // A no-op moveCursor co-issued with a write from inside a parked callback must
  // queue through the stream so it cannot overtake that write.
  test.skipIf(isWindows)("process.stdout - no-op moveCursor co-issued with a re-entrant write stays ordered", () =>
    expectFixtureOrder("process-stdout-write-order-cursor-fixture.js", ["write", "moveCursor"]),
  );

  // `prelude` defines moveCursor(dx, dy, cb) and cursorTo(x, y, cb) bound to
  // process.stdout, either through node:readline or through tty.WriteStream.
  const cursorOrderFixture = (prelude: string) =>
    prelude +
    `
    const order = [];
    let pending = 5;
    const done = name => {
      order.push(name);
      if (--pending === 0) process.stdout.write("|" + order.join(","));
    };
    process.stdout.write("A", () => done("w1"));
    moveCursor(0, 0, () => done("m0")); // no-op move
    process.stdout.write("B", () => done("w2"));
    cursorTo(3, undefined, () => done("c"));
    moveCursor(1, 0, () => done("m1"));
  `;

  // cursorTo(3) writes CSI 4G and moveCursor(1, 0) writes CSI 1C; the no-op
  // moveCursor(0, 0) writes nothing but still has to call back in order.
  const expectedCursorOrder = "AB\x1b[4G\x1b[1C|w1,m0,w2,c,m1";

  test("process.stdout - write and readline cursor callbacks run in call order", async () => {
    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        cursorOrderFixture(`
          const readline = require("node:readline");
          const moveCursor = (dx, dy, cb) => readline.moveCursor(process.stdout, dx, dy, cb);
          const cursorTo = (x, y, cb) => readline.cursorTo(process.stdout, x, y, cb);
        `),
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, exitCode }).toEqual({ stdout: expectedCursorOrder, exitCode: 0 });
  });

  // Windows ConPTY repaints the screen instead of forwarding the child's bytes,
  // so the raw output can't be compared byte for byte.
  test.skipIf(isWindows)("process.stdout - write and tty cursor callbacks run in call order", async () => {
    let output = "";
    const decoder = new TextDecoder();
    const eof = Promise.withResolvers<void>();

    await using proc = spawn({
      cmd: [
        bunExe(),
        "-e",
        cursorOrderFixture(`
          const moveCursor = (dx, dy, cb) => process.stdout.moveCursor(dx, dy, cb);
          const cursorTo = (x, y, cb) => process.stdout.cursorTo(x, y, cb);
        `),
      ],
      env: bunEnv,
      terminal: {
        cols: 80,
        rows: 24,
        data(_terminal: Bun.Terminal, chunk: Uint8Array) {
          output += decoder.decode(chunk, { stream: true });
        },
        exit() {
          eof.resolve();
        },
      },
    });

    // EOF fires once every buffered byte has been delivered.
    await eof.promise;
    const exitCode = await proc.exited;
    proc.terminal?.close();
    output += decoder.decode();

    expect({ output, exitCode }).toEqual({ output: expectedCursorOrder, exitCode: 0 });
  });
});

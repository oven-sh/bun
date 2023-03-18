import { spawn, spawnSync } from "bun";
import { describe, expect, it, test, beforeAll } from "bun:test";
import { bunExe } from "harness";
import { isatty } from "tty";
import { dlopen, FFIType } from "bun:ffi";
import { existsSync } from "node:fs";
import { spawnInNewPty } from "../../../openpty.js";

// @ts-ignore
const bunFs = Bun.fs();

describe("process.{stdin, stdout, stderr}", () => {
  let libRawModeTest: any;
  let checkIsRaw: any;
  beforeAll(() => {
    const DYN_SUFFIX = "so";
    const HELPERS_DIR = bunFs.realpathSync(import.meta.dir + `/../../../helpers`);
    const LIB_RAW_MODE_SRC_PATH = `${HELPERS_DIR}/libRawModeTest.cpp`;
    const LIB_RAW_MODE_PATH = `${HELPERS_DIR}/libRawModeTest.${DYN_SUFFIX}`;

    // NOTE: Probably want to always rebuild the helper lib to make sure we have the latest...
    // if (!existsSync(LIB_RAW_MODE_PATH)) {

    spawnSync({
      cmd: ["gcc", "-shared", "-o", LIB_RAW_MODE_PATH, LIB_RAW_MODE_SRC_PATH],
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    if (!existsSync(LIB_RAW_MODE_PATH)) {
      throw new Error("Failed to build libRawModeTest helper");
    }

    libRawModeTest = dlopen(LIB_RAW_MODE_PATH, {
      tty_is_raw: {
        args: [FFIType.int],
        returns: FFIType.int,
      },
    });

    checkIsRaw = function checkIsRaw(fd: number = 0) {
      if (typeof fd !== "number") throw new Error("fd must be a number");
      if (fd < 0) throw new Error("fd must be a number >= 0");
      return !!libRawModeTest.symbols.tty_is_raw(fd);
    };
  });

  test("process.stdin", () => {
    expect(process.stdin).toBeDefined();
    expect(process.stdout.isTTY).toBe(isatty(0));
    expect(process.stdin.on("close", function () {})).toBe(process.stdin);
    expect(process.stdin.once("end", function () {})).toBe(process.stdin);
  });

  test("process.stdin - read", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), import.meta.dir + "/process-stdin-echo.js"],
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
    var text = await new Response(stdout).text();
    expect(text).toBe(lines.join("\n") + "ENDED");
  });

  test("process.stdin - resume", async () => {
    const { stdin, stdout } = spawn({
      cmd: [bunExe(), import.meta.dir + "/process-stdin-echo.js", "resume"],
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
    var text = await new Response(stdout).text();
    expect(text).toBe("RESUMED" + lines.join("\n") + "ENDED");
  });

  test("process.stdin - isRaw", () => {
    expect(process.stdin.isRaw).toBe(false);
  });

  test("process.stdout", () => {
    expect(process.stdout).toBeDefined();
    expect(process.stdout.isTTY).toBe(isatty(1));
  });

  test("process.stderr", () => {
    expect(process.stderr).toBeDefined();
    expect(process.stderr.isTTY).toBe(isatty(2));
  });

  test("process.stdout - write", () => {
    const { stdout } = spawnSync({
      cmd: [bunExe(), import.meta.dir + "/../../bun/spawn/stdio-test-instance.js"],
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
      cmd: [bunExe(), import.meta.dir + "/../../bun/spawn/stdio-test-instance-a-lot.js"],
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
      cmd: [bunExe(), import.meta.dir + "/../../bun/spawn/stdio-test-instance-a-lot.js"],
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

  test("process.stdin.setRawMode - sets raw mode", () => {
    process.stdin.setRawMode(false);
    expect(process.stdin.isRaw).toBe(false);
    expect(checkIsRaw()).toBe(false);

    process.stdin.setRawMode(true);
    expect(process.stdin.isRaw).toBe(true);
    expect(checkIsRaw()).toBe(true);

    process.stdin.setRawMode(false);
    expect(process.stdin.isRaw).toBe(false);
    expect(checkIsRaw()).toBe(false);
  });

  test("process.stdin.setRawMode - returns process.stdin", () => {
    expect(process.stdin.setRawMode(false)).toEqual(process.stdin);
  });

  test("process.stdin.setRawMode - throws if not TTY", () => {
    // Spawn a process that is not connected to TTY
    const { stderr } = spawnSync({
      cmd: [bunExe(), import.meta.dir + "/process-stdin-set-raw-mode.js"],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(stderr?.toString()).toContain("error: Cannot set raw mode on non-TTY stream\n");
  });

  test("process.stdin.setRawMode - reset termios settings on exit", async () => {
    if (!libRawModeTest) throw new Error("libRawModeTest not available - likely build failure");
    // Check that we're not already in raw mode
    expect(process.stdin.isRaw).toBe(false);
    expect(checkIsRaw()).toBe(false);

    // Spawn a process that inherits stdio
    // Script will set raw mode then alert parent via stdout
    const proc = spawn({
      cmd: [bunExe(), import.meta.dir + "/process-stdin-raw-mode-on-exit.js"],
      stdin: "inherit",
      // onExit() {
      //   console.log("EXITED");
      // },
    });

    // Wait for script to set raw mode and alert us
    for await (const line of proc.stdout!) {
      const msg = new TextDecoder().decode(line);
      if (msg.includes("RAW_MODE_SET")) {
        expect(true).toBeTruthy();
        break;
      } else {
        expect(false).toBeTruthy();
      }
    }

    // Check that raw mode was actually set
    expect(process.stdin.isRaw).toBe(true);
    expect(checkIsRaw()).toBe(true);

    await proc.exited;

    // Check that raw mode is reset after process exits
    expect(process.stdin.isRaw).toBe(false);
    expect(checkIsRaw()).toBe(false);
  });

  test("process.stdin.setRawMode - set/unset (enhanced) raw mode before/after iterating over console async iterator -- normal before", async () => {
    if (!libRawModeTest) throw new Error("libRawModeTest not available - likely build failure");
    // Check that we're not already in raw mode
    expect(process.stdin.isRaw).toBe(false);
    expect(checkIsRaw()).toBe(false);

    // Open new pty using openpty.js
    const { subprocess, stdin, cleanup } = spawnInNewPty({
      cmd: [bunExe(), import.meta.dir + "/process-stdin-console-async-iter.ts"],
      // options: {
      //   onExit() {
      //     cleanup();
      //   },
      // },
    });

    await Bun.sleep(250);

    stdin.write("Starting\n");
    // @ts-ignore
    stdin.flush(true);

    const responses = [] as string[];

    for await (const line of subprocess.stdout as ReadableStream<Uint8Array>) {
      const msg = new TextDecoder().decode(line);
      responses.push(...msg.split(" "));
      break;
    }

    expect(responses).toEqual(["NOT_RAW", "ASYNC_IO", "NOT_RAW"]);

    cleanup();
  });

  test("process.stdin.setRawMode - set/unset (enhanced) raw mode before/after iterating over console async iterator -- raw before", async () => {
    if (!libRawModeTest) throw new Error("libRawModeTest not available - likely build failure");
    // Check that we're not already in raw mode
    expect(process.stdin.isRaw).toBe(false);
    expect(checkIsRaw()).toBe(false);

    process.stdin.setRawMode(true);

    // Open new pty using openpty.js
    const { subprocess, stdin, cleanup } = spawnInNewPty({
      cmd: [bunExe(), import.meta.dir + "/process-stdin-console-async-iter.ts", "RAW"],
      // options: {
      //   onExit() {
      //     cleanup();
      //   },
      // },
    });

    await Bun.sleep(250);

    stdin.write("Starting\n");
    // @ts-ignore
    stdin.flush(true);

    const responses = [] as string[];

    for await (const line of subprocess.stdout as ReadableStream<Uint8Array>) {
      const msg = new TextDecoder().decode(line);
      responses.push(...msg.split(" "));
      break;
    }

    expect(responses).toEqual(["RAW", "ASYNC_IO", "RAW"]);

    cleanup();
  });
});

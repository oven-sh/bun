import { spawn, spawnSync, fs } from "bun";
import { describe, expect, it, test, beforeAll } from "bun:test";
import { bunExe } from "harness";
import { isatty } from "tty";
import { dlopen, FFIType } from "bun:ffi";
import { existsSync } from "node:fs";

const bunFs = Bun.fs();

describe("process.{stdin, stdout, stderr}", () => {
  let libRawModeTest: any;
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
        returns: FFIType.int,
      },
    });
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
    function checkIsRaw() {
      return !!libRawModeTest.symbols.tty_is_raw();
    }

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
});

// TODO: Add raw mode after creating async iter
// TODO: Add test that we reset raw mode on exit

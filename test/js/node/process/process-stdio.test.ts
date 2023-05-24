import { spawn, spawnSync } from "bun";
import { describe, expect, it, test } from "bun:test";
import { bunExe } from "harness";
import { isatty } from "tty";

test.todo("process.stdin", () => {
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
    cmd: [bunExe(), import.meta.dir + "/stdio-test-instance.js"],
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
    cmd: [bunExe(), import.meta.dir + "/stdio-test-instance-a-lot.js"],
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
    cmd: [bunExe(), import.meta.dir + "/stdio-test-instance-a-lot.js"],
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

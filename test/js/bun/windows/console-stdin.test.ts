import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Bun's own stdin readers (prompt()/alert()/confirm(), the REPL, `bun -`, the
// CLI prompts) read the process stdin handle directly, not through libuv. When
// that handle is a console, reading it with ReadFile goes through conhost's
// code page conversion, which returns garbage for non-ASCII input under the
// UTF-8 code page bun selects (oven-sh/bun#27556); the console has to be read
// with ReadConsoleW. These tests type into a real console, see
// console-stdin-driver-fixture.ts. The program under test writes what it read
// to CONSOLE_STDIN_RESULT, since its stdout is the console.

const TEXT = "a\u4e2db\u{1F600}";

/**
 * Runs `bun <args>` on a console. `keys[0]` is typed before it starts; each
 * later entry is typed only after everything before it has been consumed, so it
 * is guaranteed to arrive in a separate read.
 */
async function typeIntoConsole(args: string[], keys: string[]) {
  using dir = tempDir("console-stdin", {});
  const resultPath = join(String(dir), "result.json");
  const specPath = join(String(dir), "spec.json");
  const cmd = [bunExe(), ...args].map(arg => `"${arg}"`).join(" ");
  await Bun.write(specPath, JSON.stringify({ cmd, cwd: String(dir), keys }));

  await using driver = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "console-stdin-driver-fixture.ts"), specPath],
    env: {
      ...bunEnv,
      CONSOLE_STDIN_RESULT: resultPath,
      // Keeps the REPL's history file out of the real home directory.
      HOME: String(dir),
      USERPROFILE: String(dir),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([driver.stdout.text(), driver.stderr.text(), driver.exited]);
  if (exitCode !== 0) throw new Error(`console driver exited with ${exitCode}:\n${stderr}`);

  return {
    child: JSON.parse(stdout),
    result: existsSync(resultPath) ? JSON.parse(readFileSync(resultPath, "utf8")) : "result file was not written",
  };
}

describe.skipIf(!isWindows)("reading non-ASCII input from a Windows console", () => {
  test.concurrent("prompt(), alert() and confirm()", async () => {
    // Longer than both prompt()'s 4 KiB read buffer and the 4094 characters a
    // line could have when that buffer was what got passed to the console.
    const longLine = Buffer.alloc(5000, "x").toString();
    const lines = [
      // alert(): one-byte reads, so each character is handed out byte by byte.
      "\u4e2d\u{1F600}",
      TEXT,
      "y",
      "\ud55c\uad6d\uc5b4",
      // Ctrl+Z inside a line is an ordinary character...
      "ab\x1acd",
      // ...while a line starting with Ctrl+Z is end of input, as with ReadFile,
      "\x1a",
      // and end of input on a console is not sticky.
      "after",
      longLine,
    ];
    const fixture = join(import.meta.dir, "console-stdin-prompt-fixture.js");
    expect(await typeIntoConsole([fixture], [lines.join("\r") + "\r"])).toEqual({
      child: { exit: 0, timedOut: false },
      result: {
        stdinIsTTY: true,
        prompt1: TEXT,
        confirm: true,
        prompt2: "\ud55c\uad6d\uc5b4",
        prompt3: "ab\x1acd",
        prompt4: null,
        prompt5: "after",
        prompt6: longLine,
      },
    });
  });

  test.concurrent("the REPL line editor (raw console mode)", async () => {
    const script = `require("fs").writeFileSync(process.env.CONSOLE_STDIN_RESULT, JSON.stringify("${TEXT}"))`;
    // The emoji's high surrogate is delivered in a read of its own (raw mode
    // returns whatever has been typed so far), so it has to be held back until
    // the low surrogate arrives with the next read.
    const high = script.indexOf(TEXT) + TEXT.length - 2;
    const keys = [script.slice(0, high), script[high], script.slice(high + 1) + "\r.exit\r"];
    expect(await typeIntoConsole(["repl"], keys)).toEqual({
      child: { exit: 0, timedOut: false },
      result: TEXT,
    });
  });

  test.concurrent("a script typed into `bun -` and ended with Ctrl+Z", async () => {
    const script = `require("fs").writeFileSync(process.env.CONSOLE_STDIN_RESULT, JSON.stringify("${TEXT}"))`;
    expect(await typeIntoConsole(["-"], [`${script}\r\x1a\r`])).toEqual({
      child: { exit: 0, timedOut: false },
      result: TEXT,
    });
  });
});

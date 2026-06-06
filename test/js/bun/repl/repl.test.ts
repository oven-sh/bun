// Tests for Bun REPL
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, statSync } from "node:fs";
import path from "path";

// Helper to run REPL with piped stdin (non-TTY mode) and capture output
async function runRepl(
  input: string | string[],
  options: {
    env?: Record<string, string>;
  } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const inputStr = Array.isArray(input) ? input.join("\n") + "\n" : input;
  const { env = {} } = options;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "repl"],
    stdin: Buffer.from(inputStr),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...bunEnv,
      TERM: "dumb",
      NO_COLOR: "1",
      ...env,
    },
  });

  const exitCode = await proc.exited;

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return { stdout, stderr, exitCode };
}

const stripAnsi = Bun.stripANSI;

// Width of the PTY used by withTerminalRepl. The REPL queries the real
// terminal width (TIOCGWINSZ), so tests that reconstruct the rendered grid
// must use this same width to match how the REPL wrapped its output.
const TERMINAL_REPL_COLS = 120;

// Helper to run REPL in a PTY and interact with it
async function withTerminalRepl(
  fn: (helpers: {
    terminal: Bun.Terminal;
    proc: Bun.ChildProcess;
    cols: number;
    send: (text: string) => void;
    waitFor: (pattern: string | RegExp, timeoutMs?: number) => Promise<string>;
    allOutput: () => string;
    rawOutput: () => string;
  }) => Promise<void>,
) {
  const received: string[] = [];
  let cursor = 0;
  let resolveWaiter: (() => void) | null = null;

  await using terminal = new Bun.Terminal({
    cols: TERMINAL_REPL_COLS,
    rows: 40,
    data(_term, data) {
      const str = Buffer.from(data).toString();
      received.push(str);
      if (resolveWaiter) {
        resolveWaiter();
        resolveWaiter = null;
      }
    },
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "repl"],
    terminal,
    env: {
      ...bunEnv,
      TERM: "xterm-256color",
    },
  });

  const send = (text: string) => terminal.write(text);

  const waitFor = async (pattern: string | RegExp, timeoutMs = 5000): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const all = received.join("");
      const recent = all.slice(cursor);
      const matched = typeof pattern === "string" ? recent.includes(pattern) : pattern.test(recent);
      if (matched) {
        cursor = all.length;
        return recent;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `Timed out waiting for pattern: ${pattern}\nReceived so far:\n${stripAnsi(received.join("").slice(cursor))}`,
        );
      }
      // Wait for the next chunk of terminal data (or time out).

      await new Promise<void>(resolve => {
        resolveWaiter = resolve;
      });
      resolveWaiter = null;
    }
  };

  const allOutput = () => stripAnsi(received.join(""));
  const rawOutput = () => received.join("");

  await waitFor(/\u276f|> /); // Wait for prompt

  await fn({ terminal, proc, cols: TERMINAL_REPL_COLS, send, waitFor, allOutput, rawOutput });

  // Clean exit
  send(".exit\n");
  await Promise.race([proc.exited, Bun.sleep(2000)]);
  if (!proc.killed) proc.kill();
}

// Replay a stream of terminal output (including cursor-movement and
// erase escapes) into a character grid and return the visible rows. This
// lets a test assert what the user actually SEES after the REPL's many
// in-place redraws, rather than how many bytes were written. Implements DEC
// deferred line-wrap (the "last column" flag used by xterm/vte): writing the
// final column of a row leaves the cursor pending, so an explicit newline that
// follows does not double-advance. The grid only grows (never scrolls) so row
// indices stay stable across the whole stream.
function renderTerminalGrid(output: string, cols: number): string[] {
  const grid: string[][] = [];
  const ensure = (row: number) => {
    while (grid.length <= row) grid.push(Array(cols).fill(" "));
  };
  let row = 0;
  let col = 0;
  let pendingWrap = false;

  for (let i = 0; i < output.length; i++) {
    const ch = output[i];
    const code = output.charCodeAt(i);

    if (ch === "\r") {
      col = 0;
      pendingWrap = false;
      continue;
    }
    if (ch === "\n") {
      pendingWrap = false;
      row++;
      ensure(row);
      continue;
    }
    if (code === 0x1b) {
      if (output[i + 1] === "[") {
        // CSI sequence: ESC [ <params> <final>
        let j = i + 2;
        let params = "";
        while (j < output.length && /[0-9;?]/.test(output[j])) params += output[j++];
        const final = output[j];
        const n = parseInt(params, 10);
        const count = Number.isNaN(n) ? 1 : n;
        ensure(row);
        switch (final) {
          // Cursor-moving sequences clear the pending-wrap flag.
          case "A": // cursor up
            row = Math.max(0, row - count);
            pendingWrap = false;
            break;
          case "B": // cursor down
            row += count;
            ensure(row);
            pendingWrap = false;
            break;
          case "C": // cursor forward
            col = Math.min(cols - 1, col + count);
            pendingWrap = false;
            break;
          case "D": // cursor back
            col = Math.max(0, col - count);
            pendingWrap = false;
            break;
          case "H": // cursor home
          case "f":
            row = 0;
            col = 0;
            pendingWrap = false;
            break;
          case "K": // erase in line (0/default = to end, 2 = whole line)
            if (params === "" || params === "0") for (let x = col; x < cols; x++) grid[row][x] = " ";
            else if (params === "2") grid[row].fill(" ");
            break;
          case "J": // erase in display (0/default = below, 2 = all)
            if (params === "" || params === "0") {
              for (let x = col; x < cols; x++) grid[row][x] = " ";
              for (let y = row + 1; y < grid.length; y++) grid[y].fill(" ");
            } else if (params === "2") {
              for (const r of grid) r.fill(" ");
            }
            break;
          // SGR ("m") and other sequences do not move the cursor, so they
          // must NOT clear a pending wrap (xterm behavior).
        }
        i = j;
        continue;
      }
      if (output[i + 1] === "]") {
        // OSC sequence (e.g. clipboard) terminated by BEL — skip it entirely.
        let j = i + 1;
        while (j < output.length && output.charCodeAt(j) !== 0x07) j++;
        i = j;
        continue;
      }
      continue; // lone ESC / unsupported
    }
    if (code < 0x20) continue; // other control bytes

    // Printable: apply any deferred wrap, then write.
    if (pendingWrap) {
      row++;
      col = 0;
      pendingWrap = false;
      ensure(row);
    }
    ensure(row);
    grid[row][col] = ch;
    if (col === cols - 1) pendingWrap = true;
    else col++;
  }

  return grid.map(r => r.join("").replace(/\s+$/, ""));
}

describe.concurrent("Bun REPL", () => {
  describe("basic evaluation", () => {
    test("evaluates simple expression", async () => {
      const { stdout, exitCode } = await runRepl(["1 + 1", ".exit"]);
      expect(stripAnsi(stdout)).toContain("2");
      expect(exitCode).toBe(0);
    });

    test("evaluates multiple expressions", async () => {
      const { stdout, exitCode } = await runRepl(["1 + 1", "2 * 3", "Math.sqrt(16)", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output).toContain("2");
      expect(output).toContain("6");
      expect(output).toContain("4");
      expect(exitCode).toBe(0);
    });

    test("evaluates string expressions", async () => {
      const { stdout, exitCode } = await runRepl(["'hello'.toUpperCase()", ".exit"]);
      expect(stripAnsi(stdout)).toContain("HELLO");
      expect(exitCode).toBe(0);
    });

    test("evaluates object literals", async () => {
      const { stdout, exitCode } = await runRepl(["({ a: 1, b: 2 })", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output).toContain("a");
      expect(output).toContain("b");
      expect(exitCode).toBe(0);
    });

    test("evaluates array expressions", async () => {
      const { stdout, exitCode } = await runRepl(["[1, 2, 3].map(x => x * 2)", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output).toContain("2");
      expect(output).toContain("4");
      expect(output).toContain("6");
      expect(exitCode).toBe(0);
    });
  });

  describe("special variables", () => {
    test("_ contains last result", async () => {
      const { stdout, exitCode } = await runRepl(["42", "_", ".exit"]);
      const output = stripAnsi(stdout);
      // 42 should appear at least twice: once for the eval, once for _
      expect(output.split("42").length - 1).toBeGreaterThanOrEqual(2);
      expect(exitCode).toBe(0);
    });

    test("_ updates with each result", async () => {
      const { stdout, exitCode } = await runRepl(["10", "_ * 2", "_ + 5", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output).toContain("10");
      expect(output).toContain("20");
      expect(output).toContain("25");
      expect(exitCode).toBe(0);
    });

    test("_error contains last error", async () => {
      const { stdout, exitCode } = await runRepl(["throw new Error('test error')", "_error.message", ".exit"]);
      expect(stripAnsi(stdout)).toContain("test error");
      expect(exitCode).toBe(0);
    });
  });

  describe("REPL commands", () => {
    test(".exit exits the REPL", async () => {
      const { exitCode } = await runRepl([".exit"]);
      expect(exitCode).toBe(0);
    });

    test(".help shows help message", async () => {
      const { stdout, exitCode } = await runRepl([".help", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output).toContain(".help");
      expect(output).toContain(".exit");
      expect(output).toContain(".load");
      expect(output).toContain(".save");
      expect(exitCode).toBe(0);
    });

    test(".load loads and evaluates a file", async () => {
      using dir = tempDir("repl-load-test", {
        "test.js": "var loadedVar = 42;\n",
      });
      const filePath = path.join(String(dir), "test.js");
      const { stdout, exitCode } = await runRepl([`.load ${filePath}`, "loadedVar", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output).toContain("42");
      expect(exitCode).toBe(0);
    });

    test(".load with nonexistent file shows error", async () => {
      // Use a relative path so Windows doesn't choke on forward-slash absolute paths (EINVAL).
      const { stdout, stderr, exitCode } = await runRepl([
        ".load definitely-does-not-exist-repl-test.js",
        "1 + 1",
        ".exit",
      ]);
      const allOutput = stripAnsi(stdout + stderr);
      expect(allOutput.toLowerCase()).toMatch(/error|not found|no such file|enoent|invalid argument/i);
      // REPL should continue after failed load
      expect(allOutput).toContain("2");
      expect(exitCode).toBe(0);
    });

    test(".load without filename shows usage", async () => {
      const { stdout, exitCode } = await runRepl([".load", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output.toLowerCase()).toMatch(/usage|filename/i);
      expect(exitCode).toBe(0);
    });

    test(".save saves history to file", async () => {
      using dir = tempDir("repl-save-test", {});
      const filePath = path.join(String(dir), "saved.js");
      const { exitCode } = await runRepl(["const x = 1", "const y = 2", `.save ${filePath}`, ".exit"]);
      expect(exitCode).toBe(0);
      const content = await Bun.file(filePath).text();
      expect(content).toContain("const x = 1");
      expect(content).toContain("const y = 2");
    });

    test(".save without filename shows usage", async () => {
      const { stdout, exitCode } = await runRepl([".save", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output.toLowerCase()).toMatch(/usage|filename/i);
      expect(exitCode).toBe(0);
    });

    test("unknown command shows error", async () => {
      const { stdout, exitCode } = await runRepl([".nonexistent", "1 + 1", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output.toLowerCase()).toContain("unknown");
      // REPL should continue
      expect(output).toContain("2");
      expect(exitCode).toBe(0);
    });

    test(".history shows command history", async () => {
      const { stdout, exitCode } = await runRepl(["1 + 1", "2 + 2", ".history", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output).toContain("1 + 1");
      expect(output).toContain("2 + 2");
      expect(exitCode).toBe(0);
    });

    test(".break cancels multiline input", async () => {
      const { stdout, exitCode } = await runRepl([
        "function foo() {", // opens multiline
        ".break", // cancels it
        "1 + 1", // should eval normally
        ".exit",
      ]);
      const output = stripAnsi(stdout);
      expect(output).toContain("2");
      // foo should NOT be defined since we broke out
      expect(exitCode).toBe(0);
    });

    test(".break on empty multiline recovers prompt", async () => {
      const { stdout, exitCode } = await runRepl(["{", ".break", "99", ".exit"]);
      expect(stripAnsi(stdout)).toContain("99");
      expect(exitCode).toBe(0);
    });

    test("command prefix matching (.e -> .exit)", async () => {
      // ReplCommand.find allows prefix matching when name.len > 1
      const { exitCode } = await runRepl([".ex"]);
      expect(exitCode).toBe(0);
    });
  });

  describe(".copy command", () => {
    test(".copy with no args copies last result", async () => {
      const { stdout, exitCode } = await runRepl(["42", ".copy", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output).toContain("Copied");
      expect(output).toContain("clipboard");
      expect(exitCode).toBe(0);
    });

    test(".copy with expression evaluates and copies", async () => {
      const { stdout, exitCode } = await runRepl([".copy 1 + 1", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output).toContain("Copied");
      expect(output).toContain("clipboard");
      expect(exitCode).toBe(0);
    });

    test(".copy still sets _ variable", async () => {
      const { stdout, exitCode } = await runRepl([".copy 'hello'", "_", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output).toContain("hello");
      expect(exitCode).toBe(0);
    });
  });

  describe("error handling", () => {
    test("handles syntax errors gracefully", async () => {
      const { stdout, stderr, exitCode } = await runRepl(["(1 + ))", "1 + 1", ".exit"]);
      const allOutput = stripAnsi(stdout + stderr);
      expect(allOutput.toLowerCase()).toContain("error");
      // REPL should continue working after syntax error
      expect(allOutput).toContain("2");
      expect(exitCode).toBe(0);
    });

    test("handles runtime errors gracefully", async () => {
      const { stdout, stderr, exitCode } = await runRepl(["undefinedVariable", "1 + 1", ".exit"]);
      const allOutput = stripAnsi(stdout + stderr);
      expect(allOutput).toMatch(/not defined|ReferenceError/);
      expect(exitCode).toBe(0);
    });

    test("handles thrown string errors", async () => {
      const { stdout, stderr, exitCode } = await runRepl(["throw 'custom error'", "1 + 1", ".exit"]);
      const allOutput = stripAnsi(stdout + stderr);
      expect(allOutput).toContain("custom error");
      // REPL should continue after thrown error
      expect(allOutput).toContain("2");
      expect(exitCode).toBe(0);
    });

    test("handles thrown Error objects", async () => {
      const { stdout, stderr, exitCode } = await runRepl(["throw new Error('boom')", ".exit"]);
      const allOutput = stripAnsi(stdout + stderr);
      expect(allOutput).toContain("boom");
      expect(exitCode).toBe(0);
    });

    test("shows system error properties", async () => {
      const { stdout, stderr, exitCode } = await runRepl(["fs.readFileSync('/nonexistent/path/file.txt')", ".exit"]);
      const allOutput = stripAnsi(stdout + stderr);
      expect(allOutput).toMatch(/ENOENT|no such file/);
      expect(exitCode).toBe(0);
    });

    test("throwing custom inspect doesn't crash the loop", async () => {
      // format2 catches custom-inspect throws internally, but we verify no exception
      // leaks (BUN_JSC_validateExceptionChecks in CI) and the loop continues.
      const { stdout, stderr, exitCode } = await runRepl([
        `globalThis.__bad = { [Symbol.for("nodejs.util.inspect.custom")]() { throw new Error("boom"); } }; __bad`,
        "7 * 6",
        ".exit",
      ]);
      const allOutput = stripAnsi(stdout + stderr);
      // REPL must keep working after the inspection failure.
      // Use a product that won't appear in echoed input (7*6=42).
      expect(allOutput).toContain("42");
      expect(exitCode).toBe(0);
    });

    test("throwing Proxy ownKeys trap doesn't crash the loop", async () => {
      const { stdout, stderr, exitCode } = await runRepl([
        `new Proxy({}, { ownKeys() { throw new Error("boom"); } })`,
        "100 + 23",
        ".exit",
      ]);
      const allOutput = stripAnsi(stdout + stderr);
      expect(allOutput).toContain("123");
      expect(exitCode).toBe(0);
    });
  });

  describe("import statements", () => {
    test("import default from builtin module", async () => {
      const { stdout, exitCode } = await runRepl(["import path from 'path'", "typeof path.join", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output).toContain("function");
      expect(exitCode).toBe(0);
    });

    test("import named exports from builtin module", async () => {
      const { stdout, exitCode } = await runRepl(["import { join, resolve } from 'path'", "typeof join", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output).toContain("function");
      expect(exitCode).toBe(0);
    });

    test("import namespace from builtin module", async () => {
      const { stdout, exitCode } = await runRepl(["import * as os from 'os'", "typeof os.cpus", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output).toContain("function");
      expect(exitCode).toBe(0);
    });

    test("import used across lines", async () => {
      // Use path.posix.join so the output is identical on Windows (otherwise: "\\tmp\\test").
      const { stdout, exitCode } = await runRepl([
        "import path from 'path'",
        "path.posix.join('/tmp', 'test')",
        ".exit",
      ]);
      const output = stripAnsi(stdout);
      expect(output).toContain("/tmp/test");
      expect(exitCode).toBe(0);
    });

    test("import nonexistent module shows error", async () => {
      const { stdout, stderr, exitCode } = await runRepl(["import _ from 'nonexistent-module-xyz'", "1 + 1", ".exit"]);
      const allOutput = stripAnsi(stdout + stderr);
      // Should show an error about the module not being found
      expect(allOutput.toLowerCase()).toMatch(/error|not found|cannot find|resolve/);
      // REPL should continue after failed import
      expect(allOutput).toContain("2");
      expect(exitCode).toBe(0);
    });

    test("import default and named together", async () => {
      // Combined form: import X, { a, b } from 'mod'
      // Verifies both default and named bindings are set correctly.
      using dir = tempDir("repl-import-combined", {
        "mod.mjs": `
          export const named1 = "first";
          export const named2 = "second";
          export default "the-default";
        `,
      });
      const filePath = Bun.pathToFileURL(path.join(String(dir), "mod.mjs")).href;
      const { stdout, stderr, exitCode } = await runRepl([
        `import def, { named1, named2 } from ${JSON.stringify(filePath)}`,
        "JSON.stringify([def, named1, named2])",
        ".exit",
      ]);
      const output = stripAnsi(stdout + stderr);
      expect(output).toContain(`the-default`);
      expect(output).toContain(`first`);
      expect(output).toContain(`second`);
      // Ensure the array is fully populated (no undefineds).
      expect(output).not.toMatch(/\bnull\b|\bundefined\b/);
      expect(exitCode).toBe(0);
    });

    test("import with alias uses source export name", async () => {
      // Regression: `import { foo as bar }` was reading __ns.bar instead of __ns.foo.
      using dir = tempDir("repl-import-alias", {
        "mod.mjs": `export const foo = "correct"; export const bar = "wrong";`,
      });
      const filePath = Bun.pathToFileURL(path.join(String(dir), "mod.mjs")).href;
      const { stdout, exitCode } = await runRepl([
        `import { foo as bar } from ${JSON.stringify(filePath)}`,
        "bar",
        ".exit",
      ]);
      const output = stripAnsi(stdout);
      expect(output).toContain("correct");
      expect(output).not.toContain("wrong");
      expect(exitCode).toBe(0);
    });

    test("import with multiple aliases", async () => {
      using dir = tempDir("repl-import-multi-alias", {
        "mod.mjs": `export const a = 1; export const b = 2; export const c = 3;`,
      });
      const filePath = Bun.pathToFileURL(path.join(String(dir), "mod.mjs")).href;
      const { stdout, exitCode } = await runRepl([
        `import { a as x, b as y, c } from ${JSON.stringify(filePath)}`,
        "JSON.stringify([x, y, c])",
        ".exit",
      ]);
      const output = stripAnsi(stdout);
      expect(output).toContain("[1,2,3]");
      expect(exitCode).toBe(0);
    });

    test("side-effect-only import", async () => {
      using dir = tempDir("repl-import-side-effect", {
        "side.mjs": `globalThis.__sideEffectRan = true;`,
      });
      const filePath = Bun.pathToFileURL(path.join(String(dir), "side.mjs")).href;
      const { stdout, exitCode } = await runRepl([
        `import ${JSON.stringify(filePath)}`,
        "globalThis.__sideEffectRan",
        ".exit",
      ]);
      expect(stripAnsi(stdout)).toContain("true");
      expect(exitCode).toBe(0);
    });
  });

  describe("require", () => {
    test("require is defined", async () => {
      const { stdout, exitCode } = await runRepl(["typeof require", ".exit"]);
      expect(stripAnsi(stdout)).toContain("function");
      expect(exitCode).toBe(0);
    });

    test("require builtin module", async () => {
      const { stdout, exitCode } = await runRepl(["const path = require('path')", "typeof path.join", ".exit"]);
      expect(stripAnsi(stdout)).toContain("function");
      expect(exitCode).toBe(0);
    });

    test("require.resolve works", async () => {
      const { stdout, exitCode } = await runRepl(["typeof require.resolve", ".exit"]);
      expect(stripAnsi(stdout)).toContain("function");
      expect(exitCode).toBe(0);
    });

    test("require resolves local files relative to cwd", async () => {
      // Verifies module.filename is set correctly so require("./x") resolves.
      using dir = tempDir("repl-require-local", {
        "local.js": `module.exports = { value: "from-local-file" };`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "repl"],
        stdin: Buffer.from(`require("./local").value\n.exit\n`),
        stdout: "pipe",
        stderr: "pipe",
        cwd: String(dir),
        env: { ...bunEnv, TERM: "dumb", NO_COLOR: "1" },
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stripAnsi(stdout)).toContain("from-local-file");
      expect(exitCode).toBe(0);
    });

    test("module.filename has correct path separator", async () => {
      // Regression: was producing `/cwd[repl]` instead of `/cwd/[repl]`.
      const { stdout, exitCode } = await runRepl(["module.filename", ".exit"]);
      const output = stripAnsi(stdout);
      // Must contain a separator before [repl] — matches / or \ followed by [repl]
      expect(output).toMatch(/[\/\\]\[repl\]/);
      // Must NOT have the cwd smashed against [repl] without a separator
      expect(output).not.toMatch(/[a-zA-Z0-9]\[repl\]/);
      expect(exitCode).toBe(0);
    });
  });

  describe("global objects", () => {
    test("has access to Bun globals", async () => {
      const { stdout, exitCode } = await runRepl(["typeof Bun.version", ".exit"]);
      expect(stripAnsi(stdout)).toContain("string");
      expect(exitCode).toBe(0);
    });

    test("has access to console", async () => {
      const { stdout, exitCode } = await runRepl(["console.log('hello from repl')", ".exit"]);
      expect(stripAnsi(stdout)).toContain("hello from repl");
      expect(exitCode).toBe(0);
    });

    test("has access to Buffer", async () => {
      const { stdout, exitCode } = await runRepl(["Buffer.from('hello').length", ".exit"]);
      expect(stripAnsi(stdout)).toContain("5");
      expect(exitCode).toBe(0);
    });

    test("has access to process", async () => {
      const { stdout, exitCode } = await runRepl(["typeof process.version", ".exit"]);
      expect(stripAnsi(stdout)).toContain("string");
      expect(exitCode).toBe(0);
    });

    test("has __dirname and __filename", async () => {
      const { stdout, exitCode } = await runRepl(["typeof __dirname", "typeof __filename", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output).toContain("string");
      expect(exitCode).toBe(0);
    });

    test("has module object", async () => {
      const { stdout, exitCode } = await runRepl(["typeof module", ".exit"]);
      expect(stripAnsi(stdout)).toContain("object");
      expect(exitCode).toBe(0);
    });
  });

  describe("variable persistence", () => {
    test("variables persist across evaluations", async () => {
      const { stdout, exitCode } = await runRepl(["const x = 10", "const y = 20", "x + y", ".exit"]);
      expect(stripAnsi(stdout)).toContain("30");
      expect(exitCode).toBe(0);
    });

    test("let variables can be reassigned", async () => {
      const { stdout, exitCode } = await runRepl(["let counter = 0", "counter++", "counter++", "counter", ".exit"]);
      expect(stripAnsi(stdout)).toContain("2");
      expect(exitCode).toBe(0);
    });

    test("functions persist", async () => {
      const { stdout, exitCode } = await runRepl(["function add(a, b) { return a + b; }", "add(5, 3)", ".exit"]);
      expect(stripAnsi(stdout)).toContain("8");
      expect(exitCode).toBe(0);
    });

    test("classes persist across evaluations", async () => {
      const { stdout, exitCode } = await runRepl([
        "class Point { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }",
        "new Point(3, 4).sum()",
        ".exit",
      ]);
      expect(stripAnsi(stdout)).toContain("7");
      expect(exitCode).toBe(0);
    });

    test("const can be redeclared across lines", async () => {
      // REPL hoists const -> var so redeclaration works like Node's REPL.
      const { stdout, stderr, exitCode } = await runRepl(["const x = 1", "const x = 2", "x", ".exit"]);
      const output = stripAnsi(stdout + stderr);
      expect(output).not.toMatch(/already.*declared|redeclar/i);
      expect(output).toContain("2");
      expect(exitCode).toBe(0);
    });

    test("array destructuring persists", async () => {
      const { stdout, exitCode } = await runRepl(["const [a, b, c] = [10, 20, 30]", "a + b + c", ".exit"]);
      expect(stripAnsi(stdout)).toContain("60");
      expect(exitCode).toBe(0);
    });

    test("object destructuring persists", async () => {
      const { stdout, exitCode } = await runRepl(["const { px, py } = { px: 5, py: 7 }", "px * py", ".exit"]);
      expect(stripAnsi(stdout)).toContain("35");
      expect(exitCode).toBe(0);
    });

    test("object destructuring with rename persists", async () => {
      const { stdout, exitCode } = await runRepl(["const { a: renamed } = { a: 99 }", "renamed", ".exit"]);
      expect(stripAnsi(stdout)).toContain("99");
      expect(exitCode).toBe(0);
    });

    test("destructuring with defaults persists", async () => {
      const { stdout, exitCode } = await runRepl(["const { missing = 42 } = {}", "missing", ".exit"]);
      expect(stripAnsi(stdout)).toContain("42");
      expect(exitCode).toBe(0);
    });

    test("array rest destructuring persists", async () => {
      const { stdout, exitCode } = await runRepl(["const [first, ...rest] = [1, 2, 3, 4]", "rest", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output).toContain("2");
      expect(output).toContain("3");
      expect(output).toContain("4");
      expect(exitCode).toBe(0);
    });

    test("object rest destructuring persists", async () => {
      const { stdout, exitCode } = await runRepl([
        "const { keep, ...others } = { keep: 1, x: 2, y: 3 }",
        "Object.keys(others).sort().join(',')",
        ".exit",
      ]);
      expect(stripAnsi(stdout)).toContain("x,y");
      expect(exitCode).toBe(0);
    });

    test("nested destructuring persists", async () => {
      const { stdout, exitCode } = await runRepl([
        "const { outer: { inner } } = { outer: { inner: 'deep' } }",
        "inner",
        ".exit",
      ]);
      expect(stripAnsi(stdout)).toContain("deep");
      expect(exitCode).toBe(0);
    });
  });

  describe("multiline input", () => {
    test("handles multiline function definition", async () => {
      const { stdout, exitCode } = await runRepl([
        "function greet(name) {",
        "  return 'hi ' + name",
        "}",
        "greet('world')",
        ".exit",
      ]);
      expect(stripAnsi(stdout)).toContain("hi world");
      expect(exitCode).toBe(0);
    });

    test("handles multiline object", async () => {
      const { stdout, exitCode } = await runRepl(["({", "  x: 1,", "  y: 2", "})", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output).toContain("x");
      expect(output).toContain("y");
      expect(exitCode).toBe(0);
    });

    test("lone string directive returns the string", async () => {
      // REPL treats directives (string literal statements) as expressions.
      const { stdout, exitCode } = await runRepl([`"use strict"`, ".exit"]);
      expect(stripAnsi(stdout)).toContain("use strict");
      expect(exitCode).toBe(0);
    });
  });

  describe("async evaluation", () => {
    test("await expressions", async () => {
      const { stdout, exitCode } = await runRepl(["await Promise.resolve(42)", ".exit"]);
      expect(stripAnsi(stdout)).toContain("42");
      expect(exitCode).toBe(0);
    });

    test("await rejected promise shows error", async () => {
      const { stdout, stderr, exitCode } = await runRepl([
        "await Promise.reject(new Error('async fail'))",
        "1 + 1",
        ".exit",
      ]);
      const allOutput = stripAnsi(stdout + stderr);
      expect(allOutput).toContain("async fail");
      // REPL should continue after rejected promise
      expect(allOutput).toContain("2");
      expect(exitCode).toBe(0);
    });

    test("async functions", async () => {
      const { stdout, exitCode } = await runRepl([
        "async function getValue() { return 123; }",
        "await getValue()",
        ".exit",
      ]);
      expect(stripAnsi(stdout)).toContain("123");
      expect(exitCode).toBe(0);
    });
  });

  describe("TypeScript support", () => {
    test("type annotations are stripped", async () => {
      const { stdout, exitCode } = await runRepl(["const x: number = 42", "x", ".exit"]);
      expect(stripAnsi(stdout)).toContain("42");
      expect(exitCode).toBe(0);
    });

    test("interface declarations work", async () => {
      const { stdout, exitCode } = await runRepl([
        "interface User { name: string }",
        "const u: User = { name: 'test' }",
        "u.name",
        ".exit",
      ]);
      expect(stripAnsi(stdout)).toContain("test");
      expect(exitCode).toBe(0);
    });
  });

  describe("welcome message", () => {
    test("shows welcome message with version", async () => {
      const { stdout, exitCode } = await runRepl([".exit"]);
      const output = stripAnsi(stdout);
      expect(output).toContain("Welcome to Bun");
      expect(output).toMatch(/Bun v\d+\.\d+\.\d+/);
      expect(exitCode).toBe(0);
    });
  });

  describe("-e / --eval and -p / --print", () => {
    async function runReplWith(args: string[]) {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "repl", ...args],
        stdout: "pipe",
        stderr: "pipe",
        env: { ...bunEnv, NO_COLOR: "1" },
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout: stripAnsi(stdout), stderr: stripAnsi(stderr), exitCode };
    }

    test("-e evaluates and exits without printing result", async () => {
      const { stdout, exitCode } = await runReplWith(["-e", "1 + 1"]);
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    });

    test("-e does not show welcome message", async () => {
      const { stdout, exitCode } = await runReplWith(["-e", "1 + 1"]);
      expect(stdout).not.toContain("Welcome to Bun");
      expect(exitCode).toBe(0);
    });

    test("-e console.log output is shown", async () => {
      const { stdout, exitCode } = await runReplWith(["-e", "console.log('hello from eval')"]);
      expect(stdout).toBe("hello from eval\n");
      expect(exitCode).toBe(0);
    });

    test("--eval works like -e", async () => {
      const { stdout, exitCode } = await runReplWith(["--eval", "console.log(2 + 2)"]);
      expect(stdout).toBe("4\n");
      expect(exitCode).toBe(0);
    });

    test("-p prints the result and exits", async () => {
      const { stdout, exitCode } = await runReplWith(["-p", "1 + 1"]);
      expect(stdout).toBe("2\n");
      expect(exitCode).toBe(0);
    });

    test("--print works like -p", async () => {
      const { stdout, exitCode } = await runReplWith(["--print", "2 * 3"]);
      expect(stdout).toBe("6\n");
      expect(exitCode).toBe(0);
    });

    test("-p prints undefined for void expressions", async () => {
      const { stdout, exitCode } = await runReplWith(["-p", "void 0"]);
      expect(stdout).toBe("undefined\n");
      expect(exitCode).toBe(0);
    });

    test("-p with empty script prints undefined and exits", async () => {
      const { stdout, exitCode } = await runReplWith(["-p", ""]);
      expect(stdout).toBe("undefined\n");
      expect(exitCode).toBe(0);
    });

    test("-e supports TypeScript", async () => {
      const { stdout, exitCode } = await runReplWith(["-p", "const x: number = 42; x * 2"]);
      expect(stdout).toBe("84\n");
      expect(exitCode).toBe(0);
    });

    test("-e supports top-level await", async () => {
      const { stdout, exitCode } = await runReplWith(["-p", "await Promise.resolve(123)"]);
      expect(stdout).toBe("123\n");
      expect(exitCode).toBe(0);
    });

    test("-p wraps object literals", async () => {
      const { stdout, exitCode } = await runReplWith(["-p", "{ a: 1, b: 2 }"]);
      expect(stdout).toContain("a");
      expect(stdout).toContain("1");
      expect(stdout).toContain("b");
      expect(stdout).toContain("2");
      expect(exitCode).toBe(0);
    });

    test("-e with thrown error writes to stderr and exits with code 1", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["-e", "throw new Error('boom')"]);
      expect(stdout).toBe("");
      expect(stderr).toContain("boom");
      expect(exitCode).toBe(1);
    });

    test("-e with syntax error writes to stderr and exits with code 1", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["-e", "const ="]);
      expect(stdout).toBe("");
      expect(stderr.toLowerCase()).toContain("syntaxerror");
      expect(exitCode).toBe(1);
    });

    test("-e with rejected top-level await writes to stderr and exits with code 1", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["-e", "await Promise.reject(new Error('async fail'))"]);
      expect(stdout).toBe("");
      expect(stderr).toContain("async fail");
      expect(exitCode).toBe(1);
    });

    test("-e preserves process.exitCode set by the script", async () => {
      const { exitCode } = await runReplWith(["-e", "process.exitCode = 42"]);
      expect(exitCode).toBe(42);
    });

    test("-e fires process.on('beforeExit')", async () => {
      const { stdout, exitCode } = await runReplWith([
        "-e",
        "process.on('beforeExit', () => console.log('beforeExit fired'))",
      ]);
      expect(stdout).toBe("beforeExit fired\n");
      expect(exitCode).toBe(0);
    });

    test("-e drains event loop (timers fire before exit)", async () => {
      const { stdout, exitCode } = await runReplWith(["-e", "setTimeout(() => console.log('from timer'), 50)"]);
      expect(stdout).toBe("from timer\n");
      expect(exitCode).toBe(0);
    });

    test("-p drains event loop before printing", async () => {
      // Result should be printed after the timer output, since we drain
      // the event loop before printing the final result.
      const { stdout, exitCode } = await runReplWith(["-p", "setTimeout(() => console.log('timer'), 50); 'result'"]);
      expect(stdout).toBe('timer\n"result"\n');
      expect(exitCode).toBe(0);
    });

    test("-e supports require()", async () => {
      const { stdout, exitCode } = await runReplWith(["-p", "require('path').posix.join('/a', 'b')"]);
      expect(stdout).toBe('"/a/b"\n');
      expect(exitCode).toBe(0);
    });

    test("-e supports import statements", async () => {
      const { stdout, exitCode } = await runReplWith(["-e", "import path from 'path'; console.log(typeof path.join)"]);
      expect(stdout).toBe("function\n");
      expect(exitCode).toBe(0);
    });

    test("-e has access to __dirname and __filename", async () => {
      const { stdout, exitCode } = await runReplWith(["-e", "console.log(typeof __dirname, typeof __filename)"]);
      expect(stdout).toBe("string string\n");
      expect(exitCode).toBe(0);
    });

    // https://github.com/oven-sh/bun/issues/31225
    test("bare top-level `this` does not throw (issue #31225)", async () => {
      // Before the fix this threw `ReferenceError: exports is not defined`
      // because the parser rewrote top-level `this` to `exports`, and the REPL
      // IIFE has no `exports` binding.
      const { stdout, stderr, exitCode } = await runReplWith(["-e", "this"]);
      expect(stderr).toBe("");
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    });

    test("top-level `this` evaluates to globalThis (issue #31225)", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["-e", "console.log(typeof this, this === globalThis)"]);
      expect(stderr).toBe("");
      expect(stdout).toBe("object true\n");
      expect(exitCode).toBe(0);
    });

    test("member access on top-level `this` hits the global (issue #31225)", async () => {
      // `Math` lives on the global, so `this.Math` should be the same object.
      const { stdout, stderr, exitCode } = await runReplWith(["-e", "console.log(this.Math === Math)"]);
      expect(stderr).toBe("");
      expect(stdout).toBe("true\n");
      expect(exitCode).toBe(0);
    });
  });
});

// Interactive terminal-based REPL tests
describe.todoIf(isWindows)("Bun REPL (Terminal)", () => {
  test("shows welcome message and prompt", async () => {
    await withTerminalRepl(async ({ allOutput }) => {
      const output = allOutput();
      expect(output).toContain("Welcome to Bun");
      expect(output).toMatch(/\u276f|> /);
    });
  });

  test("evaluates expression and shows result", async () => {
    await withTerminalRepl(async ({ send, waitFor }) => {
      send("40 + 2\n");
      const output = await waitFor("42");
      expect(stripAnsi(output)).toContain("42");
    });
  });

  test("error shows in terminal", async () => {
    await withTerminalRepl(async ({ send, waitFor }) => {
      send("throw new Error('order test')\n");
      const output = await waitFor("order test");
      expect(stripAnsi(output)).toContain("order test");
    });
  });

  test("console.log shows in terminal", async () => {
    await withTerminalRepl(async ({ send, waitFor }) => {
      send("console.log('side effect')\n");
      const output = await waitFor("side effect");
      expect(stripAnsi(output)).toContain("side effect");
    });
  });

  test("Ctrl+C cancels current input", async () => {
    await withTerminalRepl(async ({ send, waitFor, allOutput }) => {
      send("some partial input");
      await waitFor("some partial input");
      send("\x03"); // Ctrl+C
      await waitFor(/\u276f|> /);
      // Should be back at a clean prompt
      send("1 + 1\n");
      await waitFor("2");
    });
  });

  test("Ctrl+D exits on empty line", async () => {
    await withTerminalRepl(async ({ terminal, proc }) => {
      terminal.write("\x04"); // Ctrl+D
      const exitCode = await Promise.race([proc.exited, Bun.sleep(3000).then(() => -1)]);
      expect(exitCode).toBe(0);
    });
  });

  test("require works in terminal", async () => {
    await withTerminalRepl(async ({ send, waitFor }) => {
      send("typeof require\n");
      const output = await waitFor("function");
      expect(stripAnsi(output)).toContain("function");
    });
  });

  test("import statement works in terminal", async () => {
    await withTerminalRepl(async ({ send, waitFor }) => {
      send("import path from 'path'\n");
      // Wait for the import to complete
      await waitFor(/\u276f|> /);
      send("path.sep\n");
      await waitFor("/");
    });
  });

  test("up arrow recalls previous command", async () => {
    await withTerminalRepl(async ({ send, waitFor }) => {
      send("111 + 222\n");
      await waitFor("333");
      // Press up arrow to recall previous command
      send("\x1b[A"); // Up arrow escape sequence
      await Bun.sleep(100);
      send("\n");
      // Should evaluate the same expression again
      await waitFor("333");
    });
  });

  test("down arrow restores temp line after history", async () => {
    // Regression: temp_line was leaked/lost when navigating history.
    await withTerminalRepl(async ({ send, waitFor }) => {
      // Establish history
      send("777 + 1\n");
      await waitFor("778");

      // Type partial input, go up (to 777+1), then down (back to partial)
      send("partial");
      await waitFor("partial");
      send("\x1b[A"); // Up — shows "777 + 1"
      await waitFor("777");
      send("\x1b[B"); // Down — should restore "partial"
      await waitFor("partial");

      // Cancel and verify REPL still works
      send("\x03"); // Ctrl+C to clear
      await waitFor(/\u276f|> /);
      send("1 + 1\n");
      await waitFor("2");
    });
  });

  test("tab completes REPL commands", async () => {
    await withTerminalRepl(async ({ send, waitFor }) => {
      send(".he");
      await waitFor(".he");
      send("\t"); // Tab — should complete to .help (only match)
      await waitFor(".help");
    });
  });

  test(".editor mode collects lines until Ctrl+D", async () => {
    await withTerminalRepl(async ({ send, waitFor }) => {
      send(".editor\n");
      await waitFor(/editor mode/i);
      send("let __editorResult = 100\n");
      send("__editorResult + 23\n");
      send("\x04"); // Ctrl+D to finish editor mode
      await waitFor("123");
    });
  });

  test("multiline input with open brace", async () => {
    await withTerminalRepl(async ({ send, waitFor }) => {
      send("function test() {\n");
      await waitFor("..."); // multiline prompt
      send("  return 99\n");
      send("}\n");
      // Wait for function to be defined
      await waitFor(/\u276f|> /);
      send("test()\n");
      await waitFor("99");
    });
  });

  // Regression for #31871: the line editor read input one byte at a time and
  // dropped every byte >= 0x80, so multi-byte UTF-8 (Korean, emoji, etc.) was
  // silently discarded and the evaluated expression differed from what was typed.
  test("keeps multi-byte UTF-8 characters typed into the line editor", async () => {
    await withTerminalRepl(async ({ send, waitFor, allOutput }) => {
      send('"a한b".length\n');
      // "a한b".length is 3; before the fix the 한 was dropped and it was 2.
      await waitFor(/\n\s*3\b/);
      // The echoed input line must still contain the Korean character.
      expect(allOutput()).toContain("한");
    });
  });

  test("keeps a full Korean string typed into the line editor", async () => {
    await withTerminalRepl(async ({ send, waitFor, allOutput }) => {
      send('"안녕하세요 영재님".length\n');
      // 9 characters; before the fix only the ASCII space survived -> 1.
      await waitFor(/\n\s*9\b/);
      expect(allOutput()).toContain("안녕하세요 영재님");
    });
  });

  test("backspace deletes a whole multi-byte character", async () => {
    await withTerminalRepl(async ({ send, waitFor, allOutput }) => {
      // Type a Korean char then backspace over it; byte-wise stepping would
      // leave a truncated UTF-8 sequence behind.
      send("한");
      await waitFor("한");
      send("\x7f"); // Backspace
      send('"ok".length\n');
      await waitFor(/\n\s*2\b/);
      // The dangling Korean char must be gone, leaving a clean expression.
      expect(allOutput()).toContain('"ok".length');
    });
  });

  test("left-arrow navigation steps over a whole multi-byte character", async () => {
    await withTerminalRepl(async ({ send, waitFor, allOutput }) => {
      // Type `"한"`, then left-arrow twice to land between the opening quote
      // and 한 (the second move must skip all 3 bytes of 한, not land mid-char),
      // and insert `b`. The buffer becomes `"b한"`, whose length is 2.
      send('"한"');
      await waitFor("한");
      send("\x1b[D"); // left: between 한 and the closing quote
      send("\x1b[D"); // left: between the opening quote and 한 (skips 3 bytes)
      send("b");
      send("\x05"); // Ctrl+E: move to end of line
      send(".length\n");
      await waitFor(/\n\s*2\b/);
      expect(allOutput()).toContain('"b한"');
    });
  });

  test("Ctrl+T transposes whole multi-byte characters", async () => {
    await withTerminalRepl(async ({ send, waitFor, allOutput }) => {
      // Type `"한b"`, move the cursor between 한 and b, then Ctrl+T. Byte-wise
      // transposition would split 한; it must swap the two whole codepoints so
      // the buffer becomes `"b한"` (length 2), not corrupted UTF-8.
      send('"한b"');
      await waitFor("한b");
      send("\x1b[D"); // left: between b and the closing quote
      send("\x1b[D"); // left: between 한 and b
      send("\x14"); // Ctrl+T: transpose 한 and b -> "b한"
      send("\x05"); // Ctrl+E: move to end of line
      send(".length\n");
      await waitFor(/\n\s*2\b/);
      expect(allOutput()).toContain('"b한"');
    });
  });

  test("drops a malformed UTF-8 sequence instead of corrupting the buffer", async () => {
    await withTerminalRepl(async ({ terminal, send, waitFor }) => {
      // ED A0 80 encodes the lone surrogate U+D800: it has a valid lead byte
      // and continuation-byte shape but is not valid UTF-8. It must be dropped,
      // leaving a clean "ab" (length 2), not fed into the buffer.
      send('"a');
      await waitFor("a");
      terminal.write(new Uint8Array([0xed, 0xa0, 0x80]));
      send('b".length\n');
      await waitFor(/\n\s*2\b/);
    });
  });

  test("a stray lead byte does not swallow the next keystroke", async () => {
    await withTerminalRepl(async ({ terminal, send, waitFor }) => {
      // 0xC2 is a 2-byte lead; the following byte (0x62 'b') is not a
      // continuation byte, so the lead is dropped. The 'b' must still be
      // processed, giving a clean "ab" (length 2), not "a" (length 1).
      send('"a');
      await waitFor("a");
      terminal.write(new Uint8Array([0xc2, 0x62])); // stray lead + 'b'
      send('".length\n');
      await waitFor(/\n\s*2\b/);
    });
  });

  // https://github.com/oven-sh/bun/issues/31604
  // Pasting a single line that is wider than the terminal used to re-render the
  // whole line once per pasted byte while only clearing the row the cursor sat
  // on, so every wrapped row piled up and the screen filled with hundreds of
  // stale copies. refresh_line now erases every row the previous render used
  // before redrawing, so the line appears once (wrapped), not repeated.
  test("pasting a long wrapping line does not spam the screen (issue #31604)", async () => {
    await withTerminalRepl(async ({ send, waitFor, rawOutput, cols }) => {
      // The exact payload from the issue: one physical line (the `\n` are
      // literal backslash-n, not newlines) long enough to wrap several rows
      // (399 chars wraps at the 120-column PTY).
      const payload = String.raw`.copy "pub const panic = _bun.crash_handler.panic;\npub const std_options = std.Options{\n    .enable_segfault_handler = false,\n    // Use BoringSSL's RAND_bytes instead of the default getrandom() syscall.\n    // BoringSSL falls back to /dev/urandom on older kernels (< 3.17) where\n    // the getrandom syscall doesn't exist, avoiding a panic on ENOSYS.\n    .cryptoRandomSeed = _bun.csprng,\n};"`;
      send(payload);

      // Wait for the payload's true tail (the last bytes: `…csprng,\n};"`, the
      // `\n` being literal backslash-n). Matching the real end guarantees the
      // resolving chunk extends through the final redraw's rewrite, so the grid
      // isn't sampled mid-refresh with the prompt row momentarily cleared.
      await waitFor(String.raw`.cryptoRandomSeed = _bun.csprng,\n};"`);

      // Replay the terminal output into a grid at the PTY's width (the REPL
      // wraps at the real terminal width) and inspect what's actually visible.
      // The distinctive prefix `.copy "pub const panic` lives on the first
      // wrapped row only, so counting rows that contain it tells us how many
      // stacked copies survived. The fix leaves exactly one; the bug left
      // hundreds.
      const rows = renderTerminalGrid(rawOutput(), cols).filter(line => line.length > 0);
      const copies = rows.filter(line => line.includes('.copy "pub const panic')).length;

      expect(copies).toBe(1);
      // The wrapped line occupies a handful of rows; the bug produced hundreds.
      expect(rows.length).toBeLessThan(20);
    });
  });

  // https://github.com/oven-sh/bun/issues/27670
  // Minimal form of the same bug: pasting a run of characters wider than the
  // terminal produced one duplicate line per overflowing character.
  test("pasting a line of repeated characters wraps once (issue #27670)", async () => {
    await withTerminalRepl(async ({ send, waitFor, rawOutput, cols }) => {
      // A distinctive tail at the end of the payload is only echoed once the
      // whole (wrapped) line has been rendered, so waiting for it is
      // deterministic — no fixed sleeps that could sample a partial redraw.
      // Make it comfortably wider than the terminal so it definitely wraps.
      const tail = "__END27670";
      const fill = cols * 2;
      send('.copy "' + Buffer.alloc(fill - tail.length, "a").toString() + tail + '"');
      await waitFor(tail + '"');

      const rows = renderTerminalGrid(rawOutput(), cols).filter(line => line.length > 0);
      const copies = rows.filter(line => /^[❯>] \.copy "a/.test(line)).length;

      expect(copies).toBe(1);
      expect(rows.length).toBeLessThan(20);
    });
  });

  // https://github.com/oven-sh/bun/issues/27461 (line-wrap half)
  // Same root cause reached by typing rather than pasting: once the input grew
  // past the terminal edge, every subsequent keystroke re-emitted the whole
  // line without clearing the earlier wrapped rows. (The separate typing
  // flicker reported in that issue — the line is still redrawn per keystroke —
  // is not addressed here.)
  test("typing past the terminal width wraps once (issue #27461)", async () => {
    await withTerminalRepl(async ({ send, waitFor, rawOutput, cols }) => {
      // Unique tail typed last; waiting for it means the final keystroke's
      // redraw has landed before we sample the grid. Type well past the
      // terminal edge so the line wraps.
      const tail = "__END27461";
      const text = 'console.log("' + Buffer.alloc(cols * 2 - tail.length, "a").toString() + tail;
      // Send one byte at a time so each is a distinct keystroke/redraw.
      for (const ch of text) send(ch);
      await waitFor(tail);

      const rows = renderTerminalGrid(rawOutput(), cols).filter(line => line.length > 0);
      const copies = rows.filter(line => line.includes('console.log("a')).length;

      expect(copies).toBe(1);
      expect(rows.length).toBeLessThan(20);
    });
  });

  // The multi-row clear walks the cursor up based on the terminal width, so the
  // REPL must know the *real* width. If it assumed a narrower width than the PTY,
  // typing past that assumed width would make it clear rows it doesn't own —
  // eating earlier output like the welcome banner. Type a line that fits on one
  // physical row at the PTY width and confirm nothing above the prompt is erased.
  test("does not erase earlier output on a wide terminal", async () => {
    await withTerminalRepl(async ({ send, waitFor, rawOutput, cols }) => {
      // Comfortably under the PTY width so it must NOT wrap (would have been
      // treated as wrapped under the old hardcoded 80-column assumption).
      const tail = "__NOWRAP";
      const text = Buffer.alloc(Math.floor(cols * 0.7) - tail.length, "a").toString() + tail;
      for (const ch of text) send(ch);
      await waitFor(tail);

      const rows = renderTerminalGrid(rawOutput(), cols).filter(line => line.length > 0);
      // The welcome banner printed at startup must still be on screen.
      expect(rows.some(line => line.includes("Welcome to Bun"))).toBe(true);
      // The input fits on one row, so exactly one row carries it.
      expect(rows.filter(line => line.includes(tail)).length).toBe(1);
    });
  });

  // terminal_width must track mid-session resizes: refresh_line re-queries it
  // each redraw. After narrowing the terminal, a line that fit before now wraps,
  // and the REPL must clear/redraw at the new width (one copy), not the old one.
  test("tracks a mid-session terminal resize", async () => {
    await withTerminalRepl(async ({ terminal, send, waitFor, rawOutput }) => {
      const narrow = 40;
      terminal.resize(narrow, 40);

      // A line wider than the new width but not the old one: it must wrap at 40.
      // refresh_line re-queries the width on every keystroke, so the resize is
      // picked up as the line is typed (no prompt is re-emitted on resize, so
      // there's nothing to wait on until the tail echoes back).
      const tail = "__RESIZED";
      const text = Buffer.alloc(narrow * 2 - tail.length, "Z").toString() + tail;
      for (const ch of text) send(ch);
      await waitFor(tail);

      const rows = renderTerminalGrid(rawOutput(), narrow).filter(line => line.length > 0);
      // Rendered once at the new width: the prompt row appears exactly once and
      // the screen isn't flooded with stale copies.
      const promptRows = rows.filter(line => /^[❯>] Z/.test(line)).length;
      expect(promptRows).toBe(1);
      expect(rows.length).toBeLessThan(20);
    });
  });

  // Editing a wrapped line and then committing (here: Ctrl+C) from an interior
  // cursor row must not leave the tail of the cancelled input stranded below the
  // fresh prompt. The commit paths snap the cursor to the bottom of the render
  // before emitting their newline.
  test("cancelling a wrapped line from the start leaves no stale tail", async () => {
    await withTerminalRepl(async ({ send, waitFor, rawOutput, cols }) => {
      // Fill with a distinctive character that appears nowhere in the prompt,
      // the `^C`, or the post-cancel output — so finding it below the `^C` row
      // unambiguously means a fragment of the cancelled input was stranded
      // there. A trailing tail gives a deterministic "fully echoed" signal.
      const tail = "__CANCELTAIL";
      send(Buffer.alloc(cols * 2 - tail.length, "Z").toString() + tail);
      await waitFor(tail);

      send("\x01"); // Ctrl+A -> cursor to start of the wrapped line
      await waitFor(/\u276f|> /); // refresh repositions the cursor; prompt is re-emitted
      send("\x03"); // Ctrl+C -> cancel
      await waitFor("^C");

      // Evaluate a fresh marker so we can locate the new prompt.
      send("7 * 6\n");
      await waitFor("42");

      const rows = renderTerminalGrid(rawOutput(), cols).filter(line => line.length > 0);
      expect(rows.some(line => line.includes("^C"))).toBe(true);
      // The fix drops the cursor to the *last* wrapped row before printing `^C`,
      // so the cancelled input stays intact on the rows above it. Without the
      // snap, `^C` is written at column 2 of the *first* render row where Ctrl+A
      // left the cursor, producing `❯ ^CZZZ…` — i.e. the first row carrying the
      // fill char would also carry `^C`. Assert it doesn't (payload-independent;
      // the `^C` lands on a separate, lower row when the snap is present).
      const firstFillRow = rows.find(line => line.includes("Z"));
      expect(firstFillRow).toBeDefined();
      expect(firstFillRow).not.toContain("^C");
    });
  });
});

// History file written on REPL exit must be owner-only (0600), since it can
// contain pasted credentials. See src/runtime/cli/repl.rs History::save.
describe.skipIf(isWindows)("REPL history file permissions", () => {
  test("persists history readable only by the owner", async () => {
    using dir = tempDir("repl-history-perms", {});
    const home = String(dir);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "repl"],
      stdin: Buffer.from(['const dbUrl = "postgres://user:hunter2@db.internal/prod"', ".exit", ""].join("\n")),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...bunEnv,
        TERM: "dumb",
        NO_COLOR: "1",
        HOME: home,
      },
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    // Legitimate behavior still works: the typed line is persisted to
    // $HOME/.bun_repl_history on exit.
    const historyPath = path.join(home, ".bun_repl_history");
    const content = await Bun.file(historyPath).text();
    expect(content).toContain("const dbUrl");

    // The file must not be readable or writable by group/other, while the
    // owner keeps read/write access.
    const mode = statSync(historyPath).mode & 0o777;
    expect(mode & 0o077).toBe(0);
    expect(mode & 0o600).toBe(0o600);

    expect(stripAnsi(stdout)).toContain("Welcome to Bun");
    expect(exitCode).toBe(0);
  });

  test("tightens permissions on a pre-existing history file", async () => {
    using dir = tempDir("repl-history-perms-existing", {
      ".bun_repl_history": "1 + 1\n",
    });
    const home = String(dir);
    const historyPath = path.join(home, ".bun_repl_history");
    chmodSync(historyPath, 0o644);

    await using proc = Bun.spawn({
      cmd: [bunExe(), "repl"],
      stdin: Buffer.from(['const dbUrl = "postgres://user:hunter2@db.internal/prod"', ".exit", ""].join("\n")),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...bunEnv,
        TERM: "dumb",
        NO_COLOR: "1",
        HOME: home,
      },
    });

    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

    const content = await Bun.file(historyPath).text();
    expect(content).toContain("const dbUrl");

    const mode = statSync(historyPath).mode & 0o777;
    expect(mode & 0o077).toBe(0);
    expect(mode & 0o600).toBe(0o600);

    expect(stripAnsi(stdout)).toContain("Welcome to Bun");
    expect(exitCode).toBe(0);
  });
});

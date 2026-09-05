// Tests for Bun REPL
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { chmodSync, statSync } from "node:fs";
import path from "path";

const stripAnsi = Bun.stripANSI;

/**
 * Runs `bun repl` with piped stdin (non-TTY mode) and captures its output.
 *
 * In this mode the REPL writes "> " and a newline for every prompt, then what
 * the line evaluated to. `outputs` holds the text that followed each prompt:
 * one entry per evaluated input, none for the final `.exit` (or EOF). Stack
 * frames are dropped from it, since their positions depend on every line
 * evaluated before.
 */
async function runRepl(
  input: string | string[],
  options: {
    env?: Record<string, string>;
    cwd?: string;
    /** Where the REPL keeps .bun_repl_history. Defaults to an empty directory. */
    home?: string;
  } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number; outputs: string[] }> {
  const inputStr = Array.isArray(input) ? input.join("\n") + "\n" : input;
  const { env = {}, cwd } = options;

  // The REPL loads and saves $HOME/.bun_repl_history (USERPROFILE on Windows).
  using tempHome = tempDir("repl-home", {});
  const home = options.home ?? String(tempHome);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "repl"],
    stdin: Buffer.from(inputStr),
    stdout: "pipe",
    stderr: "pipe",
    cwd,
    env: {
      ...bunEnv,
      TERM: "dumb",
      NO_COLOR: "1",
      ...env,
      HOME: home,
      USERPROFILE: home,
    },
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const outputs = stripAnsi(stdout)
    .split("> \n")
    .slice(1, -1)
    .map(chunk => chunk.replace(/^ +at .*\n?/gm, "").trim());

  return { stdout, stderr, exitCode, outputs };
}

interface Screen {
  /** One string per row, holding exactly the cells that were written to it. */
  rows: string[];
  cursor: { row: number; col: number };
}

// A model of a `cols` wide terminal fed with the REPL's output: text auto-wraps
// (a wide glyph that does not fit in the last cell moves to the next row whole),
// and the cursor and erase controls the line editor uses are interpreted. The
// screen is unbounded in height, so rows never scroll off.
class ScreenModel {
  private readonly rows: string[][] = [[]];
  private row = 0;
  private col = 0;
  // A glyph that fills the row leaves the cursor on the last column; the wrap
  // happens when the next glyph arrives (as in xterm).
  private pendingWrap = false;
  // An escape sequence cut off at the end of the previous chunk.
  private unfinished = "";

  constructor(private cols: number) {}

  /** Rows drawn so far keep their cells, as in a terminal that does not reflow. */
  resize(cols: number): void {
    this.cols = cols;
  }

  private rowAt(index: number): string[] {
    while (this.rows.length <= index) this.rows.push([]);
    return this.rows[index];
  }

  feed(chunk: string): void {
    const output = this.unfinished + chunk;
    this.unfinished = "";
    let i = 0;
    while (i < output.length) {
      const codePoint = output.codePointAt(i)!;
      if (codePoint === 0x1b) {
        const rest = output.slice(i, i + 24);
        const seq = /^\x1b\[([\d;]*)([A-Za-z])/.exec(rest);
        if (seq === null) {
          if (/^\x1b(\[[\d;]*)?$/.test(rest)) {
            this.unfinished = output.slice(i);
            return;
          }
          throw new Error(`ScreenModel: unsupported escape sequence ${JSON.stringify(rest)}`);
        }
        i += seq[0].length;
        this.control(seq[2], seq[1], seq[0]);
        continue;
      }
      const ch = codePoint > 0xffff ? String.fromCodePoint(codePoint) : output[i];
      i += ch.length;
      if (ch === "\r") {
        this.col = 0;
        this.pendingWrap = false;
      } else if (ch === "\n") {
        // The pty translates "\n" to "\r\n", so the column was already reset.
        this.row++;
        this.pendingWrap = false;
      } else {
        this.put(ch, codePoint < 0x80 ? 1 : Bun.stringWidth(ch));
      }
    }
  }

  private control(command: string, params: string, sequence: string): void {
    if (command === "m") return; // colors
    // The line editor only ever sends a single parameter, and never one past a terminal's size.
    if (!/^\d{0,4}$/.test(params)) {
      throw new Error(`ScreenModel: unsupported escape sequence ${JSON.stringify(sequence)}`);
    }
    const n = params === "" ? undefined : Number(params);
    switch (command) {
      case "A":
        this.row = Math.max(0, this.row - (n ?? 1));
        break;
      case "B":
        this.row += n ?? 1;
        break;
      case "C":
        this.col = Math.min(this.cols - 1, this.col + (n ?? 1));
        break;
      case "D":
        this.col = Math.max(0, this.col - (n ?? 1));
        break;
      case "J": // erase from the cursor to the end of the screen
        if ((n ?? 0) !== 0) throw new Error(`ScreenModel: unsupported erase ${JSON.stringify(sequence)}`);
        this.rowAt(this.row).length = Math.min(this.rowAt(this.row).length, this.col);
        this.rows.length = this.row + 1;
        break;
      case "K": // erase to the end of the row (0) or the whole row (2)
        if (n === 2) this.rowAt(this.row).length = 0;
        else if ((n ?? 0) === 0) this.rowAt(this.row).length = Math.min(this.rowAt(this.row).length, this.col);
        else throw new Error(`ScreenModel: unsupported erase ${JSON.stringify(sequence)}`);
        break;
      default:
        throw new Error(`ScreenModel: unsupported escape sequence ${JSON.stringify(sequence)}`);
    }
    this.pendingWrap = false;
  }

  private put(ch: string, width: number): void {
    if (width === 0) return;
    if (this.pendingWrap || this.col + width > this.cols) {
      this.row++;
      this.col = 0;
      this.pendingWrap = false;
    }
    const cells = this.rowAt(this.row);
    while (cells.length < this.col) cells.push(" ");
    cells[this.col] = ch;
    // The second cell of a wide glyph holds nothing of its own.
    for (let extra = 1; extra < width; extra++) cells[this.col + extra] = "";
    if (this.col + width >= this.cols) {
      this.col = this.cols - 1;
      this.pendingWrap = true;
    } else {
      this.col += width;
    }
  }

  screen(): Screen {
    this.rowAt(this.row);
    return { rows: this.rows.map(cells => cells.join("")), cursor: { row: this.row, col: this.col } };
  }
}

function formatScreen({ rows, cursor }: Screen): string {
  return rows
    .map((text, row) => {
      if (row !== cursor.row) return text;
      // Find the character that starts at the cursor's column.
      let column = 0;
      let index = 0;
      while (index < text.length && column < cursor.col) {
        const ch = String.fromCodePoint(text.codePointAt(index)!);
        column += Bun.stringWidth(ch);
        index += ch.length;
      }
      return text.slice(0, index) + " ".repeat(Math.max(0, cursor.col - column)) + "|" + text.slice(index);
    })
    .join("\n");
}

// Helper to run REPL in a PTY and interact with it
async function withTerminalRepl(
  fn: (helpers: {
    terminal: Bun.Terminal;
    proc: Bun.Subprocess;
    send: (text: string) => void;
    waitFor: (pattern: string | RegExp, timeoutMs?: number) => Promise<string>;
    /** Resolves with the rendered screen once `ready` accepts it. */
    waitForScreen: (ready: (screen: Screen) => boolean, timeoutMs?: number) => Promise<Screen>;
    /** Changes the width of the pty, and of the screen that `waitForScreen` renders. */
    resize: (cols: number) => void;
    allOutput: () => string;
  }) => Promise<void>,
  options: { env?: Record<string, string | undefined>; cols?: number } = {},
) {
  const received: string[] = [];
  const cols = options.cols ?? 120;
  const rows = 40;
  let cursor = 0;
  let resolveWaiter: (() => void) | null = null;
  // Streaming, so that a multi-byte character split across two reads stays intact.
  const decoder = new TextDecoder();

  // The REPL loads and saves $HOME/.bun_repl_history (USERPROFILE on Windows).
  using home = tempDir("repl-home", {});
  await using terminal = new Bun.Terminal({
    cols,
    rows,
    data(_term, data) {
      const str = decoder.decode(data, { stream: true });
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
      ...options.env,
      HOME: String(home),
      USERPROFILE: String(home),
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

  // The REPL redraws within milliseconds of a keystroke; the deadline is well
  // below the test timeout so that a failure reports the screen it got stuck on.
  const model = new ScreenModel(cols);
  let modelled = 0;
  const renderReceived = () => {
    while (modelled < received.length) model.feed(received[modelled++]);
  };
  const waitForScreen = async (ready: (screen: Screen) => boolean, timeoutMs = 3000): Promise<Screen> => {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      renderReceived();
      const screen = model.screen();
      if (ready(screen)) return screen;
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(`Timed out waiting for the screen. Last screen (| marks the cursor):\n${formatScreen(screen)}`);
      }
      // Wait for the next chunk of terminal data, or for the deadline.
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, remaining);
        resolveWaiter = () => {
          clearTimeout(timer);
          resolve();
        };
      });
      resolveWaiter = null;
    }
  };

  // Call this while the REPL waits for input: what it wrote before is laid out
  // at the old width, and what it writes next at the new one.
  const resize = (newCols: number) => {
    renderReceived();
    terminal.resize(newCols, rows);
    model.resize(newCols);
  };

  const allOutput = () => stripAnsi(received.join(""));

  await waitFor(/\u276f|> /); // Wait for prompt

  await fn({ terminal, proc, send, waitFor, waitForScreen, resize, allOutput });

  // Clean exit. Ctrl+A then Ctrl+K first discards whatever the test left on
  // the line, wherever the cursor is, so `.exit` is not appended to it (which
  // would leave the REPL running until the test times out).
  if (proc.exitCode === null) {
    send("\x01\x0b.exit\n");
    await proc.exited;
  }
}

describe.concurrent("Bun REPL", () => {
  describe("basic evaluation", () => {
    test("prints the value of each evaluated line", async () => {
      const { outputs, stderr, exitCode } = await runRepl([
        "1 + 1",
        "2 * 3",
        "Math.sqrt(16)",
        "'hello'.toUpperCase()",
        "({ a: 1, b: 2 })",
        "[1, 2, 3].map(x => x * 2)",
        // A directive (a lone string literal statement) is an expression here.
        `"use strict"`,
        ".exit",
      ]);
      expect(outputs).toEqual(["2", "6", "4", '"HELLO"', "{\n  a: 1,\n  b: 2,\n}", "[ 2, 4, 6 ]", '"use strict"']);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  });

  describe("special variables", () => {
    test("_ holds the last result and _error the last error", async () => {
      const { outputs, stderr, exitCode } = await runRepl([
        "42",
        "_",
        "10",
        "_ * 2",
        "_ + 5",
        "throw new Error('test error')",
        "_error.message",
        ".exit",
      ]);
      expect(outputs).toEqual(["42", "42", "10", "20", "25", "error: test error", '"test error"']);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  });

  describe("REPL commands", () => {
    test(".exit exits the REPL after the welcome message", async () => {
      const { stdout, stderr, exitCode } = await runRepl([".exit"]);
      expect(normalizeBunSnapshot(stripAnsi(stdout))).toMatchInlineSnapshot(`
        "Welcome to Bun v<bun-version>
        Type .copy [code] to copy to clipboard. .help for more info.

        >"
      `);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test(".help shows help message", async () => {
      const { outputs, stderr, exitCode } = await runRepl([".help", ".exit"]);
      expect(outputs).toHaveLength(1);
      expect(outputs[0]).toMatchInlineSnapshot(`
        "REPL Commands:
          .help        Print this help message
          .exit        Exit the REPL
          .clear       Clear the screen
          .copy        Copy result to clipboard (.copy [expr])
          .load        Load a file into the REPL session
          .save        Save REPL history to a file
          .editor      Enter multi-line editor mode
          .break       Cancel current input
          .history     Show command history

        Keybindings:
          Ctrl+A       Move to start of line
          Ctrl+E       Move to end of line
          Ctrl+B/F     Move backward/forward one character
          Alt+B/F      Move backward/forward one word
          Ctrl+U       Delete to start of line
          Ctrl+K       Delete to end of line
          Ctrl+W       Delete word backward
          Ctrl+D       Delete character / Exit if line empty
          Ctrl+L       Clear screen
          Ctrl+T       Swap characters
          Up/Down      Navigate history
          Tab          Auto-complete / accept suggestion
          Right/End    Accept inline suggestion

        Special Variables:
          _            Last expression result
          _error       Last error"
      `);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test(".load loads and evaluates a file", async () => {
      using dir = tempDir("repl-load-test", {
        "test.js": "var loadedVar = 42;\n",
      });
      const filePath = path.join(String(dir), "test.js");
      const { outputs, stderr, exitCode } = await runRepl([`.load ${filePath}`, "loadedVar", ".exit"]);
      expect(outputs).toEqual([`Loading ${filePath}...\n42`, "42"]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test(".load with a nonexistent file shows the error and keeps running", async () => {
      // A relative path: Windows rejects a forward-slash absolute path with EINVAL.
      const { outputs, stderr, exitCode } = await runRepl([
        ".load definitely-does-not-exist-repl-test.js",
        "1 + 1",
        ".exit",
      ]);
      expect(outputs).toEqual([
        // The error carries the path on POSIX only.
        expect.stringMatching(
          /^ENOENT: (definitely-does-not-exist-repl-test\.js: )?No such file or directory \(open\(\)\)$/,
        ),
        "2",
      ]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test(".load and .save without a filename show their usage", async () => {
      const { outputs, stderr, exitCode } = await runRepl([".load", ".save", ".exit"]);
      expect(outputs).toEqual(["Usage: .load <filename>", "Usage: .save <filename>"]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test(".save saves the session to a file", async () => {
      using dir = tempDir("repl-save-test", {});
      const filePath = path.join(String(dir), "saved.js");
      const { outputs, stderr, exitCode } = await runRepl(["const x = 1", "const y = 2", `.save ${filePath}`, ".exit"]);
      expect(outputs).toEqual(["1", "2", `Session saved to ${filePath}`]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      expect(await Bun.file(filePath).text()).toBe("const x = 1\nconst y = 2\n");
    });

    test("unknown command shows an error and keeps running", async () => {
      const { outputs, stderr, exitCode } = await runRepl([".nonexistent", "1 + 1", ".exit"]);
      expect(outputs).toEqual(["Unknown command: .nonexistent\nType .help for available commands", "2"]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test(".history shows command history", async () => {
      const { outputs, stderr, exitCode } = await runRepl(["1 + 1", "2 + 2", ".history", ".exit"]);
      expect(outputs).toEqual(["2", "4", "Command History:\n     1  1 + 1\n     2  2 + 2"]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test(".break cancels multiline input", async () => {
      const { outputs, stderr, exitCode } = await runRepl([
        "function foo() {", // opens multiline
        ".break", // cancels it, so foo is never defined
        "typeof foo",
        "{",
        ".break",
        "99",
        ".exit",
      ]);
      expect(outputs).toEqual(["", '"undefined"', "", "99"]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("command prefix matching (.ex -> .exit)", async () => {
      // ReplCommand.find allows prefix matching when name.len > 1
      const { outputs, stderr, exitCode } = await runRepl([".ex"]);
      expect(outputs).toEqual([]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  });

  describe(".copy command", () => {
    test(".copy copies the last result or the value of an expression", async () => {
      const { stdout, outputs, stderr, exitCode } = await runRepl([
        "42",
        ".copy",
        ".copy 1 + 1",
        ".copy 'hello'",
        "_",
        ".exit",
      ]);
      expect(outputs).toEqual([
        "42",
        "Copied 2 characters to clipboard",
        "Copied 1 characters to clipboard",
        "Copied 5 characters to clipboard",
        // .copy <expr> still sets _
        '"hello"',
      ]);
      // The clipboard is written with an OSC 52 sequence carrying the base64 text.
      const osc52 = (text: string) => `\x1b]52;c;${btoa(text)}\x07`;
      expect(stdout).toContain(osc52("42"));
      expect(stdout).toContain(osc52("2"));
      expect(stdout).toContain(osc52("hello"));
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  });

  describe("error handling", () => {
    test("reports errors and keeps running", async () => {
      const { stdout, outputs, stderr, exitCode } = await runRepl([
        "(1 + ))",
        "undefinedVariable",
        "throw 'custom error'",
        "throw new Error('boom')",
        "fs.readFileSync('/nonexistent/path/file.txt')",
        "1 + 1",
        ".exit",
      ]);
      expect(outputs).toEqual([
        "SyntaxError: Unexpected token ')'",
        "ReferenceError: undefinedVariable is not defined",
        '"custom error"',
        "error: boom",
        expect.stringMatching(/^ENOENT: no such file or directory, open '.*file\.txt'\n[\s\S]* code: "ENOENT"$/),
        "2",
      ]);
      // A thrown error is followed by its stack frames.
      expect(stripAnsi(stdout)).toMatch(/^error: boom\n +at /m);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("a throwing inspect hook does not crash the loop", async () => {
      // format2 catches custom-inspect throws internally, but we verify no exception
      // leaks (BUN_JSC_validateExceptionChecks in CI) and the loop continues.
      const { outputs, stderr, exitCode } = await runRepl([
        `globalThis.__bad = { [Symbol.for("nodejs.util.inspect.custom")]() { throw new Error("boom"); } }; __bad`,
        // Products that do not appear in the echoed input (7*6=42, 100+23=123).
        "7 * 6",
        `new Proxy({}, { ownKeys() { throw new Error("boom"); } })`,
        "100 + 23",
        ".exit",
      ]);
      expect(outputs).toEqual(["[native code: Exception]", "42", "{}", "123"]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  });

  describe("import statements", () => {
    test("binds default, named and namespace imports from builtin modules", async () => {
      // Use path.posix.join so the output is identical on Windows (otherwise: "\\tmp\\test").
      const { outputs, stderr, exitCode } = await runRepl([
        "import path from 'path'",
        "typeof path.join",
        "import { join, resolve } from 'path'",
        "typeof join",
        "typeof resolve",
        "import * as os from 'os'",
        "typeof os.cpus",
        // A binding imported on an earlier line is still there.
        "path.posix.join('/tmp', 'test')",
        ".exit",
      ]);
      // An import statement prints the module or binding it evaluated to.
      expect(outputs).toEqual([
        expect.stringContaining("join: [Function: join]"),
        '"function"',
        "[Function: resolve]",
        '"function"',
        '"function"',
        expect.stringMatching(/^Module \{\n/),
        '"function"',
        '"/tmp/test"',
      ]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("import of a nonexistent module shows an error and keeps running", async () => {
      const { outputs, stderr, exitCode } = await runRepl(["import _ from 'nonexistent-module-xyz'", "1 + 1", ".exit"]);
      expect(outputs).toEqual([
        expect.stringMatching(/^error: Cannot find package 'nonexistent-module-xyz' from /),
        "2",
      ]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("binds every form of import from a local module", async () => {
      using dir = tempDir("repl-import-forms", {
        "combined.mjs": `
          export const named1 = "first";
          export const named2 = "second";
          export default "the-default";
        `,
        "alias.mjs": `export const foo = "correct"; export const bar = "wrong";`,
        "multi.mjs": `export const a = 1; export const b = 2; export const c = 3;`,
        "side.mjs": `globalThis.__sideEffectRan = true;`,
      });
      const url = (name: string) => JSON.stringify(Bun.pathToFileURL(path.join(String(dir), name)).href);
      const { outputs, stderr, exitCode } = await runRepl([
        // Combined form: import X, { a, b } from 'mod' sets both the default and the named bindings.
        `import def, { named1, named2 } from ${url("combined.mjs")}`,
        "[def, named1, named2]",
        // Regression: `import { foo as bar }` was reading __ns.bar instead of __ns.foo.
        `import { foo as bar } from ${url("alias.mjs")}`,
        "bar",
        `import { a as x, b as y, c } from ${url("multi.mjs")}`,
        "[x, y, c]",
        `import ${url("side.mjs")}`,
        "globalThis.__sideEffectRan",
        ".exit",
      ]);
      expect(outputs).toEqual([
        '"the-default"',
        '[ "the-default", "first", "second" ]',
        '"correct"',
        '"correct"',
        "3",
        "[ 1, 2, 3 ]",
        "Module {}",
        "true",
      ]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  });

  describe("require", () => {
    test("require and require.resolve are functions and load builtin modules", async () => {
      const { outputs, stderr, exitCode } = await runRepl([
        "typeof require",
        "const path = require('path')",
        "typeof path.join",
        "typeof require.resolve",
        ".exit",
      ]);
      expect(outputs).toEqual([
        '"function"',
        expect.stringContaining("join: [Function: join]"),
        '"function"',
        '"function"',
      ]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("require resolves local files relative to cwd", async () => {
      // Verifies module.filename is set correctly so require("./x") resolves.
      using dir = tempDir("repl-require-local", {
        "local.js": `module.exports = { value: "from-local-file" };`,
      });
      const { outputs, stderr, exitCode } = await runRepl([`require("./local").value`, "module.filename", ".exit"], {
        cwd: String(dir),
      });
      expect(outputs).toEqual([
        '"from-local-file"',
        // Regression: was producing `/cwd[repl]` instead of `/cwd/[repl]`.
        expect.stringMatching(/^".+[\/\\]\[repl\]"$/),
      ]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  });

  describe("global objects", () => {
    test("has Bun, console, Buffer, process and the CommonJS module globals", async () => {
      const { outputs, stderr, exitCode } = await runRepl([
        "typeof Bun.version",
        "console.log('hello from repl')",
        "Buffer.from('hello').length",
        "typeof process.version",
        "typeof __dirname",
        "typeof __filename",
        "typeof module",
        ".exit",
      ]);
      expect(outputs).toEqual([
        '"string"',
        "hello from repl\nundefined",
        "5",
        '"string"',
        '"string"',
        '"string"',
        '"object"',
      ]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  });

  describe("variable persistence", () => {
    test("declarations persist across evaluations", async () => {
      const { outputs, stderr, exitCode } = await runRepl([
        "const x = 10",
        "const y = 20",
        "x + y",
        "let counter = 0",
        "counter++",
        "counter++",
        "counter",
        "function add(a, b) { return a + b; }",
        "add(5, 3)",
        "class Point { constructor(x, y) { this.x = x; this.y = y; } sum() { return this.x + this.y; } }",
        "new Point(3, 4).sum()",
        // The REPL hoists const -> var, so a redeclaration works like in Node's REPL.
        "const x = 2",
        "x",
        ".exit",
      ]);
      expect(outputs).toEqual(["10", "20", "30", "0", "0", "1", "2", "undefined", "8", "[class Point]", "7", "2", "2"]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("destructured declarations persist across evaluations", async () => {
      const { outputs, stderr, exitCode } = await runRepl([
        "const [a, b, c] = [10, 20, 30]",
        "a + b + c",
        "const { px, py } = { px: 5, py: 7 }",
        "px * py",
        "const { a: renamed } = { a: 99 }",
        "renamed",
        "const { missing = 42 } = {}",
        "missing",
        "const [first, ...rest] = [1, 2, 3, 4]",
        "rest",
        "const { keep, ...others } = { keep: 1, x: 2, y: 3 }",
        "Object.keys(others).sort().join(',')",
        "const { outer: { inner } } = { outer: { inner: 'deep' } }",
        "inner",
        ".exit",
      ]);
      expect(outputs).toEqual([
        "[ 10, 20, 30 ]",
        "60",
        "{\n  px: 5,\n  py: 7,\n}",
        "35",
        "{\n  a: 99,\n}",
        "99",
        "{}",
        "42",
        "[ 1, 2, 3, 4 ]",
        "[ 2, 3, 4 ]",
        "{\n  keep: 1,\n  x: 2,\n  y: 3,\n}",
        '"x,y"',
        '{\n  outer: {\n    inner: "deep",\n  },\n}',
        '"deep"',
      ]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  });

  describe("multiline input", () => {
    test("keeps reading lines until the input is complete", async () => {
      const { outputs, stderr, exitCode } = await runRepl([
        "function greet(name) {",
        "  return 'hi ' + name",
        "}",
        "greet('world')",
        "({",
        "  x: 1,",
        "  y: 2",
        "})",
        ".exit",
      ]);
      expect(outputs).toEqual(["undefined", '"hi world"', "{\n  x: 1,\n  y: 2,\n}"]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  });

  describe("async evaluation", () => {
    test("awaits promises at the top level and in async functions", async () => {
      const { outputs, stderr, exitCode } = await runRepl([
        "await Promise.resolve(42)",
        "await Promise.reject(new Error('async fail'))",
        "1 + 1",
        "async function getValue() { return 123; }",
        "await getValue()",
        ".exit",
      ]);
      expect(outputs).toEqual(["42", "error: async fail", "2", "undefined", "123"]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });
  });

  describe("TypeScript support", () => {
    test("strips type annotations and interface declarations", async () => {
      const { outputs, stderr, exitCode } = await runRepl([
        "const x: number = 42",
        "x",
        "interface User { name: string }",
        "const u: User = { name: 'test' }",
        "u.name",
        ".exit",
      ]);
      expect(outputs).toEqual(["42", "42", "undefined", '{\n  name: "test",\n}', '"test"']);
      expect(stderr).toBe("");
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

    test("-e evaluates and exits without a welcome message or the result", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["-e", "1 + 1"]);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("-e console.log output is shown", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["-e", "console.log('hello from eval')"]);
      expect(stdout).toBe("hello from eval\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("--eval works like -e", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["--eval", "console.log(2 + 2)"]);
      expect(stdout).toBe("4\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("-p prints the result and exits", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["-p", "1 + 1"]);
      expect(stdout).toBe("2\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("--print works like -p", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["--print", "2 * 3"]);
      expect(stdout).toBe("6\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("-p prints undefined for void expressions", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["-p", "void 0"]);
      expect(stdout).toBe("undefined\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("-p with empty script prints undefined and exits", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["-p", ""]);
      expect(stdout).toBe("undefined\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("-e supports TypeScript", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["-p", "const x: number = 42; x * 2"]);
      expect(stdout).toBe("84\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("-e supports top-level await", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["-p", "await Promise.resolve(123)"]);
      expect(stdout).toBe("123\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("-p wraps object literals", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["-p", "{ a: 1, b: 2 }"]);
      expect(stdout).toBe("{\n  a: 1,\n  b: 2,\n}\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("-e with thrown error writes to stderr and exits with code 1", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["-e", "throw new Error('boom')"]);
      expect(stdout).toBe("");
      // A source preview precedes the message and its stack frames.
      expect(stderr).toMatch(/^error: boom\n +at /m);
      expect(exitCode).toBe(1);
    });

    test("-e with syntax error writes to stderr and exits with code 1", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["-e", "const ="]);
      expect(stdout).toBe("");
      expect(stderr).toMatch(/^SyntaxError: Unexpected token '='/);
      expect(exitCode).toBe(1);
    });

    test("-e with rejected top-level await writes to stderr and exits with code 1", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["-e", "await Promise.reject(new Error('async fail'))"]);
      expect(stdout).toBe("");
      expect(stderr).toMatch(/^error: async fail\n +at /m);
      expect(exitCode).toBe(1);
    });

    test("-e preserves process.exitCode set by the script", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["-e", "process.exitCode = 42"]);
      expect(stdout).toBe("");
      expect(stderr).toBe("");
      expect(exitCode).toBe(42);
    });

    test("-e fires process.on('beforeExit')", async () => {
      const { stdout, stderr, exitCode } = await runReplWith([
        "-e",
        "process.on('beforeExit', () => console.log('beforeExit fired'))",
      ]);
      expect(stdout).toBe("beforeExit fired\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("-e drains event loop (timers fire before exit)", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["-e", "setTimeout(() => console.log('from timer'), 50)"]);
      expect(stdout).toBe("from timer\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("-p drains event loop before printing", async () => {
      // Result should be printed after the timer output, since we drain
      // the event loop before printing the final result.
      const { stdout, stderr, exitCode } = await runReplWith([
        "-p",
        "setTimeout(() => console.log('timer'), 50); 'result'",
      ]);
      expect(stdout).toBe('timer\n"result"\n');
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("-e supports require()", async () => {
      const { stdout, stderr, exitCode } = await runReplWith(["-p", "require('path').posix.join('/a', 'b')"]);
      expect(stdout).toBe('"/a/b"\n');
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("-e supports import statements", async () => {
      const { stdout, stderr, exitCode } = await runReplWith([
        "-e",
        "import path from 'path'; console.log(typeof path.join)",
      ]);
      expect(stdout).toBe("function\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("-e has access to __dirname and __filename", async () => {
      const { stdout, stderr, exitCode } = await runReplWith([
        "-e",
        "console.log(typeof __dirname, typeof __filename)",
      ]);
      expect(stdout).toBe("string string\n");
      expect(stderr).toBe("");
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

// Interactive terminal-based REPL tests. Each test drives its own pty, so they run concurrently.
describe.todoIf(isWindows).concurrent("Bun REPL (Terminal)", () => {
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
    await withTerminalRepl(async ({ send, proc }) => {
      send("\x04"); // Ctrl+D
      expect(await proc.exited).toBe(0);
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
      // Up arrow redraws the line with the previous command.
      send("\x1b[A");
      await waitFor("111 + 222");
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

  describe("inline suggestions", () => {
    // Ghost text is rendered as: ESC[2m<remainder>ESC[0m after the typed text.
    // The feature requires colors, so override bunEnv's NO_COLOR for these.
    const DIM = "\x1b[2m";
    const colorEnv = { NO_COLOR: undefined, FORCE_COLOR: "1" };

    test("suggests global completion while typing", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          // "cons" should suggest "ole" (-> console). There are longer globals
          // like `constructor` on the prototype chain, but the REPL picks the
          // shortest match.
          send("cons");
          await waitFor(`${DIM}ole`);
        },
        { env: colorEnv },
      );
    });

    test("right arrow accepts the suggestion", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          send("JSO");
          await waitFor(`${DIM}N`);
          send("\x1b[C"); // Right arrow accepts the ghost text
          // After acceptance the input is `JSON`; extend it and evaluate.
          // The result "81" never appears in the echoed input, so this only
          // matches once the expression actually evaluates, proving the ghost
          // was accepted (otherwise `JSO.stringify` is a ReferenceError).
          send(".stringify(9*9)\n");
          await waitFor('"81"');
        },
        { env: colorEnv },
      );
    });

    test("suggests property completion after a dot", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          // Build up `console.` by accepting the global suggestion first.
          send("cons");
          await waitFor(`${DIM}ole`);
          send("\x1b[C"); // accept -> "console"
          send(".l");
          // console.l -> "log" is the shortest property starting with "l"
          await waitFor(`${DIM}og`);
        },
        { env: colorEnv },
      );
    });

    test("tab accepts the visible suggestion", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          send("JSON.str");
          await waitFor(`${DIM}ingify`, 10000);
          send("\t"); // Tab accepts the ghost suggestion -> `JSON.stringify`
          // Result "81" cannot occur in the echoed input, so it only matches
          // if Tab really completed to `stringify` and the call succeeded.
          send("(9*9)\n");
          await waitFor('"81"');
        },
        { env: colorEnv },
      );
    }, 15000);

    test("end key accepts the suggestion", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          send("Mat");
          await waitFor(`${DIM}h`);
          send("\x1b[F"); // End accepts the suggestion -> "Math"
          // Result 63 cannot occur in the echoed input; if End didn't accept,
          // `Mat.max(...)` would throw instead of producing it.
          send(".max(4,7)*9\n");
          await waitFor("63");
        },
        { env: colorEnv },
      );
    });

    test("suggests first property when prefix is empty after dot", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          // Define an object with a single distinctive property so the
          // suggestion is deterministic regardless of prototype ordering.
          send("globalThis.__sgObj = Object.create(null); __sgObj.onlyProp = 1\n");
          await waitFor("1");
          send("__sgObj.");
          await waitFor(`${DIM}onlyProp`);
        },
        { env: colorEnv },
      );
    });

    test("falls back to JS keywords when no global matches", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          // No global starts with "instan", but the keyword `instanceof` does.
          send("x instan");
          await waitFor(`${DIM}ceof`);
        },
        { env: colorEnv },
      );
    });

    test("no global or keyword suggestion for a property of an unresolvable expression", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          send('globalThis.__o = () => ({ th: "no" + "Ghost", this: "had" + "Ghost" }); "o" + "Ready"\n');
          await waitFor("oReady");
          // `.th` names a property of the call result, so the keyword fallback
          // (`this`) must not kick in. Right arrow would accept such a ghost,
          // turning the line into `__o().this`.
          send("__o().th\x1b[C\n");
          await waitFor("noGhost");
        },
        { env: colorEnv },
      );
    });

    test("suggests non-ASCII property names that are valid identifiers", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          // Both keys start with "caf" and have the same byte length, and `caf→`
          // comes first; only `cafés` can follow a `.`, so the ghost must be its
          // remainder.
          send(
            'globalThis.__u = { "caf\\u2192": 1, "caf\\u00e9s": 2 }; globalThis["caf\\u00e9"] = { latte: 1 }; "u" + "Ready"\n',
          );
          await waitFor("uReady");
          send("__u.caf");
          await waitFor(`${DIM}és`);
          // The typed prefix itself may contain non-ASCII characters.
          send("é");
          await waitFor(`${DIM}s`);
          // So may the object being completed: the chain segment is looked up as
          // UTF-8, not byte-per-character.
          send("\x15café.");
          await waitFor(`${DIM}latte`);
        },
        { env: colorEnv },
      );
    });

    test("resolves chain segments inherited from Object.prototype", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          // `constructor` comes from Object.prototype; it must resolve to `Object`
          // like a real property access would, not stop at the object's own keys.
          send('globalThis.__plain = {}; "plain" + "Ready"\n');
          await waitFor("plainReady");
          send("__plain.constructor.getOwnPropertyNa");
          await waitFor(`${DIM}mes`);
        },
        { env: colorEnv },
      );
    });

    test("resolves chains through primitive values", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          // `process.version` is a string and `.length` a number; both get boxed
          // the way a real property access would, ending on Number.prototype.
          send("process.version.length.toF");
          await waitFor(`${DIM}ixed`);
        },
        { env: colorEnv },
      );
    });

    test("spread dots do not turn the word into a property access", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          send("[...cons");
          await waitFor(`${DIM}ole`);
          // Nor do they swallow the chain that follows them.
          send("\x15[...console.l");
          await waitFor(`${DIM}og`);
        },
        { env: colorEnv },
      );
    });

    test("a chain starting with `this` completes against the global object", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          send("this.cons");
          await waitFor(`${DIM}ole`);
        },
        { env: colorEnv },
      );
    });

    test("no suggestions inside a string literal", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          // `st` would otherwise match globals such as `structuredClone`, and the
          // right arrow would accept that ghost, changing the evaluated string.
          send('"st\x1b[C" + "x"\n');
          await waitFor('"stx"');
        },
        { env: colorEnv },
      );
    });

    test("tab inside a string literal indents instead of completing", async () => {
      await withTerminalRepl(async ({ send, waitFor }) => {
        // `JSON.pars` has exactly one completion, which Tab would otherwise splice
        // into the string; indenting adds two spaces, so the length is 9 + 2.
        send('("JSON.pars\t").length\n');
        await waitFor(/\b11\b/);
      });
    });

    test("suggests inside a template hole but not in the template text around it", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          send("`${JSO");
          await waitFor(`${DIM}N`);
          // Back in template text after the `}`: "st" must get no ghost, or the
          // right arrow would accept it. `${JSON}` stringifies to the 13-char
          // "[object JSON]", plus " st", so the length is 16.
          send("N} st\x1b[C`.length === 16\n");
          await waitFor("true");
        },
        { env: colorEnv },
      );
    });

    test("tab on a continuation line of a template literal indents", async () => {
      await withTerminalRepl(async ({ send, waitFor }) => {
        send("globalThis.__tpl = `\n");
        await waitFor("...");
        // The backtick was opened on the previous line. Without that context
        // Tab would complete `JSON.pars` to `parse` inside the template.
        send("JSON.pars\t`\n");
        await waitFor(/\u276f|> /);
        // "\n" + "JSON.pars" + two spaces.
        send("__tpl.length\n");
        await waitFor(/\b12\b/);
      });
    });

    test("tab on a continuation line outside a string still completes", async () => {
      await withTerminalRepl(async ({ send, waitFor }) => {
        send("function __cont() {\n");
        await waitFor("...");
        send("return JSON.pars\t\n");
        send("}\n");
        await waitFor(/\u276f|> /);
        send("__cont() === JSON.parse\n");
        await waitFor("true");
      });
    });

    test("completion on a Proxy with a misbehaving getPrototypeOf trap does not hang", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          // The trap alternates between ending the chain and pointing back at
          // the proxy, so any completer that walks the chain itself never finishes.
          send(
            'globalThis.__flipN = 0; globalThis.__flip = new Proxy({}, { getPrototypeOf: () => (__flipN++ % 2 ? __flip : null) }); "flip" + "Ready"\n',
          );
          await waitFor("flipReady");
          // Typing the `.` computes completions for `__flip`; Ctrl+C then
          // discards the line and the REPL must still evaluate the next one.
          send("__flip.\x03");
          send('"still" + "Alive"\n');
          await waitFor("stillAlive");
        },
        { env: colorEnv },
      );
    });

    test("completion on a large Buffer does not enumerate index properties", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          // Every element of a typed array is an own property name, so a
          // completer that collects index names builds 2^26 identifiers here
          // and blocks the REPL for minutes (issue #40281 used 1 << 30).
          send('globalThis.__big = Buffer.allocUnsafe(1 << 26); "big" + "Ready"\n');
          await waitFor("bigReady");
          // Typing the `.` computes completions for `__big` with an empty
          // prefix; the named properties must still complete afterwards.
          send("__big.byteLen");
          await waitFor(`${DIM}gth`);
          send("\t\n");
          await waitFor("67108864");
        },
        { env: colorEnv },
      );
    });

    test("tab completes properties on an object (no ghost)", async () => {
      // Tab completion resolves `obj.prefix` chains even when ghost text is
      // disabled (NO_COLOR), so this covers parse_completion_context + resolve.
      await withTerminalRepl(async ({ send, waitFor }) => {
        // Store the marker as two halves so it never appears in the echoed
        // input; it only shows up once the completed property is evaluated.
        send("globalThis.__tcObj = { uniqueLongName: 'tcMAR' + 'KER' }; 0\n");
        await waitFor(/\b0\b/);
        send("__tcObj.uni");
        send("\t");
        // After tab, the full property should be in the input; evaluate it.
        send("\n");
        await waitFor("tcMARKER");
      });
    });

    test("suggestion is not evaluated on enter", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          send("globalThis.zzGhostMarker = 1\n");
          await waitFor("1");
          // Type a prefix that triggers a suggestion but don't accept it.
          send("zz");
          await waitFor(`${DIM}GhostMarker`);
          // Hit Enter without accepting: the ghost text must not be part of
          // the evaluated input, so `zz` alone is a ReferenceError.
          send("\n");
          await waitFor(/ReferenceError|not defined/);
        },
        { env: colorEnv },
      );
    });
  });

  describe("input wider than the terminal", () => {
    // Every keystroke redraws the whole input. When the input spans more than
    // one terminal row, the redraw has to start on the prompt's row, otherwise
    // each keystroke leaves another stale copy of the first row behind.
    const cols = 30;
    // "> " plus 37 characters: the first 28 characters share the prompt's row.
    const line = "[111, 222, 333, 444, 555, 666].length";
    const split = cols - "> ".length;

    test("a wrapped line is redrawn in place and its result is printed below it", async () => {
      await withTerminalRepl(
        async ({ send, waitForScreen }) => {
          const top = (await waitForScreen(s => s.rows.at(-1) === "> ")).rows.length - 1;

          send(line);
          let screen = await waitForScreen(s => s.rows.at(-1) === line.slice(split));
          expect(screen.rows.slice(top)).toEqual([`> ${line.slice(0, split)}`, line.slice(split)]);
          await waitForScreen(s => s.cursor.row === top + 1 && s.cursor.col === line.length - split);

          // Ctrl+A, then insert at the start: the cursor is on the prompt's row
          // while the line still continues on the next one.
          send("\x01" + "0;");
          const edited = `0;${line}`;
          screen = await waitForScreen(s => s.rows.at(-1) === edited.slice(split));
          expect(screen.rows.slice(top)).toEqual([`> ${edited.slice(0, split)}`, edited.slice(split)]);
          await waitForScreen(s => s.cursor.row === top && s.cursor.col === "> 0;".length);

          send("\n");
          screen = await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "6");
          expect(screen.rows.slice(top)).toEqual([`> ${edited.slice(0, split)}`, edited.slice(split), "6", "> "]);
        },
        { cols },
      );
    });

    test("Ctrl+C is echoed after the end of a wrapped line", async () => {
      await withTerminalRepl(
        async ({ send, waitForScreen }) => {
          const top = (await waitForScreen(s => s.rows.at(-1) === "> ")).rows.length - 1;

          send(line);
          await waitForScreen(s => s.rows.at(-1) === line.slice(split));
          // Ctrl+A moves the cursor up to the prompt's row, then Ctrl+C.
          send("\x01\x03");
          const screen = await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === `${line.slice(split)}^C`);
          expect(screen.rows.slice(top)).toEqual([`> ${line.slice(0, split)}`, `${line.slice(split)}^C`, "> "]);
        },
        { cols },
      );
    });

    test("recalling a shorter history entry clears the rows of a longer one", async () => {
      await withTerminalRepl(
        async ({ send, waitForScreen }) => {
          const top = (await waitForScreen(s => s.rows.at(-1) === "> ")).rows.length - 1;

          send(`${line}\n`);
          await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "6");
          send("7\n");
          await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "7");

          send("\x1b[A"); // Up: 7
          await waitForScreen(s => s.rows.at(-1) === "> 7");
          send("\x1b[A"); // Up: the wrapped line
          let screen = await waitForScreen(s => s.rows.at(-1) === line.slice(split));
          const history = [`> ${line.slice(0, split)}`, line.slice(split), "6", "> 7", "7"];
          expect(screen.rows.slice(top)).toEqual([...history, `> ${line.slice(0, split)}`, line.slice(split)]);

          send("\x1b[B"); // Down: back to 7, which needs one row less
          screen = await waitForScreen(s => s.rows.at(-1) === "> 7");
          expect(screen.rows.slice(top)).toEqual([...history, "> 7"]);
          await waitForScreen(s => s.cursor.row === screen.rows.length - 1 && s.cursor.col === "> 7".length);
        },
        { cols },
      );
    });

    test("ghost text that does not fit on the row wraps and is erased on enter", async () => {
      // Colors enable ghost text; the prompt is then "❯ ".
      const cols = 40;
      // "❯ " plus 30 characters leaves room for 8 of the 14 ghost characters.
      const input = "[1, 2, 3, 4, 5, 6].length + zz";
      await withTerminalRepl(
        async ({ send, waitForScreen }) => {
          const top = (await waitForScreen(s => s.rows.at(-1) === "❯ ")).rows.length - 1;

          // `zz` itself is skipped as a suggestion for `zz`, so the ghost is
          // the remainder of zzLongSuffixName.
          send("var zz = 1, zzLongSuffixName = 5\n");
          await waitForScreen(s => s.rows.at(-1) === "❯ " && s.rows.at(-2) === "5");
          const setup = ["❯ var zz = 1, zzLongSuffixName = 5", "5"];

          send(input);
          let screen = await waitForScreen(s => s.rows.at(-1) === "ixName");
          expect(screen.rows.slice(top)).toEqual([...setup, `❯ ${input}LongSuff`, "ixName"]);
          // The cursor stays in front of the ghost, on the prompt's row.
          await waitForScreen(s => s.cursor.row === top + setup.length && s.cursor.col === `❯ ${input}`.length);

          send("\n");
          screen = await waitForScreen(s => s.rows.at(-1) === "❯ " && s.rows.at(-2) === "7");
          expect(screen.rows.slice(top)).toEqual([...setup, `❯ ${input}`, "7", "❯ "]);
          const evaluated = [...setup, `❯ ${input}`, "7"];

          // "❯ " plus 38 characters fills the row, so the whole ghost goes to the
          // next row, and the cursor with it.
          const filling = "[1, 2, 3, 4, 5, 6, 7, 888].length + zz";
          send(filling);
          screen = await waitForScreen(s => s.rows.at(-1) === "LongSuffixName");
          expect(screen.rows.slice(top)).toEqual([...evaluated, `❯ ${filling}`, "LongSuffixName"]);
          await waitForScreen(s => s.cursor.row === screen.rows.length - 1 && s.cursor.col === 0);

          // Enter erases the ghost; the result takes the row the ghost was on.
          send("\n");
          screen = await waitForScreen(s => s.rows.at(-1) === "❯ " && s.rows.at(-2) === "9");
          expect(screen.rows.slice(top)).toEqual([...evaluated, `❯ ${filling}`, "9", "❯ "]);
        },
        { cols, env: { NO_COLOR: undefined, FORCE_COLOR: "1" } },
      );
    });

    test("a line that fills the row exactly leaves no blank row behind", async () => {
      // "> " plus 28 characters is exactly 30 columns.
      const filling = `"${Buffer.alloc(19, "a")}".length`;
      await withTerminalRepl(
        async ({ send, waitForScreen }) => {
          const top = (await waitForScreen(s => s.rows.at(-1) === "> ")).rows.length - 1;

          send(filling);
          // The cursor has nowhere to go on the full row, so it waits on an empty one.
          let screen = await waitForScreen(s => s.cursor.row === top + 1 && s.cursor.col === 0);
          expect(screen.rows.slice(top)).toEqual([`> ${filling}`, ""]);

          send("\n");
          screen = await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "19");
          expect(screen.rows.slice(top)).toEqual([`> ${filling}`, "19", "> "]);

          send(filling);
          await waitForScreen(s => s.rows.at(-1) === "" && s.rows.at(-2) === `> ${filling}`);
          send("\x03");
          screen = await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "^C");
          expect(screen.rows.slice(top)).toEqual([`> ${filling}`, "19", `> ${filling}`, "^C", "> "]);
        },
        { cols },
      );
    });

    test("wide characters wrap the way the terminal wraps them", async () => {
      // 21 columns: a 2 column glyph never fits in the last cell of a row that
      // starts on an even column, so those rows hold one column less than the
      // width. `> "` and nine glyphs fill the first row; the second row holds ten
      // glyphs and a blank cell; the rest goes on the third row.
      const cols = 21;
      const glyphs = Array.from({ length: 25 }, () => "日");
      const input = `"${glyphs.join("")}".length`;
      await withTerminalRepl(
        async ({ send, waitForScreen }) => {
          const top = (await waitForScreen(s => s.rows.at(-1) === "> ")).rows.length - 1;

          send(input);
          const third = `${glyphs.slice(19).join("")}".length`;
          let screen = await waitForScreen(s => s.rows.at(-1) === third);
          expect(screen.rows.slice(top)).toEqual([
            `> "${glyphs.slice(0, 9).join("")}`,
            glyphs.slice(9, 19).join(""),
            third,
          ]);
          // Six glyphs and `".length` are 20 columns.
          await waitForScreen(s => s.cursor.row === top + 2 && s.cursor.col === 20);

          send("\n");
          screen = await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "25");
          expect(screen.rows.slice(top + 2)).toEqual([third, "25", "> "]);
        },
        { cols },
      );
    });

    test("the cursor is positioned past column 80 on a wide terminal", async () => {
      const cols = 120;
      const input = Buffer.alloc(90, "q").toString();
      await withTerminalRepl(
        async ({ send, waitFor, waitForScreen }) => {
          const top = (await waitForScreen(s => s.rows.at(-1) === "> ")).rows.length - 1;

          send(input);
          await waitFor(`> ${input}`);
          send("\x1b[D"); // Left
          await waitForScreen(s => s.cursor.row === top && s.cursor.col === `> ${input}`.length - 1);

          send("Z");
          const edited = `${input.slice(0, -1)}Zq`;
          await waitForScreen(s => s.rows.at(-1) === `> ${edited}` && s.cursor.col === `> ${edited}`.length - 1);
        },
        { cols },
      );
    });

    test("a terminal narrowed after startup wraps the input at its new width", async () => {
      // The pty starts out 120 columns wide, on which the line fits on one row.
      await withTerminalRepl(async ({ send, resize, waitForScreen }) => {
        const top = (await waitForScreen(s => s.rows.at(-1) === "> ")).rows.length - 1;
        resize(cols);

        send(line);
        let screen = await waitForScreen(s => s.rows.at(-1) === line.slice(split));
        expect(screen.rows.slice(top)).toEqual([`> ${line.slice(0, split)}`, line.slice(split)]);
        await waitForScreen(s => s.cursor.row === top + 1 && s.cursor.col === line.length - split);

        send("\n");
        screen = await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "6");
        expect(screen.rows.slice(top)).toEqual([`> ${line.slice(0, split)}`, line.slice(split), "6", "> "]);
      });
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

  test(".editor is ignored while a multiline input is pending", async () => {
    await withTerminalRepl(async ({ send, waitFor, allOutput }) => {
      send("function __pending() {\n");
      await waitFor("...");
      send(".editor\n");
      await waitFor("...");
      // `.editor` must not switch modes here: the next line still feeds the
      // pending function body, which then completes and is callable.
      send("return 42 }\n");
      await waitFor(/\u276f|> /);
      send("__pending()\n");
      await waitFor("42");
      expect(allOutput()).not.toMatch(/editor mode/i);
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
});

// History file written on REPL exit must be owner-only (0600), since it can
// contain pasted credentials. See src/runtime/cli/repl.rs History::save.
describe.skipIf(isWindows).concurrent("REPL history file permissions", () => {
  const secret = 'const dbUrl = "postgres://user:hunter2@db.internal/prod"';

  test("persists history readable only by the owner", async () => {
    using dir = tempDir("repl-history-perms", {});
    const home = String(dir);

    const { outputs, stderr, exitCode } = await runRepl([secret, ".exit"], { home });
    expect(outputs).toEqual(['"postgres://user:hunter2@db.internal/prod"']);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    // Legitimate behavior still works: the typed line is persisted to
    // $HOME/.bun_repl_history on exit.
    const historyPath = path.join(home, ".bun_repl_history");
    expect(await Bun.file(historyPath).text()).toBe(`${secret}\n`);

    // The file must not be readable or writable by group/other, while the
    // owner keeps read/write access.
    expect(statSync(historyPath).mode & 0o777).toBe(0o600);
  });

  test("tightens permissions on a pre-existing history file", async () => {
    using dir = tempDir("repl-history-perms-existing", {
      ".bun_repl_history": "1 + 1\n",
    });
    const home = String(dir);
    const historyPath = path.join(home, ".bun_repl_history");
    chmodSync(historyPath, 0o644);

    const { outputs, stderr, exitCode } = await runRepl([secret, ".exit"], { home });
    expect(outputs).toEqual(['"postgres://user:hunter2@db.internal/prod"']);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);

    expect(await Bun.file(historyPath).text()).toBe(`1 + 1\n${secret}\n`);
    expect(statSync(historyPath).mode & 0o777).toBe(0o600);
  });
});

// `bun --interactive` boots the full node:repl + readline + acorn stack; on a
// debug+asan build that is ~4–5s per spawn, so the 5s default is too tight.
const interactiveTimeout = 20_000;

describe.concurrent("--interactive", () => {
  const env = { ...bunEnv, NO_COLOR: "1", NODE_REPL_HISTORY: "" };

  async function runInteractive(extra: string[], stdin: string, opts: { cwd?: string; env?: any } = {}) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--interactive", ...extra],
      env: { ...env, ...opts.env },
      cwd: opts.cwd,
      // Closing stdin (EOF) exits the REPL; `.exit` adds latency on debug builds.
      stdin: Buffer.from(stdin),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  test(
    "prints a Bun-branded banner, not 'Welcome to Node.js', and process._eval is undefined without -e",
    async () => {
      const { stdout, stderr, exitCode } = await runInteractive([], 'console.log("EVAL=" + process._eval)\n');
      expect({ stdout, stderr }).toEqual({
        stdout: expect.stringMatching(/^Welcome to Bun v\d+\.\d+\.\d+.*\(Node\.js-compatible REPL/),
        stderr: expect.not.stringContaining("error"),
      });
      expect(stdout).not.toContain("Welcome to Node.js");
      expect(stdout).toContain("> EVAL=undefined\n");
      expect(exitCode).toBe(0);
    },
    interactiveTimeout,
  );

  // `node -i -e 'code'`: -e runs as its own Script against globalThis, so
  // `var`/`function` declarations are visible from the REPL prompt. Publishing
  // the CJS bindings must not move them off the global: node runs the body in
  // global scope, it does not CJS-wrap it.
  test(
    "-e var/function declarations land on the REPL's global",
    async () => {
      const { stdout, stderr, exitCode } = await runInteractive(
        ["-e", "var fromVar = 1; function f() { return 42 }"],
        "fromVar + f()\ntypeof fromVar + typeof f\n",
      );
      expect(stdout).toContain("> 43\n");
      expect(stdout).toContain("> 'numberfunction'\n");
      expect(stderr).not.toContain("error");
      expect(exitCode).toBe(0);
    },
    interactiveTimeout,
  );

  // `process._eval` carries the raw `-e` bytes, which are UTF-8. Decoding them
  // as Latin-1 turns every multi-byte character into mojibake, so both the
  // evaluated source and the reported `process._eval` must round-trip.
  test(
    "-e round-trips multi-byte UTF-8 through process._eval",
    async () => {
      const source = `console.log("한글-🎉-café")`;
      const { stdout, stderr, exitCode } = await runInteractive(["-e", source], "process._eval\n");
      // The -e script itself ran with its literal intact...
      expect(stdout).toContain("한글-🎉-café\n");
      // ...and process._eval reports the source verbatim, not re-encoded.
      expect(stdout).toContain(`'${source}'\n`);
      expect(stderr).not.toContain("error");
      expect(exitCode).toBe(0);
    },
    interactiveTimeout,
  );

  // `node -i -e '<bad>'`: Node exits 1 with a SyntaxError code frame at
  // [eval]:1 and never accepts REPL input; not caught by the REPL error handler.
  test(
    "-e with a syntax error is fatal and never enters the REPL",
    async () => {
      const { stdout, stderr, exitCode } = await runInteractive(["-e", "console.log(1"], "'stdin-ran'\n");
      expect(stdout).toContain("Welcome to Bun");
      // stdin was never evaluated:
      expect(stdout).not.toContain("stdin-ran");
      // The error is reported against the user's [eval] script, not the bootstrap.
      expect(stdout + stderr).toMatch(/SyntaxError/);
      expect(stdout + stderr).toContain("[eval]");
      expect(stdout + stderr).not.toMatch(/node-repl|createInternalRepl|__BUN_EVAL_SCRIPT__/);
      expect(exitCode).toBe(1);
    },
    interactiveTimeout,
  );

  test(
    "-e with a runtime error is fatal and never enters the REPL",
    async () => {
      const { stdout, stderr, exitCode } = await runInteractive(["-e", 'throw new Error("BOOM")'], "'stdin-ran'\n");
      expect(stdout).not.toContain("stdin-ran");
      expect(stdout + stderr).toContain("BOOM");
      expect(stdout + stderr).toContain("[eval]");
      expect(exitCode).toBe(1);
    },
    interactiveTimeout,
  );

  test.each(["/*", "const x=`foo"])(
    "-e with an unterminated template/comment cannot swallow the bootstrap (%j)",
    async bad => {
      const { stdout, stderr, exitCode } = await runInteractive(["-e", bad], "");
      expect(stdout).toContain("Welcome to Bun");
      expect(stdout + stderr).toMatch(/SyntaxError/);
      expect(exitCode).toBe(1);
    },
    interactiveTimeout,
  );

  // Node silently ignores `-i` when a script positional is present.
  test(
    "with a script positional runs the script and does not enter the REPL",
    async () => {
      using dir = tempDir("interactive-script", { "foo.js": `console.log("script-ran")` });
      const { stdout, stderr, exitCode } = await runInteractive(["foo.js"], "1+1\n", { cwd: String(dir) });
      expect(stdout).toBe("script-ran\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    },
    interactiveTimeout,
  );

  // Documented "for now" deviation: `-p` wins over `--interactive`.
  test(
    "-p wins over --interactive (prints, no REPL)",
    async () => {
      const { stdout, stderr, exitCode } = await runInteractive(["-p", "1+1"], "999\n");
      expect(stdout).toBe("2\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    },
    interactiveTimeout,
  );

  // exec_node_repl boots the bootstrap through the [eval] slot; process._eval
  // must still report the user's -e string (used by child_process.fork's
  // execArgv stripping), not the bootstrap.
  test(
    "process._eval reports the user's -e string, not the bootstrap",
    async () => {
      const eScript = 'console.log("EVAL=" + JSON.stringify(process._eval)); process.exit(0)';
      const { stdout, stderr, exitCode } = await runInteractive(["-e", eScript], "");
      expect(stdout).toContain(`EVAL=${JSON.stringify(eScript)}\n`);
      expect(stdout + stderr).not.toMatch(/__BUN_EVAL_SCRIPT__|createInternalRepl/);
      expect(exitCode).toBe(0);
    },
    interactiveTimeout,
  );

  // The bootstrap runs -e via vm.runInThisContext (raw JS, matching
  // `node -i -e`); TypeScript syntax is a SyntaxError, not transpiled.
  test(
    "-e is raw JavaScript (not transpiled)",
    async () => {
      const { stdout, stderr, exitCode } = await runInteractive(["-e", "const x: number = 1"], "");
      expect(stdout + stderr).toMatch(/SyntaxError/);
      expect(exitCode).toBe(1);
    },
    interactiveTimeout,
  );

  // bun-as-node --interactive routes through exec_as_if_node, which used to
  // print "does not support a repl" and exit 1.
  test(
    "bun-as-node --interactive enters the REPL",
    async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "--interactive"],
        argv0: "node",
        env,
        stdin: Buffer.from("1+1\n"),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toContain("Welcome to Bun");
      expect(stdout).toContain("> 2\n");
      expect(stderr).not.toContain("does not support a repl");
      expect(exitCode).toBe(0);
    },
    interactiveTimeout,
  );

  // node evaluates `-e` after createInternalRepl, via runScriptInContext, which
  // publishes the CJS bindings onto the global before running the body. node's
  // wrapper compiles as `[eval]-wrapper`, so __dirname is "." — NOT the cwd —
  // while module.filename stays the cwd-joined path.
  test(
    "-e sees require/module/__filename/__dirname like `node -i -e`",
    async () => {
      using dir = tempDir("repl-eval-dirname", {});
      const { stdout, exitCode } = await runInteractive(
        [
          "-e",
          [
            "console.log(typeof require, typeof module, typeof __filename, typeof __dirname)",
            "console.log(JSON.stringify({d: __dirname, f: __filename, m: module.filename}))",
            'console.log("plat:" + typeof require("os").platform)',
          ].join(";"),
        ],
        "",
        { cwd: String(dir) },
      );
      expect(stdout).toContain("function object string string\n");
      expect(stdout).toContain(`${JSON.stringify({ d: ".", f: "[eval]", m: path.join(String(dir), "[eval]") })}\n`);
      expect(stdout).toContain("plat:function\n");
      expect(exitCode).toBe(0);
    },
    interactiveTimeout,
  );

  // node's `-i` is an alias for --interactive. Bun's own `-i` is
  // --install=fallback, which has no meaning under node emulation or on an
  // invocation that reaches the REPL (bare `bun -i` boots it with the
  // bunfig/default resolver options); `-i <script>` and `-i -e code` keep
  // the auto-install meaning.
  test(
    "bun-as-node: `node -i` enters the REPL",
    async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-i"],
        argv0: "node",
        env,
        stdin: Buffer.from("1+1\n"),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toContain("Welcome to Bun");
      expect(stdout).toContain("> 2\n");
      expect(stderr).not.toContain("Missing script to execute");
      expect(exitCode).toBe(0);
    },
    interactiveTimeout,
  );

  test.each([
    ["bare bun -i", ["-i"]],
    ["bun run -i --interactive", ["run", "-i", "--interactive"]],
    ["bun -i -e ''", ["-i", "-e", ""]],
  ])(
    "%s reaches the REPL",
    async (_label, extra) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...extra],
        env,
        stdin: Buffer.from("1+1\n"),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toContain("Welcome to Bun");
      expect(stdout).toContain("> 2\n");
      expect({ stderrHasError: stderr.includes("error"), exitCode }).toEqual({ stderrHasError: false, exitCode: 0 });
    },
    interactiveTimeout,
  );

  test.each(["module", "commonjs", "module-typescript", "commonjs-typescript"])(
    "--input-type=%s with a file entry is ignored like node",
    async inputType => {
      using dir = tempDir("input-type-file", { "entry.js": `console.log("ran");` });
      await using proc = Bun.spawn({
        cmd: [bunExe(), `--input-type=${inputType}`, "entry.js"],
        env,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout.trim()).toBe("ran");
      expect(exitCode).toBe(0);
    },
    interactiveTimeout,
  );

  test("--input-type with an invalid value exits 9 with node's message", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--input-type=bogus", "-e", "1"],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // Verbatim node v26.3.0 wording, including the missing space.
    expect(stderr).toContain('--input-type must be "module","commonjs", "module-typescript" or "commonjs-typescript"');
    expect(exitCode).toBe(9);
  });

  test.each([
    ["module", 'import assert from "assert"; assert.ok(1); console.log("ok");'],
    ["commonjs", 'const assert = require("assert"); assert.ok(1); console.log("ok");'],
    ["module-typescript", 'import assert from "assert"; const n: number = 1; assert.ok(n); console.log("ok");'],
    ["commonjs-typescript", 'const assert = require("assert"); const n: number = 1; assert.ok(n); console.log("ok");'],
  ])("--input-type=%s with --eval runs the matching grammar", async (inputType, src) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), `--input-type=${inputType}`, "-e", src],
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("ok");
    expect(exitCode).toBe(0);
  });

  // The "run" subcommand word is a dispatch artifact, not user input: it must
  // not survive into the REPL's process.argv the way a script name would.
  test(
    "bun run --interactive enters the REPL and keeps 'run' out of process.argv",
    async () => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", "--interactive"],
        env,
        // Tagged so the match can't be confused with the REPL's own echo.
        stdin: Buffer.from(`1+1\nconsole.log("ARGV:" + JSON.stringify(process.argv.slice(1)))\n`),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toContain("Welcome to Bun");
      expect(stdout).toContain("> 2\n");
      expect(stdout).toContain("ARGV:[]\n");
      expect(stderr).not.toContain("error");
      expect(exitCode).toBe(0);
    },
    interactiveTimeout,
  );

  test(
    "NODE_REPL_EXTERNAL_MODULE replaces the built-in REPL",
    async () => {
      using dir = tempDir("ext-repl", { "ext.js": `console.log("external-repl-42")` });
      const { stdout, stderr, exitCode } = await runInteractive([], "", {
        cwd: String(dir),
        env: { NODE_REPL_EXTERNAL_MODULE: "./ext.js" },
      });
      expect(stdout).toBe("external-repl-42\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    },
    interactiveTimeout,
  );

  test.each([
    ["process env", { env: { NODE_REPL_EXTERNAL_MODULE: "./ext.js" } }],
    ["--env-file", { args: ["--env-file=ext.env"] }],
  ])(
    "NODE_REPL_EXTERNAL_MODULE via %s wins over the --input-type rejection",
    async (_, { env: extraEnv, args = [] }: { env?: Record<string, string>; args?: string[] }) => {
      using dir = tempDir("ext-repl-input-type", {
        "ext.js": `console.log("external-repl-42")`,
        "ext.env": "NODE_REPL_EXTERNAL_MODULE=./ext.js\n",
      });
      const { stdout, stderr, exitCode } = await runInteractive([...args, "--input-type=module"], "", {
        cwd: String(dir),
        env: extraEnv,
      });
      expect({ stdout, stderr }).toEqual({
        stdout: expect.stringContaining("external-repl-42"),
        stderr: expect.not.stringContaining("Cannot specify --input-type for REPL"),
      });
      expect(exitCode).toBe(0);
    },
    interactiveTimeout,
  );
});

// ts-node does `require("repl")` at import time but only touches
// repl.start/repl.Recoverable inside createRepl(); those (plus the REPL_MODE
// symbols and isValidSyntax) are data properties so the destructure is free,
// and only calling start() or reading REPLServer/writer loads the body.
test.concurrent("require('node:repl') is hollow until start() or REPLServer is used", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const repl = require("node:repl");
        const shape = n => "value" in Object.getOwnPropertyDescriptor(repl, n) ? "data" : "accessor";
        console.log(JSON.stringify({
          keys: Object.keys(repl).sort(),
          desc: {
            start: shape("start"),
            Recoverable: shape("Recoverable"),
            REPL_MODE_SLOPPY: shape("REPL_MODE_SLOPPY"),
            isValidSyntax: shape("isValidSyntax"),
            REPLServer: shape("REPLServer"),
            writer: shape("writer"),
          },
        }));
        // Reading the cheap five must not throw and must not require readline.
        const {start, Recoverable, REPL_MODE_SLOPPY, REPL_MODE_STRICT, isValidSyntax} = repl;
        console.log(JSON.stringify({
          start: typeof start,
          Recoverable: typeof Recoverable,
          REPL_MODE_SLOPPY: typeof REPL_MODE_SLOPPY,
          isValidSyntax: typeof isValidSyntax,
        }));
        console.log("recoverable-is-error=" + (new Recoverable(new SyntaxError("m")) instanceof SyntaxError));
        // Now force the full load and check REPLServer is real.
        console.log("REPLServer=" + typeof repl.REPLServer);
        // Recoverable identity: the one exposed before load is the one the impl uses.
        console.log("same-Recoverable=" + (repl.Recoverable === Recoverable));
        repl.repl = "x";
        console.log("repl.repl=" + repl.repl);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  const lines = stdout.trim().split("\n");
  expect(JSON.parse(lines[0])).toEqual({
    keys: [
      "REPLServer",
      "REPL_MODE_SLOPPY",
      "REPL_MODE_STRICT",
      "Recoverable",
      "isValidSyntax",
      "repl",
      "start",
      "writer",
    ],
    desc: {
      start: "data",
      Recoverable: "data",
      REPL_MODE_SLOPPY: "data",
      isValidSyntax: "data",
      REPLServer: "accessor",
      writer: "accessor",
    },
  });
  expect(JSON.parse(lines[1])).toEqual({
    start: "function",
    Recoverable: "function",
    REPL_MODE_SLOPPY: "symbol",
    isValidSyntax: "function",
  });
  expect(lines.slice(2)).toEqual([
    "recoverable-is-error=true",
    "REPLServer=function",
    "same-Recoverable=true",
    "repl.repl=x",
  ]);
  expect(exitCode).toBe(0);
});

describe.concurrent("node:repl completion", () => {
  const env = { ...bunEnv, NO_COLOR: "1" };

  test.each(['require("node:', 'import("node:'])(
    "%s <Tab> offers real node-scheme specifiers only",
    async prefix => {
      const script = `
      const repl = require("node:repl");
      const { PassThrough } = require("node:stream");
      const inp = new PassThrough(), out = new PassThrough(); out.resume();
      const r = repl.start({ input: inp, output: out, terminal: false, prompt: "" });
      r.complete(${JSON.stringify(prefix)}, (err, result) => {
        if (err) throw err;
        console.log("COMPLETIONS=" + JSON.stringify(result[0]));
        r.close();
      });
    `;
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const m = stdout.match(/COMPLETIONS=(\[.*\])/);
      expect({ matched: m !== null, stderr }).toEqual({ matched: true, stderr: "" });
      const completions = JSON.parse(m![1]);
      expect(completions).toContain("node:test");
      expect(completions).toContain("node:quic");
      expect(completions).toContain("node:fs");
      expect(completions).not.toContain("node:undici");
      expect(completions).not.toContain("node:ws");
      expect(completions).not.toContain("node:bun");
      expect(completions).not.toContain("node:bun:ffi");
      expect(exitCode).toBe(0);
    },
    interactiveTimeout,
  );
});

describe.concurrent("node:repl process-global side effects", () => {
  const env = { ...bunEnv, NO_COLOR: "1" };

  // Known limitation until process.addUncaughtExceptionCaptureCallback is
  // implemented natively: the shim occupies the exclusive capture slot for the
  // process lifetime. It must NOT displace a user callback installed BEFORE the
  // first repl.start().
  test(
    "uncaught-exception capture shim defers to a pre-installed user callback",
    async () => {
      const script = `
      let userGot;
      process.setUncaughtExceptionCaptureCallback(e => { userGot = e.message; });
      const repl = require("node:repl");
      const { PassThrough } = require("node:stream");
      const inp = new PassThrough(), out = new PassThrough(); out.resume();
      const r = repl.start({ input: inp, output: out, terminal: false, prompt: "" });
      r.close();
      setImmediate(() => { throw new Error("boom"); });
      setImmediate(() => setImmediate(() => {
        console.log("userGot=" + userGot);
        // The user callback owns the slot; REPL didn't displace it.
        process.exit(0);
      }));
    `;
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toContain("userGot=boom");
      expect(stderr).not.toContain("ALREADY_SET");
      expect(exitCode).toBe(0);
    },
    interactiveTimeout,
  );

  // Node filters slash-modules in addBuiltinLibsToObject (not
  // getBuiltinLibs), so `fs/promises` etc. never land on the REPL context
  // while repl.builtinModules and require-completion still list them.
  test(
    "addBuiltinLibsToObject does not install slash-modules on the REPL context",
    async () => {
      const script = `
      const repl = require("node:repl");
      const { PassThrough } = require("node:stream");
      const inp = new PassThrough(), out = new PassThrough(); out.resume();
      const r = repl.start({ input: inp, output: out, terminal: false, prompt: "" });
      const slash = Object.getOwnPropertyNames(r.context).filter(n => n.includes("/"));
      const listed = repl.builtinModules.filter(n => n.includes("/"));
      console.log("SLASH=" + JSON.stringify(slash) + " LISTED=" + (listed.includes("fs/promises")));
      r.close();
    `;
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toContain("SLASH=[] LISTED=true");
      expect(stderr).not.toContain("error");
      expect(exitCode).toBe(0);
    },
    interactiveTimeout,
  );

  // decorateErrorStack runs after user code, so a tampered String.prototype.split
  // (or the RegExp symbol methods it falls back on) must not stop the REPL from
  // rendering the next error.
  test.each([
    "String.prototype.split = () => { throw 0 }",
    "RegExp.prototype[Symbol.split] = () => { throw 0 }",
    "RegExp.prototype[Symbol.replace] = () => { throw 0 }",
  ])(
    "error rendering survives a tampered %s",
    async tamper => {
      const script = `
      const repl = require("node:repl");
      const { PassThrough } = require("node:stream");
      const inp = new PassThrough(), out = new PassThrough();
      let buf = ""; out.on("data", d => buf += d);
      const r = repl.start({ input: inp, output: out, terminal: false, prompt: "> " });
      r.on("exit", () => { console.log(buf); process.exit(0); });
      inp.write(${JSON.stringify(tamper + "\n")});
      inp.write("oops\\n");
      inp.write("1+1\\n");
      inp.end();
    `;
      await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stdout).toBe("> [Function (anonymous)]\n> Uncaught ReferenceError: oops is not defined\n> 2\n> \n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    },
    interactiveTimeout,
  );
});

// JSC's Error#stack is an own data property (V8's is an accessor), so a frozen
// error makes _handleError's strict-mode `e.stack = …` rewrites throw; the Bun
// port guards those writes so the REPL prints the error and continues like Node.
describe.concurrent("node:repl prints a frozen thrown error and continues", () => {
  test.each([
    ["Error in sloppy mode", "SLOPPY", "throw Object.freeze(new Error('boom'))", "Uncaught Error: boom"],
    ["SyntaxError", "SLOPPY", "throw Object.freeze(new SyntaxError('boom'))", "Uncaught SyntaxError: boom"],
    ["Error in strict mode", "STRICT", "throw Object.freeze(new Error('boom'))", "Uncaught Error: boom"],
  ])(
    "%s",
    async (_name, mode, line, expectedFirstLine) => {
      const script = `
      const repl = require("repl");
      const { PassThrough } = require("stream");
      const inp = new PassThrough(), out = new PassThrough();
      let buf = "";
      out.on("data", d => buf += d);
      const r = repl.start({
        input: inp,
        output: out,
        terminal: false,
        prompt: "",
        useGlobal: true,
        replMode: repl.REPL_MODE_${mode},
      });
      r.on("exit", () => process.stdout.write(buf));
      inp.write(${JSON.stringify(line + "\n")});
      inp.end();
    `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", script],
        env: { ...bunEnv, NO_COLOR: "1" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      // The frozen .stack can't be trimmed under JSC (eager materialization), so
      // assert only on the first line and that the REPL printed the next prompt.
      expect(stdout.split("\n")[0]).toBe(expectedFirstLine);
      expect(stdout).not.toContain("Attempted to assign to readonly property");
      expect(stderr).not.toContain("Attempted to assign to readonly property");
      expect(exitCode).toBe(0);
    },
    interactiveTimeout,
  );
});

// Tests for Bun REPL
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isGlibc, isLinux, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
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
  /** Lines (each gets a "\n"), the exact text or bytes of stdin, or a file to read stdin from. */
  input: string | string[] | Uint8Array | Blob,
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
    stdin: inputStr instanceof Blob ? inputStr : Buffer.from(inputStr),
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

/** What a non-TTY REPL wrote to stdout after its welcome message. */
function afterWelcome(stdout: string): string {
  const text = stripAnsi(stdout);
  return text.slice(text.indexOf("\n\n") + 2);
}

/**
 * Runs `bun repl` on a stdin pipe that stays open until `fn` returns, for input
 * that depends on what the REPL has answered so far.
 */
async function withPipedRepl(
  fn: (helpers: {
    write: (text: string) => void;
    /** Resolves with all of stdout once `pattern` is in it. */
    waitFor: (pattern: string | RegExp) => Promise<string>;
  }) => Promise<void>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  using home = tempDir("repl-home", {});
  await using proc = Bun.spawn({
    cmd: [bunExe(), "repl"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...bunEnv, TERM: "dumb", NO_COLOR: "1", HOME: String(home), USERPROFILE: String(home) },
  });

  const stderr = proc.stderr.text();
  let received = "";
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  /** False once stdout has ended. */
  const readMore = async () => {
    const { value, done } = await reader.read();
    if (value) received += decoder.decode(value, { stream: true });
    return !done;
  };
  const waitFor = async (pattern: string | RegExp) => {
    while (true) {
      const stdout = stripAnsi(received);
      if (typeof pattern === "string" ? stdout.includes(pattern) : pattern.test(stdout)) return stdout;
      if (!(await readMore())) {
        throw new Error(`stdout ended before ${pattern}\nReceived:\n${stdout}`);
      }
    }
  };

  await fn({
    write: text => {
      proc.stdin.write(text);
      proc.stdin.flush();
    },
    waitFor,
  });
  proc.stdin.end();
  while (await readMore());

  return { stdout: stripAnsi(received), stderr: await stderr, exitCode: await proc.exited };
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
        const seq = /^\x1b\[(\??[\d;]*)([A-Za-z])/.exec(rest);
        if (seq === null) {
          if (/^\x1b(\[\??[\d;]*)?$/.test(rest)) {
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
    // Bracketed paste on or off: a mode of the terminal, nothing is drawn.
    if (params === "?2004" && (command === "h" || command === "l")) return;
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
    /** `allOutput` with its escape sequences. */
    rawOutput: () => string;
    /** The local flags of the terminal (ICANON, ECHO, ISIG ...) as they are now. */
    localFlags: () => number;
    /** `localFlags()` from before the command ran. With `session`, from right after its spawn. */
    localFlagsAtStart: number;
  }) => Promise<void>,
  options: {
    env?: Record<string, string | undefined>;
    cols?: number;
    /** What runs on the pty. Defaults to `bun repl`. */
    cmd?: string[];
    /** Makes the command a session leader with the pty as its controlling terminal, as a shell needs for job control. */
    session?: boolean;
  } = {},
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
  const terminalOptions: Bun.TerminalOptions = {
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
  };
  // Bun.spawn gives the child a controlling terminal only when it creates the pty itself.
  await using ownTerminal = options.session ? null : new Bun.Terminal(terminalOptions);
  // PENDIN is not a setting. The BSD kernels set this bit when a terminal goes back to line mode.
  const withoutPendingInput = (flags: number) => (isLinux ? flags : flags & ~0x20000000);
  // Read before the spawn: a fast child has its terminal in raw mode by the time the spawn returns.
  const ownLocalFlags = ownTerminal?.localFlags;

  await using proc = Bun.spawn({
    cmd: options.cmd ?? [bunExe(), "repl"],
    terminal: ownTerminal ?? terminalOptions,
    env: {
      ...bunEnv,
      TERM: "xterm-256color",
      ...options.env,
      HOME: String(home),
      USERPROFILE: String(home),
    },
  });

  const terminal = ownTerminal ?? proc.terminal!;
  const localFlags = () => withoutPendingInput(terminal.localFlags);
  const localFlagsAtStart = withoutPendingInput(ownLocalFlags ?? terminal.localFlags);
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

  const rawOutput = () => received.join("");
  const allOutput = () => stripAnsi(rawOutput());

  await waitFor(/\u276f|> /); // Wait for prompt

  await fn({
    terminal,
    proc,
    send,
    waitFor,
    waitForScreen,
    resize,
    allOutput,
    rawOutput,
    localFlags,
    localFlagsAtStart,
  });

  // Clean exit. Ctrl+A then Ctrl+K first discards whatever the test left on
  // the line, wherever the cursor is, so `.exit` is not appended to it (which
  // would leave the REPL running until the test times out).
  if (proc.exitCode === null && proc.signalCode === null) {
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

    // Windows path buffers are large enough for this name.
    test.skipIf(isWindows)(".load with a filename longer than PATH_MAX shows ENAMETOOLONG", async () => {
      const long = "./" + Array(21).fill(Buffer.alloc(200, "a").toString()).join("/") + ".js";
      const { outputs, stderr, exitCode } = await runRepl([`.load ${long}`, "1 + 1", ".exit"]);
      expect(outputs).toEqual([expect.stringMatching(/^ENAMETOOLONG: /), "2"]);
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

  // These inputs end without `.exit`: the REPL reads the end of stdin.
  describe("end of input", () => {
    test.each([
      { last: "the only line", input: "1 + 1", outputs: ["2"] },
      {
        last: "the second of two lines",
        input: `console.log("one")\nconsole.log("two")`,
        outputs: ["one\nundefined", "two\nundefined"],
      },
      {
        last: "the brace that closes a block",
        input: `if (true) {\n  console.log("two")\n}`,
        outputs: ["two\nundefined"],
      },
      { last: "a REPL command", input: "1 + 1\n.history", outputs: ["2", "Command History:\n     1  1 + 1"] },
      { last: "spaces", input: "1 + 1\n   ", outputs: ["2", "undefined"] },
    ])("evaluates a last line that has no newline: $last", async ({ input, outputs }) => {
      const result = await runRepl(input);
      expect(result.outputs).toEqual(outputs);
      expect(result.stderr).toBe("");
      expect(result.exitCode).toBe(0);
    });

    // The REPL writes a newline after each line it takes, and one more when the input ends. Nothing follows `.exit`.
    test.each([
      { name: "no input", input: "", transcript: "> \n" },
      { name: "a last line that leaves a call open", input: "foo(", transcript: "> \n\n" },
      { name: "a last line that is .exit", input: "1 + 1\n.exit", transcript: "> \n2\n> \n" },
    ])("writes no result and no error for $name", async ({ input, transcript }) => {
      const { stdout, stderr, exitCode } = await runRepl(input);
      expect({ transcript: afterWelcome(stdout), stderr, exitCode }).toEqual({ transcript, stderr: "", exitCode: 0 });
    });

    // Not on Windows: there the read after `closeSync(0)` does not fail, so the last line runs.
    test.skipIf(isWindows)(
      "evaluates the last line at the end of the input, but not after a read that failed",
      async () => {
        using dir = tempDir("repl-failed-read", {});
        const ran = path.join(String(dir), "ran");
        const failed = path.join(String(dir), "failed");
        const lastLine = `require("fs").writeFileSync(process.env.MARKER, "")`;
        // Both lines are in the REPL's buffer when the first one runs. After it closes fd 0, the next read fails.
        const [cleanEnd, failedRead] = await Promise.all([
          runRepl(`1\n${lastLine}`, { env: { MARKER: ran } }),
          runRepl(`require("fs").closeSync(0)\n${lastLine}`, { env: { MARKER: failed } }),
        ]);
        expect({
          cleanEnd: { ran: existsSync(ran), stderr: cleanEnd.stderr, exitCode: cleanEnd.exitCode },
          failedRead: { ran: existsSync(failed), stderr: failedRead.stderr, exitCode: failedRead.exitCode },
        }).toEqual({
          cleanEnd: { ran: true, stderr: "", exitCode: 0 },
          failedRead: { ran: false, stderr: "", exitCode: 0 },
        });
      },
    );

    test("saves a last line that has no newline to the history file", async () => {
      using home = tempDir("repl-home", {});
      const { outputs, stderr, exitCode } = await runRepl("1 + 1\n2 + 2", { home: String(home) });
      expect(outputs).toEqual(["2", "4"]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
      expect(await Bun.file(path.join(String(home), ".bun_repl_history")).text()).toBe("1 + 1\n2 + 2\n");
    });
  });

  // A pipe or a file holds text. None of its bytes is a key press, so none of
  // them completes, deletes, moves the cursor or recalls history.
  describe("stdin that is not a terminal", () => {
    test("a TAB is text: it does not complete, indent or list completions", async () => {
      const { outputs, stderr, exitCode } = await runRepl([
        '"a\tb"',
        "`a\tb`",
        // `proc` has one completion, `process`: the Tab key puts it in the place of `proc`.
        'var proc\t= 5; typeof proc + "," + typeof process',
        // The Tab key on an empty line reports how many globals there are.
        "if (1) {",
        '\tconsole.log("in")',
        "}",
        ".exit",
      ]);
      expect(outputs).toEqual(['"a\\tb"', '"a\\tb"', '"number,object"', "in\nundefined"]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("a control byte is text, not an editing key", async () => {
      // Every C0 byte but LF and CR, and DEL. On a terminal most of them are
      // keys: Ctrl+A, Backspace, Ctrl+C, Ctrl+D, ESC and so on.
      const bytes = [...Array(32).keys(), 0x7f].filter(byte => byte !== 0x0a && byte !== 0x0d);
      const { outputs, stderr, exitCode } = await runRepl([
        ...bytes.map(byte => `"a${String.fromCharCode(byte)}b".charCodeAt(1)`),
        // An arrow key on a terminal: it recalls the line before.
        '"up\x1b[A".length',
        ".exit",
      ]);
      expect(outputs).toEqual([...bytes.map(String), "5"]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("CR LF and a lone CR each end one line", async () => {
      const { outputs, stderr, exitCode } = await runRepl("`a\r\nb`\r\n1 + 1\r2 + 2\r\n.exit\r\n");
      expect(outputs).toEqual(['"a\\nb"', "2", "4"]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("a CR LF that arrives in two reads is one line end", async () => {
      const { stdout, stderr, exitCode } = await withPipedRepl(async ({ write, waitFor }) => {
        write("1 + 1\r");
        await waitFor("2\n> ");
        write("\n3 + 3\r\n");
        await waitFor("6\n> ");
      });
      // One prompt for each line, and the newline that the end of input writes.
      expect(stdout.slice(stdout.indexOf("\n\n") + 2)).toBe("> \n2\n> \n6\n> \n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("bytes that are not UTF-8 become U+FFFD", async () => {
      const { outputs, stderr, exitCode } = await runRepl(
        Buffer.concat([Buffer.from('"a'), Buffer.from([0xff]), Buffer.from('b".codePointAt(1)\n.exit\n')]),
      );
      expect(outputs).toEqual(["65533"]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test(".editor takes its lines as text and runs them at a 0x04 byte at the start of a line", async () => {
      // 0x04 is what Ctrl+D sends on a terminal.
      const { outputs, stderr, exitCode } = await runRepl(
        '.editor\nvar proc\t= 5\n\ttypeof proc + "," + typeof process\n\x04.exit\n',
      );
      expect(outputs).toEqual([expect.stringMatching(/^\/\/ Entering editor mode.*\n+"number,object"$/)]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test(".editor runs nothing at the end of a pipe or after a 0x03 byte at the start of a line", async () => {
      using dir = tempDir("repl-editor-cut", {});
      const line = `require("fs").writeFileSync(process.env.MARKER, "")`;
      // A writer that is cut off ends a pipe too, so the end of a pipe is not Ctrl+D. 0x03 is what Ctrl+C sends.
      const [cut, cancelled] = await Promise.all([
        runRepl(`.editor\n${line}\n`, { env: { MARKER: path.join(String(dir), "cut") } }),
        runRepl(`.editor\n${line}\n\x031 + 1\n.exit\n`, { env: { MARKER: path.join(String(dir), "cancelled") } }),
      ]);
      expect(cancelled.outputs).toEqual([
        expect.stringMatching(/^\/\/ Entering editor mode.*\n+\/\/ Editor mode cancelled$/),
        "2",
      ]);
      expect(readdirSync(String(dir))).toEqual([]);
      expect([cut.stderr, cut.exitCode, cancelled.stderr, cancelled.exitCode]).toEqual(["", 0, "", 0]);
    });

    test(".editor ends at a 0x04 byte at the start of a line while stdin stays open", async () => {
      const { stdout, stderr, exitCode } = await withPipedRepl(async ({ write, waitFor }) => {
        // 0x04 is what Ctrl+D sends on a terminal. A line of only a TAB or only blanks stays as it is.
        write(".editor\nconst text = `a\n\t\n   \nb`;\n[...text].map(c => c.charCodeAt(0)).join()\n\x04");
        await waitFor('"97,10,9,10,32,32,32,10,98"\n> ');
        // In the middle of a line (here at the normal prompt) it is text.
        write('"a\x04b".charCodeAt(1)\n');
      });
      expect(stdout).toEndWith('"97,10,9,10,32,32,32,10,98"\n> \n4\n> \n');
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("a control byte outside a string is an error, and the lines after it run", async () => {
      // On a terminal `ESC [ A` is the Up key and 0x04 is Ctrl+D. The `[` must not start an entry of several lines.
      const { outputs, stderr, exitCode } = await runRepl(["1 + 1", "\x1b[A", "\x04 + 1", "2 + 2", ".exit"]);
      expect(outputs).toEqual([
        "2",
        "SyntaxError: Invalid character '\\u001b'",
        "SyntaxError: Invalid character '\\u0004'",
        "4",
      ]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("a control byte inside an open bracket does not end the entry", async () => {
      // There it can be in a comment or in a regex literal.
      const { outputs, stderr, exitCode } = await runRepl([
        "[1, // a\x01b",
        '/c\x02d/.test("c\x02d"),',
        "3].join()",
        ".exit",
      ]);
      expect(outputs).toEqual(['"1,true,3"']);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    // The REPL reads 256 bytes at a time. A comment line puts the byte under test on that boundary.
    test("a character that is cut by the end of a read stays whole", async () => {
      using dir = tempDir("repl-read-boundary", {
        "input.js": `//${Buffer.alloc(251, "x").toString()}\n"한".codePointAt(0).toString(16)\n.exit\n`,
      });
      const input = Bun.file(path.join(String(dir), "input.js"));
      expect(new Uint8Array(await input.arrayBuffer()).indexOf(0xed)).toBe(255);
      const { outputs, stderr, exitCode } = await runRepl(input);
      // The comment is an entry of its own.
      expect(outputs).toEqual(["undefined", '"d55c"']);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("a 0x04 byte in the middle of a line does not end .editor, also at the start of a read", async () => {
      using dir = tempDir("repl-read-boundary", {
        "input.js": `.editor\n//${Buffer.alloc(228, "x").toString()}\nglobalThis.r = "a\x04b".charCodeAt(1)\n\x04r + 1\n.exit\n`,
      });
      const input = Bun.file(path.join(String(dir), "input.js"));
      expect(new Uint8Array(await input.arrayBuffer()).indexOf(0x04)).toBe(256);
      const { outputs, stderr, exitCode } = await runRepl(input);
      expect(outputs).toEqual([expect.stringMatching(/^\/\/ Entering editor mode.*\n+4$/), "5"]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("a file name with a NUL byte is refused", async () => {
      // The open takes a C string: it would open the name up to the NUL.
      using dir = tempDir("repl-nul-name", {
        "loaded.js": "globalThis.loadedThroughNul = 1;\n",
        "saved.txt": "keep\n",
      });
      const { outputs, stderr, exitCode } = await runRepl(
        [".load loaded.js\0tail.js", "typeof loadedThroughNul", ".save saved.txt\0tail", ".exit"],
        { cwd: String(dir) },
      );
      expect(outputs).toEqual([
        "The file name must not contain a null byte or a line break: loaded.js\\x00tail.js",
        '"undefined"',
        "The file name must not contain a null byte or a line break: saved.txt\\x00tail",
      ]);
      expect(readdirSync(String(dir)).sort()).toEqual(["loaded.js", "saved.txt"]);
      expect(await Bun.file(path.join(String(dir), "saved.txt")).text()).toBe("keep\n");
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    // Windows does not allow a control byte in a file name.
    test.skipIf(isWindows)(
      "a control byte in the name of a file that .load and .save open is spelled out",
      async () => {
        using dir = tempDir("repl-echo-open", { "lo\x1b[2Jad.js": "globalThis.loadedEsc = 6;\n" });
        const { stdout, outputs, stderr, exitCode } = await runRepl(
          [".load lo\x1b[2Jad.js", "loadedEsc + 1", ".save sa\x1b[2Jve.txt", ".exit"],
          { cwd: String(dir) },
        );
        expect(outputs).toEqual(["Loading lo\\x1b[2Jad.js...\n6", "7", "Session saved to sa\\x1b[2Jve.txt"]);
        expect(stdout).not.toContain("\x1b[2J");
        expect(readdirSync(String(dir)).sort()).toEqual(["lo\x1b[2Jad.js", "sa\x1b[2Jve.txt"]);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
      },
    );

    test("a TAB separates a REPL command from its argument", async () => {
      using dir = tempDir("repl-load-tab", { "loaded.js": "globalThis.loadedByTab = 7;\n" });
      const { outputs, stderr, exitCode } = await runRepl([
        `.load\t${path.join(String(dir), "loaded.js")}`,
        "loadedByTab + 1",
        ".exit",
      ]);
      expect(outputs).toEqual([expect.stringMatching(/^Loading .*loaded\.js\.\.\.\n7$/), "8"]);
      expect(stderr).toBe("");
      expect(exitCode).toBe(0);
    });

    test("a control byte in an echoed name or history entry is spelled out", async () => {
      using dir = tempDir("repl-echo", {});
      // ESC ] 0 sets the title of a terminal, ESC [ 2 J clears it.
      const { stdout, outputs, stderr, exitCode } = await runRepl(
        [
          '"\x1b]0;title\x07".length',
          ".history",
          ".load missing\x1b[2J.js",
          ".save missing\x1b[2J/saved.js",
          ".nope\x1b[2J",
          ".exit",
        ],
        { cwd: String(dir) },
      );
      expect(outputs).toEqual([
        "10",
        'Command History:\n     1  "\\x1b]0;title\\x07".length',
        // Neither file can be opened. On POSIX the error names the file.
        expect.stringMatching(isWindows ? /^E[A-Z]+: / : /^ENOENT: missing\\x1b\[2J\.js: /),
        expect.stringMatching(isWindows ? /^E[A-Z]+: / : /^ENOENT: missing\\x1b\[2J\/saved\.js: /),
        "Unknown command: .nope\\x1b[2J\nType .help for available commands",
      ]);
      expect(stdout).not.toContain("\x1b]0;");
      expect(stdout).not.toContain("\x1b[2J");
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

  // While it shows the prompt, the REPL has bracketed paste on: the terminal
  // then sends a paste between ESC[200~ and ESC[201~, with a CR for each line
  // end. What is between the two markers is text, and none of it a key press.
  describe("bracketed paste", () => {
    const DIM = "\x1b[2m";
    const colorEnv = { NO_COLOR: undefined, FORCE_COLOR: "1" };
    const PASTE_ON = "\x1b[?2004h";
    const PASTE_OFF = "\x1b[?2004l";
    const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;
    /** The last thing the REPL told the terminal about bracketed paste. */
    const lastSwitch = (output: string) => output.match(/\x1b\[\?2004[hl]/g)?.at(-1);

    test("a pasted TAB is text: it does not complete, indent or list completions", async () => {
      await withTerminalRepl(async ({ send, waitFor, allOutput }) => {
        send(paste('"a\tb"') + "\n");
        await waitFor('"a\\tb"');
        send(paste("`a\tb`") + "\n");
        await waitFor('"a\\tb"');
        // `proc` has one completion, `process`: the Tab key puts it in the place of `proc`.
        send(paste('var proc\t= 5; typeof proc + "," + typeof process') + "\n");
        await waitFor('"number,object"');
        // The Tab key on an empty line reports how many globals there are.
        send(paste('if (1) {\r\tconsole.log("pas" + "ted")\r}\r') + "\n");
        await waitFor("pasted");
        expect(allOutput()).not.toContain("completions");
      });
    });

    test("a paste does not accept the ghost suggestion", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          send("var proc");
          await waitFor(`${DIM}ess`);
          // The Tab key accepts the ghost: the line would become `var process= 5`.
          send(paste('\t= 5; typeof proc + "," + typeof process') + "\n");
          await waitFor("number,object");
        },
        { env: colorEnv },
      );
    });

    test("a pasted control byte is text, not an editing key", async () => {
      await withTerminalRepl(async ({ send, waitFor }) => {
        // Every C0 byte but LF and CR (the line ends of a paste), and DEL.
        const bytes = [...Array(32).keys(), 0x7f].filter(byte => byte !== 0x0a && byte !== 0x0d);
        const items = bytes.map(byte => `"a${String.fromCharCode(byte)}b".charCodeAt(1)`);
        send(paste(`[${items.join(", ")}].join("+")`) + "\n");
        await waitFor(`"${bytes.join("+")}"`);
      });
    });

    test("bytes of a paste that are not UTF-8 become U+FFFD", async () => {
      await withTerminalRepl(async ({ terminal, send, waitFor }) => {
        terminal.write(
          Buffer.concat([Buffer.from('\x1b[200~"'), Buffer.from([0xff]), Buffer.from('".codePointAt(0)\x1b[201~')]),
        );
        send("\n");
        await waitFor("65533");
      });
    });

    // Terminals that ask before they paste several lines stop asking once a
    // program has bracketed paste on: they expect it not to run the lines.
    test("a paste of several lines waits for the Enter key and runs as one entry", async () => {
      await withTerminalRepl(async ({ send, waitForScreen }) => {
        const top = (await waitForScreen(s => s.rows.at(-1) === "> ")).rows.length - 1;
        // CR, LF and CR LF each are one line end.
        send(paste("const total = [1, 2, 3]\r\n  .map(x => x * 2)\n  .reduce((a, b) => a + b)\rtotal"));
        // Each later line is drawn after the continuation prompt.
        let screen = await waitForScreen(s => s.rows.at(-1) === "... total" && s.cursor.col === 9);
        expect(screen.rows.slice(top)).toEqual([
          "> const total = [1, 2, 3]",
          "...   .map(x => x * 2)",
          "...   .reduce((a, b) => a + b)",
          "... total",
        ]);
        // What is typed now belongs to the same entry: nothing ran yet.
        send(" + 1\n");
        screen = await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.length > top + 5);
        expect(screen.rows.slice(top + 3)).toEqual(["... total + 1", "13", "> "]);
      });
    });

    test("a pasted line comment keeps its line end when the input is colored", async () => {
      await withTerminalRepl(
        async ({ send, waitForScreen }) => {
          const top = (await waitForScreen(s => s.rows.at(-1) === "\u276f ")).rows.length - 1;
          send(paste("// note\r1 + 1"));
          // The highlighter takes one line at a time: it drops the line break after a `//` comment.
          const screen = await waitForScreen(s => s.rows.at(-1) === "... 1 + 1" && s.cursor.col === 9);
          expect(screen.rows.slice(top)).toEqual(["\u276f // note", "... 1 + 1"]);
          send("\n");
          await waitForScreen(s => s.rows.at(-1) === "\u276f " && s.rows.at(-2) === "2");
        },
        { env: colorEnv },
      );
    });

    test("a paste that ends with a line end keeps it and waits for the Enter key", async () => {
      await withTerminalRepl(async ({ send, waitFor, waitForScreen }) => {
        send(paste('"one" + 1\r'));
        // The cursor is on the next line of the same entry.
        await waitForScreen(s => s.rows.at(-2) === '> "one" + 1' && s.rows.at(-1) === "... " && s.cursor.col === 4);
        send("+ 2\n");
        await waitFor('"one12"');
        // The Enter key on a paste of only a line end is the Enter key on an empty line.
        send(paste("\r"));
        await waitForScreen(s => s.rows.at(-2) === "> " && s.rows.at(-1) === "... ");
        send('\n"st" + "ill"\n');
        await waitFor('"still"');
      });
    });

    test("a second paste starts on the line after the first", async () => {
      await withTerminalRepl(async ({ send, waitForScreen }) => {
        send(paste("var first = 1\r"));
        await waitForScreen(s => s.rows.at(-1) === "... ");
        send(paste("var second = first + 1; second\r"));
        const screen = await waitForScreen(s => s.rows.at(-1) === "... " && s.rows.at(-2) !== "> var first = 1");
        expect(screen.rows.slice(-3)).toEqual(["> var first = 1", "... var second = first + 1; second", "... "]);
        send("\n");
        await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "2");
      });
    });

    test("a paste with more lines than the terminal has rows shows the lines around the cursor", async () => {
      await withTerminalRepl(async ({ send, waitForScreen }) => {
        const top = (await waitForScreen(s => s.rows.at(-1) === "> ")).rows.length - 1;
        // 60 lines on a terminal of 40 rows.
        send(paste(["[0,", ...Array(58).fill("1,"), "0].length"].join("\r")));
        let screen = await waitForScreen(s => s.rows.at(-1) === "... 0].length");
        expect(screen.rows.slice(top)).toEqual([...Array(37).fill("... 1,"), "... 0].length"]);
        // A key redraws these rows in place.
        send(" ");
        screen = await waitForScreen(s => s.rows.at(-1) === "... 0].length ");
        expect(screen.rows.length).toBe(top + 38);
        // The Enter key runs all 60 lines.
        send("\n");
        await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "60");
      });
    });

    test("a REPL command takes a pasted argument of several lines, but not as a file name", async () => {
      await withTerminalRepl(async ({ send, waitFor, rawOutput }) => {
        send(".copy " + paste("[1,\r2].length") + "\n");
        await waitFor("Copied 1 characters to clipboard");
        expect(rawOutput()).toContain(`\x1b]52;c;${btoa("2")}\x07`);
        send(".load " + paste("one.js\rtwo.js") + "\n");
        await waitFor("The file name must not contain a null byte or a line break: one.js\\ntwo.js");
      });
    });

    test("a REPL command in a paste of several lines is not run", async () => {
      await withTerminalRepl(async ({ send, waitFor }) => {
        send(paste('.exit\r"not" + "Run"\r') + "\n");
        await waitFor(/SyntaxError[^]*> /);
        send('"still" + "Here"\n');
        await waitFor('"stillHere"');
      });
    });

    test("a paste at the `...` prompt and in .editor is text too", async () => {
      await withTerminalRepl(async ({ send, waitFor }) => {
        send("globalThis.pastedList = [\n");
        await waitFor("...");
        send(paste('\t"a\tb",\r]') + "\n");
        await waitFor('[ "a\\tb" ]');

        send(".editor\n");
        await waitFor(/editor mode/i);
        // A line of only a TAB or only blanks stays as it is.
        send(paste("var proc\t= 5\rvar text = `a\r\t\r   \rb`;\r[typeof proc, typeof process, text.length].join()"));
        send("\x04"); // Ctrl+D also takes what was pasted and not entered
        await waitFor('"number,object,9"');
      });
    });

    test("a paste is drawn once, not once for each byte", async () => {
      await withTerminalRepl(async ({ send, waitFor }) => {
        const text = `"${Buffer.alloc(40, "x").toString()}"`;
        send(paste(text));
        // ESC [ J starts each redraw of the input.
        const drawn = await waitFor(text);
        expect(drawn.split("\x1b[J").length - 1).toBe(1);
      });
    });

    test("the Tab key still completes what was pasted", async () => {
      await withTerminalRepl(async ({ send, waitFor }) => {
        send(paste("JSON.pars"));
        await waitFor("JSON.pars");
        // `JSON.pars` has one completion. Without it the line is `JSON.pars === JSON.parse`.
        send("\t === JSON.parse\n");
        await waitFor("true");
      });
    });

    test("a paste marker that arrives in pieces is still a marker", async () => {
      await withTerminalRepl(async ({ send, waitFor }) => {
        const [start, end] = ["\x1b[200~", "\x1b[201~"];
        for (let cut = 1; cut < start.length; cut++) {
          // The REPL has read up to the cut once it has drawn what was typed before it.
          send('"a' + start.slice(0, cut));
          await waitFor('"a');
          send(start.slice(cut) + "\tb" + end + '".length\n');
          await waitFor(/\n\s*3\b/);

          send('"a' + start + "\tb" + end.slice(0, cut));
          await waitFor('"a');
          send(end.slice(cut) + '".length\n');
          await waitFor(/\n\s*3\b/);
        }
      });
    });

    test("a paste marker or a pasted TAB at the end of a read is not lost", async () => {
      await withTerminalRepl(async ({ send, waitFor }) => {
        // The REPL reads 256 bytes at a time: the end marker is cut by the end of the first read.
        for (const length of [245, 246, 247, 248, 249]) {
          send(paste(`"${Buffer.alloc(length - 10, "x").toString()}\t".length`) + "\n");
          await waitFor(new RegExp(`\\n\\s*${length - 9}\\b`));
        }
        // A TAB that is the last byte of a read.
        send(paste(`"${Buffer.alloc(248, "x").toString()}\t".length`) + "\n");
        await waitFor(/\n\s*249\b/);
      });
    });

    test("a paste right after the Esc key is still a paste", async () => {
      await withTerminalRepl(async ({ send, waitFor }) => {
        // The ESC of the start marker comes right after the ESC of the key. Also after `ESC O`, which starts some keys.
        send("\x1b" + paste('"a\tb"') + ".length\n");
        await waitFor(/\n\s*3\b/);
        send("\x1bO" + paste('"c\td"') + ".length + 1\n");
        await waitFor(/\n\s*4\b/);
        // Two presses of the Esc key and then text: the first character is not lost.
        send('\x1b\x1b"e" + "sc"\n');
        await waitFor('"esc"');
      });
    });

    test("Ctrl+C ends a paste whose end marker does not come", async () => {
      await withTerminalRepl(async ({ send, waitFor }) => {
        // Everything after the start marker is the paste: no key is a key. A client that goes away in the middle of a paste leaves this.
        send('\x1b[200~"lo" + "st"\r');
        // A 0x03 in the middle of a paste has more bytes behind it at once. This one has none.
        send("\x03");
        await waitFor("again to exit");
        send('"ba" + "ck"\n');
        await waitFor('"back"');
      });
    });

    test("draws a pasted TAB as blanks up to the tab stop and spells out other control bytes", async () => {
      await withTerminalRepl(async ({ send, waitForScreen }) => {
        send(paste('"a\tb\x1bc"'));
        // `> "a` fills 4 columns, so the TAB goes to column 8. The cursor is after the line.
        const drawn = '> "a    b\\x1bc"';
        await waitForScreen(s => s.rows.at(-1) === drawn && s.cursor.col === drawn.length);
        // The line holds the 5 bytes that were pasted, not what is drawn.
        send(".length\n");
        await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "5");
        // Up: the history entry is drawn the same way.
        send("\x1b[A");
        await waitForScreen(s => s.rows.at(-1) === `${drawn}.length` && s.cursor.col === drawn.length + 7);
        // On a later line the tab stops count from after the `... ` prompt.
        send("\x15" + paste("if (1) {\r\tx\r[\t1,\t2]\r}"));
        const screen = await waitForScreen(s => s.rows.at(-1) === "... }" && s.cursor.col === 5);
        expect(screen.rows.slice(-4)).toEqual(["> if (1) {", "...     x", "... [   1,      2]", "... }"]);
      });
    });

    test("the Down key and Ctrl+C on a paste that waits for the Enter key", async () => {
      await withTerminalRepl(async ({ send, waitFor, waitForScreen }) => {
        send('"old"\n');
        await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === '"old"');
        // Down with no newer entry leaves the lines where they are.
        send(paste("[1,\r2,\r3]"));
        await waitForScreen(s => s.rows.at(-1) === "... 3]");
        send("\x1b[B.length\n");
        await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "3");
        // Up saves them, Down brings them back.
        send(paste("[4,\r5]"));
        await waitForScreen(s => s.rows.at(-1) === "... 5]");
        send("\x1b[A");
        await waitForScreen(s => s.rows.at(-1)!.endsWith("3].length"));
        send("\x1b[B");
        const screen = await waitForScreen(s => s.rows.at(-1) === "... 5]");
        expect(screen.rows.slice(-2)).toEqual(["> [4,", "... 5]"]);
        // Ctrl+C at the `...` prompt and in .editor drops what waits on the line with the rest.
        send('\x15[\n"ty" + "ped"\x03"af" + "ter"\n');
        await waitFor('"after"');
        send(".editor\n");
        await waitFor(/editor mode/i);
        send(paste('console.log("pas" + "ted")\r') + "\x03");
        await waitFor("Editor mode cancelled");
        send('\n"en" + "d"\n');
        expect(await waitFor('"end"')).not.toContain("pasted\r\n");
      });
    });

    test("is on while the prompt is shown and off while a line runs", async () => {
      await withTerminalRepl(async ({ send, waitFor, rawOutput }) => {
        expect(lastSwitch(rawOutput())).toBe(PASTE_ON);
        send('"re" + "sult"\n');
        // From the Enter key to the next prompt. `prompt()` and child processes
        // read stdin while a line runs.
        const ran = await waitFor(/"result"[^]*> /);
        expect(ran.match(/\x1b\[\?2004[hl]|"result"/g)).toEqual([PASTE_OFF, '"result"', PASTE_ON]);
      });
    });

    test("is off while a line runs that was entered with a ghost suggestion shown", async () => {
      await withTerminalRepl(
        async ({ send, waitFor }) => {
          send('globalThis.zzGhost = "re" + "sult"; globalThis.zzGhostLonger = "set" + "Up"\n');
          await waitFor(/setUp[^]*\u276f/);
          send("zzGhost");
          await waitFor(`${DIM}Longer`);
          send("\n");
          const ran = await waitFor(/"result"[^]*\u276f/);
          expect(ran.match(/\x1b\[\?2004[hl]|"result"/g)).toEqual([PASTE_OFF, '"result"', PASTE_ON]);
        },
        { env: colorEnv },
      );
    });

    // Left on, the shell would get each paste wrapped in the two markers.
    test.each([
      [".exit", ".exit\n", 0],
      ["Ctrl+D on an empty line", "\x04", 0],
      ["process.exit()", "process.exit(7)\n", 7],
    ])("is switched off when the REPL ends: %s", async (_name, input, exitCode) => {
      await withTerminalRepl(async ({ send, waitFor, proc, rawOutput }) => {
        send('process.on("exit", () => console.log("exit" + "Listener")); "re" + "ady"\n');
        await waitFor(/"ready"[^]*> /);
        send(input);
        // Off before the listeners of the exit run: they can start a child that reads the terminal.
        expect(await waitFor("exitListener")).toMatch(/\x1b\[\?2004l[^]*exitListener/);
        expect(await proc.exited).toBe(exitCode);
        expect(lastSwitch(rawOutput())).toBe(PASTE_OFF);
      });
    });

    test("is switched off when the REPL ends: Ctrl+C twice", async () => {
      await withTerminalRepl(async ({ send, waitFor, proc, rawOutput }) => {
        send("\x03");
        // The hint, then the prompt again.
        await waitFor(/again to exit[^]*\x1b\[\?2004h/);
        send("\x03");
        await waitFor(PASTE_OFF);
        expect(await proc.exited).toBe(0);
        expect(lastSwitch(rawOutput())).toBe(PASTE_OFF);
      });
    });

    test("is switched off when code that completion runs ends the process", async () => {
      await withTerminalRepl(async ({ send, waitFor, proc, rawOutput }) => {
        send('globalThis.quits = { get now() { process.exit(3) } }; "re" + "ady"\n');
        await waitFor(/"ready"[^]*> /);
        // Tab reads `quits.now` to list its properties, while the prompt is shown.
        send("quits.now.\t");
        await waitFor(PASTE_OFF);
        expect(await proc.exited).toBe(3);
        expect(lastSwitch(rawOutput())).toBe(PASTE_OFF);
      });
    });

    // A line with `await` leaves SIGINT with its default action, so SIGINT is not in the second row.
    test.each([
      ["SIGTERM", "at the first prompt"],
      ["SIGINT", "at the first prompt"],
      ["SIGTERM", "after an awaited line"],
    ] as const)("is switched off when %s ends the REPL %s", async (signal, state) => {
      await withTerminalRepl(async ({ send, waitFor, proc, rawOutput, localFlags, localFlagsAtStart }) => {
        if (state === "after an awaited line") {
          send("await 1\n");
          await waitFor(/\n1\r\n[^]*\x1b\[\?2004h/);
        }
        proc.kill(signal);
        await waitFor(PASTE_OFF);
        await proc.exited;
        expect({
          signalCode: proc.signalCode,
          lastSwitch: lastSwitch(rawOutput()),
          localFlags: localFlags(),
        }).toEqual({ signalCode: signal, lastSwitch: PASTE_OFF, localFlags: localFlagsAtStart });
      });
    });

    // The fixture needs job control in a shell script: dash and bash 5 have it, the `sh` of macOS (bash 3.2) does not.
    test.skipIf(!isGlibc)(
      "a stopped REPL in the background of a `stty tostop` terminal is reset and ends on SIGTERM",
      async () => {
        // A job-control shell runs the REPL as its foreground job (`exec` keeps the pid that was printed).
        // When the job is stopped, the shell has the terminal again and the job is in the background.
        // There a write to a `tostop` terminal stops the process with SIGTTOU, unless it blocks SIGTTOU.
        // In a build with a second thread, that thread can take the SIGTERM. The main thread then reads the
        // terminal again and the kernel stops the job with SIGTTIN (128 + 21): the shell continues it.
        const shell = `
        set -m
        sh -c 'echo "pid=$$"; exec "$0" repl' "$1"
        stopped=$?
        stty tostop
        kill -TERM %1
        kill -CONT %1
        status=$stopped
        while [ "$status" -eq "$stopped" ] || [ "$status" -eq 149 ]; do
          if [ "$status" -eq 149 ]; then kill -CONT %1; fi
          wait %1
          status=$?
        done
        echo "status=$status"
      `;
        await withTerminalRepl(
          async ({ waitFor, allOutput, proc }) => {
            const pid = Number(/pid=(\d+)/.exec(allOutput())![1]);
            try {
              process.kill(pid, "SIGSTOP");
              // 128 + SIGTERM: the job ended. The reset was written before that.
              expect(await waitFor(/status=\d+/)).toMatch(/\x1b\[\?2004l[^]*status=143\b/);
              expect(await proc.exited).toBe(0);
            } finally {
              try {
                process.kill(pid, "SIGKILL");
              } catch {}
            }
          },
          { cmd: ["sh", "-c", shell, "sh", bunExe()], session: true },
        );
      },
    );
  });

  test("a terminal that refuses raw mode is read as lines of text", async () => {
    // The REPL is in a background process group that has lost its parent shell:
    // there the terminal refuses tcsetattr() and reads. The REPL starts when the
    // session leader opens the gate, which it does after that parent is gone. The
    // leader then waits for the REPL through a FIFO and reports its exit code.
    using dir = tempDir("repl-orphan", {});
    const leader = `
      set -m
      mkfifo "$FIFO" "$GATE"
      sh -c '( read go <"$GATE"; "$@" repl <&3 3<&-; echo "exit=$?" >"$FIFO" ) &' sh "$1" 3<&0 &
      wait $!
      echo go >"$GATE"
      cat "$FIFO"
    `;
    await withTerminalRepl(
      async ({ waitForScreen, rawOutput, proc }) => {
        // All of the output can arrive at once, so wait on the screen and not on new output.
        await waitForScreen(s => s.rows.includes("exit=0"));
        const output = rawOutput();
        // The plain prompt, the newline for the end of input, and nothing that is drawn.
        expect(output.slice(output.indexOf("\r\n\r\n") + 4)).toBe("> \r\nexit=0\r\n");
        expect(await proc.exited).toBe(0);
      },
      {
        cmd: ["sh", "-c", leader, "sh", bunExe()],
        session: true,
        env: { FIFO: path.join(String(dir), "done"), GATE: path.join(String(dir), "gate") },
      },
    );
  });

  test("stdin that is a pipe is read as text also when stdout is a terminal", async () => {
    await withTerminalRepl(
      async ({ waitForScreen, rawOutput, proc }) => {
        // All of the output can arrive at once, so wait on the screen and not on new output.
        await waitForScreen(s => s.rows.includes("4"));
        expect(await proc.exited).toBe(0);
        // Nothing is drawn and no terminal mode is changed.
        expect(rawOutput()).not.toContain("\x1b[?2004h");
        expect(rawOutput()).not.toContain("\x1b[J");
      },
      // \177 is DEL: on a terminal that byte is the Backspace key.
      { cmd: ["sh", "-c", `printf '"ab\\177c".length\\n.exit\\n' | "$0" repl`, bunExe()] },
    );
  });

  test("a terminal that edits its own lines keeps doing so after an awaited line", async () => {
    // stdin is the terminal and stdout is a FIFO that `cat` copies to the terminal, so the REPL leaves
    // the terminal as it is: the terminal echoes what is typed and sends whole lines.
    using dir = tempDir("repl-line-mode", {});
    const shell = `
      mkfifo "$FIFO"
      cat "$FIFO" &
      "$0" repl > "$FIFO"
      status=$?
      wait
      exit $status
    `;
    await withTerminalRepl(
      async ({ send, waitFor, proc }) => {
        send("await 1\n");
        await waitFor(/\n1\r?\n> /);
        send('"co" + "oked"\n');
        // The echo of the terminal comes before the answer.
        expect(await waitFor('"cooked"')).toContain('"co" + "oked"');
        send(".exit\n");
        expect(await proc.exited).toBe(0);
      },
      { cmd: ["sh", "-c", shell, bunExe()], env: { FIFO: path.join(String(dir), "out") } },
    );
  });

  // stdin is the terminal and stdout is a pipe, so the REPL leaves the terminal as it is.
  const lineModeShell = `{ "$0" repl; echo "exit=$?"; } | cat`;

  // In line mode Ctrl+D hands over what is typed so far. At the start of a line that is no bytes: the end of input.
  test.each([
    ["a last line that has no line end", '"half" + "Line"\x04\x04', '"halfLine"'],
    ["the lines of .editor", '.editor\n"ed" + "itor"\n\x04', '"editor"'],
  ])("the end of input on a terminal in line mode runs %s", async (_name, typed, result) => {
    await withTerminalRepl(
      async ({ send, waitForScreen, proc }) => {
        send(typed);
        const { rows } = await waitForScreen(s => s.rows.includes("exit=0"));
        const at = rows.indexOf(result);
        expect(rows.slice(at, at + 3)).toEqual([result, "> ", "exit=0"]);
        expect(await proc.exited).toBe(0);
      },
      { cmd: ["sh", "-c", lineModeShell, bunExe()] },
    );
  });

  test("a read of no bytes from a terminal that is not in line mode runs nothing", async () => {
    // After `stty -icanon min 0 time 0` a read returns at once, with no bytes when none wait: a read timeout,
    // not the end of input. The shell prompts too. What is typed after `go` waits in the terminal for the REPL.
    const shell = `
      printf 'go> '
      read go
      stty -icanon min 0 time 0
      ${lineModeShell}
    `;
    await withTerminalRepl(
      async ({ send, waitForScreen, rawOutput, proc }) => {
        send('go\n"half" + "Line"');
        await waitForScreen(s => s.rows.includes("exit=0"));
        const output = rawOutput();
        // The REPL reads the half line, then no bytes, and ends: the half line did not run.
        expect(output.slice(output.indexOf("\r\n\r\n") + 4)).toBe("> \r\nexit=0\r\n");
        expect(await proc.exited).toBe(0);
      },
      { cmd: ["sh", "-c", shell, bunExe()] },
    );
  });

  test("an escape sequence that is not a key leaves no text on the line", async () => {
    await withTerminalRepl(async ({ send, waitForScreen }) => {
      // F5, Shift+F5, the end marker of a paste that never began, a cursor position report,
      // a device attributes report, a key with three numbers, Shift+Delete of rxvt, and a
      // private sequence that ends like the Left key.
      send('"a\x1b[15~b\x1b[15;2~c\x1b[201~d\x1b[12;40Re\x1b[?62;4cf\x1b[27;5;13~g\x1b[3$h\x1b[?Di"');
      await waitForScreen(s => s.rows.at(-1) === '> "abcdefghi"');
    });
  });

  test("text typed after `ESC [` is not taken for a key sequence", async () => {
    await withTerminalRepl(async ({ send, waitFor, waitForScreen }) => {
      // The blank cannot be part of a key sequence: it and what follows is typed text.
      send("\x1b[10 + 20 + 30");
      await waitForScreen(s => s.rows.at(-1) === ">  + 20 + 30");
      send("\n");
      await waitFor(/\n\s*50\b/);
      // No key sequence is this long: 64 digits are dropped, the rest is typed text.
      send("\x1b[" + Buffer.alloc(70, "1").toString());
      await waitForScreen(s => s.rows.at(-1) === "> 111111");
    });
  });

  test("the keys that send a CSI sequence edit the line", async () => {
    await withTerminalRepl(async ({ send, waitFor }) => {
      // Each row: type `ab cd ef`, press the keys, type `X`. The line is then quoted and upper-cased, so that
      // the answer is not in the echo.
      const rows: [keys: string, answer: string][] = [
        ["\x1b[H", "XAB CD EF"], // Home
        ["\x1b[1~", "XAB CD EF"], // Home
        ["\x01\x1b[F", "AB CD EFX"], // End
        ["\x01\x1b[4~", "AB CD EFX"], // End
        ["\x01\x1b[3~", "XB CD EF"], // Delete
        ["\x1b[D\x1b[D", "AB CD XEF"], // Left
        ["\x01\x1b[C", "AXB CD EF"], // Right
        ["\x1b[1;5D", "AB CD XEF"], // Ctrl+Left
        ["\x1b[1;3D", "AB CD XEF"], // Alt+Left
        ["\x01\x1b[1;5C", "AB XCD EF"], // Ctrl+Right
        ["\x01\x1b[1;3C", "AB XCD EF"], // Alt+Right
        ["\x01\x1b[;5C", "AB XCD EF"], // Ctrl+Right without the first number
        ["\x01\x1b[2~", "XAB CD EF"], // Insert does nothing
        ["\x1b[1;2D", "AB CD EFX"], // Shift+Left is not a key
        ["\x01\x1b[3;5~", "XAB CD EF"], // Ctrl+Delete is not a key
      ];
      for (const [keys, answer] of rows) {
        // Ctrl+A, a quote, Ctrl+E, the rest.
        send(`ab cd ef${keys}X\x01"\x05".toUpperCase()\n`);
        expect(await waitFor(/"[^"]*"\r\n/)).toContain(`"${answer}"\r\n`);
      }
    });
  });

  describe("multi-line history entries", () => {
    // An input typed over several lines is one history entry. When it is
    // recalled, each line is drawn on a row of its own, the later ones after
    // the continuation prompt, and every keystroke redraws all of them from the
    // row of the first prompt.
    type Repl = Parameters<Parameters<typeof withTerminalRepl>[0]>[0];

    /** Types `lines` as one input, waits for `result`, and returns the index of the row its prompt is on. */
    async function enter({ send, waitForScreen }: Repl, lines: string[], result: string, prompt = "> ") {
      let { rows } = await waitForScreen(s => s.rows.at(-1) === prompt);
      const top = rows.length - 1;
      for (const line of lines.slice(0, -1)) {
        send(`${line}\n`);
        const drawn = rows.length;
        ({ rows } = await waitForScreen(s => s.rows.length > drawn && s.rows.at(-1) === "... "));
      }
      send(`${lines.at(-1)}\n`);
      await waitForScreen(s => s.rows.at(-1) === prompt && s.rows.at(-2) === result);
      return top;
    }

    test("a key on a recalled entry does not add rows", async () => {
      await withTerminalRepl(async repl => {
        const { send, waitForScreen } = repl;
        await enter(repl, ["[1,", "2,", "3]"], "[ 1, 2, 3 ]");

        send("\x1b[A"); // Up
        let screen = await waitForScreen(s => s.rows.at(-1)!.endsWith("3]"));
        const height = screen.rows.length;
        let last = "3]";
        for (const key of ["x", "y", "z"]) {
          last += key;
          send(key);
          screen = await waitForScreen(s => s.rows.at(-1)!.endsWith(last));
          expect(screen.rows.length).toBe(height);
          await waitForScreen(s => s.cursor.row === height - 1 && s.cursor.col === s.rows.at(-1)!.length);
        }
      });
    });

    test("a recalled entry is drawn once and edited in place", async () => {
      await withTerminalRepl(async repl => {
        const { send, waitForScreen } = repl;
        const top = await enter(repl, ["[1,", "2,", "3]"], "[ 1, 2, 3 ]");
        const typed = ["> [1,", "... 2,", "... 3]", "[ 1, 2, 3 ]"];

        send("\x1b[A"); // Up
        let screen = await waitForScreen(s => s.rows.at(-1) === "... 3]");
        expect(screen.rows.slice(top)).toEqual([...typed, "> [1,", "... 2,", "... 3]"]);
        await waitForScreen(s => s.cursor.row === top + 6 && s.cursor.col === "... 3]".length);

        send("xyz");
        screen = await waitForScreen(s => s.rows.at(-1) === "... 3]xyz");
        expect(screen.rows.slice(top)).toEqual([...typed, "> [1,", "... 2,", "... 3]xyz"]);
        await waitForScreen(s => s.cursor.row === top + 6 && s.cursor.col === "... 3]xyz".length);

        send("\x7f\x7f\x7f"); // Backspace, three times
        screen = await waitForScreen(s => s.rows.at(-1) === "... 3]" && s.cursor.col === "... 3]".length);
        expect(screen.rows.slice(top)).toEqual([...typed, "> [1,", "... 2,", "... 3]"]);

        // Left over `]`, `3` and the line break: the cursor is at the end of the second line.
        send("\x1b[D\x1b[D\x1b[D");
        await waitForScreen(s => s.cursor.row === top + 5 && s.cursor.col === "... 2,".length);
        send(" 2.5,");
        screen = await waitForScreen(s => s.rows.at(-2) === "... 2, 2.5,");
        expect(screen.rows.slice(top)).toEqual([...typed, "> [1,", "... 2, 2.5,", "... 3]"]);
        await waitForScreen(s => s.cursor.row === top + 5 && s.cursor.col === "... 2, 2.5,".length);

        // The result goes below the last line, not below the cursor.
        send("\n");
        screen = await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "[ 1, 2, 2.5, 3 ]");
        expect(screen.rows.slice(top)).toEqual([...typed, "> [1,", "... 2, 2.5,", "... 3]", "[ 1, 2, 2.5, 3 ]", "> "]);
      });
    });

    test("each Backspace on the entry of issue #27560 redraws it once", async () => {
      // With colors, as in the issue: the prompt is then "❯ ".
      await withTerminalRepl(
        async repl => {
          const { send, waitForScreen } = repl;
          const draw = (text: string) => text.split("\n").map((line, index) => (index === 0 ? "❯ " : "... ") + line);
          let text = "if (1) {\n1\n2\n3\n}";
          const top = await enter(repl, text.split("\n"), "undefined", "❯ ");
          const typed = [...draw(text), "undefined"];

          send("\x1b[A");
          let screen = await waitForScreen(s => s.rows.at(-1) === "... }");
          expect(screen.rows.slice(top)).toEqual([...typed, ...draw(text)]);

          for (let deleted = 1; deleted <= 7; deleted++) {
            text = text.slice(0, -1);
            const drawn = draw(text);
            send("\x7f");
            screen = await waitForScreen(
              s => s.rows.length === top + typed.length + drawn.length && s.rows.at(-1) === drawn.at(-1),
            );
            expect(screen.rows.slice(top)).toEqual([...typed, ...drawn]);
          }
          // `if (1) {` and an empty second line are left.
          await waitForScreen(s => s.cursor.row === top + typed.length + 1 && s.cursor.col === "... ".length);
        },
        { env: { NO_COLOR: undefined, FORCE_COLOR: "1" } },
      );
    });

    test("Enter and Ctrl+C go below the last line from a cursor on the first", async () => {
      await withTerminalRepl(async repl => {
        const { send, waitForScreen } = repl;
        const top = await enter(repl, ["[1,", "2,", "3]"], "[ 1, 2, 3 ]");
        const entry = ["> [1,", "... 2,", "... 3]"];

        send("\x1b[A");
        await waitForScreen(s => s.rows.at(-1) === "... 3]");
        send("\x01"); // Ctrl+A: the start of the first line
        await waitForScreen(s => s.cursor.row === top + 4 && s.cursor.col === "> ".length);
        send("\n");
        let screen = await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.length === top + 9);
        expect(screen.rows.slice(top + 4)).toEqual([...entry, "[ 1, 2, 3 ]", "> "]);

        send("\x1b[A");
        await waitForScreen(s => s.rows.at(-1) === "... 3]");
        send("\x01");
        await waitForScreen(s => s.cursor.row === top + 8 && s.cursor.col === "> ".length);
        send("\x03");
        screen = await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "... 3]^C");
        expect(screen.rows.slice(top + 8)).toEqual(["> [1,", "... 2,", "... 3]^C", "> "]);
      });
    });

    test("recalling another entry clears every row of a multi-line one", async () => {
      await withTerminalRepl(async repl => {
        const { send, waitForScreen } = repl;
        send("7\n");
        await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "7");
        const top = await enter(repl, ["[1,", "2,", "3]"], "[ 1, 2, 3 ]");
        const typed = ["> [1,", "... 2,", "... 3]", "[ 1, 2, 3 ]"];

        send("\x1b[A"); // Up: the three lines
        let screen = await waitForScreen(s => s.rows.at(-1) === "... 3]");
        expect(screen.rows.slice(top)).toEqual([...typed, "> [1,", "... 2,", "... 3]"]);

        send("\x1b[A"); // Up: 7
        screen = await waitForScreen(s => s.rows.at(-1) === "> 7");
        expect(screen.rows.slice(top)).toEqual([...typed, "> 7"]);

        send("\x1b[B"); // Down: the three lines again
        screen = await waitForScreen(s => s.rows.at(-1) === "... 3]");
        expect(screen.rows.slice(top)).toEqual([...typed, "> [1,", "... 2,", "... 3]"]);

        send("\x1b[B"); // Down: the empty line
        screen = await waitForScreen(s => s.rows.at(-1) === "> ");
        expect(screen.rows.slice(top)).toEqual([...typed, "> "]);
        await waitForScreen(s => s.cursor.row === top + 4 && s.cursor.col === "> ".length);
      });
    });

    test("an entry recalled at the continuation prompt starts after that prompt", async () => {
      await withTerminalRepl(async repl => {
        const { send, waitForScreen } = repl;
        const top = await enter(repl, ["[1,", "2,", "3]"], "[ 1, 2, 3 ]");

        send("[0,\n");
        await waitForScreen(s => s.rows.at(-1) === "... " && s.rows.at(-2) === "> [0,");
        send("\x1b[A");
        let screen = await waitForScreen(s => s.rows.at(-1) === "... 3]");
        expect(screen.rows.slice(top + 4)).toEqual(["> [0,", "... [1,", "... 2,", "... 3]"]);
        await waitForScreen(s => s.cursor.row === top + 7 && s.cursor.col === "... 3]".length);

        send("]");
        screen = await waitForScreen(s => s.rows.at(-1) === "... 3]]");
        expect(screen.rows.slice(top + 4)).toEqual(["> [0,", "... [1,", "... 2,", "... 3]]"]);

        send("\n");
        screen = await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "[ 0, [ 1, 2, 3 ] ]");
        expect(screen.rows.slice(top + 4)).toEqual([
          "> [0,",
          "... [1,",
          "... 2,",
          "... 3]]",
          "[ 0, [ 1, 2, 3 ] ]",
          "> ",
        ]);
      });
    });

    test("lines of a recalled entry can be emptied and deleted", async () => {
      await withTerminalRepl(async repl => {
        const { send, waitForScreen } = repl;
        // The second line is empty.
        const top = await enter(repl, ["[1,", "", "2]"], "[ 1, 2 ]");
        const typed = ["> [1,", "... ", "... 2]", "[ 1, 2 ]"];

        send("\x1b[A");
        let screen = await waitForScreen(s => s.rows.at(-1) === "... 2]");
        expect(screen.rows.slice(top)).toEqual([...typed, "> [1,", "... ", "... 2]"]);

        // Backspace over `]` and `2`: the input now ends with a line break.
        send("\x7f\x7f");
        screen = await waitForScreen(s => s.rows.length === top + 7 && s.rows.at(-1) === "... ");
        expect(screen.rows.slice(top)).toEqual([...typed, "> [1,", "... ", "... "]);
        await waitForScreen(s => s.cursor.row === top + 6 && s.cursor.col === "... ".length);

        // The input is incomplete, so Enter asks for its next line on a new row.
        send("\n");
        await waitForScreen(s => s.rows.length === top + 8 && s.rows.at(-1) === "... ");
        send("5]\n");
        screen = await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "[ 1, 5 ]");
        const second = ["> [1,", "... ", "... ", "... 5]", "[ 1, 5 ]"];
        expect(screen.rows.slice(top)).toEqual([...typed, ...second, "> "]);

        // Up recalls those four lines. Ctrl+K after `[1,` deletes the other three.
        send("\x1b[A");
        screen = await waitForScreen(s => s.rows.at(-1) === "... 5]");
        expect(screen.rows.slice(top)).toEqual([...typed, ...second, "> [1,", "... ", "... ", "... 5]"]);
        send("\x01\x1b[C\x1b[C\x1b[C\x0b");
        screen = await waitForScreen(s => s.rows.at(-1) === "> [1," && s.cursor.col === "> [1,".length);
        expect(screen.rows.slice(top)).toEqual([...typed, ...second, "> [1,"]);

        send("\n");
        await waitForScreen(s => s.rows.at(-1) === "... " && s.rows.at(-2) === "> [1,");
        send("6]\n");
        screen = await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "[ 1, 6 ]");
        expect(screen.rows.slice(top)).toEqual([...typed, ...second, "> [1,", "... 6]", "[ 1, 6 ]", "> "]);
      });
    });

    test("a line of the entry that is wider than the terminal wraps", async () => {
      const cols = 30;
      // "... " plus 34 characters: the first 26 share the continuation prompt's row.
      const second = "333, 444, 555, 666, 777, 888, 999,";
      const split = cols - "... ".length;
      await withTerminalRepl(
        async repl => {
          const { send, waitForScreen } = repl;
          const top = await enter(repl, ["[111, 222,", second, "0].length"], "10");
          const drawn = ["> [111, 222,", `... ${second.slice(0, split)}`, second.slice(split), "... 0].length"];

          send("\x1b[A");
          let screen = await waitForScreen(s => s.rows.at(-1) === "... 0].length");
          expect(screen.rows.slice(top)).toEqual([...drawn, "10", ...drawn]);
          await waitForScreen(s => s.cursor.row === top + 8 && s.cursor.col === "... 0].length".length);

          // Ctrl+B (left) to the end of the wrapped line, then insert there.
          send(Buffer.alloc("\n0].length".length, "\x02").toString());
          await waitForScreen(s => s.cursor.row === top + 7 && s.cursor.col === second.length - split);
          send(" 1,");
          const edited = `${second} 1,`;
          screen = await waitForScreen(s => s.rows.at(-2) === edited.slice(split));
          expect(screen.rows.slice(top + 5)).toEqual([
            "> [111, 222,",
            `... ${edited.slice(0, split)}`,
            edited.slice(split),
            "... 0].length",
          ]);
          await waitForScreen(s => s.cursor.row === top + 7 && s.cursor.col === edited.length - split);

          // Ctrl+A, then insert on the first row while the cursor was three rows below it.
          send("\x01" + "0, ");
          screen = await waitForScreen(s => s.rows.at(-4) === "> 0, [111, 222,");
          expect(screen.rows.slice(top + 5)).toEqual([
            "> 0, [111, 222,",
            `... ${edited.slice(0, split)}`,
            edited.slice(split),
            "... 0].length",
          ]);
          await waitForScreen(s => s.cursor.row === top + 5 && s.cursor.col === "> 0, ".length);

          send("\n");
          screen = await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "11");
          expect(screen.rows.slice(top + 8)).toEqual(["... 0].length", "11", "> "]);
        },
        { cols },
      );
    });

    test("a line that fills the row exactly is followed by the next line", async () => {
      const cols = 30;
      // "> " plus 28 characters is exactly 30 columns.
      const first = `["${Buffer.alloc(24, "a")}",`;
      await withTerminalRepl(
        async repl => {
          const { send, waitForScreen } = repl;
          const top = await enter(repl, [first, "2].length"], "2");
          const typed = [`> ${first}`, "... 2].length", "2"];

          send("\x1b[A");
          let screen = await waitForScreen(s => s.rows.at(-1) === "... 2].length");
          expect(screen.rows.slice(top)).toEqual([...typed, `> ${first}`, "... 2].length"]);
          await waitForScreen(s => s.cursor.row === top + 4 && s.cursor.col === "... 2].length".length);

          // Ctrl+B to the end of the full row. No cell is free after it, so the
          // cursor is shown at the start of the next row.
          send(Buffer.alloc("\n2].length".length, "\x02").toString());
          await waitForScreen(s => s.cursor.row === top + 4 && s.cursor.col === 0);
          // What is typed there wraps onto a row of its own.
          send("0,");
          screen = await waitForScreen(s => s.rows.at(-2) === "0,");
          expect(screen.rows.slice(top)).toEqual([...typed, `> ${first}`, "0,", "... 2].length"]);
          await waitForScreen(s => s.cursor.row === top + 4 && s.cursor.col === "0,".length);

          send("\n");
          screen = await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "3");
          const second = [`> ${first}`, "0,", "... 2].length", "3"];
          expect(screen.rows.slice(top)).toEqual([...typed, ...second, "> "]);

          // Recall it, delete all of it, and type one line that wraps: it is
          // drawn like an input that never held a line break.
          const line = "[111, 222, 333, 444, 555, 666].length";
          const wrapAt = cols - "> ".length;
          send("\x1b[A");
          await waitForScreen(s => s.rows.at(-1) === "... 2].length" && s.rows.length === top + 10);
          send("\x01\x0b" + line);
          screen = await waitForScreen(s => s.rows.at(-1) === line.slice(wrapAt));
          expect(screen.rows.slice(top)).toEqual([
            ...typed,
            ...second,
            `> ${line.slice(0, wrapAt)}`,
            line.slice(wrapAt),
          ]);
          await waitForScreen(s => s.cursor.row === top + 8 && s.cursor.col === line.length - wrapAt);

          send("\n");
          screen = await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "6");
          expect(screen.rows.slice(top + 7)).toEqual([`> ${line.slice(0, wrapAt)}`, line.slice(wrapAt), "6", "> "]);
        },
        { cols },
      );
    });

    test("each line is highlighted on its own row", async () => {
      // Colors enable syntax highlighting and ghost text; the prompt is then "❯ ".
      await withTerminalRepl(
        async repl => {
          const { send, waitFor, waitForScreen } = repl;
          send("var zzTail = 2\n");
          await waitForScreen(s => s.rows.at(-1) === "❯ " && s.rows.at(-2) === "2");
          const top = await enter(repl, ["[1, // one", "2]"], "[ 1, 2 ]", "❯ ");
          const typed = ["❯ [1, // one", "... 2]", "[ 1, 2 ]"];

          send("\x1b[A");
          let screen = await waitForScreen(s => s.rows.at(-1) === "... 2]");
          expect(screen.rows.slice(top)).toEqual([...typed, "❯ [1, // one", "... 2]"]);
          // The comment's style ends before the line break, which is CR LF (the
          // pty puts a CR of its own in front of the LF). The continuation prompt
          // follows with a style of its own.
          await waitFor(/\/\/ one(?:\x1b\[[\d;]*m)+\r\r\n(?:\x1b\[[\d;]*m)+\.\.\. (?:\x1b\[[\d;]*m)+/);

          // The ghost text follows the last line.
          send(" + zzT");
          screen = await waitForScreen(s => s.rows.at(-1) === "... 2] + zzTail");
          expect(screen.rows.slice(top)).toEqual([...typed, "❯ [1, // one", "... 2] + zzTail"]);
          await waitForScreen(s => s.cursor.row === top + 4 && s.cursor.col === "... 2] + zzT".length);

          // Right accepts it.
          send("\x1b[C\n");
          screen = await waitForScreen(s => s.rows.at(-1) === "❯ " && s.rows.at(-2) === '"1,22"');
          expect(screen.rows.slice(top)).toEqual([...typed, "❯ [1, // one", "... 2] + zzTail", '"1,22"', "❯ "]);
        },
        { env: { NO_COLOR: undefined, FORCE_COLOR: "1" } },
      );
    });
  });

  test("a recalled entry with more lines than the terminal has rows shows the lines around the cursor", async () => {
    await withTerminalRepl(async ({ send, waitForScreen }) => {
      // 50 lines on a terminal of 40 rows: a redraw cannot go back to a row that scrolled off the top.
      send(["[0,", ...Array(48).fill("1,"), "0].length"].join("\n") + "\n");
      const top = (await waitForScreen(s => s.rows.at(-1) === "> " && s.rows.at(-2) === "50")).rows.length - 1;
      // Up: the cursor is at the end, so the last 38 lines are drawn.
      send("\x1b[A");
      let screen = await waitForScreen(s => s.rows.at(-1) === "... 0].length");
      expect(screen.rows.slice(top)).toEqual([...Array(37).fill("... 1,"), "... 0].length"]);
      // A key redraws the same rows.
      send("x");
      screen = await waitForScreen(s => s.rows.at(-1) === "... 0].lengthx");
      expect(screen.rows.slice(top)).toEqual([...Array(37).fill("... 1,"), "... 0].lengthx"]);
      // Ctrl+A goes to the first line: now the first 38 lines are drawn.
      send("\x01");
      screen = await waitForScreen(s => s.rows.at(top) === "> [0," && s.cursor.row === top && s.cursor.col === 2);
      expect(screen.rows.slice(top)).toEqual(["> [0,", ...Array(37).fill("... 1,")]);
    });
  });

  // On a terminal only a key ends a line. A terminal that goes away is not the end of a line.
  test("a terminal that goes away does not evaluate the line that is being typed", async () => {
    using dir = tempDir("repl-hang-up", {});
    const marker = path.join(String(dir), "ran");
    const line = `require("fs").writeFileSync(process.env.MARKER, "")`;
    await withTerminalRepl(
      async ({ terminal, proc, send, waitForScreen }) => {
        send(line);
        await waitForScreen(s => s.rows.at(-1) === `> ${line}`);
        // The shell ignores SIGHUP, so the REPL lives to read the end of its input.
        terminal.close();
        expect(await proc.exited).toBe(0);
        expect(existsSync(marker)).toBe(false);
      },
      { cmd: ["sh", "-c", `trap "" HUP; exec "$0" repl`, bunExe()], env: { MARKER: marker } },
    );
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

// Not in the block above: alone, a debug build loads `bun:internal-for-testing` well inside the default timeout.
test.todoIf(isWindows)(
  "bracketed paste is switched off when the process crashes in code that completion runs",
  async () => {
    await withTerminalRepl(
      async ({ send, waitFor, proc, localFlags, localFlagsAtStart }) => {
        send(
          'globalThis.crashes = { get now() { require("bun:internal-for-testing").crash_handler.panic() } }; "re" + "ady"\n',
        );
        await waitFor(/"ready"[^]*> /);
        send("crashes.now.\t");
        // The crash handler restores the terminal before it prints its report.
        await waitFor(/\x1b\[\?2004l[^]*panic/);
        await proc.exited;
        expect(localFlags()).toBe(localFlagsAtStart);
      },
      {
        // Debug builds then do not start a symbolizer, and the crash is not reported.
        cmd: [bunExe(), "repl", "--debug-crash-handler-use-trace-string"],
        env: { BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" },
      },
    );
  },
);

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

test("skips the history file when $HOME is longer than PATH_MAX", async () => {
  const home = "/" + Array(21).fill(Buffer.alloc(200, "a").toString()).join("/");
  const { outputs, stderr, exitCode } = await runRepl(["1 + 1", ".exit"], { home });
  expect(outputs).toEqual(["2"]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
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
  // --install=fallback, which has no meaning under node emulation, so the node
  // meaning wins there; everywhere else `-i` stays --install=fallback.
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

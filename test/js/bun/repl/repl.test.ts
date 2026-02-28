// Tests for Bun REPL
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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

// Helper to run REPL in a PTY and interact with it
async function withTerminalRepl(
  fn: (helpers: {
    terminal: Bun.Terminal;
    proc: Bun.ChildProcess;
    send: (text: string) => void;
    waitFor: (pattern: string | RegExp, timeoutMs?: number) => Promise<string>;
    allOutput: () => string;
  }) => Promise<void>,
) {
  const received: string[] = [];
  let cursor = 0;
  let resolveWaiter: (() => void) | null = null;

  await using terminal = new Bun.Terminal({
    cols: 120,
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

  await waitFor(/\u276f|> /); // Wait for prompt

  await fn({ terminal, proc, send, waitFor, allOutput });

  // Clean exit
  send(".exit\n");
  await Promise.race([proc.exited, Bun.sleep(2000)]);
  if (!proc.killed) proc.kill();
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
});

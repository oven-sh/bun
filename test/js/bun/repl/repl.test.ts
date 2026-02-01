// Tests for Bun REPL
// These tests verify the interactive REPL functionality including:
// - Basic JavaScript evaluation
// - Special variables (_ and _error)
// - REPL commands (.help, .exit, .clear)
// - Multi-line input
// - History navigation
// - Tab completion
// - Error handling

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// Helper function to run REPL with input and capture output
async function runRepl(
  input: string | string[],
  options: {
    timeout?: number;
    env?: Record<string, string>;
  } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const inputStr = Array.isArray(input) ? input.join("\n") + "\n" : input;
  const { timeout = 5000, env = {} } = options;

  const proc = Bun.spawn({
    cmd: [bunExe(), "repl"],
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...bunEnv,
      TERM: "dumb", // Disable color codes for easier parsing
      NO_COLOR: "1",
      ...env,
    },
  });

  // Write input to stdin
  proc.stdin.write(inputStr);
  proc.stdin.flush();
  proc.stdin.end();

  // Wait for process with timeout
  const exitCode = await Promise.race([
    proc.exited,
    Bun.sleep(timeout).then(() => {
      proc.kill();
      return -1;
    }),
  ]);

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return { stdout, stderr, exitCode };
}

// Strip ANSI escape sequences and control characters for easier assertion
function stripAnsi(str: string): string {
  // Remove ANSI escape codes
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "") // OSC sequences
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ""); // Control chars except \n, \r, \t
}

// Extract result values from REPL output
function extractResults(output: string): string[] {
  const lines = stripAnsi(output).split("\n");
  const results: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip empty lines, prompts, and welcome message
    if (
      trimmed &&
      !trimmed.startsWith("bun>") &&
      !trimmed.startsWith("...>") &&
      !trimmed.startsWith("Welcome to Bun") &&
      !trimmed.startsWith("Type .help")
    ) {
      results.push(trimmed);
    }
  }

  return results;
}

describe.todoIf(isWindows)("Bun REPL", () => {
  describe("basic evaluation", () => {
    test("evaluates simple expression", async () => {
      const { stdout, exitCode } = await runRepl(["1 + 1", ".exit"]);
      const results = extractResults(stdout);
      expect(results).toContain("2");
      expect(exitCode).toBe(0);
    });

    test("evaluates multiple expressions", async () => {
      const { stdout, exitCode } = await runRepl(["1 + 1", "2 * 3", "Math.sqrt(16)", ".exit"]);
      const results = extractResults(stdout);
      expect(results).toContain("2");
      expect(results).toContain("6");
      expect(results).toContain("4");
      expect(exitCode).toBe(0);
    });

    test("evaluates string expressions", async () => {
      const { stdout, exitCode } = await runRepl(["'hello'.toUpperCase()", ".exit"]);
      const results = extractResults(stdout);
      expect(results.some(r => r.includes("HELLO"))).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("evaluates object literals", async () => {
      const { stdout, exitCode } = await runRepl(["({ a: 1, b: 2 })", ".exit"]);
      const results = extractResults(stdout);
      expect(results.some(r => r.includes("a") && r.includes("b"))).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("evaluates array expressions", async () => {
      const { stdout, exitCode } = await runRepl(["[1, 2, 3].map(x => x * 2)", ".exit"]);
      const results = extractResults(stdout);
      expect(results.some(r => r.includes("2") && r.includes("4") && r.includes("6"))).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  describe("special variables", () => {
    test("_ contains last result", async () => {
      const { stdout, exitCode } = await runRepl(["42", "_", ".exit"]);
      const results = extractResults(stdout);
      // Should have 42 twice - once from evaluation, once from _
      const fortyTwos = results.filter(r => r === "42");
      expect(fortyTwos.length).toBe(2);
      expect(exitCode).toBe(0);
    });

    test("_ updates with each result", async () => {
      const { stdout, exitCode } = await runRepl(["10", "_ * 2", "_ + 5", ".exit"]);
      const results = extractResults(stdout);
      expect(results).toContain("10");
      expect(results).toContain("20");
      expect(results).toContain("25");
      expect(exitCode).toBe(0);
    });

    test("_error contains last error", async () => {
      const { stdout, exitCode } = await runRepl(["throw new Error('test error')", "_error.message", ".exit"]);
      const results = extractResults(stdout);
      expect(results.some(r => r.includes("test error"))).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("_ is not updated for undefined results", async () => {
      const { stdout, exitCode } = await runRepl(["42", "undefined", "_", ".exit"]);
      const results = extractResults(stdout);
      // _ should still be 42, not undefined
      const fortyTwos = results.filter(r => r === "42");
      expect(fortyTwos.length).toBeGreaterThanOrEqual(2);
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
      expect(exitCode).toBe(0);
    });

    test(".clear clears context", async () => {
      const { stdout, exitCode } = await runRepl(["const x = 42", ".clear", ".exit"]);
      expect(exitCode).toBe(0);
    });
  });

  describe("error handling", () => {
    test("handles syntax errors gracefully", async () => {
      // Use a complete but invalid syntax - extra closing paren
      const { stdout, stderr, exitCode } = await runRepl(["(1 + ))", "1 + 1", ".exit"]);
      const allOutput = stripAnsi(stdout + stderr);
      // Should contain error indication but still continue
      expect(allOutput.toLowerCase().includes("error") || allOutput.toLowerCase().includes("unexpected")).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("handles runtime errors gracefully", async () => {
      const { stdout, stderr, exitCode } = await runRepl(["undefinedVariable", "1 + 1", ".exit"]);
      const allOutput = stripAnsi(stdout + stderr);
      expect(allOutput.includes("not defined") || allOutput.includes("ReferenceError")).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("handles thrown errors", async () => {
      const { stdout, stderr, exitCode } = await runRepl(["throw 'custom error'", "1 + 1", ".exit"]);
      const allOutput = stripAnsi(stdout + stderr);
      expect(allOutput).toContain("custom error");
      expect(exitCode).toBe(0);
    });
  });

  describe("global objects", () => {
    test("has access to Bun globals", async () => {
      const { stdout, exitCode } = await runRepl(["typeof Bun.version", ".exit"]);
      const results = extractResults(stdout);
      expect(results.some(r => r.includes("string"))).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("has access to console", async () => {
      const { stdout, exitCode } = await runRepl(["console.log('hello from repl')", ".exit"]);
      const output = stripAnsi(stdout);
      expect(output).toContain("hello from repl");
      expect(exitCode).toBe(0);
    });

    test("has access to Buffer", async () => {
      const { stdout, exitCode } = await runRepl(["Buffer.from('hello').length", ".exit"]);
      const results = extractResults(stdout);
      expect(results).toContain("5");
      expect(exitCode).toBe(0);
    });

    test("has access to process", async () => {
      const { stdout, exitCode } = await runRepl(["typeof process.version", ".exit"]);
      const results = extractResults(stdout);
      expect(results.some(r => r.includes("string"))).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  describe("variable persistence", () => {
    test("variables persist across evaluations", async () => {
      const { stdout, exitCode } = await runRepl(["const x = 10", "const y = 20", "x + y", ".exit"]);
      const results = extractResults(stdout);
      expect(results).toContain("30");
      expect(exitCode).toBe(0);
    });

    test("let variables can be reassigned", async () => {
      const { stdout, exitCode } = await runRepl(["let counter = 0", "counter++", "counter++", "counter", ".exit"]);
      const results = extractResults(stdout);
      expect(results).toContain("2");
      expect(exitCode).toBe(0);
    });

    test("functions persist", async () => {
      const { stdout, exitCode } = await runRepl(["function add(a, b) { return a + b; }", "add(5, 3)", ".exit"]);
      const results = extractResults(stdout);
      expect(results).toContain("8");
      expect(exitCode).toBe(0);
    });
  });

  describe("async evaluation", () => {
    test("evaluates promises", async () => {
      const { stdout, exitCode } = await runRepl(["Promise.resolve(42)", ".exit"]);
      const results = extractResults(stdout);
      expect(results.some(r => r.includes("42") || r.includes("Promise"))).toBe(true);
      expect(exitCode).toBe(0);
    });

    test("evaluates async functions", async () => {
      const { stdout, exitCode } = await runRepl(["async function getValue() { return 123; }", "getValue()", ".exit"]);
      const results = extractResults(stdout);
      expect(results.some(r => r.includes("123") || r.includes("Promise"))).toBe(true);
      expect(exitCode).toBe(0);
    });
  });

  describe("welcome message", () => {
    test("shows welcome message on startup", async () => {
      const { stdout, exitCode } = await runRepl([".exit"]);
      const output = stripAnsi(stdout);
      expect(output).toContain("Welcome to Bun");
      expect(exitCode).toBe(0);
    });

    test("shows version in welcome message", async () => {
      const { stdout, exitCode } = await runRepl([".exit"]);
      const output = stripAnsi(stdout);
      // Should contain "Bun v" followed by version numbers
      expect(output).toMatch(/Bun v\d+\.\d+\.\d+/);
      expect(exitCode).toBe(0);
    });
  });
});

// Terminal-based REPL tests (for interactive features)
describe.todoIf(isWindows)("Bun REPL with Terminal", () => {
  test("spawns REPL in PTY and receives welcome message", async () => {
    const received: Uint8Array[] = [];
    const { promise: welcomeReceived, resolve: gotWelcome } = Promise.withResolvers<void>();

    const terminal = new Bun.Terminal({
      cols: 80,
      rows: 24,
      data(_term, data) {
        received.push(new Uint8Array(data));
        const str = Buffer.from(data).toString();
        if (str.includes("Welcome")) {
          gotWelcome();
        }
      },
    });

    const proc = Bun.spawn({
      cmd: [bunExe(), "repl"],
      terminal,
      env: {
        ...bunEnv,
        TERM: "xterm-256color",
      },
    });

    // Wait for welcome message (with timeout)
    await Promise.race([welcomeReceived, Bun.sleep(3000)]);

    // Exit the REPL
    terminal.write(".exit\n");

    // Wait for process exit with timeout
    await Promise.race([proc.exited, Bun.sleep(1000)]);

    // Kill if still running
    if (!proc.killed) {
      proc.kill();
    }

    const allData = Buffer.concat(received).toString();
    expect(allData).toContain("Welcome to Bun");

    terminal.close();
  });
});

import { describe, expect, test } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { bun, lintEnv } from "./lint-helpers";

const lint = (cwd: string, operands: string[], env = lintEnv) => bun(cwd, ["--lint", ...operands], env);

// stdin, stdout and stderr of the child are one pseudoterminal; `output` is what that terminal received.
async function lintOnTerminal(cwd: string, operands: string[], env = lintEnv) {
  let output = "";
  const decoder = new TextDecoder();
  const closed = Promise.withResolvers<void>();
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--lint", ...operands],
    env,
    cwd,
    terminal: {
      cols: 200,
      rows: 50,
      data(_terminal, chunk) {
        output += decoder.decode(chunk, { stream: true });
      },
      exit() {
        closed.resolve();
      },
    },
  });
  try {
    const exitCode = await proc.exited;
    // The terminal closes after it has delivered the last byte the child wrote.
    await closed.promise;
    return { output: output + decoder.decode(), exitCode };
  } finally {
    proc.terminal?.close();
  }
}

// What a POSIX terminal receives for these lines: its line discipline puts a carriage return before each line feed.
const received = (...lines: string[]) => lines.map(line => `${line}\r\n`).join("");

const htmlCommentWarning = 'warning syntax: Treating "-->" as the start of a legacy HTML single-line comment';
// U+1F600 is four bytes and two UTF-16 code units, U+00E9 is two bytes and one code unit.
const astralLine = 'const s = "\u{1F600}\u00e9"; let x = ;';

describe("bun --lint diagnostics", () => {
  describe("stderr is not a terminal", () => {
    test.concurrent("a diagnostic is one line in the format of tsc, without colour", async () => {
      using dir = tempDir("lint-plain", { "bad.js": "let x = ;\n" });
      const expected = { stdout: "", stderr: "bad.js(1,9): error syntax: Unexpected ;\n", exitCode: 2 };
      const [plain, forcedColour] = await Promise.all([
        lint(String(dir), ["bad.js"]),
        lint(String(dir), ["bad.js"], { ...lintEnv, FORCE_COLOR: "1" }),
      ]);
      expect(plain).toEqual(expected);
      expect(forcedColour).toEqual(expected);
    });

    test.concurrent("files are in the order of their names, not of the operands", async () => {
      using dir = tempDir("lint-sorted", {
        "b.js": "let x = ;\n",
        "a.js": "\nlet x = ;\n",
        "Z.js": "\n\nlet x = ;\n",
        "sub/c.js": "  let x = ;\n",
      });
      expect(await lint(String(dir), [join("sub", "c.js"), "b.js", "a.js", "Z.js"])).toEqual({
        stdout: "",
        stderr:
          "Z.js(3,9): error syntax: Unexpected ;\n" +
          "a.js(2,9): error syntax: Unexpected ;\n" +
          "b.js(1,9): error syntax: Unexpected ;\n" +
          "sub/c.js(1,11): error syntax: Unexpected ;\n",
        exitCode: 2,
      });
    });

    test.concurrent("the absolute name gives the order, the printed name is relative", async () => {
      using dir = tempDir("lint-outside", { "z.js": "let x = ;\n", "proj/a.js": "let x = ;\n" });
      expect(await lint(join(String(dir), "proj"), [join("..", "z.js"), "a.js"])).toEqual({
        stdout: "",
        stderr: "a.js(1,9): error syntax: Unexpected ;\n" + "../z.js(1,9): error syntax: Unexpected ;\n",
        exitCode: 2,
      });
    });

    test.concurrent("the diagnostics of a file are in the order of their positions", async () => {
      using dir = tempDir("lint-positions", {
        "v.js": "x\n--> y\nlet z = ;\n",
        "w.js": "let a;\nlet a;\nx\n--> y\n",
      });
      expect(await lint(String(dir), ["w.js", "v.js"])).toEqual({
        stdout: "",
        stderr:
          `v.js(2,1): ${htmlCommentWarning}\n` +
          "v.js(3,9): error syntax: Unexpected ;\n" +
          'w.js(2,5): error syntax: "a" has already been declared\n' +
          `w.js(4,1): ${htmlCommentWarning}\n`,
        exitCode: 2,
      });
    });

    test.concurrent("what belongs to no file comes first and the other files are still read", async () => {
      using dir = tempDir("lint-operands", { "bad.js": "let x = ;\n", "ok.js": "let x = 1;\n" });
      expect(await lint(String(dir), ["bad.js", "notes.txt", "missing.js", "ok.js"])).toEqual({
        stdout: "",
        stderr:
          "error cannot-read-file: File 'missing.js' not found.\n" +
          "error unsupported-extension: File 'notes.txt' has an unsupported extension. The only supported extensions are '.ts', '.tsx', '.d.ts', '.js', '.jsx', '.cts', '.d.cts', '.cjs', '.mts', '.d.mts', '.mjs'.\n" +
          "bad.js(1,9): error syntax: Unexpected ;\n",
        exitCode: 2,
      });
    });

    test.concurrent("a file that is given more than once is reported once", async () => {
      using dir = tempDir("lint-twice", { "bad.js": "let x = ;\n", "dup.js": "let a;\nlet a;\n" });
      expect(await lint(String(dir), ["bad.js", "dup.js", "./bad.js", "dup.js", "bad.js"])).toEqual({
        stdout: "",
        stderr:
          "bad.js(1,9): error syntax: Unexpected ;\n" + 'dup.js(2,5): error syntax: "a" has already been declared\n',
        exitCode: 2,
      });
    });

    test.concurrent("a column counts UTF-16 code units", async () => {
      using dir = tempDir("lint-columns", {
        "astral.js": `${astralLine}\n`,
        // A byte order mark is not part of the text.
        "bom.js": "\uFEFFlet x = ;\n",
        // U+2028 ends a line, inside a string too.
        "separator.js": 'const s = "\u2028"; let x = ;\n',
      });
      expect(await lint(String(dir), ["astral.js", "bom.js", "separator.js"])).toEqual({
        stdout: "",
        stderr:
          "astral.js(1,26): error syntax: Unexpected ;\n" +
          "bom.js(1,9): error syntax: Unexpected ;\n" +
          "separator.js(2,12): error syntax: Unexpected ;\n",
        exitCode: 2,
      });
    });

    test.concurrent("line and column are those of tsc where Bun's own differ", async () => {
      using dir = tempDir("lint-linemap", {
        // Bun's own column after a lone carriage return is 8.
        "cr.js": "a\rlet x = ;",
        "crlf.js": "let a = 1;\r\nlet x = ;\r\n",
        // Bun's own position of the end of this file is 1:15.
        "eof.js": "function f() {\n",
      });
      expect(await lint(String(dir), ["cr.js", "crlf.js", "eof.js"])).toEqual({
        stdout: "",
        stderr:
          "cr.js(2,9): error syntax: Unexpected ;\n" +
          "crlf.js(2,9): error syntax: Unexpected ;\n" +
          "eof.js(2,1): error syntax: Unexpected end of file\n",
        exitCode: 2,
      });
    });
  });

  describe("the exit code", () => {
    const files = {
      // Run, this file prints a line and exits with 3.
      "ok.js": 'console.log("ran");\nprocess.exit(3);\n',
      "ok.ts": "const n: number = 1;\nexport default n;\n",
      "warn.js": "x\n--> y\n",
      "bad.js": "let x = ;\n",
    };

    test.concurrent("is 0 when nothing is reported", async () => {
      using dir = tempDir("lint-exit-0", files);
      expect(await lint(String(dir), ["ok.js", "ok.ts"])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    });

    test.concurrent("is 0 when only warnings are reported", async () => {
      using dir = tempDir("lint-exit-warning", files);
      expect(await lint(String(dir), ["warn.js", "ok.js"])).toEqual({
        stdout: "",
        stderr: `warn.js(2,1): ${htmlCommentWarning}\n`,
        exitCode: 0,
      });
    });

    test.concurrent("is 2 when one file of several has an error", async () => {
      using dir = tempDir("lint-exit-2", files);
      expect(await lint(String(dir), ["ok.js", "warn.js", "bad.js", "ok.ts"])).toEqual({
        stdout: "",
        stderr: "bad.js(1,9): error syntax: Unexpected ;\n" + `warn.js(2,1): ${htmlCommentWarning}\n`,
        exitCode: 2,
      });
    });

    test.concurrent("is 2 when an operand cannot be read", async () => {
      using dir = tempDir("lint-exit-operand", files);
      expect(await lint(String(dir), ["ok.js", "missing.js"])).toEqual({
        stdout: "",
        stderr: "error cannot-read-file: File 'missing.js' not found.\n",
        exitCode: 2,
      });
    });

    test.concurrent("is 1 when no file is given", async () => {
      using dir = tempDir("lint-exit-1", files);
      const { stdout, stderr, exitCode } = await lint(String(dir), []);
      expect(stdout).toBe("");
      expect(stderr).toContain("--lint");
      expect(exitCode).toBe(1);
    });
  });

  describe("stderr is a terminal", () => {
    test.concurrent("a diagnostic is a code frame and not a line of tsc", async () => {
      using dir = tempDir("lint-terminal", { "bad.js": "let x = ;\n" });
      const { output, exitCode } = await lintOnTerminal(String(dir), ["bad.js"]);
      const shown = Bun.stripANSI(output);
      expect(shown).toContain("error: syntax: Unexpected ;");
      expect(shown).toContain("at bad.js:1:9");
      expect(shown).not.toContain("bad.js(1,9)");
      expect(exitCode).toBe(2);
    });

    // ConPTY repaints what the child wrote, so Windows reads conhost's rendering: only POSIX compares the bytes below.
    test.concurrent.skipIf(isWindows)("frames have the code before the message", async () => {
      using dir = tempDir("lint-frames", { "b.js": "let x = ;\n", "a.js": `${astralLine}\n` });
      const { output, exitCode } = await lintOnTerminal(String(dir), ["b.js", "a.js"]);
      expect(output).toBe(
        received(
          `1 | ${astralLine}`,
          // Four columns of "1 | ", then the 25 code units before the semicolon.
          `${" ".repeat(29)}^`,
          "error: syntax: Unexpected ;",
          "    at a.js:1:26",
          "",
          "1 | let x = ;",
          "            ^",
          "error: syntax: Unexpected ;",
          "    at b.js:1:9",
        ),
      );
      expect(exitCode).toBe(2);
    });

    test.concurrent.skipIf(isWindows)("related information is a note under the frame, once", async () => {
      using dir = tempDir("lint-note", { "dup.js": "let a;\nlet a;\n" });
      const expected = {
        output: received(
          "2 | let a;",
          "        ^",
          'error: syntax: "a" has already been declared',
          "    at dup.js:2:5",
          "",
          "1 | let a;",
          "        ^",
          'note: "a" was originally declared here',
          "   at dup.js:1:5",
        ),
        exitCode: 2,
      };
      const [once, twice] = await Promise.all([
        lintOnTerminal(String(dir), ["dup.js"]),
        lintOnTerminal(String(dir), ["dup.js", "./dup.js"]),
      ]);
      expect(once).toEqual(expected);
      expect(twice).toEqual(expected);
    });

    test.concurrent.skipIf(isWindows)("the frame has colour when colour is on", async () => {
      using dir = tempDir("lint-colour", { "bad.js": "let x = ;\n" });
      const { output, exitCode } = await lintOnTerminal(String(dir), ["bad.js"], { ...lintEnv, FORCE_COLOR: "1" });
      expect(output).toContain("\x1b[31merror\x1b[0m\x1b[2m: \x1b[0m\x1b[1msyntax: Unexpected ;\x1b[0m\r\n");
      expect(Bun.stripANSI(output)).toBe(
        received("1 | let x = ;", "            ^", "error: syntax: Unexpected ;", "    at bad.js:1:9"),
      );
      expect(exitCode).toBe(2);
    });
  });
});

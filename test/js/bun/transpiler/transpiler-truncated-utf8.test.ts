import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, isMacOS, libcPathForDlopen, tempDir } from "harness";
import path from "node:path";

// The fixture uses mmap/mprotect via bun:ffi to place source bytes immediately
// before a PROT_NONE guard page, so any read past the end of the input faults
// deterministically. The fixture only knows the mmap flags for Linux (glibc +
// musl) and macOS; libcPathForDlopen() supplies the right shared-object path.
describe.skipIf(!(isLinux || isMacOS))("Bun.Transpiler.transformSync with truncated UTF-8 at end of buffer", () => {
  test("does not read past the end of the input buffer", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), path.join(import.meta.dir, "transpiler-truncated-utf8-fixture.ts")],
      env: { ...bunEnv, BUN_TEST_LIBC_PATH: libcPathForDlopen() },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // On failure the subprocess segfaults before printing DONE and exits
    // with a non-zero code / SIGSEGV signal.
    expect({
      stdout: stdout.trim().split("\n"),
      stderr,
      exitCode,
      signalCode: proc.signalCode,
    }).toEqual({
      stdout: [
        expect.stringContaining("ok: 1@ + 4-byte lead"),
        expect.stringContaining("ok: 1@ + 3-byte lead"),
        expect.stringContaining("ok: 1@ + 2-byte lead"),
        expect.stringContaining("ok: 4-byte lead + 1 continuation"),
        expect.stringContaining("ok: 4-byte lead + 2 continuations"),
        expect.stringContaining("ok: sourceMappingURL pragma + 4-byte lead"),
        expect.stringContaining("ok: block comment terminated at buffer end"),
        expect.stringContaining("ok: unterminated block comment at buffer end"),
        expect.stringContaining("ok: unterminated block comment + 4-byte lead"),
        expect.stringContaining("ok: unterminated block comment + '*'"),
        "DONE",
      ],
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  });
});

/** Source bytes: strings are UTF-8 encoded, number arrays are spliced in as-is. */
function source(...parts: (string | number[])[]): Uint8Array {
  return Uint8Array.from(parts.flatMap(part => (typeof part === "string" ? [...Buffer.from(part)] : part)));
}

/** `"a\uFFFDb"` -> `"61 fffd 62"` */
function codePoints(s: string): string {
  return Array.from(s, c => c.codePointAt(0)!.toString(16)).join(" ");
}

// Every expectation below is what node prints for the same bytes: one U+FFFD per
// maximal subpart of an ill-formed sequence (WHATWG UTF-8 decode).
describe("ill-formed UTF-8 in JS source decodes to U+FFFD", () => {
  const transpiler = new Bun.Transpiler({
    loader: "jsx",
    tsconfig: { compilerOptions: { jsx: "react", jsxFactory: "h" } },
  });

  /** Transpiles the bytes of `var x = ...;` built from `parts` and returns `x`. */
  function evaluate(...parts: (string | number[])[]): any {
    const output = transpiler.transformSync(source(...parts));
    const h = (tag: string, props: unknown, ...children: unknown[]) => ({ tag, props, children });
    return new Function("h", `${output}\nreturn x;`)(h);
  }

  describe("inside a string literal", () => {
    test.each<[string, number[], string]>([
      ["lone continuation byte", [0x80], "61 fffd 62"],
      ["last continuation byte", [0xbf], "61 fffd 62"],
      ["0xF8", [0xf8], "61 fffd 62"],
      ["0xFF", [0xff], "61 fffd 62"],
      ["overlong 2-byte sequence", [0xc0, 0x80], "61 fffd fffd 62"],
      ["lead byte above U+10FFFF", [0xf5, 0x80, 0x80, 0x80], "61 fffd fffd fffd fffd 62"],
      ["3-byte lead cut off before any continuation", [0xe2], "61 fffd 62"],
      ["3-byte lead cut off after one continuation", [0xe2, 0x82], "61 fffd 62"],
      ["4-byte lead cut off after two continuations", [0xf0, 0x9f, 0x98], "61 fffd 62"],
      ["truncated sequence followed by a well-formed one", [0xe2, 0x82, 0xc3, 0xa9], "61 fffd e9 62"],
      ["second byte outside the lead's range (ED A0)", [0xed, 0xa0], "61 fffd fffd 62"],
      ["second byte outside the lead's range (E0 9F)", [0xe0, 0x9f], "61 fffd fffd 62"],
      ["mixed with ASCII", [0xff, 0x41, 0xe2, 0x41, 0x80], "61 fffd 41 fffd 41 fffd 62"],
      // Well-formed input is untouched, including an actual U+FFFD.
      ["encoded U+FFFD", [0xef, 0xbf, 0xbd], "61 fffd 62"],
      ["encoded U+00FF", [0xc3, 0xbf], "61 ff 62"],
      ["encoded U+1F600", [0xf0, 0x9f, 0x98, 0x80], "61 1f600 62"],
    ])("%s", (_name, bytes, expected) => {
      expect(codePoints(evaluate('var x = "a', bytes, 'b";'))).toBe(expected);
    });
  });

  test("template literal", () => {
    expect(codePoints(evaluate("var x = `a", [0xff], "b`;"))).toBe("61 fffd 62");
  });

  test("tagged template literal", () => {
    expect(codePoints(evaluate("var x = (s => s[0])`a", [0x80], "b`;"))).toBe("61 fffd 62");
  });

  test("object key", () => {
    expect(codePoints(evaluate('var x = Object.keys({ "a', [0xff], 'b": 1 })[0];'))).toBe("61 fffd 62");
  });

  test("JSX text", () => {
    expect(codePoints(evaluate("var x = (<a>p", [0xff], "q</a>).children[0];"))).toBe("70 fffd 71");
  });

  test("JSX attribute", () => {
    expect(codePoints(evaluate('var x = (<a b="p', [0xe2, 0x82], 'q" />).props.b;'))).toBe("70 fffd 71");
  });

  test("a raw 0xA0 byte is not JSX whitespace", () => {
    expect(evaluate("var x = (<a>", [0xa0], "</a>).children;")).toEqual(["\uFFFD"]);
  });

  describe("is a syntax error outside of literals", () => {
    /** The first parse error reported for the bytes, or null when they parse. */
    function firstParseError(...parts: (string | number[])[]): string | null {
      try {
        transpiler.transformSync(source(...parts));
        return null;
      } catch (error) {
        return (error instanceof AggregateError ? error.errors[0] : error).message;
      }
    }

    test.each<[string, (string | number[])[], string]>([
      ["0xFF where an identifier is expected", ["var ", [0xff], " = 1;"], 'Expected identifier but found "\uFFFD"'],
      ["0xA0 where whitespace is expected", ["var", [0xa0], "x = 1;"], 'Expected identifier but found "\uFFFD"'],
      ["0xBA after an identifier", ["var x", [0xba], " = 1;"], 'Expected ";" but found "\uFFFD"'],
      ["truncated sequence at the end of the file", ["var x = 1;", [0xe2]], "Unexpected \uFFFD"],
    ])("%s", (_name, parts, message) => {
      expect(firstParseError(...parts)).toBe(message);
    });
  });

  test.concurrent("when running a file", async () => {
    using dir = tempDir("ill-formed-utf8", {
      "main.js": Buffer.from(
        source(
          'const codePoints = s => Array.from(s, c => c.codePointAt(0).toString(16)).join(" ");\n',
          'console.log(codePoints("a',
          [0xff],
          "b",
          [0xe2, 0x82],
          'c"));\n',
          "console.log(codePoints(`a",
          [0x80],
          "b`));\n",
          "console.log(codePoints(((s) => s[0])`a",
          [0xff],
          "b`));\n",
          "console.log(/^a",
          [0xff],
          'b$/.test("a\\uFFFDb"), /^a',
          [0xff],
          'b$/.test("a\\u00FFb"));\n',
          'console.log(codePoints(Object.keys({ "',
          [0xf8],
          '": 1 })[0]));\n',
        ),
      ),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("61 fffd 62 fffd 63\n61 fffd 62\n61 fffd 62\ntrue false\nfffd\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test.concurrent("when running a file that uses 0xFF as an identifier", async () => {
    using dir = tempDir("ill-formed-utf8-identifier", {
      "main.js": Buffer.from(source("var ", [0xff], ' = 1;\nconsole.log("ran");\n')),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("");
    expect(stderr).toContain('error: Expected identifier but found "\uFFFD"');
    expect(exitCode).toBe(1);
  });
});

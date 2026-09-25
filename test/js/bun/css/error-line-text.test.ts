import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// `position.lineText` of a CSS BuildMessage is the text of the reported line
// without its line terminator, like the JS parser's diagnostics. The CSS
// tokenizer counts `\n`, `\r\n`, a lone `\r` and a form feed as line breaks, so
// the line has to be looked up with the same rules for `line` and `lineText`
// to describe the same line.

const IMPORT_ERROR = "@import rules must come before any other rules except @charset and @layer";

async function cssDiagnostics(source: string) {
  using dir = tempDir("css-line-text", { "in.css": source });
  const result = await Bun.build({ entrypoints: [join(String(dir), "in.css")], throw: false });
  return result.logs.map(({ message, position }) => ({
    message,
    line: position?.line,
    lineText: position?.lineText,
  }));
}

const importAfterRule: [name: string, source: string, line: number, lineText: string][] = [
  ["LF, error on line 2", 'a { color: red; }\n@import "x";\n', 2, '@import "x";'],
  ["CRLF, error on line 2", 'a { color: red; }\r\n@import "x";\r\n', 2, '@import "x";'],
  ["LF, blank line before the error", 'a { color: red; }\n\n@import "x";\n', 3, '@import "x";'],
  ["LF, error on the first line", 'a {} @import "x";\nb {}\n', 1, 'a {} @import "x";'],
  ["CRLF, error on the first line", 'a {} @import "x";\r\nb {}\r\n', 1, 'a {} @import "x";'],
  ["LF, error on a last line without a line break", 'a { color: red; }\n@import "x";', 2, '@import "x";'],
  ["CRLF, error on a last line without a line break", 'a { color: red; }\r\n@import "x";', 2, '@import "x";'],
  ["lone CR line breaks", 'a { color: red; }\r@import "x";\r', 2, '@import "x";'],
  ["form feed line break", 'a { color: red; }\f@import "x";\n', 2, '@import "x";'],
  ["whitespace around the line's content is kept", 'a { color: red; }\n  @import "x";  \n', 2, '  @import "x";  '],
];

for (const [name, source, line, lineText] of importAfterRule) {
  test.concurrent(`parse error lineText: ${name}`, async () => {
    expect(await cssDiagnostics(source)).toEqual([{ message: IMPORT_ERROR, line, lineText }]);
  });
}

test.concurrent("parse error lineText: error at the end of input after the last line break", async () => {
  // A stray `}` is reported at the end of input, on the empty line after it.
  expect(await cssDiagnostics("a { color: red; }\n}\n")).toEqual([
    { message: "Unexpected end of input", line: 3, lineText: "" },
  ]);
});

test.concurrent("minify error lineText is the reported line without line breaks", async () => {
  // Nested two-selector rules that the default browser targets cannot express
  // natively; expanding 17 levels of them trips the selector expansion limit,
  // which is reported on one of the nested rules.
  const rule = "co :is(.bar), .bar :is(.baz) {";
  const source = "/* nested */\n" + (rule + "\n").repeat(17) + "color: red;\n" + "}\n".repeat(17);
  const [diagnostic, ...rest] = await cssDiagnostics(source);
  expect(rest).toEqual([]);
  expect(diagnostic.message).toStartWith("Nested CSS rules expand to more than");
  expect(diagnostic.line).toBeGreaterThan(1);
  expect(diagnostic.lineText).toBe(rule);
});

test.concurrent("bun build prints the code frame for an error on a last line without a line break", async () => {
  using dir = tempDir("css-line-text-cli", { "in.css": 'a { color: red; }\n@import "x";' });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "in.css"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stdout).toBe("");
  expect(stderr).toContain(`2 | @import "x";\n`);
  expect(stderr).toContain(`error: ${IMPORT_ERROR}`);
  expect(exitCode).toBe(1);
});

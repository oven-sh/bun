import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// JS/TS/TOML parse diagnostics must count columns in UTF-16 code units, the
// same convention as runtime stack traces (JSC), CSS diagnostics, and the
// source-map spec.

async function buildPosition(
  filename: string,
  bytes: Uint8Array | string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  using dir = tempDir("parse-col", {});
  const file = join(String(dir), filename);
  await Bun.write(file, bytes);
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const r = await Bun.build({ entrypoints: [${JSON.stringify(file)}], throw: false });
       const p = r.logs[0]?.position;
       console.log(JSON.stringify({ line: p?.line, column: p?.column }));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

test.concurrent("JS parse error after astral characters reports UTF-16 column", async () => {
  // U+1F600 GRINNING FACE is one codepoint but two UTF-16 code units. `]`
  // sits at UTF-16 unit index 18 (column 19). With codepoint counting this
  // was reported as 17.
  expect(await buildPosition("in.js", 'const a = "\u{1F600}\u{1F600}"; ]')).toEqual({
    stdout: `{"line":1,"column":19}`,
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("JS parse error column agrees for BMP vs astral lines of equal UTF-16 width", async () => {
  // Four one-unit BMP characters and two two-unit astral characters both put
  // `]` at column 19.
  const astral = await buildPosition("a.js", 'const a = "\u{1F600}\u{1F600}"; ]');
  const bmp = await buildPosition("b.js", 'const a = "\u00E9\u00E9\u00E9\u00E9"; ]');
  expect({ astral: astral.stdout, bmp: bmp.stdout }).toEqual({
    astral: `{"line":1,"column":19}`,
    bmp: `{"line":1,"column":19}`,
  });
});

test.concurrent("JS parse error column matches JSC runtime column for the same line", async () => {
  // Parse error and runtime error originate at the same UTF-16 offset; before
  // the fix only the parse column drifted.
  using dir = tempDir("parse-col-rt", {
    "rt.js": 'const a = "\u{1F600}\u{1F600}"; f();\nfunction f(){ throw new Error("x") }',
    "bad.js": 'const a = "\u{1F600}\u{1F600}"; ]',
  });
  const rt = join(String(dir), "rt.js");
  const bad = join(String(dir), "bad.js");
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const parse = await Bun.build({ entrypoints: [${JSON.stringify(bad)}], throw: false })
         .then(r => r.logs[0].position.column);
       let runtime;
       try { await import(${JSON.stringify(rt)}); } catch (e) {
         runtime = +e.stack.match(/rt\\.js:1:(\\d+)/)[1];
       }
       console.log(JSON.stringify({ parse, runtime }));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode }).toEqual({
    stdout: `{"parse":19,"runtime":19}`,
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("TOML parse error after astral characters reports UTF-16 column", async () => {
  // Two astral characters are 4 UTF-16 units, same as "xxxx", so both lines
  // put `]` at column 12. With codepoint counting the astral line was 10.
  const astral = await buildPosition("a.toml", 'k = "\u{1F600}\u{1F600}" ]');
  const ascii = await buildPosition("b.toml", 'k = "xxxx" ]');
  expect({ astral: astral.stdout, ascii: ascii.stdout }).toEqual({
    astral: `{"line":1,"column":12}`,
    ascii: `{"line":1,"column":12}`,
  });
});

async function lineTextWindow(source: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  using dir = tempDir("parse-col-window", {});
  const file = join(String(dir), "long.js");
  await Bun.write(file, source);
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const r = await Bun.build({ entrypoints: [${JSON.stringify(file)}], throw: false });
       const p = r.logs[0].position;
       console.log(JSON.stringify({
         column: p.column,
         hasToken: p.lineText.includes("]"),
         chars: [...new Set(p.lineText)].sort(),
       }));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

test.concurrent("long non-ASCII line's lineText window covers the error token", async () => {
  // 120 copies of U+00E9 (2 UTF-8 bytes, 1 UTF-16 unit each) then ` ]`:
  // 242 source bytes, `]` at byte 241 / column 122. The window is a byte
  // slice, so indexing it by column missed the token on non-ASCII lines.
  expect(await lineTextWindow(Buffer.alloc(240, "\u00E9").toString() + " ]")).toEqual({
    stdout: `{"column":122,"hasToken":true,"chars":[" ","]","\u00E9"]}`,
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("long non-ASCII line's lineText window does not split a UTF-8 sequence", async () => {
  // `]` at byte 160 of a 321-byte line: the window is applied, and its
  // bounds are snapped to UTF-8 char boundaries.
  const half = Buffer.alloc(160, "\u00E9").toString();
  expect(await lineTextWindow(half + "]" + half)).toEqual({
    stdout: `{"column":81,"hasToken":true,"chars":["]","\u00E9"]}`,
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("CLI caret stays under the token for an error at the end of a long line", async () => {
  // The location keeps the whole 151-byte line. The printer shows its last 120
  // bytes and indents the caret by what it printed, not by the column.
  using dir = tempDir("parse-col-caret", {
    "long.js": Buffer.alloc(150, "a").toString() + "]",
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "long.js"],
    env: { ...bunEnv, NO_COLOR: "1" },
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = stderr.split("\n");
  const textLine = lines.find(l => l.includes("]"))!;
  const caretLine = lines.find(l => l.trimEnd().endsWith("^"))!;
  expect({ token: textLine.indexOf("]"), caret: caretLine.indexOf("^") }).toEqual({ token: 123, caret: 123 });
});

const fill = (count: number, char: string) => Buffer.alloc(count, char).toString();

/**
 * Runs `bun <args>` in a directory holding `files`. Returns the exit code,
 * stderr and every source excerpt in it: a `N | text` line and the index of
 * the `^` under it.
 */
async function printedExcerpts(args: string[], files: Record<string, string>) {
  using dir = tempDir("parse-col-excerpt", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, , exitCode] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
  const lines = stderr.split(/\r?\n/);
  const excerpts: { excerpt: string; caret: number }[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (/^\d+ \| /.test(lines[i]) && /^ *\^$/.test(lines[i + 1])) {
      excerpts.push({ excerpt: lines[i], caret: lines[i + 1].indexOf("^") });
    }
  }
  return { stderr, excerpts, exitCode };
}

// The logger prints at most about 120 bytes of a line: 40 before the caret and
// 80 after it, or the last 120 when the line ends sooner. It indents the caret
// by what it printed. A location can hold far more than 120 bytes: the parsers
// keep the whole line for an error in its last 80 bytes, and CSS always does.
const longArray = "[" + fill(80_000, "1,") + "]";

describe.each([["build"], ["run"]])("bun %s prints a bounded excerpt of a very long line", subcommand => {
  test.concurrent("for an error at its start", async () => {
    const source = `var b = (; var a = ${longArray};`;
    const { stderr, excerpts, exitCode } = await printedExcerpts([subcommand, "long.js"], { "long.js": source });
    expect(excerpts).toEqual([{ excerpt: "1 | " + source.slice(0, 9 + 80), caret: 4 + 9 }]);
    expect(stderr.length).toBeLessThan(1024);
    expect(exitCode).toBe(1);
  });

  test.concurrent("for an error in its middle", async () => {
    const source = `var a = ${longArray}; var b = (; var c = ${longArray};`;
    const at = source.indexOf("(;") + 1;
    const { stderr, excerpts, exitCode } = await printedExcerpts([subcommand, "long.js"], { "long.js": source });
    expect(excerpts.map(e => e.excerpt)).toEqual(["1 | " + source.slice(at - 40, at + 80)]);
    // This location does not say how much of the line it dropped on the left,
    // so only the length of the caret line is checked: it was `at` spaces long.
    expect(excerpts[0].caret).toBeLessThanOrEqual(excerpts[0].excerpt.length);
    expect(stderr.length).toBeLessThan(1024);
    expect(exitCode).toBe(1);
  });

  test.concurrent("for an error at its end", async () => {
    const source = `var a = ${longArray}; var b = (;`;
    const { stderr, excerpts, exitCode } = await printedExcerpts([subcommand, "long.js"], { "long.js": source });
    expect(excerpts).toEqual([{ excerpt: "1 | " + source.slice(-120), caret: 4 + 119 }]);
    expect(stderr.length).toBeLessThan(1024);
    expect(exitCode).toBe(1);
  });
});

test.concurrent("an error in the trailing whitespace of a very long line prints the end of its text", async () => {
  // "Unexpected end of file" at the last of 200 spaces. Those 200 bytes are
  // not the excerpt, and the caret goes right after the `(`.
  const text = `var a = ${longArray}; var b = (`;
  const { stderr, excerpts, exitCode } = await printedExcerpts(["build", "long.js"], {
    "long.js": text + fill(200, " "),
  });
  expect(excerpts).toEqual([{ excerpt: "1 | " + text.slice(-120), caret: 4 + 120 }]);
  expect(stderr.length).toBeLessThan(1024);
  expect(exitCode).toBe(1);
});

test.concurrent("an error in the trailing whitespace of a short line keeps its caret at the column", async () => {
  const { excerpts, exitCode } = await printedExcerpts(["build", "short.js"], {
    "short.js": "var b = (" + fill(20, " "),
  });
  expect(excerpts).toEqual([{ excerpt: "1 | var b = (", caret: 4 + 28 }]);
  expect(exitCode).toBe(1);
});

test.concurrent("an error and its note on one very long line both print a bounded excerpt", async () => {
  const source = `const x = 1; var a = ${longArray}; const x = 2;`;
  const { stderr, excerpts, exitCode } = await printedExcerpts(["build", "long.js"], { "long.js": source });
  expect(excerpts).toEqual([
    { excerpt: "1 | " + source.slice(-120), caret: 4 + 120 - "x = 2;".length },
    { excerpt: "1 | " + source.slice(0, 6 + 80), caret: 4 + 6 },
  ]);
  expect(stderr.length).toBeLessThan(1024);
  expect(exitCode).toBe(1);
});

test.concurrent.each([
  // The last 120 bytes start one byte into an `é` and three bytes into a `𐐀`.
  ["2-byte", fill(600, "\u00E9") + "]", "1 | " + fill(120, "\u00E9") + "]", 4 + 60],
  ["4-byte", fill(400, "\u{10400}") + "xy]", "1 | " + fill(120, "\u{10400}") + "xy]", 4 + 60 + 2],
])(
  "bounded excerpt of a line of %s characters starts on a character and counts UTF-16 units",
  async (_, source, excerpt, caret) => {
    const { excerpts, exitCode } = await printedExcerpts(["build", "long.js"], { "long.js": source });
    expect(excerpts).toEqual([{ excerpt, caret }]);
    expect(exitCode).toBe(1);
  },
);

describe("bun build prints a bounded excerpt of a very long CSS line", () => {
  // A stray `}` after a rule is an error at the `}`.
  const rules = fill(60_000, "a{color:red}");

  test.concurrent("for an error at its start", async () => {
    const source = "a{color:red}}" + rules;
    const { stderr, excerpts, exitCode } = await printedExcerpts(["build", "long.css"], { "long.css": source });
    expect(excerpts).toEqual([{ excerpt: "1 | " + source.slice(0, 120), caret: 4 + 12 }]);
    expect(stderr.length).toBeLessThan(1024);
    expect(exitCode).toBe(1);
  });

  test.concurrent("for an error in its middle", async () => {
    const source = rules + "}" + rules;
    const { stderr, excerpts, exitCode } = await printedExcerpts(["build", "long.css"], { "long.css": source });
    expect(excerpts).toEqual([{ excerpt: "1 | " + source.slice(60_000 - 40, 60_000 + 80), caret: 4 + 40 }]);
    expect(stderr.length).toBeLessThan(1024);
    expect(exitCode).toBe(1);
  });

  test.concurrent("for an error at its end", async () => {
    // "Unexpected end of input": the caret is one column past the last `}`.
    const source = rules + "}";
    const { stderr, excerpts, exitCode } = await printedExcerpts(["build", "long.css"], { "long.css": source });
    expect(excerpts).toEqual([{ excerpt: "1 | " + source.slice(-120), caret: 4 + 120 }]);
    expect(stderr.length).toBeLessThan(1024);
    expect(exitCode).toBe(1);
  });
});

test.concurrent("bounded excerpt of a CSS line starts and ends on a character", async () => {
  // 40 bytes before the stray `}` is one byte into a `€`, and 80 bytes after
  // it is two bytes into one.
  const comment = "/*" + fill(60_000, "\u20AC") + "*/";
  const source = comment + "a{color:red}}" + comment + "a{color:red}";
  const { stderr, excerpts, exitCode } = await printedExcerpts(["build", "long.css"], { "long.css": source });
  expect(excerpts).toEqual([
    {
      excerpt: "1 | " + fill(27, "\u20AC") + "*/a{color:red}}/*" + fill(78, "\u20AC"),
      caret: 4 + 9 + "*/a{color:red}".length,
    },
  ]);
  expect(stderr.length).toBeLessThan(1024);
  expect(exitCode).toBe(1);
});

test.concurrent("bun install prints a bounded excerpt of a one-line package.json that is cut short", async () => {
  const source = `{"name":"x","version":"1.0.0","files":[` + fill(80_000, '"a",') + `"a"]`;
  const { stderr, excerpts, exitCode } = await printedExcerpts(["install"], { "package.json": source });
  expect(excerpts).toEqual([{ excerpt: "1 | " + source.slice(-120), caret: 4 + 119 }]);
  expect(stderr.length).toBeLessThan(1024);
  expect(exitCode).toBe(1);
});

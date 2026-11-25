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
  // `]` at byte 160 of a 321-byte line, which is stored whole.
  const half = Buffer.alloc(160, "\u00E9").toString();
  expect(await lineTextWindow(half + "]" + half)).toEqual({
    stdout: `{"column":81,"hasToken":true,"chars":["]","\u00E9"]}`,
    stderr: "",
    exitCode: 0,
  });
});

const fill = (count: number, char: string) => Buffer.alloc(count, char).toString();

// `fill` counts bytes: 160 bytes of U+00E9 are 80 characters.
test.concurrent.each([
  {
    title: "the whole line of 321 bytes",
    line: fill(160, "\u00E9") + "]" + fill(160, "\u00E9"),
    lineText: fill(160, "\u00E9") + "]" + fill(160, "\u00E9"),
  },
  {
    title: "the whole line of 1,000 bytes",
    line: fill(100, "a") + "]" + fill(899, "b"),
    lineText: fill(100, "a") + "]" + fill(899, "b"),
  },
  {
    title: "the excerpt of a line of 1,001 bytes",
    line: fill(100, "a") + "]" + fill(900, "b"),
    lineText: fill(40, "a") + "]" + fill(79, "b"),
  },
  {
    // Byte 680, 80 bytes from `]`, is inside a character, so the excerpt ends one byte later.
    title: "the excerpt of a line of 1,201 bytes, cut on character boundaries",
    line: fill(600, "\u00E9") + "]" + fill(600, "\u00E9"),
    lineText: fill(40, "\u00E9") + "]" + fill(80, "\u00E9"),
  },
])("position.lineText is $title", async ({ line, lineText }) => {
  using dir = tempDir("parse-col-line-text", { "long.js": line });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const r = await Bun.build({ entrypoints: [${JSON.stringify(join(String(dir), "long.js"))}], throw: false });
       console.log(JSON.stringify(r.logs[0].position.lineText));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ lineText: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({ lineText, stderr: "", exitCode: 0 });
});

/**
 * Runs `bun <args>` in a directory holding `files` and returns every source
 * excerpt the logger printed (a `N | text` line followed by a caret line) along
 * with the column the `^` landed on. The excerpt may be a window of a long line;
 * the caret must land on the offending token inside the printed excerpt.
 */
async function printedExcerpts(args: string[], files: Record<string, string>) {
  using dir = tempDir("parse-col-caret", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
  const lines = stderr.split(/\r?\n/);
  const excerpts: { excerpt: string; caret: number }[] = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (/^\d+ \| /.test(lines[i]) && /^ *\^$/.test(lines[i + 1])) {
      excerpts.push({ excerpt: lines[i], caret: lines[i + 1].indexOf("^") });
    }
  }
  return { stderr, excerpts };
}

test.concurrent("CLI caret stays under the token for an error at the end of a long line", async () => {
  // An error in the last 80 bytes of a line of 1,000 bytes or less is not left-trimmed.
  const { excerpts } = await printedExcerpts(["build", "long.js"], { "long.js": fill(150, "a") + "]" });
  expect(excerpts).toEqual([{ excerpt: "1 | " + fill(150, "a") + "]", caret: 4 + 150 }]);
});

test.concurrent.each([["build"], ["run"]])(
  "bun %s: CLI caret stays under the token when the excerpt is left-trimmed",
  async subcommand => {
    // `]` is at byte 100 of a 1,101-byte line, so the excerpt is the 120 bytes
    // around it (40 before, 80 after) and the caret belongs 40 characters in,
    // not at the token's column in the full line (which is past the end of
    // the excerpt).
    const { excerpts } = await printedExcerpts([subcommand, "long.js"], {
      "long.js": "let ok = 1;\n" + fill(100, "a") + "]" + fill(1000, "b") + "\n",
    });
    expect(excerpts).toEqual([{ excerpt: "2 | " + fill(40, "a") + "]" + fill(79, "b"), caret: 4 + 40 }]);
  },
);

// The printed line is cut when more than 80 bytes start at the error, and the
// cut drops a prefix when more than 40 bytes precede the error. A line of more
// than 1,000 bytes is cut wherever the error is.
test.concurrent.each([
  ["a 1,000-byte line", fill(100, "a") + "]" + fill(899, "b"), 60, 180],
  ["a 1,001-byte line", fill(100, "a") + "]" + fill(900, "b"), 60, 180],
  ["80 bytes from the error to the end keep a 1,000-byte line whole", fill(920, "a") + "]" + fill(79, "b"), 0, 1000],
  ["80 bytes from the error to the end cut a 1,001-byte line", fill(921, "a") + "]" + fill(79, "b"), 881, 1001],
  ["81 bytes from the error to the end cut the line", fill(1000, "a") + "]" + fill(80, "b"), 960, 1080],
  ["40 bytes before the error drop no prefix", fill(40, "a") + "]" + fill(1000, "b"), 0, 120],
  ["41 bytes before the error drop one byte", "c" + fill(40, "a") + "]" + fill(1000, "b"), 1, 121],
  [
    "a 200-byte line, 80 bytes from the error to the end: whole, as on main",
    fill(120, "a") + "]" + fill(79, "b"),
    0,
    200,
  ],
  ["a 201-byte line, 81 bytes from the error to the end", fill(120, "a") + "]" + fill(80, "b"), 80, 200],
  ["a 141-byte line, 40 bytes before the error", fill(40, "a") + "]" + fill(100, "b"), 0, 120],
  ["a 142-byte line, 41 bytes before the error", "c" + fill(40, "a") + "]" + fill(100, "b"), 1, 121],
])("CLI caret at an excerpt limit: %s", async (_, line, start, end) => {
  const { excerpts } = await printedExcerpts(["build", "long.js"], { "long.js": line });
  expect(excerpts).toEqual([{ excerpt: "1 | " + line.slice(start, end), caret: 4 + line.indexOf("]") - start }]);
});

// A line of more than 1,000 bytes is not printed whole for an error in its last
// 80 bytes either: the excerpt is the 40 bytes before the error and the rest of
// the line. `position.lineText` is still the whole line (see below).
const longArray = "[" + fill(80_000, "1,") + "]";

test.concurrent.each([["build"], ["run"]])(
  "bun %s prints an excerpt for an error at the end of a line of more than 1,000 bytes",
  async subcommand => {
    const source = `var a = ${longArray}; var b = (;`;
    const { stderr, excerpts } = await printedExcerpts([subcommand, "long.js"], { "long.js": source });
    expect(excerpts).toEqual([{ excerpt: "1 | " + source.slice(-41), caret: 4 + 40 }]);
    expect(stderr.length).toBeLessThan(1024);
  },
);

test.concurrent("an error at the end of a second line of more than 1,000 bytes, after CR LF", async () => {
  const line = `var a = ${longArray}; var b = (;`;
  const { stderr, excerpts } = await printedExcerpts(["build", "long.js"], {
    "long.js": "let ok = 1;\r\n" + line + "\r\n",
  });
  expect(excerpts).toEqual([{ excerpt: "2 | " + line.slice(-41), caret: 4 + 40 }]);
  expect(stderr.length).toBeLessThan(1024);
});

test.concurrent("a note at the end of a line of more than 1,000 bytes gets an excerpt", async () => {
  const first = `var a = ${longArray}; const x = 1;`;
  const { stderr, excerpts } = await printedExcerpts(["build", "long.js"], {
    "long.js": first + "\nconst x = 2;\n",
  });
  const at = first.length - "x = 1;".length;
  expect(excerpts).toEqual([
    { excerpt: "2 | const x = 2;", caret: 4 + 6 },
    { excerpt: "1 | " + first.slice(at - 40), caret: 4 + 40 },
  ]);
  expect(stderr.length).toBeLessThan(1024);
});

// The byte 40 bytes before `]` starts a U+00E9, and it is inside a U+540D and a
// U+10400. The caret counts terminal columns: a U+540D takes 2, and a U+10400
// takes 1 though it is 2 UTF-16 units.
test.concurrent.each([
  ["2-byte", fill(1200, "\u00E9") + "]", fill(40, "\u00E9") + "]", 20],
  ["3-byte wide", fill(1200, "\u540D") + "]", fill(42, "\u540D") + "]", 14 * 2],
  ["4-byte", fill(1200, "\u{10400}") + "xy]", fill(40, "\u{10400}") + "xy]", 10 + 2],
])("the excerpt at the end of a long line of %s characters starts on a character", async (_, source, shown, cells) => {
  const { excerpts } = await printedExcerpts(["build", "long.js"], { "long.js": source });
  expect(excerpts).toEqual([{ excerpt: "1 | " + shown, caret: 4 + cells }]);
});

test.concurrent("bun install prints an excerpt of a one-line package.json that is cut short", async () => {
  const source = `{"name":"x","version":"1.0.0","files":[` + fill(80_000, '"a",') + `"a"]`;
  const { stderr, excerpts } = await printedExcerpts(["install"], { "package.json": source });
  expect(excerpts).toEqual([{ excerpt: "1 | " + source.slice(-41), caret: 4 + 40 }]);
  expect(stderr.length).toBeLessThan(1024);
});

// The 40 bytes before the error are blanks, and so is the excerpt. Blanks at the end of a line are not printed,
// so nothing is left to print: the message and the place stand alone.
test.concurrent("an error after 2,000 blanks at the end of a line prints no source line", async () => {
  const { stderr, excerpts } = await printedExcerpts(["build", "blank.js"], {
    "blank.js": "var a = (" + fill(2000, " "),
  });
  expect(excerpts).toEqual([]);
  expect(stderr).toStartWith("error: Unexpected end of file\n");
  expect(stderr.length).toBeLessThan(1024);
});

/**
 * What `BuildMessage.position` holds for the first error of `source`: the
 * column, the length of `lineText`, and the character that a reader finds when
 * it indexes `lineText` by the column.
 */
async function positionOf(name: string, source: string) {
  using dir = tempDir("parse-col-position", { [name]: source });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const r = await Bun.build({ entrypoints: [${JSON.stringify(join(String(dir), name))}], throw: false });
       const p = r.logs[0].position;
       console.log(JSON.stringify({ column: p.column, length: p.lineText.length, atColumn: p.lineText[p.column - 1] }));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { position: stdout && JSON.parse(stdout), stderr, exitCode };
}

// A CSS error makes its own location, with the whole line at any length. What
// is printed of a line of more than 1,000 bytes is the excerpt around the
// column: the 40 bytes before it and the 80 bytes from it.
describe("bun build prints an excerpt of a CSS line of more than 1,000 bytes", () => {
  // A stray `}` after a rule is an error at the `}`.
  const rules = fill(60_000, "a{color:red}");

  test.concurrent("for an error at its start", async () => {
    const source = "a{color:red}}" + rules;
    const { stderr, excerpts } = await printedExcerpts(["build", "long.css"], { "long.css": source });
    expect(excerpts).toEqual([{ excerpt: "1 | " + source.slice(0, 12 + 80), caret: 4 + 12 }]);
    expect(stderr.length).toBeLessThan(1024);
  });

  test.concurrent("for an error in its middle", async () => {
    const source = rules + "}" + rules;
    const { stderr, excerpts } = await printedExcerpts(["build", "long.css"], { "long.css": source });
    expect(excerpts).toEqual([{ excerpt: "1 | " + source.slice(60_000 - 40, 60_000 + 80), caret: 4 + 40 }]);
    expect(stderr.length).toBeLessThan(1024);
  });

  test.concurrent("for an error at its end", async () => {
    // "Unexpected end of input": the column is one past the last `}`, so the caret follows the excerpt.
    const source = rules + "}";
    const { stderr, excerpts } = await printedExcerpts(["build", "long.css"], { "long.css": source });
    expect(excerpts).toEqual([{ excerpt: "1 | " + source.slice(-40), caret: 4 + 40 }]);
    expect(stderr.length).toBeLessThan(1024);
  });

  test.concurrent("and starts and ends the excerpt on a character", async () => {
    // 40 bytes before the stray `}` is one byte into a U+20AC, and 80 bytes
    // after it is two bytes into one.
    const comment = "/*" + fill(60_000, "\u20AC") + "*/";
    const source = comment + "a{color:red}}" + comment + "a{color:red}";
    const { stderr, excerpts } = await printedExcerpts(["build", "long.css"], { "long.css": source });
    expect(excerpts).toEqual([
      {
        excerpt: "1 | " + fill(27, "\u20AC") + "*/a{color:red}}/*" + fill(78, "\u20AC"),
        caret: 4 + 9 + "*/a{color:red}".length,
      },
    ]);
    expect(stderr.length).toBeLessThan(1024);
  });

  // The lines that follow count their columns from their own first byte, whatever ends the line before.
  test.concurrent.each([
    ["a line feed", "\n", "\n"],
    ["CR LF", "\r\n", "\r\n"],
    ["a line feed, as the last line of the file", "\n", ""],
  ])("for an error on the line after %s", async (_, before, after) => {
    const some = fill(1_200, "a{color:red}");
    const line = some + "}" + some;
    const { stderr, excerpts } = await printedExcerpts(["build", "long.css"], {
      "long.css": "/*! banner */" + before + line + after,
    });
    expect(excerpts).toEqual([{ excerpt: "2 | " + line.slice(1_200 - 40, 1_200 + 80), caret: 4 + 40 }]);
    expect(stderr.length).toBeLessThan(1024);
  });

  // 41 rules, a stray `}` at byte 492, 41 rules, and a last rule that brings the line to 1,000 or 1,001 bytes.
  const some = fill(492, "a{color:red}");
  const line1000 = some + "}" + some + "a{color:red}b{}";
  const line1001 = some + "}" + some + "a{color:red}b{ }";

  test.concurrent.each([
    ["the first line", "", ""],
    ["a line after a line feed", "/*! banner */\n", "\n"],
    ["a line after CR LF", "/*! banner */\r\n", "\r\n"],
  ])("and prints %s of 1,000 bytes whole, and an excerpt of one of 1,001", async (_, before, after) => {
    const number = before ? 2 : 1;
    const [whole, cut] = await Promise.all(
      [line1000, line1001].map(line => printedExcerpts(["build", "long.css"], { "long.css": before + line + after })),
    );
    expect({ bytes: [line1000.length, line1001.length], whole: whole.excerpts, cut: cut.excerpts }).toEqual({
      bytes: [1000, 1001],
      whole: [{ excerpt: `${number} | ` + line1000, caret: 4 + 492 }],
      cut: [{ excerpt: `${number} | ` + line1001.slice(492 - 40, 492 + 80), caret: 4 + 40 }],
    });
  });

  test.concurrent("and `position.lineText` is the whole line at both lengths", async () => {
    const [whole, cut] = await Promise.all([positionOf("long.css", line1000), positionOf("long.css", line1001)]);
    expect({ whole, cut }).toEqual({
      whole: { position: { column: 493, length: 1000, atColumn: "}" }, stderr: "", exitCode: 0 },
      cut: { position: { column: 493, length: 1001, atColumn: "}" }, stderr: "", exitCode: 0 },
    });
  });
});

test.concurrent("CLI caret counts the left-trimmed prefix in columns, not bytes", async () => {
  // U+00E9 is 2 UTF-8 bytes but 1 column (Buffer.alloc fills by bytes, so
  // fill(200) is 100 characters). `]` is at byte 200 / column 101 of a
  // 1,201-byte line; the window keeps the 40 bytes (20 characters) before it,
  // so the caret belongs 20 characters in.
  const { excerpts } = await printedExcerpts(["build", "long.js"], {
    "long.js": fill(200, "\u00E9") + "]" + fill(1000, "\u00E9"),
  });
  expect(excerpts).toEqual([{ excerpt: "1 | " + fill(40, "\u00E9") + "]" + fill(80, "\u00E9"), caret: 4 + 20 }]);
});

test.concurrent("CLI caret counts a left-trimmed astral prefix in UTF-16 units, like the column", async () => {
  // U+10400 (a valid identifier character) is 4 UTF-8 bytes, 2 UTF-16 units
  // and 1 terminal column, and columns count UTF-16 units. 30 of them put `]`
  // at byte 120 / column 61; the window keeps the 10 characters (20 units)
  // before it, so the caret belongs 10 terminal columns in (30 if the trimmed
  // width were counted in characters, 50 if it were not subtracted at all).
  const { excerpts } = await printedExcerpts(["build", "long.js"], {
    "long.js": fill(120, "\u{10400}") + "]" + fill(1000, "b"),
  });
  expect(excerpts).toEqual([{ excerpt: "1 | " + fill(40, "\u{10400}") + "]" + fill(79, "b"), caret: 4 + 10 }]);
});

// U+540D is 3 UTF-8 bytes and 2 terminal columns. The byte 40 bytes before `]` is inside a character, so the
// excerpt starts at the 14th character before `]`. The first line is cut when it is stored, the second when it
// is printed.
test.concurrent.each([[1200], [300]])(
  "CLI excerpt starts on a character boundary, with %i bytes after the error",
  async after => {
    const { excerpts } = await printedExcerpts(["build", "long.js"], {
      "long.js": fill(210, "\u540D") + "]" + fill(after, "\u540D"),
    });
    expect(excerpts).toEqual([{ excerpt: "1 | " + fill(42, "\u540D") + "]" + fill(81, "\u540D"), caret: 4 + 14 * 2 }]);
  },
);

// A literal U+FFFD gets two diagnostics. The second is at a byte inside the character, where the column is one
// too large. Each excerpt is cut around the byte of its error, not around its column: 40 bytes before, 80 from it.
test.concurrent.each([[79], [80]])("CLI excerpt around a literal U+FFFD with %i bytes after it", async after => {
  const { excerpts } = await printedExcerpts(["build", "long.js"], {
    "long.js": fill(796, "a") + "\uFFFD" + fill(after, "b"),
  });
  expect(excerpts).toEqual([
    { excerpt: "1 | " + fill(40, "a") + "\uFFFD" + fill(77, "b"), caret: 4 + 40 },
    { excerpt: "1 | " + fill(39, "a") + "\uFFFD" + fill(78, "b"), caret: 4 + 40 },
  ]);
});

test.concurrent("a line with 80 bytes from the error to its end is printed whole after a lone CR too", async () => {
  const { excerpts } = await printedExcerpts(["build", "cr.js"], {
    "cr.js": "let ok = 1;\r" + fill(120, "a") + "]" + fill(79, "b") + "\r",
  });
  expect(excerpts.map(it => it.excerpt)).toEqual(["2 | " + fill(120, "a") + "]" + fill(79, "b")]);
});

test.concurrent("CLI caret is aligned for both the error and its note on a long line", async () => {
  // The redeclaration at byte 176 is left-trimmed; the note pointing at the
  // original declaration (byte 6) is windowed without a left trim.
  const source = "const x = 1; /* " + fill(150, "p") + " */ const x = 2; " + fill(1000, "q") + "\n";
  const { excerpts } = await printedExcerpts(["build", "long.js"], { "long.js": source });
  expect(excerpts).toEqual([
    { excerpt: "1 | " + fill(30, "p") + " */ const x = 2; " + fill(73, "q"), caret: 4 + 30 + " */ const ".length },
    { excerpt: "1 | const x = 1; /* " + fill(70, "p"), caret: 4 + "const ".length },
  ]);
});

test.concurrent.each([[379], [1179]])(
  "bun install points the caret at the token inside a package.json line of %i bytes",
  async length => {
    // The `}` is at column 179. The excerpt starts 40 bytes before it (the caret
    // used to be indented by the full 178 columns), while the `at file:line:col`
    // suffix still reports the real column.
    const { stderr, excerpts } = await printedExcerpts(["install"], {
      "package.json": '{"name":"x",' + fill(150, " ") + '"dependencies": }' + fill(length - 179, " ") + "\n",
    });
    expect(excerpts).toEqual([
      { excerpt: "1 | " + fill(24, " ") + '"dependencies": }', caret: 4 + 24 + '"dependencies": '.length },
    ]);
    expect(stderr).toContain("package.json:1:179");
  },
);

// The excerpt is the 40 bytes before the position and the 80 bytes from it,
// without the spaces at its end. A credential elsewhere on the line is not in it.
test.concurrent.each([
  {
    file: "package.json",
    text: `{"name":"x", "repository": "https://user:S3cretValue@git.example/x.git",${fill(150, " ")}"name": "y",${fill(150, " ")}"version": "1.0.0"}`,
    at: '"name": "y"',
    message: 'warn: Duplicate key "name" in object literal',
  },
  {
    file: "bun.lock",
    text: `{\n  "lockfileVersion": 1,\n  "workspaces": { "": { "name": "x" } },\n  "packages": {${fill(60, " ")}"p0": ["p0@1.0.0", "", {}, "sha512-x"]${fill(150, " ")}}\n}`,
    at: '"sha512-x"',
    message: "warn: Unsupported or malformed integrity hash; ignoring",
  },
  {
    file: "bunfig.toml",
    text: `install = {${fill(60, " ")}globalDir = "/x", registry = { url = "https://r.example/${fill(150, "x")}/", token = "S3cretValueS3cretValue" } }`,
    at: '"/x"',
    message: 'warn: ignoring "globalDir" in project bunfig.toml',
  },
  {
    file: ".npmrc",
    text: `//registry.example/${fill(60, "p")}/:certfile=/etc/ssl/${fill(120, "x")}.pem`,
    at: "certfile",
    message: "warn: certfile is not supported; ignoring this .npmrc option",
  },
])(
  "bun install prints the excerpt of a long line of $file, with the caret under the position",
  async ({ file, text, at, message }) => {
    using dir = tempDir("parse-col-install", { "package.json": '{"name":"x"}', [file]: text + "\n", "home/.keep": "" });
    // An empty home, so the machine's own config files add no diagnostic.
    const home = join(String(dir), "home");
    await using proc = Bun.spawn({
      cmd: [bunExe(), "install"],
      env: { ...bunEnv, NO_COLOR: "1", HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stderr] = await Promise.all([proc.stderr.text(), proc.stdout.text(), proc.exited]);
    const lines = text.split("\n");
    const number = lines.findIndex(line => line.includes(at)) + 1;
    const offset = lines[number - 1].indexOf(at);
    const excerpt = lines[number - 1].slice(offset - 40, offset + 80).trimEnd();
    expect(stderr.replaceAll("\r\n", "\n")).toContain(`${number} | ${excerpt}\n${fill(4 + 40, " ")}^\n${message}`);
    expect(stderr).not.toContain("S3cretValue");
  },
);

// The excerpt of a line of more than 1,000 bytes can be without the `token` key
// that marks a string as a secret. So where the errors of a file are redacted,
// such a line is printed whole and masked, as before. Blanks at the end of the
// line count for its length. The errors reach the log through two functions.
const stars = (count: number) => fill(count, "*");
const secret = (count: number) => fill(count, "secretvalue");
test.concurrent.each([
  {
    title: "a syntax error at the end of a line of 1,112 bytes",
    args: ["install"],
    bunfig: `[install]\ntoken = "${secret(1100)}" ]\n`,
    printed: `2 | token = "${stars(1100)}" ]`,
  },
  {
    title: "a syntax error at the end of a line of 963 bytes and 60 spaces",
    args: ["install"],
    bunfig: `[install]\ntoken = "${secret(951)}" ]${fill(60, " ")}\n`,
    printed: `2 | token = "${stars(951)}" ]`,
  },
  {
    title: "a syntax error at the end of a line of 1,000 bytes and a tab",
    args: ["install"],
    bunfig: `[install]\ntoken = "${secret(988)}" ]\t\n`,
    printed: `2 | token = "${stars(988)}" ]`,
  },
  {
    title: "an invalid value at the end of a line of 1,000 bytes and a space",
    args: ["install"],
    bunfig: `install = { registry = { token = "${secret(950)}" }, cafile = 1 } \n`,
    printed: `1 | install = { registry = { token = "${stars(950)}" }, cafile = 1 }`,
  },
  {
    title: "an invalid [lint] value at the end of a line of 1,230 bytes",
    args: ["lint", "a.js"],
    bunfig: `[lint]\nrules = {${fill(1200, " ")}"no-var" = "always" }\n`,
    printed: `2 | rules = {${fill(1200, " ")}"no-var" = "always" }`,
  },
])("a redacted line is printed whole and masked: $title", async ({ args, bunfig, printed }) => {
  using dir = tempDir("parse-col-redacted", {
    "bunfig.toml": bunfig,
    "package.json": "{}",
    "a.js": "export {};\n",
    "eslint.config.js": "export default [{ rules: {} }];\n",
  });
  const run = async (colors: Record<string, string | undefined>) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: { ...bunEnv, ...colors },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return Bun.stripANSI(stdout + stderr).replaceAll("\r\n", "\n");
  };
  const outputs = await Promise.all([run({ NO_COLOR: "1" }), run({ NO_COLOR: undefined, FORCE_COLOR: "1" })]);
  for (const output of outputs) {
    expect(output).toContain(printed + "\n");
    expect(output).not.toContain("secretvalue");
  }
});

// The logger used to slice the line from one byte before its start to pick
// up (and later trim) a preceding `\n`; after a three-byte U+2028 or U+2029
// that byte is a stray UTF-8 continuation byte. It was printed before the text
// and pushed it one cell to the right of the caret, and it was the first
// character of `position.lineText`.
test.concurrent.each([
  ["U+2028", "\u2028"],
  ["U+2029", "\u2029"],
])("the line that follows a %s line separator starts at its first character", async (_, separator) => {
  using dir = tempDir("parse-col-separator", { "ls.js": `let a = 1;${separator}let b = 2; ]` });
  const file = join(String(dir), "ls.js");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", file],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  await using script = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const p = (await Bun.build({ entrypoints: [${JSON.stringify(file)}], throw: false })).logs[0].position;
       console.log(JSON.stringify({ lineText: p.lineText, pointsAt: p.lineText[p.column - 1] }));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [printed, position] = await Promise.all([
    build.stderr.text(),
    script.stdout.text(),
    build.exited,
    script.exited,
  ]);
  const lines = printed.split(/\r?\n/);
  const at = lines.indexOf("2 | let b = 2; ]");
  expect({ caretLine: lines[at + 1], position: position && JSON.parse(position) }).toEqual({
    caretLine: fill(4 + "let b = 2; ".length, " ") + "^",
    position: { lineText: "let b = 2; ]", pointsAt: "]" },
  });
});

test.concurrent("CLI caret counts a tab the same with and without non-ASCII text on the line", async () => {
  using dir = tempDir("parse-col-caret-tabs", {
    "ascii.js": '\t\tconst a = "e" + ;\n',
    "accent.js": '\t\tconst a = "é" + ;\n',
    "wide.js": '\tconst a = "名前" + ;\n',
  });
  const caretIn = async (file: string) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", file],
      env: { ...bunEnv, NO_COLOR: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return stderr
      .split("\n")
      .find(l => l.trimEnd().endsWith("^"))!
      .indexOf("^");
  };
  const [ascii, accent, wide] = await Promise.all(["ascii.js", "accent.js", "wide.js"].map(caretIn));
  // "1 | " is 4 columns. Each of the two wide characters takes 2.
  expect({ ascii, accent, wide }).toEqual({ ascii: 4 + 18, accent: 4 + 18, wide: 4 + 20 });
});

// `position.column` counts from the start of the whole line, so `lineText` has
// to be the whole line for `lineText[column - 1]` to be the character the
// error points at. Every position a script can read is checked: the thrown
// error, the `Bun.build` log, the `toJSON()` of both, and the notes.
async function positionsOf(line: string) {
  using dir = tempDir("parse-col-whole-line", { "line.ts": line + "\n" });
  const file = join(String(dir), "line.ts");
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const thrown = await import(${JSON.stringify(file)}).catch(e => e);
       const [log] = (await Bun.build({ entrypoints: [${JSON.stringify(file)}], throw: false })).logs;
       const readable = {
         thrown: thrown.position,
         thrownJSON: thrown.toJSON().position,
         log: log.position,
         logJSON: log.toJSON().position,
         note: log.notes?.[0]?.position,
       };
       const positions = {};
       for (const [from, p] of Object.entries(readable)) {
         if (p) positions[from] = { lineText: p.lineText, pointsAt: p.lineText[p.column - 1], keys: Object.keys(p) };
       }
       console.log(JSON.stringify(positions));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { positions: stdout && JSON.parse(stdout), stderr, exitCode };
}

const positionKeys = ["lineText", "file", "namespace", "line", "column", "length", "offset"];

test.concurrent.each([
  ["100 bytes follow the error", `export const a = "${fill(60, "x")}"; const b = (;${fill(100, "y")}`],
  ["20 bytes follow the error", `export const a = "${fill(60, "x")}"; const b = (;${fill(20, "y")}`],
  ["non-ASCII text precedes the error", `export const a = "${fill(120, "\u00E9")}"; const b = (;${fill(100, "y")}`],
  ["the line is 1,000 bytes", `export const b = (;${fill(981, "y")}`],
  ["the error ends a line over 1,000 bytes", `export const a = "${fill(1000, "x")}"; const b = (;${fill(20, "y")}`],
])("position.lineText is the whole line and column indexes it: %s", async (_, line) => {
  const position = { lineText: line, pointsAt: ";", keys: positionKeys };
  expect(await positionsOf(line)).toEqual({
    positions: { thrown: position, thrownJSON: position, log: position, logJSON: position },
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("position.lineText is the whole line for an error and its note", async () => {
  const line = `const x = 1; /* ${fill(150, "p")} */ const x = 2; /* ${fill(100, "q")} */`;
  const position = { lineText: line, pointsAt: "x", keys: positionKeys };
  expect(await positionsOf(line)).toEqual({
    positions: { thrown: position, thrownJSON: position, log: position, logJSON: position, note: position },
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("position.lineText is the whole line for a ResolveMessage from Bun.build", async () => {
  // The ResolveMessage that `import()` throws has no position.
  const line = `/* ${fill(60, "p")} */ import "./missing"; /* ${fill(100, "q")} */`;
  const position = { lineText: line, pointsAt: '"', keys: positionKeys };
  expect(await positionsOf(line)).toEqual({
    positions: { log: position, logJSON: position },
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("position.lineText is the whole line of a module that a plugin made", async () => {
  // No file holds this line, so a script cannot read it anywhere else.
  const line = `export const a = "${fill(60, "x")}"; const b = (;${fill(100, "y")}`;
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { logs } = await Bun.build({
         entrypoints: ["made:entry"],
         throw: false,
         plugins: [
           {
             name: "made",
             setup(build) {
               build.onResolve({ filter: /^made:/ }, args => ({ path: args.path, namespace: "made" }));
               build.onLoad({ filter: /.*/, namespace: "made" }, () => ({ contents: ${JSON.stringify(line + "\n")}, loader: "ts" }));
             },
           },
         ],
       });
       const p = logs[0].position;
       console.log(JSON.stringify({ namespace: p.namespace, lineText: p.lineText, pointsAt: p.lineText[p.column - 1] }));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ position: stdout && JSON.parse(stdout), stderr, exitCode }).toEqual({
    position: { namespace: "made", lineText: line, pointsAt: ";" },
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("an imported .xml file gets the same: the whole line in lineText, the excerpt in the CLI", async () => {
  const line = `<root><a>${fill(150, "x")}</a><b attr=></b><c>${fill(150, "y")}</c></root>`;
  const at = line.indexOf("></b>");
  const files = { "entry.ts": `import root from "./data.xml";\nconsole.log(root);\n`, "data.xml": line + "\n" };
  using dir = tempDir("parse-col-xml", files);
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { logs } = await Bun.build({ entrypoints: [${JSON.stringify(join(String(dir), "entry.ts"))}], throw: false });
       const p = logs[0].position;
       console.log(JSON.stringify({ lineText: p.lineText, pointsAt: p.lineText[p.column - 1] }));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [{ excerpts }, stdout] = await Promise.all([
    printedExcerpts(["build", "entry.ts"], files),
    proc.stdout.text(),
    proc.exited,
  ]);
  expect({ excerpts, position: stdout && JSON.parse(stdout) }).toEqual({
    excerpts: [{ excerpt: "1 | " + line.slice(at - 40, at + 80), caret: 4 + 40 }],
    position: { lineText: line, pointsAt: ">" },
  });
});

// What the CLI prints of such a line is still the excerpt: the 40 bytes before
// the error and the 80 bytes from it. 26 bytes of "x" are 26 columns, and 26
// bytes of U+00E9 are 13.
test.concurrent.each([
  ["ASCII", "x", 26],
  ["non-ASCII", "\u00E9", 13],
])(
  "CLI prints the excerpt around an error in the middle of a %s line of 1,000 bytes or less",
  async (_, char, columns) => {
    const line = `export const a = "${fill(120, char)}"; const b = (;${fill(100, "y")}`;
    const { excerpts } = await printedExcerpts(["build", "line.ts"], { "line.ts": line + "\n" });
    expect(excerpts).toEqual([
      {
        excerpt: "1 | " + fill(26, char) + '"; const b = (;' + fill(79, "y"),
        caret: 4 + columns + '"; const b = ('.length,
      },
    ]);
  },
);

test.concurrent("the development error page of Bun.serve gets the excerpt, as the CLI prints it", async () => {
  const line = `export const a = "${fill(120, "x")}"; const b = (;${fill(100, "y")}`;
  using dir = tempDir("parse-col-dev-page", {
    "broken.ts": line + "\n",
    "server.ts": `
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        development: true,
        async fetch() {
          await import("./broken.ts");
          return new Response("unreachable");
        },
      });
      const html = await (await fetch(server.url)).text();
      const json = /<script id="__bunfallback" type="application\\/json">([^<]*)<\\/script>/.exec(html)[1];
      console.log(JSON.stringify(JSON.parse(json).problems.build.msgs.map(msg => msg.data.location.line_text)));
      server.stop(true);
      process.exit(0);
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "server.ts"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(JSON.parse(stdout.trim().split("\n").at(-1)!)).toEqual([fill(26, "x") + '"; const b = (;' + fill(79, "y")]);
  expect(exitCode).toBe(0);
});

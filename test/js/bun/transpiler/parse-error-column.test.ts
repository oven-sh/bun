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

const fill = (count: number, char: string) => Buffer.alloc(count, char).toString();

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

test.concurrent("CLI caret stays under the token for an error at the end of a long line", async () => {
  // An error in the last 80 bytes of a line is never left-trimmed.
  const { excerpts } = await printedExcerpts(["build", "long.js"], { "long.js": fill(150, "a") + "]" });
  expect(excerpts).toEqual([{ excerpt: "1 | " + fill(150, "a") + "]", caret: 4 + 150 }]);
});

test.concurrent.each([["build"], ["run"]])(
  "bun %s: CLI caret stays under the token when the excerpt is left-trimmed",
  async subcommand => {
    // `]` is at byte 100 of a 201-byte line, so the excerpt is the 120 bytes
    // around it (40 before, 80 after) and the caret belongs 40 characters in,
    // not at the token's column in the full line (which is past the end of
    // the excerpt).
    const { excerpts } = await printedExcerpts([subcommand, "long.js"], {
      "long.js": "let ok = 1;\n" + fill(100, "a") + "]" + fill(100, "b") + "\n",
    });
    expect(excerpts).toEqual([{ excerpt: "2 | " + fill(40, "a") + "]" + fill(79, "b"), caret: 4 + 40 }]);
  },
);

// The line is cut when more than 80 bytes start at the error, and the cut
// drops a prefix when more than 40 bytes precede the error.
test.concurrent.each([
  ["80 bytes from the error to the end keep the whole line", fill(100, "a") + "]" + fill(79, "b"), 0, 180],
  ["81 bytes from the error to the end cut the line", fill(100, "a") + "]" + fill(80, "b"), 60, 180],
  ["40 bytes before the error drop no prefix", fill(40, "a") + "]" + fill(100, "b"), 0, 120],
  ["41 bytes before the error drop one byte", "c" + fill(40, "a") + "]" + fill(100, "b"), 1, 121],
])("CLI caret at an excerpt limit: %s", async (_, line, start, end) => {
  const { excerpts } = await printedExcerpts(["build", "long.js"], { "long.js": line });
  expect(excerpts).toEqual([{ excerpt: "1 | " + line.slice(start, end), caret: 4 + line.indexOf("]") - start }]);
});

test.concurrent("CLI caret counts the left-trimmed prefix in columns, not bytes", async () => {
  // U+00E9 is 2 UTF-8 bytes but 1 column (Buffer.alloc fills by bytes, so
  // fill(200) is 100 characters). `]` is at byte 200 / column 101 of a
  // 401-byte line; the window keeps the 40 bytes (20 characters) before it,
  // so the caret belongs 20 characters in.
  const { excerpts } = await printedExcerpts(["build", "long.js"], {
    "long.js": fill(200, "\u00E9") + "]" + fill(200, "\u00E9"),
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
    "long.js": fill(120, "\u{10400}") + "]" + fill(100, "b"),
  });
  expect(excerpts).toEqual([{ excerpt: "1 | " + fill(40, "\u{10400}") + "]" + fill(79, "b"), caret: 4 + 10 }]);
});

test.concurrent("CLI caret is aligned for both the error and its note on a long line", async () => {
  // The redeclaration at byte 176 is left-trimmed; the note pointing at the
  // original declaration (byte 6) is windowed without a left trim.
  const source = "const x = 1; /* " + fill(150, "p") + " */ const x = 2; " + fill(100, "q") + "\n";
  const { excerpts } = await printedExcerpts(["build", "long.js"], { "long.js": source });
  expect(excerpts).toEqual([
    { excerpt: "1 | " + fill(30, "p") + " */ const x = 2; " + fill(73, "q"), caret: 4 + 30 + " */ const ".length },
    { excerpt: "1 | const x = 1; /* " + fill(70, "p"), caret: 4 + "const ".length },
  ]);
});

test.concurrent("bun install points the caret at the token inside a long package.json line", async () => {
  // The `}` is at column 179 of a 379-byte line. The excerpt starts 40 bytes
  // before it (the caret used to be indented by the full 178 columns), while
  // the `at file:line:col` suffix still reports the real column.
  const { stderr, excerpts } = await printedExcerpts(["install"], {
    "package.json": '{"name":"x",' + fill(150, " ") + '"dependencies": }' + fill(200, " ") + "\n",
  });
  expect(excerpts).toEqual([
    { excerpt: "1 | " + fill(24, " ") + '"dependencies": }', caret: 4 + 24 + '"dependencies": '.length },
  ]);
  expect(stderr).toContain("package.json:1:179");
});

test.concurrent(
  "excerpt of a line following a U+2028 line separator starts at the line's first character",
  async () => {
    // The logger used to slice the line from one byte before its start to pick
    // up (and later trim) a preceding `\n`; after a three-byte U+2028 that byte
    // is a stray UTF-8 continuation byte, which was printed before the text and
    // pushed it one cell to the right of the caret.
    const { excerpts } = await printedExcerpts(["build", "ls.js"], {
      "ls.js": "let a = 1;\u2028let b = 2; ]",
    });
    expect(excerpts).toEqual([{ excerpt: "2 | let b = 2; ]", caret: 4 + "let b = 2; ".length }]);
  },
);

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

// A line of more than 1,000 bytes is not hand-written. Its location keeps an
// excerpt wherever the error is: up to 40 bytes before the error and 80 after
// it, or the last 120 bytes of the line. A shorter line keeps the window limits
// above, so an error in its last 80 bytes keeps the whole line.
const longArray = "[" + fill(80_000, "1,") + "]";

describe.each([["build"], ["run"]])(
  "bun %s prints a bounded excerpt of a line of more than 1,000 bytes",
  subcommand => {
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
      expect(excerpts).toEqual([{ excerpt: "1 | " + source.slice(at - 40, at + 80), caret: 4 + 40 }]);
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
  },
);

test.concurrent.each([
  [1000, "1 | " + fill(999, "a") + "]", 4 + 999, { column: 1000, length: 1000, atColumn: "]" }],
  [1001, "1 | " + fill(119, "a") + "]", 4 + 119, { column: 1001, length: 120, atColumn: undefined }],
])("a line of %d bytes with an error at its end", async (bytes, excerpt, caret, position) => {
  const source = fill(bytes - 1, "a") + "]";
  const { excerpts, exitCode } = await printedExcerpts(["build", "long.js"], { "long.js": source });
  expect(excerpts).toEqual([{ excerpt, caret }]);
  expect(exitCode).toBe(1);

  // What `BuildMessage.position` holds. A reader that indexes `lineText` by
  // `column` finds the token in the line that is kept whole.
  using dir = tempDir("parse-col-position", { "long.js": source });
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const r = await Bun.build({ entrypoints: [${JSON.stringify(join(String(dir), "long.js"))}], throw: false });
       const p = r.logs[0].position;
       console.log(JSON.stringify({ column: p.column, length: p.lineText.length, atColumn: p.lineText[p.column - 1] }));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, built] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ position: JSON.parse(stdout), stderr, exitCode: built }).toEqual({ position, stderr: "", exitCode: 0 });
});

test.concurrent("a note at the end of a line of more than 1,000 bytes prints a bounded excerpt", async () => {
  const first = `var a = ${longArray}; const x = 1;`;
  const { stderr, excerpts, exitCode } = await printedExcerpts(["build", "long.js"], {
    "long.js": first + "\nconst x = 2;\n",
  });
  expect(excerpts).toEqual([
    { excerpt: "2 | const x = 2;", caret: 4 + 6 },
    { excerpt: "1 | " + first.slice(-120), caret: 4 + 120 - "x = 1;".length },
  ]);
  expect(stderr.length).toBeLessThan(1024);
  expect(exitCode).toBe(1);
});

test.concurrent.each([
  // The last 120 bytes start one byte into an `é` or a `名`, and three bytes into a `𐐀`.
  // The caret counts terminal columns: a `名` takes 2, and a `𐐀` takes 1 though it is 2 UTF-16 units.
  ["2-byte", fill(1200, "\u00E9") + "]", "1 | " + fill(120, "\u00E9") + "]", 4 + 60],
  ["3-byte wide", fill(1200, "\u540D") + "]", "1 | " + fill(120, "\u540D") + "]", 4 + 2 * 40],
  ["4-byte", fill(1200, "\u{10400}") + "xy]", "1 | " + fill(120, "\u{10400}") + "xy]", 4 + 30 + 2],
])(
  "excerpt at the end of a long line of %s characters starts on a character and has the caret under the token",
  async (_, source, excerpt, caret) => {
    const { excerpts, exitCode } = await printedExcerpts(["build", "long.js"], { "long.js": source });
    expect(excerpts).toEqual([{ excerpt, caret }]);
    expect(exitCode).toBe(1);
  },
);

describe("bun build prints a bounded excerpt of a CSS line of more than 1,000 bytes", () => {
  // A stray `}` after a rule is an error at the `}`.
  const rules = fill(60_000, "a{color:red}");

  test.concurrent("for an error at its start", async () => {
    const source = "a{color:red}}" + rules;
    const { stderr, excerpts, exitCode } = await printedExcerpts(["build", "long.css"], { "long.css": source });
    expect(excerpts).toEqual([{ excerpt: "1 | " + source.slice(0, 12 + 80), caret: 4 + 12 }]);
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

  test.concurrent("and starts and ends the excerpt on a character", async () => {
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

  test.concurrent("and keeps a line of 1,000 bytes whole", async () => {
    const some = fill(492, "a{color:red}");
    const source = some + "}" + some + "a{color:red}b{}";
    const { excerpts, exitCode } = await printedExcerpts(["build", "long.css"], { "long.css": source });
    expect(source.length).toBe(1000);
    expect(excerpts).toEqual([{ excerpt: "1 | " + source, caret: 4 + 492 }]);
    expect(exitCode).toBe(1);
  });
});

test.concurrent("bun install prints a bounded excerpt of a one-line package.json that is cut short", async () => {
  const source = `{"name":"x","version":"1.0.0","files":[` + fill(80_000, '"a",') + `"a"]`;
  const { stderr, excerpts, exitCode } = await printedExcerpts(["install"], { "package.json": source });
  expect(excerpts).toEqual([{ excerpt: "1 | " + source.slice(-120), caret: 4 + 119 }]);
  expect(stderr.length).toBeLessThan(1024);
  expect(exitCode).toBe(1);
});

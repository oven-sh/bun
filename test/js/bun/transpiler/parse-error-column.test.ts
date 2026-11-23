import { expect, test } from "bun:test";
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
  // `]` at byte 600 of a 1,201-byte line: the window is applied, and its
  // bounds are snapped to UTF-8 char boundaries.
  const half = Buffer.alloc(600, "\u00E9").toString();
  expect(await lineTextWindow(half + "]" + half)).toEqual({
    stdout: `{"column":301,"hasToken":true,"chars":["]","\u00E9"]}`,
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
  // An error in the last 80 bytes of a line is never left-trimmed.
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

// A line over 1,000 bytes is cut when more than 80 bytes start at the error,
// and the cut drops a prefix when more than 40 bytes precede the error.
test.concurrent.each([
  ["a 1,000-byte line is kept whole", fill(100, "a") + "]" + fill(899, "b"), 0, 1000],
  ["a 1,001-byte line is cut", fill(100, "a") + "]" + fill(900, "b"), 60, 180],
  ["80 bytes from the error to the end keep the whole line", fill(1000, "a") + "]" + fill(79, "b"), 0, 1080],
  ["81 bytes from the error to the end cut the line", fill(1000, "a") + "]" + fill(80, "b"), 960, 1080],
  ["40 bytes before the error drop no prefix", fill(40, "a") + "]" + fill(1000, "b"), 0, 120],
  ["41 bytes before the error drop one byte", "c" + fill(40, "a") + "]" + fill(1000, "b"), 1, 121],
])("CLI caret at an excerpt limit: %s", async (_, line, start, end) => {
  const { excerpts } = await printedExcerpts(["build", "long.js"], { "long.js": line });
  expect(excerpts).toEqual([{ excerpt: "1 | " + line.slice(start, end), caret: 4 + line.indexOf("]") - start }]);
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

test.concurrent("bun install points the caret at the token inside a long package.json line", async () => {
  // The `}` is at column 179 of a 1,179-byte line. The excerpt starts 40 bytes
  // before it (the caret used to be indented by the full 178 columns), while
  // the `at file:line:col` suffix still reports the real column.
  const { stderr, excerpts } = await printedExcerpts(["install"], {
    "package.json": '{"name":"x",' + fill(150, " ") + '"dependencies": }' + fill(1000, " ") + "\n",
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

test.concurrent.each([
  ["ASCII", `export const a = "${fill(60, "x")}"; const b = (;${fill(100, "y")}`],
  ["non-ASCII", `export const a = "${fill(120, "\u00E9")}"; const b = (;${fill(100, "y")}`],
])("CLI caret is under the token in the middle of a %s line of 1,000 bytes or less", async (_, line) => {
  const { excerpts } = await printedExcerpts(["build", "line.ts"], { "line.ts": line + "\n" });
  expect(excerpts).toEqual([{ excerpt: "1 | " + line, caret: 4 + line.indexOf("(;") + 1 }]);
});

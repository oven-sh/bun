import { expect, test } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
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
  // `write_format` offsets the caret by `column - 1` with no knowledge of any
  // left-trim, so the window gate must not left-trim this case.
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
  expect({ token: textLine.indexOf("]"), caret: caretLine.indexOf("^") }).toEqual({ token: 154, caret: 154 });
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

// A diagnostic that the logger locates from a byte offset has the same line,
// column and line text for every way to end a line. Each source is written from
// explicit bytes: a fixture file would get LF.
const lineBreaks = { LF: "\n", CRLF: "\r\n", CR: "\r" };

async function diagnostics(file: string, source: string) {
  await Bun.write(file, source);
  const { logs } = await Bun.build({ entrypoints: [file], throw: false });
  return logs.map(({ message, position }) => ({
    message,
    line: position?.line,
    column: position?.column,
    lineText: position?.lineText,
  }));
}

async function diagnosticsPerLineBreak(ext: string, lines: string[], names = Object.keys(lineBreaks)) {
  using dir = tempDir("parse-col-line-breaks", {});
  const found: Record<string, unknown> = {};
  for (const name of names) {
    const lineBreak = lineBreaks[name as keyof typeof lineBreaks];
    found[name] = await diagnostics(join(String(dir), `${name}.${ext}`), lines.join(lineBreak) + lineBreak);
  }
  return found;
}

test.concurrent.each([
  { ext: "js", lines: ["const port = 3000;", "function start() {"], message: "Unexpected end of file", column: 19 },
  { ext: "jsx", lines: ["const port = 3000;", "function start() {"], message: "Unexpected end of file", column: 19 },
  { ext: "ts", lines: ["const port = 3000;", "listen(port,"], message: "Unexpected end of file", column: 13 },
  {
    ext: "tsx",
    lines: ["const port = 3000;", "class Server {"],
    message: 'Expected "}" but found end of file',
    column: 15,
  },
  { ext: "json", lines: ["{", '  "port": 3000,'], message: "Expected string but found end of file", column: 16 },
  {
    ext: "jsonc",
    lines: ["{ // the port", '  "port": 3000,'],
    message: "Expected string but found end of file",
    column: 16,
  },
  { ext: "json5", lines: ["{", "  port: 3000,"], message: "Unexpected end of input", column: 14 },
  // TOML has no lone CR line break. CSS is not here: its tokenizer locates its own errors (test/js/bun/css/).
  {
    ext: "toml",
    lines: ["port = 3000", "hosts = [1,"],
    message: "Unterminated array; expected ']'",
    column: 12,
    names: ["LF", "CRLF"],
  },
  { ext: "yaml", lines: ["port: 3000", "hosts: [1,"], message: "Unexpected token", column: 11 },
  { ext: "xml", lines: ["<config>", "<port>3000"], message: "Missing closing tag for element 'port'", column: 11 },
])(
  "$ext: an error at the end of the file is on the last line for every line break",
  async ({ ext, lines, message, column, names = Object.keys(lineBreaks) }) => {
    const onLastLine = [{ message, line: 2, column, lineText: lines[1] }];
    expect(await diagnosticsPerLineBreak(ext, lines, names)).toEqual(
      Object.fromEntries(names.map(name => [name, onLastLine])),
    );
  },
);

test.concurrent.each([
  ["];", 1],
  ["const host = ];", 14],
])("the column of the error in %j on line 2 counts from 1 for every line break", async (secondLine, column) => {
  const found = [{ message: "Unexpected ]", line: 2, column, lineText: secondLine }];
  expect(await diagnosticsPerLineBreak("js", ["const port = 3000;", secondLine])).toEqual({
    LF: found,
    CRLF: found,
    CR: found,
  });
});

test.concurrent("both errors for an unclosed ${ are on the last line for every line break", async () => {
  // The lexer reports the second one at the last byte of the file, not at its end.
  const lines = ["const port = 3000;", "const url = `http://localhost:${port"];
  const found = ['Expected "}" but found end of file', "Unterminated string literal"].map(message => ({
    message,
    line: 2,
    column: 37,
    lineText: lines[1],
  }));
  expect(await diagnosticsPerLineBreak("js", lines)).toEqual({ LF: found, CRLF: found, CR: found });
});

test.concurrent("an error at the end of the file is not located inside a multi-byte sequence", async () => {
  using dir = tempDir("parse-col-sequence", {});
  const at = (name: string, source: string) => diagnostics(join(String(dir), name), source);
  expect({
    lineSeparator: await at("ls.js", "const port = 3000;\nfunction start() {\u2028"),
    paragraphSeparator: await at("ps.js", "const port = 3000;\nfunction start() {\u2029"),
    lastCharacter: await at("cjk.js", "foo(\u4E2D"),
    lastCharacterTwice: await at("template.js", "const s = `${a\u4E2D"),
  }).toEqual({
    lineSeparator: [{ message: "Unexpected end of file", line: 2, column: 19, lineText: "function start() {" }],
    paragraphSeparator: [{ message: "Unexpected end of file", line: 2, column: 19, lineText: "function start() {" }],
    // With no final line break the error is at the last character, as it is for ASCII.
    lastCharacter: [{ message: 'Expected ")" but found end of file', line: 1, column: 5, lineText: "foo(\u4E2D" }],
    lastCharacterTwice: [
      { message: 'Expected "}" but found end of file', line: 1, column: 15, lineText: "const s = `${a\u4E2D" },
      { message: "Unterminated string literal", line: 1, column: 15, lineText: "const s = `${a\u4E2D" },
    ],
  });
});

const braceLeftOpenCRLF = "const port = 3000;\r\nfunction start() {\r\n";

test.concurrent("Bun.Transpiler and import() locate the end of a CR LF source on its last line", async () => {
  using dir = tempDir("parse-col-crlf-import", { "crlf.js": braceLeftOpenCRLF });
  const position = (thrown: any) => {
    const { line, column, lineText } = (thrown.errors?.[0] ?? thrown).position;
    return { line, column, lineText };
  };
  let transformed, imported;
  try {
    new Bun.Transpiler({ loader: "js" }).transformSync(braceLeftOpenCRLF);
  } catch (thrown) {
    transformed = position(thrown);
  }
  try {
    await import(join(String(dir), "crlf.js"));
  } catch (thrown) {
    imported = position(thrown);
  }
  const onLastLine = { line: 2, column: 19, lineText: "function start() {" };
  expect({ transformed, imported }).toEqual({ transformed: onLastLine, imported: onLastLine });
});

test.concurrent.each(["build", "run"])(
  "bun %s prints the last line of a CR LF file for a brace left open",
  async command => {
    using dir = tempDir("parse-col-crlf-cli", { "crlf.js": braceLeftOpenCRLF });
    await using proc = Bun.spawn({
      cmd: [bunExe(), command, "crlf.js"],
      env: { ...bunEnv, NO_COLOR: "1" },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, frame: normalizeBunSnapshot(stderr, String(dir)).split("\n").slice(0, 4), exitCode }).toEqual({
      stdout: "",
      frame: [
        "2 | function start() {",
        "                      ^",
        "error: Unexpected end of file",
        "    at <dir>/crlf.js:2:19",
      ],
      exitCode: 1,
    });
  },
);

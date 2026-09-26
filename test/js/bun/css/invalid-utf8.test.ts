import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

// CSS source files whose bytes are not well-formed UTF-8. css-syntax-3 §3.2
// decodes the byte stream (U+FFFD for each ill-formed sequence) before
// tokenizing, so no such byte may reach the emitted stylesheet, a diagnostic,
// or an import specifier. The tokenizer is a port of rust-cssparser, which
// takes `&str`; bun feeds it `&[u8]`, so the decode has to happen at load.

/** Template tag: each `${n}` is spliced in as the single byte `n`. */
const raw = (strings: TemplateStringsArray, ...bytes: number[]) =>
  Buffer.concat(strings.flatMap((s, i) => [Buffer.from(s), Buffer.from(i < bytes.length ? [bytes[i]] : [])]));

// One stylesheet covering each way a raw byte used to leak or corrupt output:
//   .a  inside a quoted string, and inside a font-family that prints as an ident
//   .b  a continuation byte at the start of a token
//   .c .d  right after a backslash: the escape decoder advanced by the width
//       of U+FFFD (3) instead of the 1 byte it replaced, eating `yz`, `x ` and
//       the closing quote (which swallowed the rest of .d) after it
const sheet = raw`.a::before { content: "caf${0xe9}${0xff}"; font-family: "F${0xf8}nt"; }
.b { color: red ${0xaf}; }
.c\\${0xc3}yz { content: "\\${0xc3}x AFTER"; }
.d { content: "\\${0xc3}"; color: green; }
`;

const decoder = new TextDecoder("utf-8", { fatal: true });

// The decode changes what the author wrote, so it says so once per file, at
// the first replaced sequence (`sheet`: line 1, the 0xE9 after `"caf`).
const replacedWarning = "warn: This file is not valid UTF-8, each invalid byte sequence was replaced with U+FFFD";

async function build(files: Record<string, string | Buffer>, args: string[]) {
  using dir = tempDir("css-invalid-utf8", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", ...args],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
  // Whatever `--outdir=out` produced, keyed by name with the content hash dropped
  // (`index-abc123.css` -> `index.css`). Empty when the build wrote nothing;
  // callers assert on `stderr` first so a failed build shows its diagnostic.
  const out: Record<string, Uint8Array> = {};
  const outDir = join(String(dir), "out");
  for (const name of existsSync(outDir) ? readdirSync(outDir) : []) {
    out[name.replace(/-[a-z0-9]+\./, ".")] = await Bun.file(join(outDir, name)).bytes();
  }
  return { stdout, stderr, exitCode, out };
}

function expectDecodedSheet(bytes: Uint8Array | undefined) {
  expect(bytes).toBeDefined();
  // Throws on any ill-formed sequence: the output must be valid UTF-8.
  const css = decoder.decode(bytes).replaceAll(/\s+/g, "");
  expect(css).toContain(`content:"caf\uFFFD\uFFFD"`);
  expect(css).toContain(`font-family:F\uFFFDnt`);
  expect(css).toContain(`red\uFFFD`);
  expect(css).toContain(`.c\uFFFDyz{`);
  expect(css).toContain(`content:"\uFFFDxAFTER"`);
  expect(css).toContain(`.d{content:"\uFFFD";color:green`);
}

describe.concurrent("ill-formed bytes are decoded to U+FFFD before tokenizing", () => {
  test("bun build x.css", async () => {
    const { stderr, exitCode, out } = await build({ "in.css": sheet }, ["./in.css", "--outdir=out"]);
    expect(stderr).not.toContain("error");
    expect(stderr).toContain(replacedWarning);
    expect(stderr).toContain("in.css:1:27");
    expectDecodedSheet(out["in.css"]);
    expect(exitCode).toBe(0);
  });

  test("bun build --minify x.css", async () => {
    const { stderr, exitCode, out } = await build({ "in.css": sheet }, ["./in.css", "--minify", "--outdir=out"]);
    expect(stderr).not.toContain("error");
    expectDecodedSheet(out["in.css"]);
    expect(exitCode).toBe(0);
  });

  test("bun build --no-bundle x.css", async () => {
    const { stdout, stderr, exitCode } = await build({ "in.css": sheet }, ["--no-bundle", "./in.css"]);
    expect(stderr).not.toContain("error");
    expect(stderr).toContain(replacedWarning);
    expect(stderr).toContain("in.css:1:27");
    expectDecodedSheet(stdout);
    expect(exitCode).toBe(0);
  });

  test("css chunk of an html entrypoint", async () => {
    const { stderr, exitCode, out } = await build(
      {
        "in.css": sheet,
        "index.html": `<!doctype html><html><head><link rel="stylesheet" href="./in.css"></head><body></body></html>`,
      },
      ["./index.html", "--outdir=out"],
    );
    expect(stderr).not.toContain("error");
    expectDecodedSheet(out["index.css"]);
    expect(exitCode).toBe(0);
  });

  test("a declared @charset that is not UTF-8 is named in the warning", async () => {
    // `@charset` is never honoured. A Latin-1 sheet used to pass its bytes
    // through by accident, so the warning says why its text changed.
    const { stderr, exitCode, out } = await build(
      { "in.css": raw`@charset "ISO-8859-1";\n.a::before { content: "caf${0xe9}"; }\n` },
      ["./in.css", "--outdir=out"],
    );
    expect(stderr).not.toContain("error");
    expect(stderr).toContain(
      `warn: @charset "ISO-8859-1" was ignored, this file was read as UTF-8 and each invalid byte sequence was replaced with U+FFFD`,
    );
    expect(stderr).toContain("in.css:2:27");
    expect(decoder.decode(out["in.css"]).replaceAll(/\s+/g, "")).toEndWith(`.a:before{content:"caf\uFFFD";}`);
    expect(exitCode).toBe(0);
  });

  test("a sheet the decode leaves unchanged gets no warning", async () => {
    const { stderr, exitCode, out } = await build(
      { "in.css": `@charset "ISO-8859-1";\n.a::before { content: "caf\u00e9"; }\n` },
      ["./in.css", "--outdir=out"],
    );
    expect(stderr).not.toContain("warn");
    expect(decoder.decode(out["in.css"]).replaceAll(/\s+/g, "")).toEndWith(`.a:before{content:"caf\u00e9";}`);
    expect(exitCode).toBe(0);
  });

  test("@import and url() specifiers report resolve errors", async () => {
    // The raw byte used to reach the resolve-error formatter, which renders
    // the specifier lossily and then searched the message for the original
    // bytes: `panic: unreachable` instead of a diagnostic.
    const { stderr, exitCode } = await build(
      { "in.css": raw`@import "./dep${0xe9}.css"; .a { background: url(./img${0xe2}.png) }` },
      ["./in.css", "--outdir=out"],
    );
    expect(stderr).toContain(`Could not resolve: "./dep\uFFFD.css"`);
    expect(stderr).toContain(`Could not resolve: "./img\uFFFD.png"`);
    expect(exitCode).toBe(1);
  });

  test("Bun.build reports the warning with its position", async () => {
    using dir = tempDir("css-invalid-utf8", { "in.css": raw`.a {}\n.b::before { content: "caf${0xe9}"; }\n` });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const r = await Bun.build({ entrypoints: ["./in.css"], throw: false });
         const logs = r.logs.map(l => ({ level: l.level, message: l.message, ...l.position }));
         console.log(JSON.stringify({ success: r.success, logs }));`,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const result = JSON.parse(stdout);
    for (const log of result.logs) log.file = basename(log.file);
    expect(result).toEqual({
      success: true,
      logs: [
        {
          level: "warn",
          message: replacedWarning.slice("warn: ".length),
          file: "in.css",
          namespace: "file",
          // `.a {}\n` is 6 bytes, then 26 bytes of `.b::before { content: "caf`.
          line: 2,
          column: 27,
          offset: 32,
          length: 3,
          lineText: `.b::before { content: "caf\uFFFD"; }`,
        },
      ],
    });
    expect(exitCode).toBe(0);
  });

  test("each ill-formed shape gets one warning, at its first replaced sequence", async () => {
    const plain = replacedWarning.slice("warn: ".length);
    const ignored = (label: string) =>
      `@charset "${label}" was ignored, this file was read as UTF-8 and each invalid byte sequence was replaced with U+FFFD`;
    // ASCII, so its length is both the bytes and the UTF-16 units in front of what follows it.
    const head = '.a::before{content:"ab';
    const tail = 'cd"}\n';

    type Sheet = { bytes: Buffer; message: string; line: number; column: number; offset: number; css: string };
    const sheets: Record<string, Sheet> = {
      // A sync tool cut the file in the middle of a 3-byte character.
      "file that ends inside a character": {
        bytes: raw`.a{color:red}/*${0xe2}${0x82}`,
        message: plain,
        line: 1,
        column: 16,
        offset: 15,
        css: "color: red",
      },
    };
    // Bytes put between `head` and `tail`, what they decode to (one U+FFFD for each maximal ill-formed
    // sequence), and how many bytes and UTF-16 units of them come before the first ill-formed byte.
    const inString: [name: string, bytes: number[], decoded: string, bytesBefore?: number, unitsBefore?: number][] = [
      ["continuation byte with no lead byte", [0x80], "\uFFFD"],
      ["two continuation bytes", [0x80, 0xbf], "\uFFFD\uFFFD"],
      ["byte that no sequence contains", [0xff], "\uFFFD"],
      ["lead byte followed by ASCII", [0xc3], "\uFFFD"],
      ["overlong 2-byte form", [0xc0, 0xaf], "\uFFFD\uFFFD"],
      ["3-byte sequence cut after 2 bytes", [0xe2, 0x82], "\uFFFD"],
      ["overlong 3-byte form", [0xe0, 0x80, 0x80], "\uFFFD\uFFFD\uFFFD"],
      ["surrogate", [0xed, 0xa0, 0x80], "\uFFFD\uFFFD\uFFFD"],
      ["4-byte sequence cut after 3 bytes", [0xf0, 0x9f, 0x98], "\uFFFD"],
      ["code point above U+10FFFF", [0xf4, 0x90, 0x80, 0x80], "\uFFFD\uFFFD\uFFFD\uFFFD"],
      ["after a 2-byte character", [0xc3, 0xa9, 0xe9], "\u00e9\uFFFD", 2, 1],
      ["after a 4-byte character", [0xf0, 0x9f, 0x98, 0x80, 0xff], "\u{1F600}\uFFFD", 4, 2],
    ];
    for (const [name, bytes, decoded, bytesBefore = 0, unitsBefore = 0] of inString) {
      sheets[name] = {
        bytes: Buffer.concat([Buffer.from(head), Buffer.from(bytes), Buffer.from(tail)]),
        message: plain,
        line: 1,
        column: head.length + unitsBefore + 1,
        offset: head.length + bytesBefore,
        css: `content: "ab${decoded}cd"`,
      };
    }
    // A label of UTF-8 and an empty label declare nothing that was ignored.
    const charsets: [label: string, message: string][] = [
      ["windows-1252", ignored("windows-1252")],
      ["utf-16", ignored("utf-16")],
      ["no-such-encoding", ignored("no-such-encoding")],
      ["utf8", plain],
      [" UTF-8 ", plain],
      ["", plain],
    ];
    for (const [label, message] of charsets) {
      const rule = `@charset "${label}";\n`;
      sheets[`@charset "${label}"`] = {
        bytes: Buffer.concat([Buffer.from(rule + head), Buffer.from([0xe9]), Buffer.from(tail)]),
        message,
        line: 2,
        column: head.length + 1,
        offset: rule.length + head.length,
        css: `content: "ab\uFFFDcd"`,
      };
    }

    const names = Object.keys(sheets);
    using dir = tempDir(
      "css-invalid-utf8",
      Object.fromEntries(names.map((name, i) => [`s${i}.css`, sheets[name].bytes])),
    );
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `import { basename } from "node:path";
         const entrypoints = [...new Bun.Glob("s*.css").scanSync(".")].map(file => "./" + file);
         const r = await Bun.build({ entrypoints, outdir: "out", throw: false });
         const logs = r.logs.map(({ level, message, position: p }) =>
           ({ file: basename(p.file), level, message, line: p.line, column: p.column, offset: p.offset }));
         console.log(JSON.stringify({ success: r.success, logs }));`,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const { success, logs } = JSON.parse(stdout);

    const actual: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const [i, name] of names.entries()) {
      const { message, line, column, offset, css } = sheets[name];
      // Throws on any ill-formed sequence: the output must be valid UTF-8.
      const out = decoder.decode(await Bun.file(join(String(dir), "out", `s${i}.css`)).bytes());
      actual[name] = {
        warnings: logs.filter(log => log.file === `s${i}.css`).map(({ file, ...rest }) => rest),
        css: out.includes(css) ? css : out,
      };
      expected[name] = { warnings: [{ level: "warn", message, line, column, offset }], css };
    }
    expect({ success, sheets: actual }).toEqual({ success: true, sheets: expected });
    expect(exitCode).toBe(0);
  });

  test("Bun.build reports the resolve error on a ResolveMessage", async () => {
    using dir = tempDir("css-invalid-utf8", { "in.css": raw`@import url("./dep${0xe2}x.css");` });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const r = await Bun.build({ entrypoints: ["./in.css"], throw: false });
         const l = r.logs.find(l => l.name === "ResolveMessage");
         console.log(JSON.stringify({ success: r.success, name: l?.name, message: l?.message }));`,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const log = JSON.parse(stdout);
    // `ResolveMessage.message` decodes its text as Latin-1 today (pre-existing,
    // reproducible with `import "./café.js"`), so only the ASCII around the
    // replacement character is asserted.
    expect(log).toMatchObject({ success: false, name: "ResolveMessage" });
    expect(log.message).toStartWith(`Could not resolve: "./dep`);
    expect(log.message).toEndWith(`x.css"`);
    expect(exitCode).toBe(0);
  });
});

// Columns after stray 0xF0..0xFF bytes. The tokenizer keeps a UTF-16 column
// adjustment in `current_line_start_position` via wrapping_sub(1) for 4-byte
// lead bytes, relying on the three continuation bytes of a valid sequence to
// add it back. A lone lead byte used to wrap the line-start to usize::MAX:
// overflow-checked builds panicked on the later `position - line_start`, and
// release builds reported a column past the end of the file.

async function buildColumn(bytes: number[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  using dir = tempDir("css-invalid-utf8", {});
  const css = join(String(dir), "in.css");
  await Bun.write(css, new Uint8Array(bytes));
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const r = await Bun.build({ entrypoints: [${JSON.stringify(css)}], throw: false });
       const p = r.logs.find(l => l.level === "error")?.position;
       console.log(JSON.stringify({ line: p?.line, column: p?.column }));`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

test.concurrent("lone 0xF0 byte reports column 2, not 3, and does not panic", async () => {
  // One byte in the file: the parse error at EOF is column 2. Previously the
  // wrapped line-start made this column 3 (release) or aborted the process
  // (overflow-checked debug); either failure shows up in this diff.
  expect(await buildColumn([0xf0])).toEqual({
    stdout: `{"line":1,"column":2}`,
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("three stray 0xF0 bytes report column 4, not 7", async () => {
  expect(await buildColumn([0xf0, 0xf0, 0xf0])).toEqual({
    stdout: `{"line":1,"column":4}`,
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("stray 0xF0 on a non-first line does not skew the column", async () => {
  // "a{}\n" puts the stray byte at the start of line 2 where the true line
  // start is non-zero, exercising the same bookkeeping without the position-0
  // edge case.
  expect(await buildColumn([...Buffer.from("a{}\n"), 0xf0])).toEqual({
    stdout: `{"line":2,"column":2}`,
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("valid 4-byte UTF-8 still counts as two UTF-16 columns", async () => {
  // U+1F600 GRINNING FACE: a well-formed 4-byte sequence is a surrogate pair in
  // UTF-16, so EOF after it is column 3. This must not regress.
  expect(await buildColumn([0xf0, 0x9f, 0x98, 0x80])).toEqual({
    stdout: `{"line":1,"column":3}`,
    stderr: "",
    exitCode: 0,
  });
});

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// CSS source files whose bytes are not well-formed UTF-8. css-syntax-3 §3.3
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
  const out: Record<string, Uint8Array> = {};
  try {
    for (const name of readdirSync(join(String(dir), "out"))) {
      out[name.replace(/-[a-z0-9]+\./, ".")] = await Bun.file(join(String(dir), "out", name)).bytes();
    }
  } catch {}
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

  test("Bun.build reports the resolve error on a ResolveMessage", async () => {
    using dir = tempDir("css-invalid-utf8", { "in.css": raw`@import url("./dep${0xe2}x.css");` });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const r = await Bun.build({ entrypoints: ["./in.css"], throw: false });
         const l = r.logs[0];
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

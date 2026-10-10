import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
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

test("lineText is the line of the error, or 40 bytes before it and 80 after it when the line goes on", () => {
  let seed = 0x9e3779b9;
  const random = (below: number) => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed % below;
  };
  const characters = ["a", "b", " ", "\u00E9", "\u4E2D", "\u{1F600}"];
  const item = () => {
    let text = "";
    for (let length = random(60); length > 0; length--) text += characters[random(characters.length)];
    return JSON.stringify(text) + (random(4) === 0 ? ",\n" : ",");
  };
  const transpiler = new Bun.Transpiler();
  const decoder = new TextDecoder();

  for (let i = 0; i < 150; i++) {
    // An array of strings on lines of many lengths, with a stray `@` between two of them.
    let text = "[";
    for (let before = random(12); before > 0; before--) text += item();
    text += "@";
    for (let after = random(6); after > 0; after--) text += item();
    const source = Buffer.from(text);

    let position: BuildMessage["position"] = null;
    try {
      transpiler.transformSync(source, "json");
    } catch (e) {
      position = (e as BuildMessage).position;
    }
    // The error is on the byte after the `@`, or on the `@` when the source ends there.
    expect(position!.offset).toBe(source.indexOf("@") + 1);
    const offset = Math.min(position!.offset, source.length - 1);

    let start = offset === 0 ? 0 : source.lastIndexOf("\n", offset - 1) + 1;
    let end = source.indexOf("\n", offset);
    if (end === -1) end = source.length;
    if (end - offset > 80) {
      start = Math.max(start, offset - 40);
      end = offset + 80;
      while ((source[start] & 0xc0) === 0x80) start--;
      while ((source[end] & 0xc0) === 0x80) end++;
    }
    expect(position!.lineText).toBe(decoder.decode(source.subarray(start, end)));
  }
});

// A line that no one has read: `{"a":1,]`, then NUL bytes that nothing wrote,
// so each page of them costs its first reader a minor page fault. The line is
// 8192 pages of 4 KiB, or 2048 of 16 KiB. Windows does not count these faults.
const LONG_LINE = 32 * 1024 * 1024;
const FEW_PAGES = 1024;

test.concurrent("an error at the start of a long line does not read the rest of the line", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
        const transpiler = new Bun.Transpiler();
        const results = {};
        // The lines stay referenced, so that none is made of the pages of an earlier one.
        const lines = [];
        for (const loader of ["json", "jsonc", "json5", "yaml"]) {
          const line = new Uint8Array(${LONG_LINE});
          line.set(Buffer.from('{"a":1,]'));
          lines.push(line);
          // Page in the parser and the logger, so that the count is for the line.
          try { transpiler.transformSync("{]", loader); } catch {}
          const before = process.resourceUsage().minorPageFault;
          try {
            transpiler.transformSync(line, loader);
            results[loader] = "no error";
          } catch (e) {
            const faults = process.resourceUsage().minorPageFault - before;
            const { line, column, lineText } = e.position;
            results[loader] = { line, column, lineText, ${isWindows ? "" : `readsLittle: faults < ${FEW_PAGES}`} };
          }
        }
        console.log(JSON.stringify(results, null, 2));
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The error is on the 8th byte (JSON5: the 9th), and 80 bytes follow it.
  const excerpt = '{"a":1,]' + Buffer.alloc(79).toString();
  const readsLittle = isWindows ? {} : { readsLittle: true };
  expect({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode }).toEqual({
    stdout: JSON.stringify(
      {
        json: { line: 1, column: 8, lineText: excerpt, ...readsLittle },
        jsonc: { line: 1, column: 8, lineText: excerpt, ...readsLittle },
        json5: { line: 1, column: 9, lineText: excerpt + "\0", ...readsLittle },
        yaml: { line: 1, column: 8, lineText: excerpt, ...readsLittle },
      },
      null,
      2,
    ),
    stderr: "",
    exitCode: 0,
  });
});

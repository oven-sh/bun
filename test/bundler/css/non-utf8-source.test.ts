import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The CSS tokenizer requires well-formed UTF-8. Raw non-UTF-8 bytes in a
// stylesheet (Latin-1, truncated sequences, mixed encodings) must be decoded
// with U+FFFD replacement like browsers do, not crash the bundler or flow
// through into the output verbatim.
async function buildCss(files: Record<string, string | Buffer>) {
  using dir = tempDir("css-non-utf8", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "./entry.css", "--outdir", "dist"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const outFile = Bun.file(`${dir}/dist/entry.css`);
  const outBytes = (await outFile.exists()) ? new Uint8Array(await outFile.arrayBuffer()) : null;
  const outText = outBytes === null ? null : new TextDecoder().decode(outBytes);
  return { stdout, stderr, exitCode, outBytes, outText };
}

const latin1 = (text: string) => Buffer.from(text, "latin1");

describe("css bundling of non-UTF-8 sources", () => {
  test("raw Latin-1 byte inside a string value becomes U+FFFD in the output", async () => {
    // 0xAF (Latin-1 macron) is a UTF-8 continuation byte: the file is not
    // valid UTF-8.
    const { outBytes, outText, exitCode } = await buildCss({ "entry.css": latin1('.a { content: "x\xafy" }\n') });
    expect(outText).toContain('content: "x\uFFFDy"');
    expect(outBytes?.includes(0xaf)).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("raw Latin-1 byte at a token start in a declaration value does not abort", async () => {
    const { outBytes, outText, exitCode } = await buildCss({ "entry.css": latin1(".a { color: red \xaf}\n") });
    expect(outText).toContain(".a {");
    expect(outBytes?.includes(0xaf)).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("raw Latin-1 byte in an @property initial-value reports a normal parse error", async () => {
    // `\uFFFD1px` does not match `syntax: "<length>"`, so the rule is invalid:
    // the same diagnostic an ASCII-only invalid initial-value produces.
    const { stderr, exitCode } = await buildCss({
      "entry.css": latin1(
        '@property --x { syntax: "<length>"; inherits: false; initial-value:\xbd1px; }\n.a { color: red }\n',
      ),
    });
    expect(stderr).toContain("error: Unexpected token: \uFFFD1px");
    expect(exitCode).toBe(1);
  });

  test("non-UTF-8 bytes reached through @import are decoded too", async () => {
    const { outBytes, outText, exitCode } = await buildCss({
      "entry.css": '@import "./bad.css";\n.b { color: blue }\n',
      "bad.css": latin1('.a { content: "\xaf" }\n'),
    });
    expect(outText).toContain('content: "\uFFFD"');
    expect(outText).toContain(".b {");
    expect(outBytes?.includes(0xaf)).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("--no-bundle (single-file transform) decodes non-UTF-8 CSS too", async () => {
    // `bun build --no-bundle` takes a separate path into the CSS parser than
    // the bundler does.
    using dir = tempDir("css-non-utf8-no-bundle", { "entry.css": latin1(".a { color: red \xaf}\n") });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "--no-bundle", "./entry.css"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [outRaw, stderr, exitCode] = await Promise.all([proc.stdout.bytes(), proc.stderr.text(), proc.exited]);
    const outText = new TextDecoder().decode(outRaw);
    expect(outText).toContain(".a {");
    expect(outRaw.includes(0xaf)).toBe(false);
    expect(exitCode).toBe(0);
  });

  test("well-formed multi-byte UTF-8 is preserved byte for byte", async () => {
    const source = '.intl::after { content: "héllo 日本 🎉" }\n';
    const { outText, exitCode } = await buildCss({ "entry.css": Buffer.from(source, "utf8") });
    expect(outText).toContain('content: "héllo 日本 🎉"');
    expect(outText).not.toContain("\uFFFD");
    expect(exitCode).toBe(0);
  });
});

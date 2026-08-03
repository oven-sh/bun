import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Tagged template cooked strings round-trip through the runtime transpiler.
test("template literal", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", join(import.meta.dir, "template-literal-fixture-test.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  expect(exitCode).toBe(0);
  expect(stdout.toString()).toBe(
    // This is base64 encoded contents of the template literal
    // this narrows down the test to the transpiler instead of the runtime
    "8J+QsDEyMzEyM/CfkLDwn5Cw8J+QsPCfkLDwn5Cw8J+QsDEyM/CfkLAxMjPwn5CwMTIzMTIz8J+QsDEyM/CfkLAxMjPwn5CwLPCfkLB0cnVl",
  );
});

// The runtime transpiler must not rewrite non-ASCII characters inside tagged
// template raw contents or regex literal patterns: both are observable at
// runtime via `.raw` / `.source`.
// https://github.com/oven-sh/bun/issues/8745
// https://github.com/oven-sh/bun/issues/18115
// https://github.com/oven-sh/bun/issues/15492
// https://github.com/oven-sh/bun/issues/16763
// https://github.com/oven-sh/bun/issues/8207
// https://github.com/oven-sh/bun/issues/13853
// https://github.com/oven-sh/bun/issues/33930
async function run(code: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("RegExp literal .source preserves non-ASCII", () => {
  test.each([
    ["latin1 range", "/café/u", "café"],
    ["BMP", "/中文/u", "中文"],
    ["BOM", "/a\uFEFFb/u", "a\uFEFFb"],
    ["astral", "/a🐰b/u", "a🐰b"],
  ])("%s", async (_name, literal, source) => {
    const { stdout, stderr, exitCode } = await run(
      `const r = ${literal}; process.stdout.write(JSON.stringify([r.source, r.source.length, String(r)]));`,
    );
    expect({ stdout, stderr }).toEqual({
      stdout: JSON.stringify([source, source.length, `/${source}/u`]),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test("new RegExp(literal.source, literal.flags) round-trips", async () => {
    const { stdout, stderr, exitCode } = await run(
      `const a = /café-中/u; const b = new RegExp(a.source, a.flags); ` +
        `process.stdout.write(JSON.stringify([a.source === b.source, String(a) === String(b), b.test("xxcafé-中xx")]));`,
    );
    expect({ stdout, stderr }).toEqual({ stdout: JSON.stringify([true, true, true]), stderr: "" });
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/13853
  // parsel-js widens a regex via re.source.replace("(?<argument>¶*)", ...); when
  // the transpiler escapes ¶ to \u00B6 the replace never matches and puppeteer's
  // ::-p-* selector arguments come back empty.
  test("parsel-js .source.replace on literal ¶ (#13853)", async () => {
    const { stdout, stderr, exitCode } = await run(
      `const re = /::(?<name>[-\\w\\P{ASCII}]+)(?:\\((?<argument>¶*)\\))?/gu;` +
        `const widened = re.source.replace("(?<argument>¶*)", "(?<argument>.*)");` +
        `process.stdout.write(JSON.stringify([re.source.includes("(?<argument>\\xB6*)"), widened.includes(".*"), re.source]));`,
    );
    expect({ stdout, stderr }).toEqual({
      stdout: JSON.stringify([true, true, "::(?<name>[-\\w\\P{ASCII}]+)(?:\\((?<argument>¶*)\\))?"]),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // https://github.com/oven-sh/bun/issues/33930
  // Raw control bytes (0x00-0x1F) in a regex literal must come through as one
  // code point in .source, not the six-character \uNNNN escape text. Uses a
  // file because argv is NUL-terminated.
  test("raw NUL and control bytes (#33930)", async () => {
    using dir = tempDir("regex-source-control", {
      "entry.js":
        `const nul = /` +
        "\x00" +
        `HFMASK(\\d+)` +
        "\x00" +
        `/g;\n` +
        `const ctrl = /a` +
        "\x01\x1f" +
        `b/;\n` +
        `process.stdout.write(JSON.stringify({\n` +
        `  nul: [...nul.source].map(c => c.codePointAt(0)),\n` +
        `  nulLen: nul.source.length,\n` +
        `  match: nul.test("\\x00HFMASK42\\x00"),\n` +
        `  ctrl: [...ctrl.source].map(c => c.codePointAt(0)),\n` +
        `  ctrlLen: ctrl.source.length,\n` +
        `}));\n`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "entry.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({
      stdout: JSON.stringify({
        nul: [0, 72, 70, 77, 65, 83, 75, 40, 92, 100, 43, 41, 0],
        nulLen: 13,
        match: true,
        ctrl: [97, 1, 31, 98],
        ctrlLen: 4,
      }),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("tagged template .raw preserves non-ASCII", () => {
  test.each([
    ["latin1 range", "Redémarrage"],
    ["BMP", "before中after"],
    ["astral", "æ™弟気👋"],
  ])("%s", async (_name, value) => {
    const { stdout, stderr, exitCode } = await run(
      `process.stdout.write(JSON.stringify([String.raw\`${value}\`, String.raw\`${value}\`.length]));`,
    );
    expect({ stdout, stderr }).toEqual({ stdout: JSON.stringify([value, value.length]), stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("String.raw iterates code points (#18115)", async () => {
    const { stdout, stderr, exitCode } = await run(
      `const text = String.raw\`a中\`; const chars = []; for (const c of text) chars.push(c); ` +
        `process.stdout.write(JSON.stringify(chars));`,
    );
    expect({ stdout, stderr }).toEqual({ stdout: JSON.stringify(["a", "中"]), stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("substitutions between non-ASCII", async () => {
    const { stdout, stderr, exitCode } = await run(`process.stdout.write(String.raw\`中\${"x"}弟\${"y"}気\`);`);
    expect({ stdout, stderr }).toEqual({ stdout: "中x弟y気", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test(".raw matches source, cooked is unchanged", async () => {
    const { stdout, stderr, exitCode } = await run(
      `const tag = (s) => JSON.stringify({ raw: s.raw[0], cooked: s[0] }); process.stdout.write(tag\`é\\n中\`);`,
    );
    expect({ stdout, stderr }).toEqual({ stdout: JSON.stringify({ raw: "é\\n中", cooked: "é\n中" }), stderr: "" });
    expect(exitCode).toBe(0);
  });
});

test("bun build --target=bun preserves non-ASCII in regex/raw templates", async () => {
  using dir = tempDir("nonascii-regex-template", {
    "index.ts": [
      `const r = /café-中-🐰/u;`,
      `const raw = String.raw\`é中🐰\`;`,
      `process.stdout.write(JSON.stringify([r.source, r.source.length, raw, raw.length]));`,
    ].join("\n"),
  });

  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--target=bun", "--outfile", String(dir) + "/out.js", String(dir) + "/index.ts"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, buildErr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
  expect(buildErr).not.toContain("error");
  expect(buildExit).toBe(0);

  const out = await Bun.file(String(dir) + "/out.js").text();
  expect(out).not.toMatch(/\\u00E9/i);
  expect(out).not.toMatch(/\\u4E2D/i);
  expect(out).toContain("café-中-🐰");

  await using proc = Bun.spawn({
    cmd: [bunExe(), String(dir) + "/out.js"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({
    stdout: JSON.stringify(["café-中-🐰", "café-中-🐰".length, "é中🐰", "é中🐰".length]),
    stderr: "",
  });
  expect(exitCode).toBe(0);
});

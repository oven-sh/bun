import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync, statSync } from "node:fs";
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

// Ill-formed UTF-8 in verbatim text is decoded by the same routine the lexer
// decodes string literals with, so whatever policy the lexer has for a byte
// sequence (#38262 is making it U+FFFD per maximal subpart, like node), the
// regex source and the raw text built from the same bytes must come out equal
// to a string literal built from them. This pins the two paths to each other
// rather than to a particular policy. (Files written by `bun build` keep the
// bytes and are decoded with replacement by whoever loads them, which only
// differs for WTF-8 encoded surrogates; that path is not covered here.)
describe.concurrent("ill-formed bytes in verbatim text decode like a string literal", () => {
  test.each([
    ["stray continuation byte", [0xa9]],
    ["truncated sequence followed by ASCII", [0xe4, 0xb8, 0x78]],
    ["overlong encoding", [0xc0, 0x80]],
    ["encoded surrogate", [0xed, 0xa0, 0x80]],
    ["byte that cannot start a sequence", [0xff]],
  ])("%s", async (_name, bytes) => {
    const bad = Buffer.from(bytes);
    const wrap = (before: string, after: string) => Buffer.concat([Buffer.from(before), bad, Buffer.from(after)]);
    using dir = tempDir("ill-formed-verbatim", {
      "entry.js": Buffer.concat([
        wrap("const literal = 'a", "b';\n"),
        wrap("const source = /a", "b/.source;\n"),
        wrap("const raw = ((s) => s.raw[0])`a", "b`;\n"),
        Buffer.from(
          "const units = (s) => [...s].map(c => c.codePointAt(0));\n" +
            "process.stdout.write(JSON.stringify([units(literal), source === literal, raw === literal]));\n",
        ),
      ]),
    });
    const { stdout, stderr, exitCode } = await runIn(String(dir), ["entry.js"]);
    expect(stderr).toBe("");
    const [literal, sourceMatches, rawMatches] = JSON.parse(stdout);
    // The literal itself is the lexer's reading of the bytes; only its shape
    // is asserted, the policy belongs to the lexer.
    expect(literal[0]).toBe(0x61);
    expect(literal.at(-1)).toBe(0x62);
    expect({ sourceMatches, rawMatches, literal }).toEqual({ sourceMatches: true, rawMatches: true, literal });
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

// When printing for the runtime the printer writes 8-bit (Latin-1) output and
// widens the whole buffer to UTF-16 at the first code point above U+00FF, so
// every path that hands transpiler output to JSC has an 8-bit arm and a 16-bit
// arm; `// @bun` files skip the printer and are decoded from UTF-8. The same
// module goes through each of those paths here with text of each class; a path
// that reads the wrong width shows up as mojibake or garbage. `body` must
// define `values`.
//
// The `padded-*` modules are large enough (MINIMUM_CACHE_SIZE is 4 KiB) to be
// stored in the on-disk transpiler cache.
const padding = "// " + Buffer.alloc(8 * 1024, "x").toString() + "\n";
function probeFiles(body: string) {
  const print = `process.stdout.write(JSON.stringify(values));\nprocess.exit(0);\n`;
  return {
    "main.js": body + print,
    "padded-main.js": padding + body + print,
    "pragma-main.js": "// @bun\n" + body + print,
    "probe.mjs": body + "export default values;\n",
    "padded-probe.mjs": padding + body + "export default values;\n",
    "pragma-probe.mjs": "// @bun\n" + body + "export default values;\n",
    "probe.cjs": body + "module.exports = values;\n",
    "import.mjs": `import values from "./probe.mjs";\n` + print,
    "import-pragma.mjs": `import values from "./pragma-probe.mjs";\n` + print,
    "require.cjs": `const values = require("./probe.cjs");\n` + print,
    "empty.js": "",
    "import-empty.mjs": `import "./empty.js";\nimport values from "./probe.mjs";\n` + print,
    "import-padded.mjs": `import "./empty.js";\nimport values from "./padded-probe.mjs";\n` + print,
  };
}

function probe(text: string) {
  const body = `
const re = /${text}/u;
const raw = String.raw\`${text}\\n\`;
const values = [re.source, re.source.length, String(re), raw, raw.length];
`;
  return {
    text,
    body,
    expected: JSON.stringify([text, text.length, `/${text}/u`, `${text}\\n`, text.length + "\\n".length]),
    files: probeFiles(body),
  };
}

// Legal comments were already printed verbatim before regex and template text
// was (and came back as mojibake, e.g. "Â©", on every path), so this variant
// pins the module loading half independently of the regex/template change.
function legalCommentProbe(text: string) {
  const body = `
function tagged() {
  /*! ${text} */
  return 1;
}
const values = [tagged.toString().split("/*! ")[1].split(" */")[0]];
`;
  return { text, body, expected: JSON.stringify([text]), files: probeFiles(body) };
}

type Probe = ReturnType<typeof probe>;

// "café-©-ÿ" stays within Latin-1, so the module's output is still 8-bit;
// "中" and "🐰" widen it to UTF-16 (the rabbit also checks surrogate pairs).
const latin1 = probe("café-©-ÿ");
const nonAscii = probe("café-中-🐰");
const asciiTwin = probe("cafe-x-y");
const latin1Comment = legalCommentProbe("© café ÿ");
const nonAsciiComment = legalCommentProbe("© café-中-🐰");
const asciiCommentTwin = legalCommentProbe("(c) cafe-x-y");
const kinds: [string, Probe][] = [
  ["8-bit regex and raw template text", latin1],
  ["UTF-16 regex and raw template text", nonAscii],
  ["8-bit legal comment text (module loading fix alone)", latin1Comment],
  ["UTF-16 legal comment text (module loading fix alone)", nonAsciiComment],
];

async function runIn(cwd: string, args: string[], env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...args],
    cwd,
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function transpilerCacheEnv(dir: string) {
  return {
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(dir, "transpiler-cache"),
    // Debug builds only read the cache back with this set.
    BUN_DEBUG_ENABLE_RESTORE_FROM_TRANSPILER_CACHE: "1",
  };
}

// Identity of every entry in the transpiler cache directory. An entry that
// fails to load is silently deleted and written again by the re-transpile, so
// a second run that really hit the cache leaves these unchanged.
function cacheEntries(dir: string) {
  const cacheDir = join(dir, "transpiler-cache");
  return readdirSync(cacheDir).map(name => {
    const { ino, mtimeMs, size } = statSync(join(cacheDir, name));
    return { name, ino, mtimeMs, size };
  });
}

// Entry header, see `Metadata::encode` in src/jsc/RuntimeTranspilerCache.rs:
// u32 version, u8 module type, u8 encoding tag, then u64 fields starting with
// features_hash, input_byte_length, input_hash, output_byte_offset and
// output_byte_length. UTF-16 output is stored in native byte order; CI is
// little-endian everywhere.
const CACHE_TAG_UTF16 = 2;
const CACHE_TAG_LATIN1 = 3;
function cacheEntryOutputs(dir: string) {
  const cacheDir = join(dir, "transpiler-cache");
  return readdirSync(cacheDir)
    .map(name => {
      const entry = readFileSync(join(cacheDir, name));
      const tag = entry[5];
      const offset = Number(entry.readBigUInt64LE(30));
      const length = Number(entry.readBigUInt64LE(38));
      const output = entry.subarray(offset, offset + length);
      return { tag, output: output.toString(tag === CACHE_TAG_UTF16 ? "utf16le" : "latin1") };
    })
    .sort((a, b) => a.tag - b.tag);
}

describe.concurrent("every module loading path preserves non-ASCII regex/raw text", () => {
  describe.each(kinds)("%s", (_kind, { files, expected }) => {
    test.each([
      ["entry point", ["main.js"]],
      ["entry point with --hot (watcher keeps a ref-counted copy of the source)", ["--hot", "main.js"]],
      ["entry point with the // @bun pragma", ["pragma-main.js"]],
      ["import (async transpiler)", ["import.mjs"]],
      ["import of a // @bun module (async transpiler)", ["import-pragma.mjs"]],
      ["require (sync transpiler)", ["require.cjs"]],
    ])("%s", async (_name, args) => {
      using dir = tempDir("nonascii-load-path", files);
      const { stdout, stderr, exitCode } = await runIn(String(dir), args);
      expect({ stdout, stderr }).toEqual({ stdout: expected, stderr: "" });
      expect(exitCode).toBe(0);
    });
  });

  // The on-disk transpiler cache stores the output in the width the printer
  // ended up with, and the entry's tag is the one place that width can be
  // observed from outside: 8-bit text must leave the module 8-bit, and text
  // above U+00FF must have widened it. The first run writes the entry and the
  // second run must serve it: an entry read back in the wrong width is
  // garbage, and an entry that fails to load is rewritten.
  test.each([
    ["8-bit", "entry point (sync transpiler)", "padded-main.js", latin1, CACHE_TAG_LATIN1],
    ["8-bit", "import (async transpiler)", "import-padded.mjs", latin1, CACHE_TAG_LATIN1],
    ["UTF-16", "entry point (sync transpiler)", "padded-main.js", nonAscii, CACHE_TAG_UTF16],
    ["UTF-16", "import (async transpiler)", "import-padded.mjs", nonAscii, CACHE_TAG_UTF16],
  ])("transpiler cache round trip of %s output through the %s", async (_width, _name, entry, probe, tag) => {
    const { files, expected, text } = probe;
    using dir = tempDir("nonascii-transpiler-cache", files);
    const env = transpilerCacheEnv(String(dir));

    const first = await runIn(String(dir), [entry], env);
    expect({ stdout: first.stdout, stderr: first.stderr }).toEqual({ stdout: expected, stderr: "" });
    expect(first.exitCode).toBe(0);
    // Only the padded module is large enough to be cached.
    const written = cacheEntries(String(dir));
    expect(written).toHaveLength(1);
    const [stored] = cacheEntryOutputs(String(dir));
    expect(stored.tag).toBe(tag);
    expect(stored.output).toContain(`/${text}/u`);

    const second = await runIn(String(dir), [entry], env);
    expect({ stdout: second.stdout, stderr: second.stderr }).toEqual({ stdout: expected, stderr: "" });
    expect(second.exitCode).toBe(0);
    expect(cacheEntries(String(dir))).toEqual(written);
  });

  // `require()` reuses one printer for every module of the process, so after
  // a module has widened it, the next module must start out 8-bit again.
  // Nothing else in this file loads a widening module before an 8-bit one in
  // the same process.
  test("a module printed after a widened one is 8-bit again", async () => {
    using dir = tempDir("nonascii-printer-reset", {
      "wide.cjs": padding + nonAscii.body + "module.exports = values;\n",
      "narrow.cjs": padding + latin1.body + "module.exports = values;\n",
      "main.cjs": `process.stdout.write(JSON.stringify([require("./wide.cjs"), require("./narrow.cjs")]));\n`,
    });
    const { stdout, stderr, exitCode } = await runIn(String(dir), ["main.cjs"], transpilerCacheEnv(String(dir)));
    expect({ stdout, stderr }).toEqual({ stdout: `[${nonAscii.expected},${latin1.expected}]`, stderr: "" });
    expect(exitCode).toBe(0);
    const [wide, narrow] = cacheEntryOutputs(String(dir));
    expect([wide.tag, narrow.tag]).toEqual([CACHE_TAG_UTF16, CACHE_TAG_LATIN1]);
    expect(wide.output).toContain(`/${nonAscii.text}/u`);
    expect(narrow.output).toContain(`/${latin1.text}/u`);
  });
});

// NODE_COMPILE_CACHE persists JSC bytecode generated from the transpiler's
// output, in whichever width it has, and keyed by a hash of those bytes. On
// later runs the loader must hand it the same bytes in the same width, whether
// it transpiled the module again or served it from the transpiler cache, and
// the bytecode must have been generated from a string of that width too; any
// mismatch is a silent miss. The ASCII twin gives the expected number of hits
// (entry point, probe module and the empty module, whose output has zero
// bytes). Before this change a cached module with a non-ASCII legal comment
// still reached the compile cache, so that combination must keep working.
//
// The modes differ in which path populates the compile cache: "transpiled
// again" and "served from the transpiler cache" generate the bytecode from the
// print path on the first run, while "warmed" writes the transpiler cache
// entry first (as a machine that has run the program before would have) so
// that the bytecode is generated from the entry's bytes and stored width, and
// the last run's acceptance is the match between the two.
//
// Each mode runs three probes through two or three rounds of processes, the
// first of which also generates and persists the bytecode, so these stay out
// of the concurrent groups and get an explicit timeout: three rounds of a
// debug build take about as long as the default allows.
type CompileCacheMode = "transpiled again" | "served from the transpiler cache" | "warmed";
describe("NODE_COMPILE_CACHE bytecode is accepted", () => {
  test.each<[string, CompileCacheMode, string, Probe, Probe[]]>([
    [
      "regex and raw template text, module transpiled again",
      "transpiled again",
      "import-empty.mjs",
      asciiTwin,
      [latin1, nonAscii],
    ],
    [
      "regex and raw template text, module served from the transpiler cache",
      "served from the transpiler cache",
      "import-padded.mjs",
      asciiTwin,
      [latin1, nonAscii],
    ],
    [
      "regex and raw template text, bytecode generated from a warm transpiler cache",
      "warmed",
      "import-padded.mjs",
      asciiTwin,
      [latin1, nonAscii],
    ],
    [
      "legal comment text, module served from the transpiler cache",
      "served from the transpiler cache",
      "import-padded.mjs",
      asciiCommentTwin,
      [latin1Comment, nonAsciiComment],
    ],
  ])(
    "%s",
    async (_name, mode, entry, twin, probes) => {
      async function cacheHits({ files, expected }: Probe) {
        using dir = tempDir("nonascii-compile-cache", files);
        const compileCache = { NODE_COMPILE_CACHE: join(String(dir), "compile-cache") };
        const transpilerCache = transpilerCacheEnv(String(dir));
        const runs =
          mode === "transpiled again"
            ? [compileCache, compileCache]
            : mode === "served from the transpiler cache"
              ? [
                  { ...compileCache, ...transpilerCache },
                  { ...compileCache, ...transpilerCache },
                ]
              : [transpilerCache, { ...compileCache, ...transpilerCache }, { ...compileCache, ...transpilerCache }];

        let stderr = "";
        for (const [i, env] of runs.entries()) {
          const last = i === runs.length - 1;
          const result = await runIn(String(dir), [entry], last ? { ...env, BUN_JSC_verboseDiskCache: "1" } : env);
          if (!last) expect({ stdout: result.stdout, stderr: result.stderr }).toEqual({ stdout: expected, stderr: "" });
          else expect(result.stdout).toBe(expected);
          expect(result.exitCode).toBe(0);
          if (i === 0 && mode !== "transpiled again") expect(cacheEntries(String(dir))).toHaveLength(1);
          stderr = result.stderr;
        }
        return stderr.split("[Disk Cache] Cache hit for sourceCode").length - 1;
      }

      const [twinHits, ...hits] = await Promise.all([twin, ...probes].map(cacheHits));
      expect(twinHits).toBeGreaterThanOrEqual(3);
      // One entry per probe: 8-bit output, then output widened to UTF-16.
      expect(hits).toEqual([twinHits, twinHits]);
    },
    20_000,
  );
});

// Error positions must still map back to the original source when a module
// widens partway through. These layouts pin the line accounting on both sides
// of the switch (the runtime printer puts each statement on its own generated
// line, so they say nothing about columns within a line; the column arithmetic
// of both builder modes is pinned by test/cli/inspect/inspect-inline-sourcemap.test.ts).
// Columns below are 1-based UTF-16 offsets of the callee in the original
// line, which `indexOf` gives directly.
describe.concurrent("stack positions are remapped around non-ASCII regex/raw text", () => {
  const layouts = {
    "text before the error sites": (text: string) => [
      `const re = /${text}/u;`,
      `const raw = String.raw\`${text}\`; const a = new Error("a");`,
      `const b = new Error("b");`,
      `print(a, b);`,
    ],
    "text between the error sites": (text: string) => [
      `const a = new Error("a");`,
      `const re = /${text}/u; const b = new Error("b");`,
      `const raw = String.raw\`${text}\`;`,
      `const c = new Error("c");`,
      `print(a, b, c);`,
    ],
  };
  const print = [
    `function print(...errors) {`,
    `  process.stdout.write(JSON.stringify(errors.map(e => e.stack.split("\\n")[1].match(/:(\\d+:\\d+)$/)[1])));`,
    `}`,
  ];

  function expectedPositions(lines: string[]) {
    return lines.flatMap((line, row) => {
      const column = line.indexOf("Error(");
      return column === -1 ? [] : [`${row + 1}:${column + 1}`];
    });
  }

  const texts: [string, string][] = [
    ["ASCII", "xyz"],
    ["8-bit", "é©"],
    ["UTF-16", "中🐰"],
  ];
  test.each(texts.flatMap(([width, text]) => Object.keys(layouts).map(layout => [width, layout, text] as const)))(
    "%s %s",
    async (_width, layout, text) => {
      const lines = layouts[layout as keyof typeof layouts](text);
      using dir = tempDir("nonascii-stack-positions", { "main.js": [...lines, ...print].join("\n") });
      const { stdout, stderr, exitCode } = await runIn(String(dir), ["main.js"]);
      expect({ stdout, stderr }).toEqual({ stdout: JSON.stringify(expectedPositions(lines)), stderr: "" });
      expect(exitCode).toBe(0);
    },
  );
});

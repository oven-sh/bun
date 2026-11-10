import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join, sep } from "node:path";

// A `// @bun`-pragma'd file is not re-transpiled, so the sidecar / inline
// source map is parsed as-is when error.stack is formatted. A negative
// relative VLQ delta that takes a running field below zero must be rejected
// as an invalid map (warn + fall back to unmapped positions), not trip the
// `Ordinal::from_zero_based` debug_assert in assertions-enabled builds.

const body =
  `// @bun\n` +
  `function t() {\n` +
  `  throw new Error("NEGVLQ");\n` +
  `}\n` +
  `try { t(); } catch (e) { console.log(String(e.stack).split("\\n")[1].trim()); }\n`;

function makeMap(mappings: string) {
  return JSON.stringify({
    version: 3,
    sources: ["orig.ts"],
    sourcesContent: ["a\nb\nc\n"],
    names: [],
    mappings,
  });
}

describe.concurrent("sourcemap: negative VLQ delta in mappings is rejected, not asserted", () => {
  for (const [field, mappings, errName] of [
    ["generated column", ";;D;", "InvalidGeneratedColumnValue"],
    ["original line", ";;AADA;", "InvalidOriginalLineValue"],
    ["original column", ";;AAAD;", "InvalidOriginalColumnValue"],
  ] as const) {
    test(`external .map: negative ${field}`, async () => {
      using dir = tempDir("negvlq-ext", {
        "entry.js": body + `//# sourceMappingURL=entry.js.map\n`,
        "entry.js.map": makeMap(mappings),
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(errName);
      expect(stdout).toContain("at t (");
      expect(stdout).toContain(join(String(dir), "entry.js"));
      expect(exitCode).toBe(0);
    });

    test(`inline data-URL map: negative ${field}`, async () => {
      const b64 = Buffer.from(makeMap(mappings)).toString("base64");
      using dir = tempDir("negvlq-inl", {
        "entry.js": body + `//# sourceMappingURL=data:application/json;base64,${b64}\n`,
      });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.js"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toContain(errName);
      expect(stdout).toContain("at t (");
      expect(exitCode).toBe(0);
    });
  }

  test("new module.SourceMap({mappings}) with negative generated column throws", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { SourceMap } = require("node:module");
         try {
           new SourceMap({ version: 3, sources: ["a"], names: [], mappings: "D" });
           console.log("no-throw");
         } catch (e) {
           console.log("threw:" + String(e.message));
         }`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, stdout: stdout.trim() }).toEqual({
      stderr: "",
      stdout: expect.stringMatching(/^threw:.*generated column/i),
    });
    expect(exitCode).toBe(0);
  });

  // "+/////D" is VLQ for i32::MAX. With overflow-checks on (dev profile), an
  // unchecked `+=` on the running source/name index would panic before the
  // range check can reject it.
  test("new module.SourceMap({mappings}) with i32::MAX source-index delta throws", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { SourceMap } = require("node:module");
         try {
           new SourceMap({ version: 3, sources: ["a","b"], names: [], mappings: "ACAA,A+/////DAA" });
           console.log("no-throw");
         } catch (e) {
           console.log("threw:" + String(e.message));
         }`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, stdout: stdout.trim() }).toEqual({
      stderr: "",
      stdout: expect.stringMatching(/^threw:.*source index/i),
    });
    expect(exitCode).toBe(0);
  });

  test("new module.SourceMap({mappings}) with i32::MAX name-index delta is accepted", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { SourceMap } = require("node:module");
         new SourceMap({ version: 3, sources: ["a"], names: ["n","m"], mappings: "AAAAC,AAAA+/////D" });
         console.log("ok");`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, stdout: stdout.trim() }).toEqual({ stderr: "", stdout: "ok" });
    expect(exitCode).toBe(0);
  });

  test("SourceMap findEntry/findOrigin with negative line/column return empty objects", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { SourceMap } = require("node:module");
         const sm = new SourceMap({ version: 3, sources: ["a"], names: [], mappings: "AAAA" });
         console.log(JSON.stringify({
           entryNegLine: sm.findEntry(-1, 0),
           entryNegCol: sm.findEntry(0, -1),
           originNegLine: sm.findOrigin(-1, 0),
           originNegCol: sm.findOrigin(0, -1),
         }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      entryNegLine: {},
      entryNegCol: {},
      originNegLine: {},
      originNegCol: {},
    });
    expect(exitCode).toBe(0);
  });
});

// `sourcesContent` is only the text of a code frame, so no shape of it stops `mappings` and `sources` from remapping
// a frame, and nothing is reported. A `sources` entry that is not a string is a source with no name.
describe.concurrent("sourcemap: sourcesContent and nameless sources do not make a map undecodable", () => {
  // Generated line 3, column 2 -> sources[0], line 5, column 3.
  const base = { version: 3, sources: ["orig.ts"], names: [], mappings: ";;EAIE;" };
  // A decodable map next to the file. An inline map is the one that is used.
  const sidecar = JSON.stringify({ ...base, sources: ["sidecar.ts"], sourcesContent: [""] });

  async function run(files: Record<string, string>) {
    using dir = tempDir("sourcemap-shapes", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const relative = (text: string) => text.replaceAll(String(dir) + sep, "");
    return { stdout: relative(stdout), stderr: relative(stderr), exitCode };
  }

  test.each([
    ["absent", base],
    ["null", { ...base, sourcesContent: null }],
    ["[]", { ...base, sourcesContent: [] }],
    ["shorter than sources", { ...base, sources: ["orig.ts", "other.ts"], sourcesContent: ["x"] }],
    ["longer than sources", { ...base, sourcesContent: ["x", "y"] }],
    ["a string", { ...base, sourcesContent: "x" }],
    ["a number", { ...base, sourcesContent: 5 }],
    ["an object", { ...base, sourcesContent: {} }],
    ["false", { ...base, sourcesContent: false }],
  ])("external .map: sourcesContent %s", async (_, map) => {
    const files = { "entry.js": body + `//# sourceMappingURL=entry.js.map\n`, "entry.js.map": JSON.stringify(map) };
    expect(await run(files)).toEqual({ stdout: "at t (orig.ts:5:3)\n", stderr: "", exitCode: 0 });
  });

  // What `bun build --sourcemap=external` writes: the file names its map with a `debugId` comment only.
  test("external .map of a file that has a debugId comment only: sourcesContent absent", async () => {
    const files = {
      "entry.js": body + `//# debugId=0123456789ABCDEF64756E2164756E21\n`,
      "entry.js.map": JSON.stringify({ ...base, debugId: "0123456789ABCDEF64756E2164756E21" }),
    };
    expect(await run(files)).toEqual({ stdout: "at t (orig.ts:5:3)\n", stderr: "", exitCode: 0 });
  });

  test.each([
    ["absent", base],
    ["a string", { ...base, sourcesContent: "x" }],
  ])("inline data-URL map: sourcesContent %s", async (_, map) => {
    const files = {
      "entry.js": body + `//# sourceMappingURL=data:application/json;base64,${btoa(JSON.stringify(map))}\n`,
      "entry.js.map": sidecar,
    };
    expect(await run(files)).toEqual({ stdout: "at t (orig.ts:5:3)\n", stderr: "", exitCode: 0 });
  });

  test.each([
    ["[null]", [null], "null"],
    ["[5]", [5], "null"],
    ['["orig.ts", null]', ["orig.ts", null], "orig.ts"],
  ])("external .map: sources %s", async (_, sources, name) => {
    const map = { ...base, sources, sourcesContent: sources.map(() => null) };
    const files = { "entry.js": body + `//# sourceMappingURL=entry.js.map\n`, "entry.js.map": JSON.stringify(map) };
    expect(await run(files)).toEqual({ stdout: `at t (${name}:5:3)\n`, stderr: "", exitCode: 0 });
  });

  // Bun finds `<file>.map` by the name of the file alone, so it also finds a map that another tool left there.
  // A map in one of the shapes above is the map of the file only when the file links it.
  const id = "0123456789ABCDEF64756E2164756E21";
  const refused = {
    stdout: "at t (entry.js:3:18)\n",
    stderr: "warn: Could not decode sourcemap in 'entry.js': InvalidSourceMap\n",
    exitCode: 0,
  };

  test.each([
    ["no sourcesContent", base, "orig.ts"],
    [
      "fewer sourcesContent entries than sources",
      { ...base, sources: ["orig.ts", "b.ts"], sourcesContent: ["x"] },
      "orig.ts",
    ],
    ["a source that has no name", { ...base, sources: [null], sourcesContent: [null] }, "null"],
  ])("external .map with %s is used only when the file links it", async (_, map, name) => {
    const mapped = { stdout: `at t (${name}:5:3)\n`, stderr: "", exitCode: 0 };
    // The end of the file, the keys that the map also has, and the result.
    const links = {
      "no link": ["", {}, refused],
      "the name of another map": ["//# sourceMappingURL=other.js.map\n", {}, refused],
      "a debug id, and the map has none": [`//# debugId=${id}\n`, {}, refused],
      "the name of the map": ["//# sourceMappingURL=entry.js.map\n", {}, mapped],
      "the name of the map after ./": ["//# sourceMappingURL=./entry.js.map\n", {}, mapped],
      // A UUID has the same digits with dashes and in lower case.
      "the debug id of the map": [`//# debugId=${id}\n`, { debugId: "01234567-89ab-cdef-6475-6e2164756e21" }, mapped],
    } as const;
    const results = await Promise.all(
      Object.values(links).map(([end, keys]) =>
        run({ "entry.js": body + end, "entry.js.map": JSON.stringify({ ...map, ...keys }) }),
      ),
    );
    expect(Object.fromEntries(Object.keys(links).map((link, i) => [link, results[i]]))).toEqual(
      Object.fromEntries(Object.entries(links).map(([link, [, , result]]) => [link, result])),
    );
  });

  test("a bundle from bun build: its own map without sourcesContent is used, a map that another tool left is not", async () => {
    using dir = tempDir("sourcemap-leftover", {
      "src/index.ts":
        `export function boom(): never {\n` +
        `  throw new Error("LEFTOVER");\n` +
        `}\n` +
        `try {\n` +
        `  boom();\n` +
        `} catch (e) {\n` +
        `  console.log(String((e as Error).stack).split("\\n")[1].trim());\n` +
        `}\n`,
    });
    const bun = async (...args: string[]) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...args],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const relative = (text: string) => text.replaceAll(String(dir) + sep, "").replaceAll("\\", "/");
      return { stdout: relative(stdout), stderr: relative(stderr), exitCode };
    };
    const build = async (outdir: string, ...flags: string[]) =>
      expect((await bun("build", "src/index.ts", "--target=bun", "--outdir", outdir, ...flags)).exitCode).toBe(0);
    await Promise.all([build("own", "--sourcemap=external"), build("left"), build("left-with-content")]);

    // What is left of the map of `--sourcemap=external` when a deploy step removes the source text. The bundle has
    // the debug id of the map.
    const ownMap = join(String(dir), "own", "index.js.map");
    const { sourcesContent, ...own } = await Bun.file(ownMap).json();
    await Bun.write(ownMap, JSON.stringify(own));
    // The map that tsc writes for its own `index.js`. A build with no --sourcemap has no line that links a map.
    const tsc = {
      version: 3,
      file: "index.js",
      sourceRoot: "",
      sources: ["../src/index.ts"],
      names: [],
      mappings: ";;AAAA,SAAgB,IAAI;IAClB,MAAM,IAAI,KAAK,CAAC,OAAO,CAAC,CAAC;AAC3B,CAAC;AACD,IAAI,EAAE,CAAC",
    };
    await Promise.all([
      Bun.write(join(String(dir), "left", "index.js.map"), JSON.stringify(tsc)),
      Bun.write(join(String(dir), "left-with-content", "index.js.map"), JSON.stringify({ ...tsc, sourcesContent })),
    ]);

    const [ownResult, left, leftWithContent] = await Promise.all([
      bun("own/index.js"),
      bun("left/index.js"),
      bun("left-with-content/index.js"),
    ]);
    expect({ own: ownResult, left, leftWithContent }).toEqual({
      own: { stdout: "at boom (src/index.ts:2:13)\n", stderr: "", exitCode: 0 },
      left: {
        stdout: "at boom (left/index.js:4:18)\n",
        stderr: "warn: Could not decode sourcemap in 'left/index.js': InvalidSourceMap\n",
        exitCode: 0,
      },
      // A map that has the text of each source is used with no link, as before.
      leftWithContent: { stdout: "at boom (src/index.ts:2:13)\n", stderr: "", exitCode: 0 },
    });
  });
});

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
    return { stdout: stdout.replaceAll(String(dir) + sep, ""), stderr, exitCode };
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
});

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

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

// A segment that names a source the map does not have. ";;EAIE" maps generated
// 3:3 to original 5:3 of source 0. ";;ECIE" maps it to source 1.
describe.concurrent("sourcemap: a source index past `sources` is rejected", () => {
  const map = { version: 3, sources: ["original.ts"], sourcesContent: [null], names: [], mappings: ";;ECIE" };
  const maps = {
    "last-source": { ...map, sources: ["other.ts", "original.ts"], sourcesContent: [null, null] },
    "past-end": map,
    "no-sources": { ...map, sources: [], sourcesContent: [], mappings: ";;EAIE" },
    // Long enough for the SIMD decoder, which leaves the last segment of any input to the scalar loop.
    "past-end-at-tail": { ...map, mappings: ";;EAIE" + Buffer.alloc(5 * 46, ",CAAC").toString() + ",CCAA" },
    // ",CCAA" names source 1 and ",CDAA" goes back to source 0. The SIMD decoder has to refuse it mid-input.
    "past-end-mid-input": {
      ...map,
      mappings:
        ";;EAIE" + Buffer.alloc(5 * 20, ",CAAC").toString() + ",CCAA,CDAA" + Buffer.alloc(5 * 20, ",CAAC").toString(),
    },
    // The same with two-character VLQs, which take another path in the SIMD decoder.
    "past-end-mid-input-wide": {
      ...map,
      mappings:
        ";;EAIE" +
        Buffer.alloc(7 * 20, ",gBAAgB").toString() +
        ",CCAA,CDAA" +
        Buffer.alloc(7 * 20, ",gBAAgB").toString(),
    },
  };
  const throwsOnLine3 = `// @bun\nexport function t() {\n  throw new Error("SI");\n}\n`;
  const files: Record<string, string> = {
    "main.js": `
      for (const file of process.argv.slice(2)) {
        const { t } = await import("./" + file);
        for (let i = 0; i < 2; i++) {
          try {
            t();
          } catch (e) {
            console.log(file + ": " + e.stack.split("\\n")[1].trim());
          }
        }
      }
    `,
  };
  for (const [name, map] of Object.entries(maps)) {
    const json = JSON.stringify(map);
    files[`${name}.js`] = throwsOnLine3 + `//# sourceMappingURL=${name}.js.map\n`;
    files[`${name}.js.map`] = json;
    files[`${name}.inline.js`] = throwsOnLine3 + `//# sourceMappingURL=data:application/json;base64,${btoa(json)}\n`;
  }
  const remapped = ["last-source.js", "last-source.inline.js"];
  const refused = Object.keys(maps)
    .filter(name => name !== "last-source")
    .flatMap(name => [`${name}.js`, `${name}.inline.js`]);

  for (const [decoder, env] of [
    ["SIMD", {}],
    ["scalar", { BUN_FEATURE_FLAG_DISABLE_SIMD_SOURCEMAP: "1" }],
  ] as const) {
    test(`${decoder} decoder: one warning for each file, and its frames keep their built position`, async () => {
      using dir = tempDir("source-index-past-end", files);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "main.js", ...remapped, ...refused],
        env: { ...bunEnv, ...env },
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const clean = (text: string) => text.replaceAll(String(dir), "<dir>").replaceAll("\\", "/");
      const twice = (line: string) => line + line;
      expect({ stdout: clean(stdout), stderr: clean(stderr) }).toEqual({
        stdout:
          remapped.map(file => twice(`${file}: at t (<dir>/original.ts:5:3)\n`)).join("") +
          refused.map(file => twice(`${file}: at t (<dir>/${file}:3:18)\n`)).join(""),
        stderr: refused
          .map(file => `warn: Could not decode sourcemap in '<dir>/${file}': InvalidSourceIndexValue\n`)
          .join(""),
      });
      expect(exitCode).toBe(0);
    });
  }

  test("a throw in the last source of a `bun build --sourcemap=external` bundle is remapped", async () => {
    using dir = tempDir("source-index-last-of-bundle", {
      "first.ts": `export function first() {}\n`,
      "second.ts": `export function second() {}\n`,
      "entry.ts":
        `import { first } from "./first";\n` +
        `import { second } from "./second";\n` +
        `first();\n` +
        `second();\n` +
        `function last() {\n` +
        `  throw new Error("SI");\n` +
        `}\n` +
        `last();\n`,
    });
    const build = await Bun.build({
      entrypoints: [join(String(dir), "entry.ts")],
      outdir: join(String(dir), "out"),
      target: "bun",
      sourcemap: "external",
    });
    expect(build.success).toBe(true);
    const { sources } = await Bun.file(join(String(dir), "out", "entry.js.map")).json();
    expect(sources).toEqual(["../first.ts", "../second.ts", "../entry.ts"]);

    await using proc = Bun.spawn({
      cmd: [bunExe(), join("out", "entry.js")],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain(`at last (${join(String(dir), "entry.ts")}:6:9)`);
    expect(stdout).toBe("");
    expect(exitCode).toBe(1);
  });
});

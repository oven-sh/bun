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

// The inline source map of a `// @bun` file is the one that a
// `//# sourceMappingURL=` comment names in the comment lines the file ends
// with (ECMA-426, JavaScriptExtractSourceMapURL "without parsing"). The
// printer writes a string that holds "\n" as a template literal with a real
// line break, so string data can put the same text at the start of a line.
// That text is data: it names no map.
describe.concurrent("sourcemap: sourceMappingURL is read from the comment lines a file ends with", () => {
  // Line 3 of the generated file, where `thrower` makes its Error, is line 1,
  // column 5 of `source`.
  const mapTo = (source: string, mappings = ";;AAAI") =>
    JSON.stringify({
      version: 3,
      sources: [source],
      sourcesContent: ["// " + source + "\n"],
      names: [],
      mappings,
    });
  const dataUrl = (source: string, mappings?: string) =>
    "data:application/json;base64," + Buffer.from(mapTo(source, mappings)).toString("base64");
  const comment = (source: string) => "//# sourceMappingURL=" + dataUrl(source);
  // What the printer writes for a string that holds "\n//# sourceMappingURL=<url>\n".
  const stringData = (source: string) => "export const data = `\n" + comment(source) + "\n`;";
  const row = (...tail: string[]) =>
    ["// @bun", "export function thrower() {", '  return new Error("ROW");', "}", ...tail, ""].join("\n");

  // `frame` is where the Error of each module is reported: in the source its
  // map names, or on line 3 of the module itself when it has no map.
  const rows: Record<string, { text: string; sidecar?: string; frame: string }> = {
    // The comment is in the last comment lines of the file.
    "last-line": { text: row(comment("END.ts")), frame: "END.ts:1:5" },
    "no-line-break-after-it": { text: row(comment("END.ts")).trimEnd(), frame: "END.ts:1:5" },
    "crlf-line-breaks": { text: row(comment("END.ts")).replaceAll("\n", "\r\n"), frame: "END.ts:1:5" },
    "cr-line-breaks-after-it": { text: row(comment("END.ts") + "\r// trailing\r").trimEnd(), frame: "END.ts:1:5" },
    "comments-and-a-blank-line-after-it": {
      text: row(comment("END.ts"), "//# debugId=F3F71626E87E7C2264756E2164756E21", "", "// trailing"),
      frame: "END.ts:1:5",
    },
    "comment-with-an-asterisk-after-it": { text: row(comment("END.ts"), "// 2 * 3"), frame: "END.ts:1:5" },
    "white-space-after-the-url": { text: row(comment("END.ts") + " \t"), frame: "END.ts:1:5" },
    "second-of-two": {
      text: row(comment("FIRST.ts"), "export const after = 1;", comment("SECOND.ts")),
      frame: "SECOND.ts:1:5",
    },
    "indented": { text: row("  " + comment("END.ts")), frame: "END.ts:1:5" },
    "at-sign": { text: row("//@ sourceMappingURL=" + dataUrl("END.ts")), frame: "END.ts:1:5" },
    "tab-after-the-number-sign": { text: row("//#\tsourceMappingURL=" + dataUrl("END.ts")), frame: "END.ts:1:5" },
    "nothing-after-the-number-sign": { text: row("//#sourceMappingURL=" + dataUrl("END.ts")), frame: "END.ts:1:5" },
    "string-data-before-it": { text: row(stringData("STRING.ts"), comment("END.ts")), frame: "END.ts:1:5" },

    // The comment is not in the last comment lines of the file, or it is not
    // of the form `//# sourceMappingURL=<url>`. JavaScriptCore, V8 and Node.js
    // read some of these. ECMA-426 does not, and nor does Bun.
    "code-after-it": { text: row(comment("MID.ts"), "export const after = 1;"), frame: "code-after-it.js:3" },
    "code-before-it-on-its-line": {
      text: row("export const before = 1; " + comment("MID.ts")),
      frame: "code-before-it-on-its-line.js:3",
    },
    "string-data-after-it": {
      text: row(comment("MID.ts"), stringData("STRING.ts")),
      frame: "string-data-after-it.js:3",
    },
    "block-comment-after-it": { text: row(comment("MID.ts"), "/* the end */"), frame: "block-comment-after-it.js:3" },
    // A later `//` line with a quote or `*/` in it can be the end of a string,
    // a template literal or a block comment that began above the URL.
    "double-quote-in-a-comment-after-it": {
      text: row(comment("MID.ts"), '// "quoted"'),
      frame: "double-quote-in-a-comment-after-it.js:3",
    },
    "single-quote-in-a-comment-after-it": {
      text: row(comment("MID.ts"), "// don't edit"),
      frame: "single-quote-in-a-comment-after-it.js:3",
    },
    "backtick-in-a-comment-after-it": {
      text: row(comment("MID.ts"), "// `quoted`"),
      frame: "backtick-in-a-comment-after-it.js:3",
    },
    "block-comment-end-in-a-comment-after-it": {
      text: row(comment("MID.ts"), "// */"),
      frame: "block-comment-end-in-a-comment-after-it.js:3",
    },
    "block-comment-form": {
      text: row("/*# sourceMappingURL=" + dataUrl("BLOCK.ts") + " */"),
      frame: "block-comment-form.js:3",
    },
    "space-before-the-url": {
      text: row("//# sourceMappingURL= " + dataUrl("END.ts")),
      frame: "space-before-the-url.js:3",
    },
    "text-after-the-url": { text: row(comment("END.ts") + " and more"), frame: "text-after-the-url.js:3" },

    // Text of a string, a template literal or a block comment is no comment.
    "string-data": { text: row(stringData("STRING.ts")), frame: "string-data.js:3" },
    "string-data-with-sidecar": {
      text: row(stringData("STRING.ts")),
      sidecar: mapTo("SIDECAR.ts"),
      frame: "SIDECAR.ts:1:5",
    },
    "string-data-that-ends-the-file": {
      text: row("export const data = `", comment("STRING.ts"), "//`;"),
      frame: "string-data-that-ends-the-file.js:3",
    },
    // React's Flight client has `code += "\n//# sourceMappingURL=" + sourceMap`.
    "string-data-that-is-no-url": {
      text: row("export const fake = sourceMap => `\n//# sourceMappingURL=` + sourceMap;"),
      frame: "string-data-that-is-no-url.js:3",
    },
    "block-comment-body": { text: row("/*", comment("BLOCK.ts"), "*/"), frame: "block-comment-body.js:3" },
  };

  test("one `// @bun` module for each place the text can be", async () => {
    const files: Record<string, string> = {
      "main.js": `
        const out = {};
        for (const name of ${JSON.stringify(Object.keys(rows))}) {
          const { thrower } = await import("./" + name + ".js");
          out[name] = thrower().stack.split("\\n")[1].trim();
        }
        console.log(JSON.stringify(out));
      `,
    };
    for (const [name, { text, sidecar }] of Object.entries(rows)) {
      files[name + ".js"] = text;
      if (sidecar) files[name + ".js.map"] = sidecar;
    }
    using dir = tempDir("sourcemap-url-rows", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // "at thrower (<dir>/END.ts:1:5)" -> "END.ts:1:5". A frame that no map
    // moved keeps its generated line; its column is the engine's to choose.
    const prefix = String(dir).replaceAll("\\", "/") + "/";
    const frames: Record<string, string> = {};
    for (const [name, frame] of Object.entries<string>(JSON.parse(stdout || "{}"))) {
      frames[name] = frame
        .replaceAll("\\", "/")
        .replace(/^at thrower \((.*)\)$/, "$1")
        .replace(prefix, "")
        .replace(/(\.js:\d+):\d+$/, "$1");
    }
    expect({ frames, stderr }).toEqual({
      frames: Object.fromEntries(Object.entries(rows).map(([name, { frame }]) => [name, frame])),
      // No "Could not decode sourcemap" for text that is not a comment.
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // A CommonJS module of a `Bun.ModuleGraph` is compiled through a stand-in
  // for its source. The map is still the one that the module's text names.
  test("`// @bun` modules of a Bun.ModuleGraph", async () => {
    using dir = tempDir("sourcemap-url-module-graph", {
      "esm.js": row(comment("ESM.ts")),
      "cjs.js": [
        "// @bun @bun-cjs",
        "(function(exports, require, module, __filename, __dirname) {",
        "exports.thrower = function thrower() {",
        '  return new Error("ROW");',
        "};})",
        // The Error is made on line 4 here.
        "//# sourceMappingURL=" + dataUrl("CJS.ts", ";;;AAAI"),
        "",
      ].join("\n"),
      "main.js": `
        const out = [];
        for (let i = 0; i < 2; i++) {
          const graph = new Bun.ModuleGraph();
          for (const name of ["esm", "cjs"]) {
            const module = await graph.import("./" + name + ".js");
            out.push((module.thrower ?? module.default.thrower)().stack.split("\\n")[1].trim());
          }
          graph.dispose();
        }
        console.log(JSON.stringify(out));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const frames = [
      `at thrower (${join(String(dir), "ESM.ts")}:1:5)`,
      `at thrower (${join(String(dir), "CJS.ts")}:1:5)`,
    ];
    expect({ frames: JSON.parse(stdout || "[]"), stderr }).toEqual({ frames: [...frames, ...frames], stderr: "" });
    expect(exitCode).toBe(0);
  });

  // A comment that names a map Bun cannot load is still reported, once.
  test("a comment whose URL cannot be decoded warns one time", async () => {
    using dir = tempDir("sourcemap-url-warn", {
      "entry.js": [
        "// @bun",
        "function thrower() {",
        '  return new Error("ROW");',
        "}",
        "console.log(thrower().stack.split('\\n')[1].trim());",
        "console.log(thrower().stack.split('\\n')[1].trim());",
        "//# sourceMappingURL=data:application/json;base64,AAAA",
        "",
      ].join("\n"),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.js"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({
      frames: stdout
        .trim()
        .split("\n")
        .map(line => line.replace(/:\d+\)$/, ")")),
      warnings: stderr.split("\n").filter(line => line.includes("Could not decode sourcemap")).length,
    }).toEqual({
      frames: Array(2).fill(`at thrower (${join(String(dir), "entry.js")}:3)`),
      warnings: 1,
    });
    expect(exitCode).toBe(0);
  });

  // `bun build --target=bun` of a file that imports a string with such a line:
  // the text of a worker that was built with an inline source map, for example.
  // That map has a mapping for each of the first 40 lines, so a bundle that is
  // read through it reports WORKER.ts.
  const workerMap = JSON.stringify({
    version: 3,
    sources: ["WORKER.ts"],
    sourcesContent: ["// WORKER.ts\n"],
    names: [],
    mappings: "AAAI" + Buffer.alloc(5 * 39, ";AACA").toString(),
  });
  const worker =
    "self.onmessage = () => {};\n" +
    "//# sourceMappingURL=data:application/json;base64," +
    Buffer.from(workerMap).toString("base64") +
    "\n";
  const bundleInput = {
    "dep.js": `export const workerSource = ${JSON.stringify(worker)};\n`,
    "in.ts": [
      'import { workerSource } from "./dep.js";',
      "function thrower(): never {",
      '  throw new Error("BOOM");',
      "}",
      "try {",
      "  thrower();",
      "} catch (e: any) {",
      '  console.log(String(e.stack).split("\\n")[1].trim(), workerSource.length);',
      "}",
      "",
    ].join("\n"),
    // Runs each bundle named on the command line, in order.
    "run.js": `for (const outdir of process.argv.slice(2)) await import("./" + outdir + "/in.js");\n`,
  };
  const sourcemaps = ["external", "inline", "none"] as const;

  // Builds in.ts once for each kind of source map, then runs the bundles in one process.
  async function runBundles(options: Partial<Bun.BuildConfig>, env: typeof bunEnv = bunEnv) {
    using dir = tempDir("sourcemap-url-bundle", bundleInput);
    const expected: string[] = [];
    for (const sourcemap of sourcemaps) {
      const outdir = join(String(dir), sourcemap);
      const build = await Bun.build({
        entrypoints: [join(String(dir), "in.ts")],
        outdir,
        target: "bun",
        sourcemap,
        ...options,
      });
      expect(build.success).toBe(true);
      const bundle = await Bun.file(join(outdir, "in.js")).text();
      // The string has to be in the bundle as a line of its own for this to test anything.
      expect(bundle).toContain("\n" + worker.split("\n")[1] + "\n`");
      // With no source map the frame stays on the line of the bundle that throws.
      const throwLine = bundle.split("\n").findIndex(line => line.includes('throw new Error("BOOM")')) + 1;
      expected.push(
        sourcemap === "none"
          ? `at thrower (${join(outdir, "in.js")}:${throwLine}) ${worker.length}`
          : `at thrower (${join(String(dir), "in.ts")}:3:13) ${worker.length}`,
      );
    }

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run.js", ...sourcemaps],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // A frame that no map moved has a column, which is the engine's to choose.
    const lines = stdout
      .trim()
      .split("\n")
      .map(line => line.replace(/(in\.js:\d+):\d+\)/, "$1)"));
    return { lines, expected, stderr, exitCode };
  }

  for (const format of ["esm", "cjs"] as const) {
    test(`${format} bundles that hold a string with a sourceMappingURL line`, async () => {
      const { lines, expected, stderr, exitCode } = await runBundles({ format });
      expect({ lines, stderr }).toEqual({ lines: expected, stderr: "" });
      expect(exitCode).toBe(0);
    });
  }

  // The engine does not parse the text of a bundle that runs from bytecode.
  // The map of such a bundle is still the one that its text names.
  test("cjs bundles with bytecode that hold a string with a sourceMappingURL line", async () => {
    const { lines, expected, stderr, exitCode } = await runBundles(
      { format: "cjs", bytecode: true },
      { ...bunEnv, BUN_JSC_verboseDiskCache: "1" },
    );
    const log = stderr.split("\n").filter(Boolean);
    expect({
      lines,
      ranFromBytecode: log.filter(line => line === "[Disk Cache] Cache hit for sourceCode").length,
      rest: log.filter(line => !line.startsWith("[Disk Cache]")),
    }).toEqual({ lines: expected, ranFromBytecode: sourcemaps.length, rest: [] });
    expect(exitCode).toBe(0);
  });
});

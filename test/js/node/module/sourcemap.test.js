const { test, expect } = require("bun:test");
const { SourceMap } = require("node:module");
const { bunEnv, bunExe, tempDir } = require("harness");

test("SourceMap class exists", () => {
  expect(SourceMap).toBeDefined();
  expect(typeof SourceMap).toBe("function");
  expect(SourceMap.name).toBe("SourceMap");
});

test("SourceMap constructor requires payload", () => {
  expect(() => {
    new SourceMap();
  }).toThrowErrorMatchingInlineSnapshot(`"The "payload" argument must be of type object. Received undefined"`);
});

test("SourceMap payload must be an object", () => {
  expect(() => {
    new SourceMap("not an object");
  }).toThrowErrorMatchingInlineSnapshot(
    `"The "payload" argument must be of type object. Received type string ('not an object')"`,
  );
});

test("SourceMap instance has expected methods", () => {
  const sourceMap = new SourceMap({
    version: 3,
    sources: ["test.js"],
    mappings: "AAAA",
  });

  expect(typeof sourceMap.findOrigin).toBe("function");
  expect(typeof sourceMap.findEntry).toBe("function");
  expect(sourceMap.findOrigin.length).toBe(2);
  expect(sourceMap.findEntry.length).toBe(2);
});

test("SourceMap payload getter", () => {
  const payload = {
    version: 3,
    sources: ["test.js"],
    mappings: "AAAA",
  };
  const sourceMap = new SourceMap(payload);

  expect(sourceMap.payload).toBe(payload);
});

test("SourceMap lineLengths getter", () => {
  const payload = {
    version: 3,
    sources: ["test.js"],
    mappings: "AAAA",
  };
  const lineLengths = [10, 20, 30];
  const sourceMap = new SourceMap(payload, { lineLengths });

  expect(sourceMap.lineLengths).toBe(lineLengths);
});

test("SourceMap lineLengths undefined when not provided", () => {
  const sourceMap = new SourceMap({
    version: 3,
    sources: ["test.js"],
    mappings: "AAAA",
  });

  expect(sourceMap.lineLengths).toBeUndefined();
});
test("SourceMap findEntry returns mapping data", () => {
  const sourceMap = new SourceMap({
    version: 3,
    sources: ["test.js"],
    mappings: "AAAA",
  });
  const result = sourceMap.findEntry(0, 0);

  expect(result).toMatchInlineSnapshot(`
    {
      "generatedColumn": 0,
      "generatedLine": 0,
      "name": undefined,
      "originalColumn": 0,
      "originalLine": 0,
      "originalSource": "test.js",
    }
  `);
});

test("SourceMap findOrigin returns origin data", () => {
  const sourceMap = new SourceMap({
    version: 3,
    sources: ["test.js"],
    mappings: "AAAA",
  });
  const result = sourceMap.findOrigin(0, 0);

  expect(result).toMatchInlineSnapshot(`
    {
      "column": 0,
      "fileName": "test.js",
      "line": 0,
      "name": undefined,
    }
  `);
});

test("SourceMap with names returns name property correctly", () => {
  const sourceMap = new SourceMap({
    version: 3,
    sources: ["test.js"],
    names: ["myFunction", "myVariable"],
    mappings: "AAAAA,CAACC", // Both segments reference names
  });

  const result = sourceMap.findEntry(0, 0);
  const resultWithName = sourceMap.findEntry(0, 6);
  expect(result).toMatchInlineSnapshot(`
    {
      "generatedColumn": 0,
      "generatedLine": 0,
      "name": "myFunction",
      "originalColumn": 0,
      "originalLine": 0,
      "originalSource": "test.js",
    }
  `);
  expect(resultWithName).toMatchInlineSnapshot(`
    {
      "generatedColumn": 1,
      "generatedLine": 0,
      "name": "myVariable",
      "originalColumn": 1,
      "originalLine": 0,
      "originalSource": "test.js",
    }
  `);
});

test("SourceMap without names has undefined name property", () => {
  const sourceMap = new SourceMap({
    version: 3,
    sources: ["test.js"],
    mappings: "AAAA",
  });

  const result = sourceMap.findEntry(0, 0);
  expect(result).toMatchInlineSnapshot(`
    {
      "generatedColumn": 0,
      "generatedLine": 0,
      "name": undefined,
      "originalColumn": 0,
      "originalLine": 0,
      "originalSource": "test.js",
    }
  `);
});

test("SourceMap with invalid name index has undefined name property", () => {
  const sourceMap = new SourceMap({
    version: 3,
    sources: ["test.js"],
    mappings: "AAAAA,CAACC", // Both segments reference names
  });

  const result = sourceMap.findEntry(0, 0);
  expect(result).toMatchInlineSnapshot(`
    {
      "generatedColumn": 0,
      "generatedLine": 0,
      "name": undefined,
      "originalColumn": 0,
      "originalLine": 0,
      "originalSource": "test.js",
    }
  `);
});

test("SourceMap handles mappings with truncated VLQ segments without crashing", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { SourceMap } = require("node:module");
const truncated = [
  // 'g' decodes to a base64 value with the VLQ continuation bit set, so the
  // decoder expects more bytes than the 1-byte input provides.
  { version: 3, sources: [], mappings: "g" },
  // Both leading VLQ fields are consumed before the segment is complete, so
  // the next field is decoded from an empty remainder.
  { version: 3, sources: ["x.js"], mappings: "AA" },
];
for (const payload of truncated) {
  try {
    new SourceMap(payload);
  } catch (err) {
    // A clean SyntaxError for a malformed mapping is acceptable.
    if (!(err instanceof SyntaxError)) throw err;
  }
}
// A well-formed mapping still parses.
const ok = new SourceMap({ version: 3, sources: ["test.js"], mappings: "AAAA" });
console.log(ok.findEntry(0, 0).originalSource);
console.log("done");`,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("test.js\ndone\n");
  expect(exitCode).toBe(0);
});

test("error.stack of // @bun code with a truncated VLQ in sourceMappingURL warns and degrades gracefully", async () => {
  // 'g' is a single base64 byte with the VLQ continuation bit set, so the
  // mappings string ends mid-value. The generated-column field is truncated,
  // so the decoder makes no progress and parsing fails. Bun must reject the
  // map with a "Could not decode sourcemap" warning instead of silently
  // accepting a bogus `value: 0` mapping, and reading error.stack must still
  // print the unmapped location instead of aborting.
  const map = Buffer.from(
    JSON.stringify({ version: 3, sources: ["a.ts"], sourcesContent: ["x"], names: [], mappings: "g" }),
  ).toString("base64");
  using dir = tempDir("sourcemap-truncated-vlq", {
    "entry.js": `// @bun\nthrow new Error("boom");\n//# sourceMappingURL=data:application/json;base64,${map}\n`,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The truncated mapping is rejected with a warning rather than silently
  // decoded as 0 (which left no trace that the map was corrupt).
  expect(stderr).toContain("Could not decode sourcemap");
  expect(stderr).toContain("error: boom");
  expect(stderr).toContain("entry.js:2:");
  expect(stdout).toBe("");
  expect(exitCode).toBe(1);
});

// `module.findSourceMap(url)` answers for a module that loaded while source maps were enabled:
// the map from the code Bun runs to the file, and the line lengths of that code.
const { describe } = require("bun:test");

describe("findSourceMap", () => {
  const srcTs = [
    // A template literal keeps a line break of its own.
    "export const text: string = `a\r\nb\u2028c`;",
    "export function pick(a: number, b: string | null): string {",
    "  if (a > 1) {",
    "    return 'big'",
    "  }",
    "  return b ?? 'none'",
    "}",
    "export const unused = (): number => 1",
    "",
  ].join("\n");

  async function run(files, args = []) {
    using dir = tempDir("find-source-map", { "src.ts": srcTs, ...files });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args, "main.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderrIfFailed: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
      stdout: expect.any(String),
      stderrIfFailed: "",
      exitCode: 0,
    });
    return JSON.parse(stdout);
  }

  test.concurrent(
    "a module that loaded while source maps were enabled has a map, with payload and lineLengths",
    async () => {
      const out = await run({
        "main.mjs": `
        import { findSourceMap } from "node:module";
        import { Session } from "node:inspector/promises";
        import { fileURLToPath } from "node:url";
        process.setSourceMapsEnabled(true);
        const session = new Session();
        session.connect();
        await session.post("Profiler.enable");
        await session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
        const { pick } = await import("./src.ts");
        pick(0, null);
        const { result } = await session.post("Profiler.takePreciseCoverage");
        const script = result.find(script => script.url.endsWith("/src.ts"));
        const url = import.meta.resolve("./src.ts");
        const map = findSourceMap(url);
        const { lineLengths, payload } = map;
        // The offset of a coverage range is an offset in the code that ran. The line lengths turn it into a
        // line and a column of that code, which the map takes to the file.
        const pickRange = script.functions.find(f => f.functionName === "pick").ranges[0];
        let line = 0, column = pickRange.startOffset;
        while (column > lineLengths[line]) column -= lineLengths[line++] + 1;
        const entry = map.findEntry(line, column);
        console.log(JSON.stringify({
          isSourceMap: map.constructor.name,
          sameObject: findSourceMap(url) === findSourceMap(url) || "a new object each call",
          cached: map.payload === payload && map.lineLengths === lineLengths,
          byPath: findSourceMap(fileURLToPath(url)) instanceof map.constructor,
          payload: { ...payload, mappings: typeof payload.mappings },
          lineLengths,
          wholeScript: script.functions[0].ranges[0].endOffset,
          pick: [entry.originalSource, entry.originalLine, entry.originalColumn],
        }));
      `,
      });
      expect(out.isSourceMap).toBe("SourceMap");
      expect(out.cached).toBe(true);
      expect(out.byPath).toBe(true);
      expect(out.payload).toEqual({
        version: 3,
        sources: [expect.stringMatching(/^file:\/\/.*\/src\.ts$/)],
        names: [],
        mappings: "string",
      });
      // One entry per line of the code that ran, without its line break: the whole-script range ends after the last one.
      expect(out.lineLengths.reduce((sum, length) => sum + length + 1, -1)).toBe(out.wholeScript);
      // The range of `pick` starts at its `function` keyword: line 3, column 7 of src.ts, after `export `.
      expect(out.pick).toEqual([out.payload.sources[0], 3, 7]);
    },
  );

  test.concurrent(
    "a module that loaded before source maps were enabled has no map, and disabling keeps a map",
    async () => {
      const out = await run({
        "main.mjs": `
        import { findSourceMap } from "node:module";
        const url = import.meta.resolve("./src.ts");
        await import("./src.ts");
        const before = findSourceMap(url);
        process.setSourceMapsEnabled(true);
        const enabledAfterLoad = findSourceMap(url);
        await import("./other.ts");
        const otherUrl = import.meta.resolve("./other.ts");
        const other = findSourceMap(otherUrl);
        process.setSourceMapsEnabled(false);
        console.log(JSON.stringify([before, enabledAfterLoad, other?.constructor.name, findSourceMap(otherUrl)?.constructor.name]));
      `,
        "other.ts": "export const n: number = 1;\n",
      });
      expect(out).toEqual([null, null, "SourceMap", "SourceMap"]);
    },
  );

  test.concurrent(
    "--enable-source-maps enables it for the process and its workers, the setter for its thread",
    async () => {
      const worker = `
      import { findSourceMap, getSourceMapsSupport } from "node:module";
      import { Worker, isMainThread } from "node:worker_threads";
      await import("./src.ts");
      const has = findSourceMap(import.meta.resolve("./src.ts")) !== undefined;
      if (isMainThread) {
        const state = [process.sourceMapsEnabled, has];
        process.setSourceMapsEnabled(true);
        const answerOf = options => {
          const worker = new Worker(new URL(import.meta.url), options);
          return new Promise((resolve, reject) => { worker.on("message", resolve); worker.on("error", reject); });
        };
        // A Worker inherits the flags of the process. Its own execArgv stands in for them, as in Node.
        const [inherited, withFlag, withoutFlag] = await Promise.all([
          answerOf(), answerOf({ execArgv: ["--enable-source-maps"] }), answerOf({ execArgv: [] }),
        ]);
        console.log(JSON.stringify({ main: state, inherited, withFlag, withoutFlag, support: getSourceMapsSupport() }));
      } else {
        const { parentPort } = await import("node:worker_threads");
        parentPort.postMessage([process.sourceMapsEnabled, has]);
      }
    `;
      expect(await run({ "main.mjs": worker })).toEqual({
        main: [false, false],
        inherited: [false, false],
        withFlag: [true, true],
        withoutFlag: [false, false],
        support: { enabled: true, nodeModules: true, generatedCode: true },
      });
      expect(await run({ "main.mjs": worker }, ["--enable-source-maps"])).toEqual({
        main: [true, true],
        inherited: [true, true],
        withFlag: [true, true],
        withoutFlag: [false, false],
        support: { enabled: true, nodeModules: true, generatedCode: true },
      });
    },
  );

  test.concurrent("the script of bun -e has no map, and a require()d module has one", async () => {
    using dir = tempDir("find-source-map-eval", {
      "lib.cjs": "exports.n = /** @type {number} */ (1);\n",
    });
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--enable-source-maps",
        "-e",
        `const { findSourceMap } = require("node:module"); require("./lib.cjs"); console.log(JSON.stringify([findSourceMap(process.cwd() + "/[eval]"), findSourceMap(require.resolve("./lib.cjs"))?.lineLengths]));`,
      ],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderrIfFailed: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
      stdout: expect.any(String),
      stderrIfFailed: "",
      exitCode: 0,
    });
    const [evalMap, lineLengths] = JSON.parse(stdout);
    expect(evalMap).toBeNull();
    expect(lineLengths).toEqual(lineLengths.map(() => expect.any(Number)));
    expect(lineLengths.length).toBeGreaterThan(0);
  });

  test.concurrent(
    "bun test --enable-source-maps reaches each file, and a file's setter stays with the file under --isolate",
    async () => {
      using dir = tempDir("find-source-map-test", {
        "src.ts": srcTs,
        "a.test.ts": `
        import { test } from "bun:test";
        import { findSourceMap, getSourceMapsSupport } from "node:module";
        test("a", async () => {
          await import("./src.ts");
          console.log(JSON.stringify([findSourceMap(import.meta.resolve("./src.ts")) !== undefined]));
          process.setSourceMapsEnabled(!getSourceMapsSupport().enabled);
        });
      `,
        "b.test.ts": `
        import { test } from "bun:test";
        import { getSourceMapsSupport } from "node:module";
        test("b", () => {
          console.log(JSON.stringify([getSourceMapsSupport().enabled]));
        });
      `,
      });
      for (const [args, expected] of [
        // Without isolation the files share one VM, so the setter of the first reaches the second.
        [["--enable-source-maps"], [true, false]],
        [
          ["--enable-source-maps", "--isolate"],
          [true, true],
        ],
        [["--isolate"], [false, false]],
      ]) {
        await using proc = Bun.spawn({
          cmd: [bunExe(), "test", ...args, "a.test.ts", "b.test.ts"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ args, stdout, stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
          args,
          stdout: expect.any(String),
          stderr: "",
          exitCode: 0,
        });
        expect(stderr).toContain(" 2 pass");
        const [aHasMap, bEnabled] = stdout
          .trim()
          .split("\n")
          .filter(line => line.startsWith("["))
          .map(line => JSON.parse(line)[0]);
        expect({ args, aHasMap, bEnabled }).toEqual({ args, aHasMap: expected[0], bEnabled: expected[1] });
      }
    },
  );

  test.concurrent(
    "setSourceMapsSupport sets the three, leaves out node_modules unless asked, and validates",
    async () => {
      const out = await run({
        "main.mjs": `
        import { findSourceMap, getSourceMapsSupport, setSourceMapsSupport } from "node:module";
        const codes = [];
        for (const args of [[1], [true, 1], [true, { nodeModules: "yes" }], [true, { generatedCode: 0 }]]) {
          try { setSourceMapsSupport(...args); codes.push("no error"); } catch (error) { codes.push(error.code); }
        }
        const before = getSourceMapsSupport();
        setSourceMapsSupport(true);
        const plain = getSourceMapsSupport();
        await import("./src.ts");
        await import("./node_modules/dep/index.ts");
        const depUrl = import.meta.resolve("./node_modules/dep/index.ts");
        const withoutNodeModules = [findSourceMap(import.meta.resolve("./src.ts"))?.constructor.name, findSourceMap(depUrl)];
        setSourceMapsSupport(true, { nodeModules: true });
        await import("./node_modules/dep/other.ts");
        const withNodeModules = [findSourceMap(depUrl), findSourceMap(import.meta.resolve("./node_modules/dep/other.ts"))?.constructor.name];
        console.log(JSON.stringify({
          codes, before, plain, frozen: Object.isFrozen(plain) && Object.getPrototypeOf(plain) === null,
          full: getSourceMapsSupport(), withoutNodeModules, withNodeModules,
          bad: [findSourceMap(), findSourceMap(1), findSourceMap("foo"), findSourceMap("file://%zz"), findSourceMap("node:fs")],
        }));
      `,
        "node_modules/dep/index.ts": "export const a: number = 1;\n",
        "node_modules/dep/other.ts": "export const b: number = 2;\n",
      });
      expect(out).toEqual({
        codes: ["ERR_INVALID_ARG_TYPE", "ERR_INVALID_ARG_TYPE", "ERR_INVALID_ARG_TYPE", "ERR_INVALID_ARG_TYPE"],
        before: { enabled: false, nodeModules: false, generatedCode: false },
        plain: { enabled: true, nodeModules: false, generatedCode: false },
        frozen: true,
        full: { enabled: true, nodeModules: true, generatedCode: false },
        withoutNodeModules: ["SourceMap", null],
        withNodeModules: [null, "SourceMap"],
        bad: [null, null, null, null, null],
      });
    },
  );
});

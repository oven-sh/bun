const { describe, test, expect } = require("bun:test");
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

// A `// @bun` file is not transpiled again: bun reads the map beside it, or the
// inline one, as it is. ";;EAIE" maps generated 3:3 to original 5:3 of source
// 0. ";;ECIE" maps it to source 1.
describe.concurrent("// @bun code with a source map that has no sourcesContent", () => {
  const map = { version: 3, sources: ["original.ts"], names: [], mappings: ";;EAIE" };
  const throwsOnLine3 = `// @bun\nexport function t() {\n  throw new Error("SC");\n}\n`;
  const printFirstFrames = `
    for (const file of process.argv.slice(2)) {
      const { t } = await import("./" + file);
      try {
        t();
      } catch (e) {
        console.log(file + ": " + e.stack.split("\\n")[1].trim());
      }
    }
  `;

  // `<name>.js` has the map beside it. `<name>.inline.js` has it inline.
  function builtFiles(name, map) {
    const json = JSON.stringify(map);
    return {
      [`${name}.js`]: throwsOnLine3 + `//# sourceMappingURL=${name}.js.map\n`,
      [`${name}.js.map`]: json,
      [`${name}.inline.js`]: throwsOnLine3 + `//# sourceMappingURL=data:application/json;base64,${btoa(json)}\n`,
    };
  }

  async function run(dir, ...args) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const clean = text => text.replaceAll(String(dir), "<dir>").replaceAll("\\", "/");
    return { stdout: clean(stdout), stderr: clean(stderr), exitCode };
  }

  test("error.stack is remapped when sourcesContent is absent, null, shorter or longer than sources", async () => {
    using dir = tempDir("sourcemap-sources-content", {
      "main.js": printFirstFrames,
      ...builtFiles("absent", map),
      ...builtFiles("null", { ...map, sourcesContent: null }),
      ...builtFiles("empty", { ...map, sourcesContent: [] }),
      ...builtFiles("shorter", {
        ...map,
        sources: ["other.ts", "original.ts"],
        sourcesContent: ["x"],
        mappings: ";;ECIE",
      }),
      ...builtFiles("longer", { ...map, sourcesContent: ["x", "y"] }),
    });
    const files = ["absent", "null", "empty", "shorter", "longer"].flatMap(name => [`${name}.js`, `${name}.inline.js`]);

    const { stdout, stderr, exitCode } = await run(dir, "main.js", ...files);
    expect({ stdout, stderr }).toEqual({
      stdout: files.map(file => `${file}: at t (<dir>/original.ts:5:3)\n`).join(""),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test("a sourcesContent that is not an array or null is refused", async () => {
    using dir = tempDir("sourcemap-sources-content-refused", {
      "main.js": printFirstFrames,
      ...builtFiles("string", { ...map, sourcesContent: "x" }),
      ...builtFiles("object", { ...map, sourcesContent: {} }),
    });
    const files = ["string.js", "string.inline.js", "object.js", "object.inline.js"];

    const { stdout, stderr, exitCode } = await run(dir, "main.js", ...files);
    expect({ stdout, stderr }).toEqual({
      stdout: files.map(file => `${file}: at t (<dir>/${file}:3:18)\n`).join(""),
      stderr: files.map(file => `warn: Could not decode sourcemap in '<dir>/${file}': InvalidSourceMap\n`).join(""),
    });
    expect(exitCode).toBe(0);
  });

  test("an inline map without sourcesContent is used, not the .map file beside it", async () => {
    using dir = tempDir("sourcemap-sources-content-inline-first", {
      "main.js": printFirstFrames,
      "both.js": builtFiles("both", { ...map, sources: ["inline.ts"] })["both.inline.js"],
      "both.js.map": JSON.stringify({ ...map, sources: ["beside.ts"], sourcesContent: ["x"] }),
    });

    const { stdout, stderr, exitCode } = await run(dir, "main.js", "both.js");
    expect({ stdout, stderr }).toEqual({ stdout: "both.js: at t (<dir>/inline.ts:5:3)\n", stderr: "" });
    expect(exitCode).toBe(0);
  });

  test("CallSite positions and the printed error are remapped, with the source text read from disk", async () => {
    using dir = tempDir("sourcemap-sources-content-printer", {
      ...builtFiles("absent", map),
      "original.ts": `// 1\n// 2\n// 3\nexport function t() {\n  throw new Error("SC");\n}\n`,
      "main.js": `
        import { t } from "./absent.js";
        Error.prepareStackTrace = (_, [site]) => [site.getFileName(), site.getLineNumber(), site.getColumnNumber()].join(":");
        try {
          t();
        } catch (e) {
          console.log(e.stack);
        }
        Error.prepareStackTrace = undefined;
        try {
          t();
        } catch (e) {
          console.log(Bun.inspect(e).split("\\n").slice(0, 8).join("\\n"));
        }
      `,
    });

    const { stdout, stderr, exitCode } = await run(dir, "main.js");
    expect({ stdout, stderr }).toEqual({
      stdout: [
        "<dir>/original.ts:5:3",
        "1 | // 1",
        "2 | // 2",
        "3 | // 3",
        "4 | export function t() {",
        '5 |   throw new Error("SC");',
        "      ^",
        "error: SC",
        "      at t (<dir>/original.ts:5:3)",
        "",
      ].join("\n"),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });
});

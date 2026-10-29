const { test, expect } = require("bun:test");
const { readFileSync } = require("node:fs");
const { SourceMap } = require("node:module");
const path = require("node:path");
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

// A 1-field segment (a generated column and nothing else) says that the code from that column on has no
// original position. The expected entries are what Node v26.3.0 returns for the same payload and arguments.
const mapped = (generatedLine, generatedColumn, originalLine, originalColumn, name) => ({
  generatedLine,
  generatedColumn,
  originalSource: "a.ts",
  originalLine,
  originalColumn,
  name,
});
const unmapped = (generatedLine, generatedColumn) => ({
  generatedLine,
  generatedColumn,
  originalSource: undefined,
  originalLine: undefined,
  originalColumn: undefined,
  name: undefined,
});

test.each([
  {
    name: "un-maps the rest of its line",
    mappings: ";;EAIE,G;",
    entries: [
      [2, 1, {}],
      [2, 2, mapped(2, 2, 4, 2)],
      [2, 4, mapped(2, 2, 4, 2)],
      [2, 5, unmapped(2, 5)],
      [2, 8, unmapped(2, 5)],
    ],
  },
  {
    name: "ends at the next 4-field segment",
    mappings: "AAAA,G,GAAG;",
    entries: [
      [0, 0, mapped(0, 0, 0, 0)],
      [0, 2, mapped(0, 0, 0, 0)],
      [0, 3, unmapped(0, 3)],
      [0, 5, unmapped(0, 3)],
      [0, 6, mapped(0, 6, 0, 3)],
      [0, 9, mapped(0, 6, 0, 3)],
    ],
  },
  {
    name: "is the first segment of a line",
    mappings: "G,EAAA;",
    entries: [
      [0, 2, {}],
      [0, 3, unmapped(0, 3)],
      [0, 4, unmapped(0, 3)],
      [0, 5, mapped(0, 5, 0, 0)],
    ],
  },
  {
    name: "is on each of two lines",
    mappings: "AAAA,G;AACA,E;",
    entries: [
      [0, 3, unmapped(0, 3)],
      [1, 1, mapped(1, 0, 1, 0)],
      [1, 2, unmapped(1, 2)],
      [1, 7, unmapped(1, 2)],
    ],
  },
  {
    name: "comes after a 4-field segment at the same column",
    mappings: "AAAA,A;",
    entries: [
      [0, 0, unmapped(0, 0)],
      [0, 5, unmapped(0, 0)],
    ],
  },
  {
    name: "comes before a 4-field segment at the same column",
    mappings: "A,AAAA;",
    entries: [
      [0, 0, mapped(0, 0, 0, 0)],
      [0, 5, mapped(0, 0, 0, 0)],
    ],
  },
  {
    name: "is between two segments that have names",
    mappings: "AAAAA,G,GAAGC;",
    entries: [
      [0, 0, mapped(0, 0, 0, 0, "n0")],
      [0, 3, unmapped(0, 3)],
      [0, 5, unmapped(0, 3)],
      [0, 6, mapped(0, 6, 0, 3, "n1")],
    ],
  },
  {
    name: "has a negative column delta",
    mappings: "KAAA,F;",
    entries: [
      [0, 2, {}],
      [0, 3, unmapped(0, 3)],
      [0, 4, unmapped(0, 3)],
      [0, 5, mapped(0, 5, 0, 0)],
      [0, 6, mapped(0, 5, 0, 0)],
    ],
  },
])("SourceMap findEntry: a 1-field segment $name", ({ mappings, entries }) => {
  const sourceMap = new SourceMap({ version: 3, sources: ["a.ts"], names: ["n0", "n1"], mappings });
  for (const [line, column, entry] of entries) {
    expect({ line, column, entry: sourceMap.findEntry(line, column) }).toStrictEqual({ line, column, entry });
  }
});

test("SourceMap findEntry keeps the 1-field segments of a payload without sources", () => {
  const sourceMap = new SourceMap({ version: 3, sources: [], names: [], mappings: "C,E;G;" });
  const entries = [
    [0, 0, {}],
    [0, 1, unmapped(0, 1)],
    [0, 2, unmapped(0, 1)],
    [0, 3, unmapped(0, 3)],
    [0, 9, unmapped(0, 3)],
    [1, 3, unmapped(1, 3)],
  ];
  for (const [line, column, entry] of entries) {
    expect({ line, column, entry: sourceMap.findEntry(line, column) }).toStrictEqual({ line, column, entry });
  }
});

test("SourceMap findOrigin returns nothing after a 1-field segment", () => {
  const sourceMap = new SourceMap({ version: 3, sources: ["a.ts"], names: [], mappings: "AAAA,G,GAAG;" });
  expect([0, 2, 3, 5, 6].map(column => sourceMap.findOrigin(0, column))).toStrictEqual([
    { name: undefined, line: 0, column: 0, fileName: "a.ts" },
    { name: undefined, line: 0, column: 0, fileName: "a.ts" },
    {},
    {},
    { name: undefined, line: 0, column: 3, fileName: "a.ts" },
  ]);
});

test("SourceMap findEntry reads a 1-field segment at the end of mappings as unmapped", () => {
  // ECMA-426 does not ask for a separator after the last segment (`Mapping : GeneratedColumn`). Node v26.3.0
  // reads past the end of the string there and returns the previous original position at the new column, with
  // names[0]. https://github.com/nodejs/node/pull/66264 changes Node to the answer below.
  const afterMapped = new SourceMap({ version: 3, sources: ["a.ts"], names: ["n0"], mappings: "AAAA,G" });
  const alone = new SourceMap({ version: 3, sources: ["a.ts"], names: ["n0"], mappings: "G" });
  expect({
    afterMapped: [2, 3, 9].map(column => afterMapped.findEntry(0, column)),
    alone: [2, 3, 9].map(column => alone.findEntry(0, column)),
  }).toStrictEqual({
    afterMapped: [mapped(0, 0, 0, 0), unmapped(0, 3), unmapped(0, 3)],
    alone: [{}, unmapped(0, 3), unmapped(0, 3)],
  });
});

test("SourceMap findEntry passes the tc39 mapping-semantics vectors", () => {
  // https://github.com/tc39/source-map-tests, vendored with Node's fixtures.
  const test426 = path.join(__dirname, "..", "test", "fixtures", "test426");
  const { tests } = JSON.parse(readFileSync(path.join(test426, "source-map-spec-tests.json"), "utf8"));
  const vectors = tests.filter(vector => vector.name.startsWith("mappingSemantics"));
  expect(vectors.map(vector => vector.name)).toEqual([
    "mappingSemanticsSingleFieldSegment",
    "mappingSemanticsFourFieldSegment",
    "mappingSemanticsFiveFieldSegment",
    "mappingSemanticsColumnReset",
    "mappingSemanticsRelative1",
    "mappingSemanticsRelative2",
  ]);
  for (const { name, sourceMapFile, testActions } of vectors) {
    const sourceMap = new SourceMap(JSON.parse(readFileSync(path.join(test426, "resources", sourceMapFile), "utf8")));
    const found = testActions.map(({ actionType, generatedLine, generatedColumn }) => {
      const entry = sourceMap.findEntry(generatedLine, generatedColumn);
      return {
        actionType,
        generatedLine,
        generatedColumn,
        originalSource: entry.originalSource ?? null,
        originalLine: entry.originalLine ?? null,
        originalColumn: entry.originalColumn ?? null,
        mappedName: entry.name ?? null,
      };
    });
    expect({ name, found }).toEqual({ name, found: testActions });
  }
});

// `unmapped` throws after a 1-field segment and `mapped` throws where a 4-field segment is the last one.
const oneFieldFixture = `// @bun
function unmapped() {
  throw new Error("unmapped");
}
function mapped() {
  throw new Error("mapped");
}
if (process.argv[2] === "uncaught") unmapped();
for (const fn of [unmapped, mapped]) {
  try {
    fn();
  } catch (e) {
    console.log(e.stack.split("\\n")[1].trim());
  }
}
Error.prepareStackTrace = (_, [site]) => site.getFileName() + ":" + site.getLineNumber() + ":" + site.getColumnNumber();
for (const fn of [unmapped, mapped]) {
  try {
    fn();
  } catch (e) {
    console.log(e.stack);
  }
}
`;
const oneFieldFixtureMap = JSON.stringify({
  version: 3,
  sources: ["original.ts"],
  sourcesContent: ["// 1\n// 2\n// 3\n// 4\n  original_line_5();\n// 6\n// 7\n  original_line_8();\n"],
  names: [],
  // Line 3: "EAIE" maps column 2 to original.ts 5:3, then "G" un-maps the line from column 5.
  // Line 6: "EAGA" maps column 2 to original.ts 8:3.
  mappings: ";;EAIE,G;;;EAGA;",
});

test.concurrent.each([
  [
    "in a .map file",
    { "entry.js": oneFieldFixture + "//# sourceMappingURL=entry.js.map\n", "entry.js.map": oneFieldFixtureMap },
  ],
  [
    "in a data: URL",
    {
      "entry.js":
        oneFieldFixture +
        "//# sourceMappingURL=data:application/json;base64," +
        Buffer.from(oneFieldFixtureMap).toString("base64") +
        "\n",
    },
  ],
])("a frame of // @bun code after a 1-field segment keeps its generated position: map %s", async (_, files) => {
  using dir = tempDir("sourcemap-one-field", files);
  const run = async (...args) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "entry.js", ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = text => text.replaceAll(String(dir), "<dir>").replaceAll("\\", "/").split(/\r?\n/);
    return { stdout: lines(stdout), stderr: lines(stderr), exitCode };
  };

  expect(await run()).toEqual({
    stdout: [
      // error.stack
      "at unmapped (<dir>/entry.js:3:18)",
      "at mapped (<dir>/original.ts:8:3)",
      // Error.prepareStackTrace call sites
      "<dir>/entry.js:3:9",
      "<dir>/original.ts:8:3",
      "",
    ],
    stderr: [""],
    exitCode: 0,
  });

  // The uncaught error: its frame, and the line of entry.js above the caret.
  const uncaught = await run("uncaught");
  const caret = uncaught.stderr.findIndex(line => line.trim() === "^");
  expect({
    preview: uncaught.stderr[caret - 1],
    frames: uncaught.stderr.filter(line => line.trimStart().startsWith("at ")),
    stdout: uncaught.stdout,
    exitCode: uncaught.exitCode,
  }).toEqual({
    preview: '3 |   throw new Error("unmapped");',
    frames: ["      at unmapped (<dir>/entry.js:3:9)", "      at <dir>/entry.js:8:45"],
    stdout: [""],
    exitCode: 1,
  });
});

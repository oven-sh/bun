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

test("SourceMap findEntry in a segment with one field returns the generated position only", () => {
  const sourceMap = new SourceMap({ version: 3, sources: ["a.ts"], names: [], mappings: "AAAA,I,IAAQ" });
  const entry = sourceMap.findEntry(0, 5);

  // Node.js v26.13.0 returns this object: the four other keys exist and are undefined.
  expect(entry).toStrictEqual({
    generatedLine: 0,
    generatedColumn: 4,
    originalSource: undefined,
    originalLine: undefined,
    originalColumn: undefined,
    name: undefined,
  });
  expect(JSON.stringify(entry)).toBe('{"generatedLine":0,"generatedColumn":4}');
  expect(sourceMap.findOrigin(0, 5)).toStrictEqual({});
});

// Every entry in this table is what Node.js v26.13.0 returns for the same findEntry call.
const oneFieldSegments = [
  [
    "in the middle of a line",
    "AAAA,I,IAAQ",
    [],
    [
      [0, 3, { generatedLine: 0, generatedColumn: 0, originalSource: "a.ts", originalLine: 0, originalColumn: 0 }],
      [0, 4, { generatedLine: 0, generatedColumn: 4 }],
      [0, 5, { generatedLine: 0, generatedColumn: 4 }],
      [0, 7, { generatedLine: 0, generatedColumn: 4 }],
      [0, 8, { generatedLine: 0, generatedColumn: 8, originalSource: "a.ts", originalLine: 0, originalColumn: 8 }],
      [0, 9, { generatedLine: 0, generatedColumn: 8, originalSource: "a.ts", originalLine: 0, originalColumn: 8 }],
    ],
  ],
  [
    "first on a line",
    "E,IAAA",
    [],
    [
      [0, 1, {}],
      [0, 2, { generatedLine: 0, generatedColumn: 2 }],
      [0, 5, { generatedLine: 0, generatedColumn: 2 }],
      [0, 6, { generatedLine: 0, generatedColumn: 6, originalSource: "a.ts", originalLine: 0, originalColumn: 0 }],
    ],
  ],
  [
    "last on a line",
    "AAAA,U;AACA",
    [],
    [
      [0, 9, { generatedLine: 0, generatedColumn: 0, originalSource: "a.ts", originalLine: 0, originalColumn: 0 }],
      [0, 10, { generatedLine: 0, generatedColumn: 10 }],
      [0, 12, { generatedLine: 0, generatedColumn: 10 }],
      [1, 0, { generatedLine: 1, generatedColumn: 0, originalSource: "a.ts", originalLine: 1, originalColumn: 0 }],
    ],
  ],
  [
    "last on the last line",
    "AAAA,I;",
    [],
    [
      [0, 3, { generatedLine: 0, generatedColumn: 0, originalSource: "a.ts", originalLine: 0, originalColumn: 0 }],
      [0, 4, { generatedLine: 0, generatedColumn: 4 }],
      [0, 5, { generatedLine: 0, generatedColumn: 4 }],
    ],
  ],
  [
    "last in the string",
    "AAAA,I",
    [],
    [
      [0, 3, { generatedLine: 0, generatedColumn: 0, originalSource: "a.ts", originalLine: 0, originalColumn: 0 }],
      [0, 4, { generatedLine: 0, generatedColumn: 4, originalSource: "a.ts", originalLine: 0, originalColumn: 0 }],
      [0, 5, { generatedLine: 0, generatedColumn: 4, originalSource: "a.ts", originalLine: 0, originalColumn: 0 }],
    ],
  ],
  [
    "alone in the string",
    "E",
    [],
    [
      [0, 1, {}],
      [0, 2, { generatedLine: 0, generatedColumn: 2, originalSource: "a.ts", originalLine: 0, originalColumn: 0 }],
      [0, 3, { generatedLine: 0, generatedColumn: 2, originalSource: "a.ts", originalLine: 0, originalColumn: 0 }],
    ],
  ],
  [
    "two in a row",
    "AAAA,I,I,IAAY",
    [],
    [
      [0, 3, { generatedLine: 0, generatedColumn: 0, originalSource: "a.ts", originalLine: 0, originalColumn: 0 }],
      [0, 4, { generatedLine: 0, generatedColumn: 4 }],
      [0, 7, { generatedLine: 0, generatedColumn: 4 }],
      [0, 8, { generatedLine: 0, generatedColumn: 8 }],
      [0, 11, { generatedLine: 0, generatedColumn: 8 }],
      [0, 12, { generatedLine: 0, generatedColumn: 12, originalSource: "a.ts", originalLine: 0, originalColumn: 12 }],
    ],
  ],
  [
    "on a later line",
    "AAAA;AACA,I,IAAQ",
    [],
    [
      [1, 3, { generatedLine: 1, generatedColumn: 0, originalSource: "a.ts", originalLine: 1, originalColumn: 0 }],
      [1, 4, { generatedLine: 1, generatedColumn: 4 }],
      [1, 6, { generatedLine: 1, generatedColumn: 4 }],
      [1, 8, { generatedLine: 1, generatedColumn: 8, originalSource: "a.ts", originalLine: 1, originalColumn: 8 }],
    ],
  ],
  [
    "alone on a later line",
    "AAAA;A;AAEA",
    [],
    [
      [0, 7, { generatedLine: 0, generatedColumn: 0, originalSource: "a.ts", originalLine: 0, originalColumn: 0 }],
      [1, 0, { generatedLine: 1, generatedColumn: 0 }],
      [1, 7, { generatedLine: 1, generatedColumn: 0 }],
      [2, 0, { generatedLine: 2, generatedColumn: 0, originalSource: "a.ts", originalLine: 2, originalColumn: 0 }],
    ],
  ],
  [
    "at the column of the segment before it",
    "AAAA,A,IAAI",
    [],
    [
      [0, 0, { generatedLine: 0, generatedColumn: 0 }],
      [0, 3, { generatedLine: 0, generatedColumn: 0 }],
      [0, 4, { generatedLine: 0, generatedColumn: 4, originalSource: "a.ts", originalLine: 0, originalColumn: 4 }],
    ],
  ],
  [
    "before the segment before it",
    "IAAA,H,QAAQ",
    [],
    [
      [0, 0, {}],
      [0, 1, { generatedLine: 0, generatedColumn: 1 }],
      [0, 3, { generatedLine: 0, generatedColumn: 1 }],
      [0, 4, { generatedLine: 0, generatedColumn: 4, originalSource: "a.ts", originalLine: 0, originalColumn: 0 }],
      [0, 9, { generatedLine: 0, generatedColumn: 9, originalSource: "a.ts", originalLine: 0, originalColumn: 8 }],
    ],
  ],
  [
    "between segments that have names",
    "AAAAA,I,IAAQC",
    ["x", "y"],
    [
      [
        0,
        3,
        { generatedLine: 0, generatedColumn: 0, originalSource: "a.ts", originalLine: 0, originalColumn: 0, name: "x" },
      ],
      [0, 4, { generatedLine: 0, generatedColumn: 4 }],
      [0, 7, { generatedLine: 0, generatedColumn: 4 }],
      [
        0,
        8,
        { generatedLine: 0, generatedColumn: 8, originalSource: "a.ts", originalLine: 0, originalColumn: 8, name: "y" },
      ],
    ],
  ],
];

test.each(oneFieldSegments)("SourceMap findEntry with a one-field segment %s", (_, mappings, names, entries) => {
  const sourceMap = new SourceMap({ version: 3, sources: ["a.ts"], names, mappings });
  for (const [line, column, entry] of entries) {
    expect({ line, column, entry: sourceMap.findEntry(line, column) }).toEqual({ line, column, entry });
  }
});

test("SourceMap findEntry with a one-field segment last in the string of a map that has no sources", () => {
  const sourceMap = new SourceMap({ version: 3, sources: [], names: [], mappings: "E,I" });

  // Node.js v26.13.0 adds originalLine 0 and originalColumn 0 to the second entry, of a source that does not exist.
  expect([sourceMap.findEntry(0, 3), sourceMap.findEntry(0, 7)]).toEqual([
    { generatedLine: 0, generatedColumn: 2 },
    { generatedLine: 0, generatedColumn: 6 },
  ]);
  expect(sourceMap.findOrigin(0, 7)).toStrictEqual({});
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

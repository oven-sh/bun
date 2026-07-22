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

test("SourceMap payload getter returns a fresh clone", () => {
  const payload = {
    version: 3,
    sources: ["test.js"],
    names: ["fn"],
    sourcesContent: ["src"],
    mappings: "AAAAA",
  };
  const sourceMap = new SourceMap(payload);

  const first = sourceMap.payload;
  expect(first).toEqual(payload);
  expect(first).not.toBe(payload);
  // Every array-valued property is sliced, not just sources.
  expect(first.sources).not.toBe(payload.sources);
  expect(first.names).not.toBe(payload.names);
  expect(first.sourcesContent).not.toBe(payload.sourcesContent);
  expect(sourceMap.payload).not.toBe(first);

  // Mutating the caller's object or its arrays after construction must not
  // leak through.
  payload.file = "mutated";
  payload.sources.push("leaked");
  payload.names.push("leaked");
  expect(sourceMap.payload.file).toBeUndefined();
  expect(sourceMap.payload.sources).toEqual(["test.js"]);
  expect(sourceMap.payload.names).toEqual(["fn"]);

  // Mutating a returned clone must not leak into later reads.
  first.version = 99;
  first.sources.push("leaked");
  expect(sourceMap.payload.version).toBe(3);
  expect(sourceMap.payload.sources).toEqual(["test.js"]);
});

test("SourceMap payload without sources is cloned without crashing", () => {
  const sourceMap = new SourceMap({ version: 3, mappings: ";;" });
  expect(sourceMap.payload).toEqual({ version: 3, mappings: ";;" });
  expect(sourceMap.findEntry(0, 0)).toEqual({});
});

test("SourceMap lineLengths getter returns a fresh copy", () => {
  const payload = {
    version: 3,
    sources: ["test.js"],
    mappings: "AAAA",
  };
  const lineLengths = [10, 20, 30];
  const sourceMap = new SourceMap(payload, { lineLengths });

  const first = sourceMap.lineLengths;
  expect(first).toEqual([10, 20, 30]);
  expect(first).not.toBe(lineLengths);
  expect(sourceMap.lineLengths).not.toBe(first);

  // Mutating a returned copy must not leak into later reads.
  first.push(99);
  expect(sourceMap.lineLengths).toEqual([10, 20, 30]);
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
  // findOrigin takes 1-based Error-stack line/column and returns 1-based
  // lineNumber/columnNumber.
  const result = sourceMap.findOrigin(1, 1);

  expect(result).toMatchInlineSnapshot(`
    {
      "columnNumber": 1,
      "fileName": "test.js",
      "lineNumber": 1,
      "name": undefined,
    }
  `);
});

test("SourceMap findOrigin is 1-based and findEntry clamps to the closest preceding entry", () => {
  const payload = {
    version: 3,
    file: "out.js",
    sources: ["a.ts", "b.ts"],
    names: [],
    mappings: "AAAA,IACC;AAAC,GCAE",
  };
  const sourceMap = new SourceMap(payload);

  // Row/column 0 are before the first 1-based position.
  expect(sourceMap.findOrigin(1, 0)).toEqual({});
  expect(sourceMap.findOrigin(0, 0)).toEqual({});

  // findOrigin offsets the original position by the distance from the matched
  // generated position, so the returned column tracks the input column.
  expect(sourceMap.findOrigin(2, 5)).toEqual({
    name: undefined,
    fileName: "b.ts",
    lineNumber: 2,
    columnNumber: 6,
  });

  // Past the last mapping, findEntry returns the closest preceding entry.
  expect(sourceMap.findEntry(99, 99)).toEqual({
    generatedLine: 1,
    generatedColumn: 3,
    originalSource: "b.ts",
    originalLine: 1,
    originalColumn: 4,
    name: undefined,
  });

  // Before the first mapping it stays {}.
  expect(sourceMap.findEntry(-1, -1)).toEqual({});
  expect(sourceMap.findEntry(0, -1)).toEqual({});

  // A negative column on a later line still resolves to the preceding line.
  expect(sourceMap.findEntry(1, -1)).toEqual({
    generatedLine: 0,
    generatedColumn: 4,
    originalSource: "a.ts",
    originalLine: 1,
    originalColumn: 1,
    name: undefined,
  });
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

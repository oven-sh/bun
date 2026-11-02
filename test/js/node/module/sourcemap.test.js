const { test, expect } = require("bun:test");
const { readFileSync } = require("node:fs");
const { SourceMap } = require("node:module");
const { join } = require("node:path");
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

// [generatedLine, generatedColumn, name] of each segment, as findEntry answers it.
function namesOfSegments(mappings, segments) {
  const sourceMap = new SourceMap({ version: 3, sources: ["a.ts"], names: ["x", "y"], mappings });
  return segments.map(([line, column]) => [line, column, sourceMap.findEntry(line, column).name]);
}

// A segment has a name only when it has a fifth field: the name index of an
// earlier five-field segment does not carry over to a four-field segment.
// Each row is the mappings, then [generatedLine, generatedColumn, name] of
// every segment. The names are the ones Node.js v26.3.0 answers.
test.each([
  ["AAAAA,IAAI;", [0, 0, "x"], [0, 4, undefined]],
  ["AAAAA,CAAC,CAAC;", [0, 0, "x"], [0, 1, undefined], [0, 2, undefined]],
  ["AAAAA;AAAA;", [0, 0, "x"], [1, 0, undefined]],
  ["AAAAA,CAAC;AACA,CAAC;", [0, 0, "x"], [0, 1, undefined], [1, 0, undefined], [1, 1, undefined]],
  ["AAAA,CAACA,CAAC;", [0, 0, undefined], [0, 1, "x"], [0, 2, undefined]],
  // The name index changes between the four-field segments.
  ["AAAAA,CAAC,CAACC,CAAC;", [0, 0, "x"], [0, 1, undefined], [0, 2, "y"], [0, 3, undefined]],
  ["AAAAC,CAAC,CAACD,CAAC;", [0, 0, "y"], [0, 1, undefined], [0, 2, "x"], [0, 3, undefined]],
  // The running name index survives a four-field segment and a ';'.
  ["AAAAC,CAAC,CAACA", [0, 0, "y"], [0, 1, undefined], [0, 2, "y"]],
  ["AAAAC;AACA;AACAA;AACA;", [0, 0, "y"], [1, 0, undefined], [2, 0, "y"], [3, 0, undefined]],
  // The segments are at generated columns 10, 2 and 6: each row keeps its name when the rows are sorted.
  ["UAAAC,RAAA,IAAAD;", [0, 2, undefined], [0, 6, "x"], [0, 10, "y"]],
])("SourceMap gives a four-field segment no name: %s", (mappings, ...segments) => {
  expect(namesOfSegments(mappings, segments)).toEqual(segments);
});

// Node.js v26.3.0 reads past the end of the mappings: a fifth field after a
// four-field segment that ends the string, or a whole segment after a last
// comma. So it answers names[nameIndex] for the last segment of each row here:
// "x", "x", "y", "x", "x" and "x". ECMA-426 gives that segment no name.
// https://github.com/nodejs/node/issues/63795
test.each([
  ["AAAAA,CAAC", [0, 0, "x"], [0, 1, undefined]],
  ["AAAAA,CAAC,", [0, 0, "x"], [0, 1, undefined]],
  ["AAAAC,CAAC", [0, 0, "y"], [0, 1, undefined]],
  ["AAAA,CAAC", [0, 0, undefined], [0, 1, undefined]],
  ["AAAA", [0, 0, undefined]],
  ["AAAA,", [0, 0, undefined]],
])("SourceMap gives a four-field segment that ends the mappings no name: %s", (mappings, ...segments) => {
  expect(namesOfSegments(mappings, segments)).toEqual(segments);
});

test("SourceMap findOrigin gives a four-field segment no name", () => {
  // Both lines have the same segments, so the answer is the same whether the
  // arguments count from 0 or, as in Node.js, from 1.
  const sourceMap = new SourceMap({
    version: 3,
    sources: ["a.ts"],
    names: ["x", "y"],
    mappings: "AAAAA,IAAI;AAAAA,IAAI;",
  });
  expect([sourceMap.findOrigin(1, 2).name, sourceMap.findOrigin(1, 6).name]).toEqual(["x", undefined]);
});

test("SourceMap answers every mapping of the tc39 basicMapping test", () => {
  const fixtures = join(__dirname, "..", "test", "fixtures", "test426");
  const { tests } = JSON.parse(readFileSync(join(fixtures, "source-map-spec-tests.json"), "utf8"));
  const { sourceMapFile, testActions } = tests.find(({ name }) => name === "basicMapping");
  const sourceMap = new SourceMap(JSON.parse(readFileSync(join(fixtures, "resources", sourceMapFile), "utf8")));

  expect(testActions.length).toBe(12);
  expect(
    testActions.map(({ actionType, generatedLine, generatedColumn }) => {
      const entry = sourceMap.findEntry(generatedLine, generatedColumn);
      return {
        actionType,
        generatedLine,
        generatedColumn,
        originalSource: entry.originalSource,
        originalLine: entry.originalLine,
        originalColumn: entry.originalColumn,
        mappedName: entry.name ?? null,
      };
    }),
  ).toEqual(testActions);
});

// "g" has the VLQ continuation bit set, so the name field has no last digit.
test.each([
  ["in 5 bytes of mappings", "AAAAg", 4],
  ["after 205 bytes that the SIMD decoder takes", Buffer.alloc(205, "CAAC,").toString() + "CAACg", 209],
])("SourceMap rejects a name field that the mappings cut short %s", (_, mappings, offset) => {
  let error;
  try {
    new SourceMap({ version: 3, sources: ["a.ts"], names: ["x"], mappings });
  } catch (thrown) {
    error = thrown;
  }
  expect(error).toBeInstanceOf(SyntaxError);
  expect(error.message).toBe(`Invalid name index delta at ${offset}`);
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

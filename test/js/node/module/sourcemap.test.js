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

// +1 written with `digits` digits. "i" is +1 with the continuation bit, "g" is
// a zero digit with the continuation bit, "A" is the terminal digit.
const plusOne = digits => "i" + Buffer.alloc(digits - 2, "g").toString() + "A";

test.each([8, 9, 13, 1987])("SourceMap reads a VLQ written with %d digits in each of the five fields", digits => {
  const changedByField = [
    { generatedColumn: 1 },
    { originalSource: "b.js" },
    { originalLine: 1 },
    { originalColumn: 1 },
    { name: "n1" },
  ];
  const entries = changedByField.map((_, field) => {
    const segment = ["A", "A", "A", "A", "A"];
    segment[field] = plusOne(digits);
    const map = new SourceMap({
      version: 3,
      sources: ["a.js", "b.js"],
      names: ["n0", "n1"],
      mappings: segment.join(""),
    });
    return map.findEntry(0, 1);
  });
  const unchanged = {
    generatedLine: 0,
    generatedColumn: 0,
    originalSource: "a.js",
    originalLine: 0,
    originalColumn: 0,
    name: "n0",
  };
  expect(entries).toEqual(changedByField.map(changed => ({ ...unchanged, ...changed })));
});

test("SourceMap accepts the tc39 source map test validMappingLargeVLQ", () => {
  const file = join(__dirname, "..", "test", "fixtures", "test426", "resources", "valid-mapping-large-vlq.js.map");
  const payload = JSON.parse(readFileSync(file, "utf8"));
  // One segment with one field: generated column +1, written with 1987 digits.
  expect(payload.mappings).toBe(plusOne(1987));
  // A segment with one field has no original position, so no entry. The next
  // segment is relative to it: it is at generated column 1 + 1.
  expect(new SourceMap(payload).findEntry(0, 1)).toEqual({});
  payload.mappings += ",CAAA";
  expect(new SourceMap(payload).findEntry(0, 2)).toEqual({
    generatedLine: 0,
    generatedColumn: 2,
    originalSource: "valid-mapping-large-vlq.js",
    originalLine: 0,
    originalColumn: 0,
    name: undefined,
  });
});

test.each([
  ["has no terminal digit", "AAA" + Buffer.alloc(1987, "g").toString(), 3],
  ["stops at a delimiter", "AAAgggggggg,AAAA", 3],
  ["has a byte that is not a base64 digit", "AAAgggggggg!A", 3],
  ["has a payload in its 9th digit", "AAAggggggggB", 3],
  ["has a bit past bit 31 in its 7th digit", "AAAggggggkggA", 3],
  // 60 segments (300 bytes) come first and 100 bytes follow. The SIMD kernel
  // decodes the first, then hands the segment with the long VLQ to the scalar
  // decoder.
  [
    "is between segments for the SIMD kernel",
    Buffer.alloc(300, "CAAC,").toString() + "AAAggggggggB," + Buffer.alloc(100, "CAAC,").toString(),
    303,
  ],
])("SourceMap rejects a VLQ of more than 8 digits that %s", (_, mappings, at) => {
  const construct = () => new SourceMap({ version: 3, sources: ["a.js"], names: [], mappings });
  expect(construct).toThrow(SyntaxError);
  expect(construct).toThrow(new SyntaxError(`Missing original column value at ${at}`));
});

test("error.stack of // @bun code is remapped through a VLQ written with 9 digits", async () => {
  // Line 2 of entry.js maps to line 1 of a.ts. The original column is +1,
  // written with 9 digits.
  const map = Buffer.from(
    JSON.stringify({ version: 3, sources: ["a.ts"], sourcesContent: ["x"], names: [], mappings: ";AAA" + plusOne(9) }),
  ).toString("base64");
  using dir = tempDir("sourcemap-long-vlq", {
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
  expect(stderr).not.toContain("Could not decode sourcemap");
  expect(stderr).toContain("error: boom");
  expect(stderr).toContain("a.ts:1:2");
  expect(stdout).toBe("");
  expect(exitCode).toBe(1);
});

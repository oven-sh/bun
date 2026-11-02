const { test, expect } = require("bun:test");
const { readFileSync } = require("node:fs");
const { SourceMap } = require("node:module");
const { join } = require("node:path");
const { bunEnv, bunExe, nodeExeAtLeast, tempDir } = require("harness");

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
  // Line 1, column 1 is the first position of a file, as in Node.js and in an error's stack.
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

  // The values that Node.js v26.13.0 returns: the four other keys exist and are undefined.
  expect(entry).toStrictEqual({
    generatedLine: 0,
    generatedColumn: 4,
    originalSource: undefined,
    originalLine: undefined,
    originalColumn: undefined,
    name: undefined,
  });
  expect(JSON.stringify(entry)).toBe('{"generatedLine":0,"generatedColumn":4}');
  expect(sourceMap.findOrigin(1, 6)).toStrictEqual({});
});

// Each entry has the values that Node.js v26.13.0 returns for the same findEntry call.
// Each position is on line 0, or at or after the first segment of its line.
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

// A one-field segment that ends the string has no source, as ECMA-426 says. Node.js through v26.13.0 reads past
// the end of the string there and gives the segment the source, line and column of the segment before it:
// https://github.com/nodejs/node/blob/v26.13.0/lib/internal/source_map/source_map.js#L290-L308
// https://github.com/nodejs/node/pull/66264 changes Node.js to the entries below.
const oneFieldSegmentsThatEndTheString = [
  [
    "after a mapped segment",
    { sources: ["a.ts"], mappings: "AAAA,I" },
    [
      [0, 3, { generatedLine: 0, generatedColumn: 0, originalSource: "a.ts", originalLine: 0, originalColumn: 0 }],
      [0, 4, { generatedLine: 0, generatedColumn: 4 }],
      [0, 5, { generatedLine: 0, generatedColumn: 4 }],
    ],
  ],
  [
    "alone in the string",
    { sources: ["a.ts"], mappings: "E" },
    [
      [0, 1, {}],
      [0, 2, { generatedLine: 0, generatedColumn: 2 }],
      [0, 3, { generatedLine: 0, generatedColumn: 2 }],
    ],
  ],
  [
    "alone on the last line",
    { sources: ["a.ts"], mappings: "AAAA;A" },
    [
      [0, 3, { generatedLine: 0, generatedColumn: 0, originalSource: "a.ts", originalLine: 0, originalColumn: 0 }],
      [1, 0, { generatedLine: 1, generatedColumn: 0 }],
      [1, 3, { generatedLine: 1, generatedColumn: 0 }],
    ],
  ],
  [
    "after a segment that has a name",
    { sources: ["a.ts"], names: ["x"], mappings: "AAAAA,I" },
    [
      [
        0,
        3,
        { generatedLine: 0, generatedColumn: 0, originalSource: "a.ts", originalLine: 0, originalColumn: 0, name: "x" },
      ],
      [0, 4, { generatedLine: 0, generatedColumn: 4 }],
    ],
  ],
  [
    "in a map that has no sources",
    { sources: [], mappings: "E,I" },
    [
      [0, 3, { generatedLine: 0, generatedColumn: 2 }],
      [0, 7, { generatedLine: 0, generatedColumn: 6 }],
    ],
  ],
];

test.each(oneFieldSegmentsThatEndTheString)(
  "SourceMap findEntry with a one-field segment that ends the string %s",
  (_, payload, entries) => {
    const sourceMap = new SourceMap({ version: 3, names: [], ...payload });
    for (const [line, column, entry] of entries) {
      expect({ line, column, entry: sourceMap.findEntry(line, column) }).toEqual({ line, column, entry });
      expect({ line, column, origin: sourceMap.findOrigin(line + 1, column + 1) }).toEqual({
        line,
        column,
        origin:
          entry.originalSource === undefined
            ? {}
            : {
                name: entry.name,
                fileName: entry.originalSource,
                lineNumber: entry.originalLine + 1 + line - entry.generatedLine,
                columnNumber: entry.originalColumn + 1 + column - entry.generatedColumn,
              },
      });
    }
  },
);

// The three cases of test/parallel/test-source-map-trailing-unmapped-segment.js of https://github.com/nodejs/node/pull/66264.
test("SourceMap does not map a one-field segment that ends the string", () => {
  const unmapped = {
    originalSource: undefined,
    originalLine: undefined,
    originalColumn: undefined,
    name: undefined,
  };

  const onTheSameLine = new SourceMap({ version: 3, sources: ["a.js"], names: [], mappings: "AAAA,K" });
  expect(onTheSameLine.findEntry(0, 5)).toStrictEqual({ generatedLine: 0, generatedColumn: 5, ...unmapped });
  expect(onTheSameLine.findOrigin(1, 6)).toStrictEqual({});

  const onALaterLine = new SourceMap({ version: 3, sources: ["a.js"], names: [], mappings: "AAAA;A" });
  expect(onALaterLine.findEntry(1, 3)).toStrictEqual({ generatedLine: 1, generatedColumn: 0, ...unmapped });
  expect(onALaterLine.findOrigin(2, 4)).toStrictEqual({});

  const withoutAName = new SourceMap({
    version: 3,
    sources: ["a.js"],
    names: ["should-not-be-used"],
    mappings: "AAAA",
  });
  expect(withoutAName.findEntry(0, 0)).toStrictEqual({
    generatedLine: 0,
    generatedColumn: 0,
    originalSource: "a.js",
    originalLine: 0,
    originalColumn: 0,
    name: undefined,
  });
});

test("SourceMap findEntry answers the single-field segment test of the source map specification", () => {
  const fixtures = join(__dirname, "..", "test", "fixtures", "test426");
  const { testActions, sourceMapFile } = JSON.parse(
    readFileSync(join(fixtures, "source-map-spec-tests.json"), "utf8"),
  ).tests.find(({ name }) => name === "mappingSemanticsSingleFieldSegment");
  const sourceMap = new SourceMap(JSON.parse(readFileSync(join(fixtures, "resources", sourceMapFile), "utf8")));

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
  expect(found).toEqual(testActions);
});

// A position before the first segment of its line is in the last segment of an earlier line. The values are those of Node.js v26.3.0.
test("SourceMap findEntry and findOrigin find a one-field segment of an earlier line", () => {
  const onTheLineBefore = new SourceMap({ version: 3, sources: ["a.ts"], names: [], mappings: "AAAA,I;IACA" });
  expect(onTheLineBefore.findEntry(1, 2)).toEqual({ generatedLine: 0, generatedColumn: 4 });
  expect(onTheLineBefore.findOrigin(2, 3)).toStrictEqual({});
  expect(onTheLineBefore.findOrigin(2, 5)).toEqual({ fileName: "a.ts", lineNumber: 2, columnNumber: 1 });

  const beforeAnEmptyLine = new SourceMap({ version: 3, sources: ["a.ts"], names: [], mappings: "AAAA,I;" });
  expect(beforeAnEmptyLine.findEntry(1, 0)).toEqual({ generatedLine: 0, generatedColumn: 4 });

  const twoLinesBefore = new SourceMap({ version: 3, sources: ["a.ts"], names: [], mappings: "AAAA,U;;AAEA" });
  expect(twoLinesBefore.findEntry(1, 0)).toEqual({ generatedLine: 0, generatedColumn: 10 });
  expect(twoLinesBefore.findOrigin(2, 1)).toStrictEqual({});
  expect(twoLinesBefore.findOrigin(3, 1)).toEqual({ fileName: "a.ts", lineNumber: 3, columnNumber: 1 });
});

// The expected values of the findEntry and findOrigin tests below are what Node.js v26.3.0 returns for the same calls.

test("SourceMap findEntry lists its keys in the order of Node.js", () => {
  const sourceMap = new SourceMap({ version: 3, sources: ["a.ts"], names: ["x"], mappings: "AAAA,IAAAA" });
  const keys = ["generatedLine", "generatedColumn", "originalSource", "originalLine", "originalColumn", "name"];

  expect(Object.keys(sourceMap.findEntry(0, 5))).toEqual(keys);
  // The entry of a segment that has no name has the key too. So has the entry of a segment that has no source.
  expect(Object.keys(sourceMap.findEntry(0, 0))).toEqual(keys);
  const oneField = new SourceMap({ version: 3, sources: ["a.ts"], names: [], mappings: "AAAA,I,IAAQ" });
  expect(Object.keys(oneField.findEntry(0, 5))).toEqual(keys);
  expect(JSON.stringify(sourceMap.findEntry(0, 5))).toBe(
    '{"generatedLine":0,"generatedColumn":4,"originalSource":"a.ts","originalLine":0,"originalColumn":0,"name":"x"}',
  );
});

// Line 0 has a segment at column 2 and one at column 6. Line 1 has none. Line 2 has one at column 3.
const threeLines = { version: 3, sources: ["a.ts", "b.ts"], names: [], mappings: "EAAA,IACE;;GCEA" };
const first = { generatedLine: 0, generatedColumn: 2, originalSource: "a.ts", originalLine: 0, originalColumn: 0 };
const second = { generatedLine: 0, generatedColumn: 6, originalSource: "a.ts", originalLine: 1, originalColumn: 2 };
const third = { generatedLine: 2, generatedColumn: 3, originalSource: "b.ts", originalLine: 3, originalColumn: 2 };

test("SourceMap findEntry returns the last segment at or before the position, on any line", () => {
  const sourceMap = new SourceMap(threeLines);
  const entries = positions => positions.map(([line, column]) => [line, column, sourceMap.findEntry(line, column)]);

  expect(
    entries([
      [0, 2],
      [0, 5],
      [0, 6],
      [0, 100],
      [2, 3],
      [2, 4],
    ]),
  ).toEqual([
    [0, 2, first],
    [0, 5, first],
    [0, 6, second],
    [0, 100, second],
    [2, 3, third],
    [2, 4, third],
  ]);
  // A line that has no segment, and the columns of a line before its first segment.
  expect(
    entries([
      [1, 0],
      [1, 50],
      [2, 0],
      [2, 2],
      [1, -1],
      [2, -1],
    ]),
  ).toEqual([
    [1, 0, second],
    [1, 50, second],
    [2, 0, second],
    [2, 2, second],
    [1, -1, second],
    [2, -1, second],
  ]);
  // After the last segment.
  expect(
    entries([
      [3, 0],
      [99, 99],
      [3, -1],
    ]),
  ).toEqual([
    [3, 0, third],
    [99, 99, third],
    [3, -1, third],
  ]);
  // Before the first segment.
  expect(
    entries([
      [0, 0],
      [0, 1],
      [0, -1],
      [-1, 0],
      [-1, 99],
    ]),
  ).toEqual([
    [0, 0, {}],
    [0, 1, {}],
    [0, -1, {}],
    [-1, 0, {}],
    [-1, 99, {}],
  ]);
});

test("SourceMap findEntry compares the position as numbers", () => {
  const sourceMap = new SourceMap(threeLines);
  const entries = positions => positions.map(([line, column]) => sourceMap.findEntry(line, column));

  // NaN is not before any segment. Neither is a position that was not passed.
  expect(
    entries([
      [NaN, NaN],
      [NaN, 0],
      [2, NaN],
      [undefined, undefined],
    ]),
  ).toEqual([third, third, third, third]);
  expect(
    entries([
      [0, NaN],
      [1, NaN],
    ]),
  ).toEqual([second, second]);
  expect(
    entries([
      [Infinity, 0],
      [2 ** 31, 0],
      [2 ** 32, 0],
      [2, Infinity],
      [2, 2 ** 32],
    ]),
  ).toEqual([third, third, third, third, third]);
  expect(
    entries([
      [0, Infinity],
      [0, 2 ** 31],
      [0, 2 ** 32],
      [2, -Infinity],
      [2, -(2 ** 32)],
    ]),
  ).toEqual([second, second, second, second, second]);
  expect(
    entries([
      [-Infinity, 0],
      [-(2 ** 31) - 1, 0],
      [0, -Infinity],
      [-0.5, 99],
    ]),
  ).toEqual([{}, {}, {}, {}]);
  // A line that is not a whole number is after every segment of the line before it.
  expect(
    entries([
      [0.5, 0],
      [1.5, 0],
      [2.5, 0],
    ]),
  ).toEqual([second, second, third]);
  expect(
    entries([
      [0, 5.9],
      [0, 6.1],
      [2, 2.9],
      [2, 3.1],
      [2, -0.1],
    ]),
  ).toEqual([first, second, second, third, second]);
});

test("SourceMap findEntry compares an argument that is not a number as Node.js does", () => {
  const sourceMap = new SourceMap(threeLines);
  const entries = positions => positions.map(([line, column]) => sourceMap.findEntry(line, column));

  // `===` is false for a line that is not a number: such a line is after every segment of its line.
  expect(
    entries([
      ["0", 2],
      ["0", -1],
      [null, 0],
      [false, 2],
      [0n, 2],
      [{ valueOf: () => 0 }, 2],
    ]),
  ).toEqual([second, second, second, second, second, second]);
  expect(
    entries([
      ["2", 0],
      [true, 0],
      [2n, 0],
      ["1.5", 0],
      ["abc", 0],
      [2n ** 70n, 0],
    ]),
  ).toEqual([third, second, third, second, third, third]);
  expect(
    entries([
      ["-1", 0],
      [-1n, 0],
      [-(2n ** 70n), 0],
    ]),
  ).toEqual([{}, {}, {}]);
  // `<` compares a column that is not a number by its value.
  expect(
    entries([
      [0, "5"],
      [0, "6"],
      [0, 6n],
      [0, "abc"],
      [0, undefined],
      [0, 2n ** 70n],
      [0, { valueOf: () => 5 }],
    ]),
  ).toEqual([first, second, second, second, second, second, first]);
  expect(
    entries([
      [0, null],
      [0, true],
      [0, ""],
      [0, -1n],
      [2, -(2n ** 70n)],
    ]),
  ).toEqual([{}, {}, {}, {}, second]);
});

test("SourceMap findEntry reads an argument only where Node.js compares it", () => {
  const sourceMap = new SourceMap(threeLines);

  expect(() => sourceMap.findEntry(Symbol(), 0)).toThrow(TypeError);
  expect(() => sourceMap.findEntry(0, Symbol())).toThrow(TypeError);
  expect(() => sourceMap.findEntry(2, Symbol())).toThrow(TypeError);
  // No segment is on line 1, so nothing compares the column.
  expect(sourceMap.findEntry(1, Symbol())).toEqual(second);
  expect(sourceMap.findEntry(3, Symbol())).toEqual(third);
  // The line is not equal to the line of a segment.
  expect(sourceMap.findEntry("0", Symbol())).toEqual(second);
  expect(sourceMap.findEntry(0.5, Symbol())).toEqual(second);
  expect(sourceMap.findEntry(NaN, Symbol())).toEqual(third);
  expect(sourceMap.findEntry(-1, Symbol())).toEqual({});
  // A map that has no segment compares nothing.
  const empty = new SourceMap({ version: 3, sources: [], names: [], mappings: "" });
  expect(empty.findEntry(Symbol(), Symbol())).toEqual({});
});

test("SourceMap findOrigin takes a one-based position and returns lineNumber and columnNumber", () => {
  const sourceMap = new SourceMap({ version: 3, sources: ["a.ts"], names: ["x", "y"], mappings: "AAAAA,IAAQC" });

  expect(sourceMap.findOrigin(1, 1)).toStrictEqual({ name: "x", fileName: "a.ts", lineNumber: 1, columnNumber: 1 });
  expect(Object.keys(sourceMap.findOrigin(1, 1))).toEqual(["name", "fileName", "lineNumber", "columnNumber"]);
  // The origin is the original position of the segment, plus the distance of the position from the segment.
  expect(sourceMap.findOrigin(1, 4)).toStrictEqual({ name: "x", fileName: "a.ts", lineNumber: 1, columnNumber: 4 });
  expect(sourceMap.findOrigin(1, 5)).toStrictEqual({ name: "y", fileName: "a.ts", lineNumber: 1, columnNumber: 9 });
  expect(sourceMap.findOrigin(1, 7)).toStrictEqual({ name: "y", fileName: "a.ts", lineNumber: 1, columnNumber: 11 });
  expect(sourceMap.findOrigin(3, 1)).toStrictEqual({ name: "y", fileName: "a.ts", lineNumber: 3, columnNumber: 5 });
  // Line 0 and column 0 are before the first position of a file.
  expect([sourceMap.findOrigin(0, 0), sourceMap.findOrigin(0, 1), sourceMap.findOrigin(1, 0)]).toStrictEqual([
    {},
    {},
    {},
  ]);
});

test("SourceMap findOrigin of a segment that has no name has a name key", () => {
  const sourceMap = new SourceMap(threeLines);

  expect(sourceMap.findOrigin(1, 3)).toStrictEqual({
    name: undefined,
    fileName: "a.ts",
    lineNumber: 1,
    columnNumber: 1,
  });
  expect(sourceMap.findOrigin(3, 4)).toStrictEqual({
    name: undefined,
    fileName: "b.ts",
    lineNumber: 4,
    columnNumber: 3,
  });
  expect(sourceMap.findOrigin(1, 2)).toStrictEqual({});
});

test("SourceMap findOrigin adds the position as numbers", () => {
  const sourceMap = new SourceMap({ version: 3, sources: ["a.ts"], names: [], mappings: "AAAA,IAAQ" });
  const origin = (lineNumber, columnNumber) => ({ name: undefined, fileName: "a.ts", lineNumber, columnNumber });

  // The sum is past the largest 32-bit integer.
  expect(sourceMap.findOrigin(1, 2147483647)).toStrictEqual(origin(1, 2147483651));
  expect(sourceMap.findOrigin(1, 2 ** 32)).toStrictEqual(origin(1, 2 ** 32 + 4));
  expect(sourceMap.findOrigin(2147483647, 1)).toStrictEqual(origin(2147483647, 5));
  expect(sourceMap.findOrigin(2 ** 32, 2 ** 32)).toStrictEqual(origin(2 ** 32, 2 ** 32 + 4));
  expect(sourceMap.findOrigin(1.5, 1.5)).toStrictEqual(origin(1.5, 5.5));
  expect(sourceMap.findOrigin(NaN, NaN)).toStrictEqual(origin(NaN, NaN));
  expect(sourceMap.findOrigin()).toStrictEqual(origin(NaN, NaN));
  expect(sourceMap.findOrigin(Infinity, 1)).toStrictEqual(origin(Infinity, 5));
  expect(sourceMap.findOrigin(1, -Infinity)).toStrictEqual({});
});

test("SourceMap findOrigin converts its arguments to numbers", () => {
  const sourceMap = new SourceMap(threeLines);
  const origin = { name: undefined, fileName: "a.ts", lineNumber: 1, columnNumber: 1 };

  expect(sourceMap.findOrigin("1", "3")).toStrictEqual(origin);
  expect(sourceMap.findOrigin(true, [3])).toStrictEqual(origin);
  expect(sourceMap.findOrigin({ valueOf: () => 1 }, { valueOf: () => 3 })).toStrictEqual(origin);
  expect(sourceMap.findOrigin(null, null)).toStrictEqual({});
  expect(() => sourceMap.findOrigin(1n, 3n)).toThrow(TypeError);
  expect(() => sourceMap.findOrigin(Symbol(), 3)).toThrow(TypeError);
  // The arguments are converted before the lookup, also when the map has no segment.
  const empty = new SourceMap({ version: 3, sources: [], names: [], mappings: "" });
  expect(() => empty.findOrigin(1, Symbol())).toThrow(TypeError);
  expect(empty.findOrigin(1, 1)).toStrictEqual({});
});

test("SourceMap findEntry and findOrigin answer for the instance they are called on", () => {
  class Subclass extends SourceMap {}
  const subclass = new Subclass(threeLines);
  const other = new SourceMap({ version: 3, sources: ["c.ts"], names: [], mappings: "AAAA" });

  expect(subclass.findEntry(1, 0)).toEqual(second);
  expect(subclass.findOrigin(2, 1)).toStrictEqual({
    name: undefined,
    fileName: "a.ts",
    lineNumber: 3,
    columnNumber: -3,
  });
  expect(SourceMap.prototype.findEntry.call(subclass, 1, 0)).toEqual(second);
  expect(Reflect.apply(other.findOrigin, subclass, [3, 4])).toStrictEqual({
    name: undefined,
    fileName: "b.ts",
    lineNumber: 4,
    columnNumber: 3,
  });
});

// The fixture prints what both methods answer for 529 pairs of arguments on each of six maps.
const node = nodeExeAtLeast("26.3.0");
test.skipIf(!node)("SourceMap findEntry and findOrigin print what Node.js prints for each argument pair", async () => {
  const fixture = join(__dirname, "sourcemap-find-fixture.js");
  async function linesOf(exe) {
    await using proc = Bun.spawn({ cmd: [exe, fixture], env: bunEnv, stdout: "pipe", stderr: "inherit" });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ exe, exitCode }).toEqual({ exe, exitCode: 0 });
    return stdout.split("\n");
  }
  const [fromBun, fromNode] = await Promise.all([linesOf(bunExe()), linesOf(node)]);

  expect(fromNode.length).toBeGreaterThan(6000);
  const different = fromNode.flatMap((line, index) =>
    line === fromBun[index] ? [] : [{ node: line, bun: fromBun[index] }],
  );
  expect(different.slice(0, 10)).toEqual([]);
  expect(fromBun.length).toBe(fromNode.length);
});

// Two differences from Node.js that are decisions. Both are about what a program can see of a lookup, not its answer.
test("SourceMap findOrigin calls no findEntry of the program and converts an object argument once", () => {
  class Replaced extends SourceMap {
    findEntry() {
      return { generatedLine: 0, generatedColumn: 0, originalSource: "c.ts", originalLine: 10, originalColumn: 20 };
    }
  }
  // Node.js calls `this.findEntry`: { name: undefined, fileName: "c.ts", lineNumber: 11, columnNumber: 23 }
  expect(new Replaced(threeLines).findOrigin(1, 3)).toStrictEqual({
    name: undefined,
    fileName: "a.ts",
    lineNumber: 1,
    columnNumber: 1,
  });

  // Node.js converts an argument of findOrigin twice, and one of findEntry in each comparison: twice on this map.
  const conversions = { findOrigin: 0, findEntry: 0 };
  const fourSegments = new SourceMap({ version: 3, sources: ["a.ts"], names: [], mappings: "AAAA,CAAC,CAAC,CAAC" });
  fourSegments.findOrigin({ valueOf: () => (conversions.findOrigin++, 1) }, 3);
  fourSegments.findEntry(0, { valueOf: () => (conversions.findEntry++, 2) });
  expect(conversions).toEqual({ findOrigin: 1, findEntry: 1 });
});

// Node.js compares the BigInt. Bun converts an object with ToNumber, which throws
// "TypeError: Conversion from 'BigInt' to 'number' is not allowed." The values are those of Node.js v26.3.0.
test.todo("SourceMap findEntry compares an object that converts to a BigInt", () => {
  const sourceMap = new SourceMap(threeLines);

  expect(sourceMap.findEntry({ valueOf: () => 0n }, 2)).toEqual(second);
  expect(sourceMap.findEntry(Object(2n), 0)).toEqual(third);
  expect(sourceMap.findEntry(0, { valueOf: () => 6n })).toEqual(second);
  expect(sourceMap.findEntry(0, { [Symbol.toPrimitive]: () => 6n })).toEqual(second);
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

test("error.stack of // @bun code keeps a frame on a line that has no segment where it is", async () => {
  // The one segment is at the start of line 2 and maps to a.ts:11:5. Line 3 has no segment, so the frame of the
  // call on it is not mapped. findEntry answers with the segment of line 2 for that position.
  const map = { version: 3, sources: ["a.ts"], sourcesContent: [null], names: [], mappings: ";AAUI" };
  using dir = tempDir("sourcemap-line-of-frame", {
    "entry.js": [
      "// @bun",
      'function thrower() { throw new Error("boom"); }',
      "try { thrower(); } catch (e) { console.log(e.stack); }",
      "//# sourceMappingURL=data:application/json;base64," + Buffer.from(JSON.stringify(map)).toString("base64"),
      "",
    ].join("\n"),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "entry.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // The function of each frame, and its file:line:column without the folder.
  const frames = [...stdout.matchAll(/^ +at (?:(\w+) \()?.*[\\/]([\w.]+:\d+:\d+)\)?$/gm)].map(frame => frame.slice(1));
  expect({ frames, stderr }).toEqual({
    frames: [
      ["thrower", "a.ts:11:5"],
      [undefined, "entry.js:3:14"],
    ],
    stderr: "",
  });
  expect(new SourceMap(map).findEntry(2, 13)).toEqual({
    generatedLine: 1,
    generatedColumn: 0,
    originalSource: "a.ts",
    originalLine: 10,
    originalColumn: 4,
  });
  expect(exitCode).toBe(0);
});

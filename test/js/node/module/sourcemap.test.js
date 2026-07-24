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

// `module.findSourceMap()` answers only once source maps are enabled, like
// Node. Each case runs in its own process because the switch is per-VM.
function fixture(lib, body) {
  return `
import { findSourceMap, SourceMap } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
const lib = path.join(import.meta.dirname, ${JSON.stringify(lib)});
${body}
`;
}

async function runFixture(dir) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "fixture.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("findSourceMap returns undefined until process.setSourceMapsEnabled(true)", async () => {
  using dir = tempDir("findsourcemap-gate", {
    "lib.ts": "export const q: number = 42;\n",
    "fixture.mjs": fixture(
      "lib.ts",
      `
await import(lib);
console.log("disabled:", String(findSourceMap(lib)));
process.setSourceMapsEnabled(true);
console.log("enabled:", findSourceMap(lib)?.constructor.name);
process.setSourceMapsEnabled(false);
console.log("disabled again:", String(findSourceMap(lib)));
`,
    ),
  });

  expect(await runFixture(dir)).toEqual({
    stdout: "disabled: undefined\nenabled: SourceMap\ndisabled again: undefined\n",
    stderr: "",
    exitCode: 0,
  });
});

test.concurrent("findSourceMap maps a transpiled file back to its original source", async () => {
  using dir = tempDir("findsourcemap-transpiled", {
    "lib.ts": "export const q: number = 42;\n",
    "fixture.mjs": fixture(
      "lib.ts",
      `
process.setSourceMapsEnabled(true);
await import(lib);
const sourceMap = findSourceMap(lib);
console.log(JSON.stringify(sourceMap.findEntry(0, 13)));
console.log(JSON.stringify(sourceMap.findOrigin(0, 13)));
// A file:// specifier resolves to the same entry as the path.
const href = pathToFileURL(lib).href;
console.log(findSourceMap(href).findEntry(0, 13).originalSource === href);
// The payload is a conformant v3 document: it round-trips through the public
// SourceMap constructor and yields the same entry.
const payload = sourceMap.payload;
console.log(payload.version, JSON.stringify(payload.sources), JSON.stringify(payload.names));
console.log(JSON.stringify(new SourceMap(payload).findEntry(0, 13)));
`,
    ),
  });

  const href = Bun.pathToFileURL(`${dir}/lib.ts`).href;
  const entry = { generatedLine: 0, generatedColumn: 13, originalLine: 0, originalColumn: 13, originalSource: href };
  const { stdout, stderr, exitCode } = await runFixture(dir);
  expect(stderr).toBe("");
  expect(stdout.split("\n")).toEqual([
    JSON.stringify(entry),
    JSON.stringify({ line: 0, column: 13, fileName: href }),
    "true",
    `3 ${JSON.stringify([href])} []`,
    JSON.stringify(entry),
    "",
  ]);
  expect(exitCode).toBe(0);
});

test.concurrent("findSourceMap resolves an inline sourceMappingURL against the module", async () => {
  const map = { version: 3, sources: ["nested/orig.ts"], names: [], mappings: "AAAA", sourcesContent: ["// orig\n"] };
  const inline = Buffer.from(JSON.stringify(map)).toString("base64");
  using dir = tempDir("findsourcemap-inline", {
    // `// @bun` marks the file as already bundled, so Bun uses the map the file
    // carries rather than one it generated while transpiling.
    "lib.mjs": `// @bun\nexport const q = 42;\n//# sourceMappingURL=data:application/json;base64,${inline}\n`,
    "fixture.mjs": fixture(
      "lib.mjs",
      `
process.setSourceMapsEnabled(true);
await import(lib);
const sourceMap = findSourceMap(lib);
console.log(sourceMap.findEntry(0, 0).originalSource);
console.log(JSON.stringify(sourceMap.payload));
`,
    ),
  });

  // Relative `sources` resolve against the generated file, exactly as Node does.
  const original = new URL("nested/orig.ts", Bun.pathToFileURL(`${dir}/lib.mjs`)).href;
  const { stdout, stderr, exitCode } = await runFixture(dir);
  expect(stderr).toBe("");
  expect(stdout.split("\n")).toEqual([
    original,
    JSON.stringify({ version: 3, sources: [original], names: [], mappings: "AAAA" }),
    "",
  ]);
  expect(exitCode).toBe(0);
});

test.concurrent("findSourceMap ignores builtins and specifiers with no map", async () => {
  using dir = tempDir("findsourcemap-misses", {
    "lib.ts": "export const q: number = 42;\n",
    "fixture.mjs": fixture(
      "lib.ts",
      `
process.setSourceMapsEnabled(true);
await import(lib);
for (const specifier of ["node:fs", "bun:jsc", "data:text/javascript,0", "nope.ts", 42, undefined]) {
  console.log(String(findSourceMap(specifier)));
}
`,
    ),
  });

  const { stdout, stderr, exitCode } = await runFixture(dir);
  expect(stderr).toBe("");
  expect(stdout).toBe("undefined\n".repeat(6));
  expect(exitCode).toBe(0);
});

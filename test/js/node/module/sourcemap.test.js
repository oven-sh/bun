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

// A `// @bun` file is not transpiled again. Bun takes its inline map from the last `//# sourceMappingURL=` line, and
// only when the file can end there (ECMA-426 draft, JavaScriptExtractSourceMapURL without parsing): no quote and no
// `*/` from the URL on, and only blank lines and `//` comments after the line.
// ";;EAIE" maps generated 3:3 to original 5:3 of source 0.
describe.concurrent("sourceMappingURL comment of a // @bun file", () => {
  const throwsOnLine3 = `// @bun\nexport function t() {\n  throw new Error("SC");\n}\n`;
  const map = { version: 3, sources: ["original.ts"], sourcesContent: [null], names: [], mappings: ";;EAIE" };
  // The JSON is padded so that base64 needs no "=". Text after such a payload does not end it.
  function comment(map) {
    const json = JSON.stringify(map);
    return "//# sourceMappingURL=data:application/json;base64," + btoa(json.padEnd(Math.ceil(json.length / 3) * 3));
  }
  const inString = comment({ ...map, sources: ["in-string.ts"] });
  const own = comment({ ...map, sources: ["own.ts"] });
  const beside = JSON.stringify({ ...map, sources: ["beside.ts"] });

  async function run(files, script, names) {
    using dir = tempDir("sourcemap-comment", { "main.js": script, ...files });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.js", ...names],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const clean = text => text.replaceAll(String(dir), "<dir>").replaceAll("\\", "/");
    return { stdout: clean(stdout), stderr: clean(stderr), exitCode };
  }
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

  test("text in a string or in a block comment is not the comment of the file", async () => {
    // Each file has a map beside it, as `bun build --sourcemap=external` writes it.
    const tails = {
      "string.js": "export const text = `\n" + inString + "\n`;\n//# debugId=0\n",
      "string-closes-on-comment-line.js": "export const text = `\n" + inString + "\n// `;\n",
      "string-closes-on-debug-id-line.js": "export const text = `\n" + inString + "\n//# debugId=0`;\n",
      "string-closes-on-url-line.js": "export const text = `\n" + inString + "`;",
      "minified.js": "var b=`x\n" + inString + "\n// the end`;function u(){return 1}export{b,u};\n\n//# debugId=0\n",
      "block-comment.js": "/*\n" + inString + "\n// */\n",
    };
    const files = {};
    for (const [name, tail] of Object.entries(tails)) {
      files[name] = throwsOnLine3 + tail;
      files[name + ".map"] = beside;
    }

    const { stdout, stderr, exitCode } = await run(files, printFirstFrames, Object.keys(tails));
    expect({ stdout, stderr }).toEqual({
      stdout: Object.keys(tails)
        .map(name => `${name}: at t (<dir>/beside.ts:5:3)\n`)
        .join(""),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test("such text gives no map and no warning to a file that has no map", async () => {
    const tails = {
      "string.js": "export const text = `\n" + inString + "\n`;\n",
      "string-closes-on-url-line.js": "export const text = `\n" + inString + "`;",
      // A library that writes map comments has the start of one in its own code.
      "writer.js": "export const withMap = (code, url) => code + `\n//# sourceMappingURL=` + url;\n",
      "writer-minified.js": "export const withMap=(c,u)=>c+`\n//# sourceMappingURL=`+u;\n",
    };
    const files = {};
    for (const [name, tail] of Object.entries(tails)) files[name] = throwsOnLine3 + tail;

    const { stdout, stderr, exitCode } = await run(files, printFirstFrames, Object.keys(tails));
    expect({ stdout, stderr }).toEqual({
      stdout: Object.keys(tails)
        .map(name => `${name}: at t (<dir>/${name}:3:18)\n`)
        .join(""),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test("the comment of the file is read when only blank lines and // comments follow it", async () => {
    const files = {
      "own.js": throwsOnLine3 + own + "\n",
      "own-without-newline.js": throwsOnLine3 + own,
      "own-then-comments.js": throwsOnLine3 + own + "\n\n  \t\n// the end\n  // indented\n",
      "own-crlf.js": (throwsOnLine3 + own + "\n// the end\n").replaceAll("\n", "\r\n"),
      // The last such line is the one that counts.
      "string-then-own.js": throwsOnLine3 + "export const text = `\n" + inString + "\n`;\n" + own + "\n",
    };

    const { stdout, stderr, exitCode } = await run(files, printFirstFrames, Object.keys(files));
    expect({ stdout, stderr }).toEqual({
      stdout: Object.keys(files)
        .map(name => `${name}: at t (<dir>/own.ts:5:3)\n`)
        .join(""),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test("the comment of the file is not read when code, a block comment or a quote follows it", async () => {
    const tails = {
      "own-then-code.js": own + "\nexport const after = 1;\n",
      "own-then-block-comment.js": own + "\n/* the end */\n",
      "own-then-quote.js": own + "\n// it's the end\n",
      "own-literal-json.js": "//# sourceMappingURL=data:application/json," + JSON.stringify(map) + "\n",
    };
    const files = {};
    for (const [name, tail] of Object.entries(tails)) {
      files[name] = throwsOnLine3 + tail;
      files[name + ".map"] = beside;
    }

    const { stdout, stderr, exitCode } = await run(files, printFirstFrames, Object.keys(tails));
    expect({ stdout, stderr }).toEqual({
      stdout: Object.keys(tails)
        .map(name => `${name}: at t (<dir>/beside.ts:5:3)\n`)
        .join(""),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  test("the code frame of an error is not text of a file that a string names", async () => {
    const files = {
      "other.txt": "OTHER 1\nOTHER 2\nOTHER 3\nOTHER 4\nOTHER 5\nOTHER 6\n",
      "bundle.js": throwsOnLine3 + "var b=`x\n" + comment({ ...map, sources: ["other.txt"] }) + "\n// x`;export{b};\n",
    };
    const printCodeFrame = `
      const { t } = await import("./bundle.js");
      try {
        t();
      } catch (e) {
        const text = Bun.inspect(e);
        console.log(JSON.stringify({
          frame: text.split("\\n").find(line => line.includes(" at t ")).trim(),
          showsOtherFile: text.includes("OTHER"),
        }));
      }
    `;

    const { stdout, stderr, exitCode } = await run(files, printCodeFrame, []);
    expect({ stdout: JSON.parse(stdout), stderr }).toEqual({
      stdout: { frame: "at t (<dir>/bundle.js:3:9)", showsOtherFile: false },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });
});

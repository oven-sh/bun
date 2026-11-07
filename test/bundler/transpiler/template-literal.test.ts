import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// When targeting Bun's runtime,
// We must escape latin1 characters in raw template literals
// This is somewhat brittle
test("template literal", () => {
  const { stdout, exitCode } = Bun.spawnSync({
    cmd: [bunExe(), "run", join(import.meta.dir, "template-literal-fixture-test.js")],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
  });

  expect(exitCode).toBe(0);
  expect(stdout.toString()).toBe(
    // This is base64 encoded contents of the template literal
    // this narrows down the test to the transpiler instead of the runtime
    "8J+QsDEyMzEyM/CfkLDwn5Cw8J+QsPCfkLDwn5Cw8J+QsDEyM/CfkLAxMjPwn5CwMTIzMTIz8J+QsDEyM/CfkLAxMjPwn5CwLPCfkLB0cnVl",
  );
});

describe("a tag whose template has non-ASCII text", () => {
  const fixture = join(import.meta.dir, "template-literal-tags-fixture.js");
  // What Node prints.
  const expected = {
    raw: ["😀", "a1é2日本", '{"a":"😀"}'],
    cooked: ["😀\n", "é"],
    ownEscapes: ["\\u{1f600}😀\\xe9é"],
    escaped: ["é", "a日b😀", "\\é\\é"],
    escapedRaw: ["\\é", "a\\日b\\😀", "\\\\é\\\\\\é"],
    invalidEscape: [true, "\\u{zz}é"],
    invalidEscapeAndEscaped: [true, true, "\\x\\é"],
    newline: ["é\né"],
    sameSite: true,
    otherSite: false,
    frozen: [true, true, true, true],
    rawDescriptor: false,
    length: [2, 2],
    member: [
      ["object", "é|ü|", 1, 2],
      ["object", "é"],
    ],
    classes: [
      ["derived", "ü"],
      ["derived", "ø"],
    ],
    constructed: "é",
    order: ["tag", "first", "second"],
    ascii: "\\u{1f600}\\n",
    nested: "éüx",
  };

  async function run(file: string) {
    await using process = Bun.spawn({ cmd: [bunExe(), file], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      process.stdout.text(),
      process.stderr.text(),
      process.exited,
    ]);
    return { stdout, stderr, exitCode };
  }

  test.concurrent("gets it in strings.raw", async () => {
    const { stdout, stderr, exitCode } = await run(fixture);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  // The helper can't be imported with a statement there.
  test.concurrent.each([
    ["named .cjs", "tags.cjs", (source: string) => ({ "tags.cjs": source })],
    [
      "that assigns to module.exports",
      "tags.js",
      (source: string) => ({ "tags.js": source + "\nmodule.exports = {};" }),
    ],
    ["that starts with 'use strict'", "tags.js", (source: string) => ({ "tags.js": '"use strict";\n' + source })],
    [
      "in a package of type commonjs",
      "tags.js",
      (source: string) => ({ "tags.js": source, "package.json": `{ "type": "commonjs" }` }),
    ],
  ])("gets it in strings.raw in a CommonJS module %s", async (_, name, files) => {
    using dir = tempDir("template-literal-tags", files(await Bun.file(fixture).text()));
    const { stdout, stderr, exitCode } = await run(join(String(dir), name));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  test.concurrent("gets it in strings.raw in a CommonJS module that another module loads", async () => {
    using dir = tempDir("template-literal-tags", {
      "tags.cjs": "module.exports = String.raw`é\\n`;",
      "required.cjs": `console.log(JSON.stringify(require("./tags.cjs")));`,
      "imported.mjs": `import raw from "./tags.cjs"; console.log(JSON.stringify(raw));`,
    });
    for (const entry of ["required.cjs", "imported.mjs"]) {
      const { stdout, stderr, exitCode } = await run(join(String(dir), entry));
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toBe("é\\n");
      expect(exitCode).toBe(0);
    }
  });

  test.concurrent("leaves a CommonJS module as strict or as sloppy as it was", async () => {
    const body = "module.exports = [String.raw`é`, (function () { return this === undefined; })()];";
    using dir = tempDir("template-literal-tags", {
      "strict.cjs": `"use strict";\n${body}\nconsole.log(JSON.stringify(module.exports));`,
      "sloppy.cjs": `${body}\nconsole.log(JSON.stringify(module.exports));`,
    });
    for (const [entry, isStrict] of [
      ["strict.cjs", true],
      ["sloppy.cjs", false],
    ] as const) {
      const { stdout, stderr, exitCode } = await run(join(String(dir), entry));
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual(["é", isStrict]);
      expect(exitCode).toBe(0);
    }
  });

  test.concurrent("gets it in strings.raw after bun build --target=bun, whose output is ASCII", async () => {
    using dir = tempDir("template-literal-tags", {});
    const build = await Bun.build({ entrypoints: [fixture], target: "bun", outdir: String(dir) });
    expect(build.success).toBe(true);
    expect(await build.outputs[0].text()).not.toMatch(/[^\x00-\x7f]/);
    const { stdout, stderr, exitCode } = await run(build.outputs[0].path);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  test.concurrent("gets CR and CRLF as LF", async () => {
    using dir = tempDir("template-literal-tags", {
      "lines.js": "console.log(JSON.stringify((strings => strings.raw)`é\r\né\ré`));",
    });
    const { stdout, stderr, exitCode } = await run(join(String(dir), "lines.js"));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(["é\né\né"]);
    expect(exitCode).toBe(0);
  });

  // What Node gives the tag: [strings, strings.raw].
  test.concurrent.each([
    ["a line continuation that ends in U+2028", "a\\\u2028b", [["ab"], ["a\\\u2028b"]]],
    ["a line continuation that ends in U+2029", "a\\\u2029b", [["ab"], ["a\\\u2029b"]]],
    ["U+2028 behind two backslashes", "a\\\\\u2028b", [["a\\\u2028b"], ["a\\\\\u2028b"]]],
    ["a line continuation between $ and {", "$\\\u2028{1}", [["${1}"], ["$\\\u2028{1}"]]],
    ["U+007F", "a\x7Fb", [["a\x7Fb"], ["a\x7Fb"]]],
    ["U+007F behind a backslash", "a\\\x7Fb", [["a\x7Fb"], ["a\\\x7Fb"]]],
  ])("gets %s as it is in Node", async (_, text, stringsAndRaw) => {
    using dir = tempDir("template-literal-tags", {
      "tag.js": "console.log(JSON.stringify((strings => [[...strings], strings.raw])`" + text + "`));",
    });
    const { stdout, stderr, exitCode } = await run(join(String(dir), "tag.js"));
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(stringsAndRaw);
    expect(exitCode).toBe(0);
  });

  // `Bun.Transpiler` calls no helper, so the tag gets what is printed in `strings.raw`.
  test("is printed for Bun with an escape for each non-ASCII character, and cooks to the same strings", () => {
    // [the text of the template, what is printed for Bun]
    const rows = [
      ["\u00E9\\\u00E9\\\\\u00E9", "\\u00E9\\u00E9\\\\\\u00E9"],
      ["\u0080\uFFFF\\\uFFFF", "\\u0080\\uFFFF\\uFFFF"],
      ["\u{10000}\\\u{10000}\\\\\\\u{10FFFF}", "\\u{10000}\\u{10000}\\\\\\u{10ffff}"],
      ["a\\\u2028b\u2029${1}\\\u2029", "a\\\nb\\u2029${1}\\\n"],
      ["\u00E9\x7F\t\0\\\x7F", "\\u00E9\x7F\t\0\\\x7F"],
    ];
    const code = (text: string) => "x = tag`" + text + "`;\n";
    for (const target of ["browser", "node"] as const) {
      const transpiler = new Bun.Transpiler({ target });
      expect(rows.map(([text]) => transpiler.transformSync(code(text)))).toEqual(rows.map(([text]) => code(text)));
    }
    const transpiler = new Bun.Transpiler({ target: "bun" });
    expect(rows.map(([text]) => transpiler.transformSync(code(text)))).toEqual(
      rows.map(([, printed]) => code(printed)),
    );
    const cooked = (code: string) =>
      new Function("tag", "let x;\n" + code + "return x;")((strings: string[]) => [...strings]);
    expect(rows.map(([, printed]) => cooked(code(printed)))).toEqual(rows.map(([text]) => cooked(code(text))));
  });
});

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
    invalidEscape: [true, "\\u{zz}é"],
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
});

// What `bun format` has built in besides the options of Prettier, from `[format]` in bunfig.toml and from the flags of the same
// names: `sortImports`, `sortTailwindcss`, `sortPackageJson`, `jsdoc`, `insertFinalNewline`, `overrides`. And TOML, which needs neither.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../children";

afterAll(endChildren);

/** Runs `bun format` with `args` in a directory that has `files`. `files` of the result: what has become of them. */
async function format(files: Record<string, string>, args: string[] = ["."]) {
  using dir = tempDir("bun-format-bunfig", files);
  await using proc = spawn({
    cmd: [bunExe(), "format", "--log-level=warn", ...args],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const read = (name: string) => readFileSync(join(String(dir), name), "utf8");
  return { stdout, stderr, exitCode, files: Object.fromEntries(Object.keys(files).map(name => [name, read(name)])) };
}

const bunfig = (text: string) => ({ "bunfig.toml": `[format]\n${text}\n` });

/** 90 columns: Prettier breaks it, oxfmt does not. */
const wide = `const value = someFunction(argumentNumberOne, argumentNumberTwo, argumentNumberThree, four);\n`;
const broken = `const value = someFunction(
  argumentNumberOne,
  argumentNumberTwo,
  argumentNumberThree,
  four,
);
`;

describe.concurrent("sortImports", () => {
  const imports = `import { a, z } from "./sibling";
import x from "../parent";
import type { T } from "zod";
import React from "react";
import fs from "node:fs";
import { test } from "bun:test";
import path from "path";
import { b } from "@/lib/b";
import { c } from "~/c";
import i from "#internal";
import css from "./a.css";
import index from ".";
import { Z } from "@scope/pkg";
`;
  const sorted = `import { test } from "bun:test";
import fs from "node:fs";
import path from "path";

import { Z } from "@scope/pkg";
import React from "react";
import type { T } from "zod";

import i from "#internal";
import { b } from "@/lib/b";
import { c } from "~/c";

import index from ".";
import x from "../parent";
import { a, z } from "./sibling";

import css from "./a.css";
`;

  test("true: built-in modules, packages, aliases, relative paths, styles, with an empty line between", async () => {
    const result = await format({ ...bunfig("sortImports = true"), "a.ts": imports + wide });
    expect(result.stderr).toBe("");
    // Everything else is as without the key.
    expect(result.files["a.ts"]).toBe(sorted + broken);
    expect(result.exitCode).toBe(0);
  });

  test("it is off unless it is set", async () => {
    const [plain, off] = await Promise.all([
      format({ "a.ts": imports }),
      format({ ...bunfig("sortImports = false"), "a.ts": imports }),
    ]);
    expect(plain.files["a.ts"]).toBe(imports);
    expect(off.files["a.ts"]).toBe(imports);
  });

  test("--sort-imports and --no-sort-imports", async () => {
    const [on, off] = await Promise.all([
      format({ "a.ts": imports }, ["--sort-imports", "."]),
      format({ ...bunfig("sortImports = true"), "a.ts": imports }, ["--no-sort-imports", "."]),
    ]);
    expect(on.files["a.ts"]).toBe(sorted);
    expect(off.files["a.ts"]).toBe(imports);
  });

  const table = `[format.sortImports]
groups = ["ui", ["builtin", "external"], { newlinesBetween = false }, "internal", ["parent", "sibling", "index"], "unknown"]
customGroups = [{ groupName = "ui", elementNamePattern = ["react", "@scope/**"] }]
internalPattern = ["~/"]
order = "desc"
`;
  const byTable = `import React from "react";
import { Z } from "@scope/pkg";

import type { T } from "zod";
import path from "path";
import fs from "node:fs";
import { test } from "bun:test";
import { b } from "@/lib/b";
import i from "#internal";
import { c } from "~/c";

import { a, z } from "./sibling";
import css from "./a.css";
import x from "../parent";
import index from ".";
`;

  test("a table has the options", async () => {
    const result = await format({ "bunfig.toml": table, "a.ts": imports });
    expect(result.stderr).toBe("");
    expect(result.files["a.ts"]).toBe(byTable);
    expect(result.exitCode).toBe(0);
  });

  test("the options are those of sortImports in an .oxfmtrc.json", async () => {
    const options = {
      groups: [
        "ui",
        ["builtin", "external"],
        { newlinesBetween: false },
        "internal",
        ["parent", "sibling", "index"],
        "unknown",
      ],
      customGroups: [{ groupName: "ui", elementNamePattern: ["react", "@scope/**"] }],
      internalPattern: ["~/"],
      order: "desc",
    };
    const result = await format({ ".oxfmtrc.json": JSON.stringify({ sortImports: options }), "a.ts": imports });
    expect(result.files["a.ts"]).toBe(byTable);
  });

  test("the flag turns on what the table says", async () => {
    const result = await format({ "bunfig.toml": table, "a.ts": imports }, ["--sort-imports", "."]);
    expect(result.files["a.ts"]).toBe(byTable);
  });

  test("the scripts of a Vue file", async () => {
    const vue = `<script setup>\nimport b from "./b";\nimport a from "a";\n</script>\n`;
    const result = await format({ ...bunfig("sortImports = true"), "a.vue": vue });
    expect(result.files["a.vue"]).toBe(`<script setup>\nimport a from "a";\n\nimport b from "./b";\n</script>\n`);
  });

  test("it is laid over a .prettierrc, as the flag is", async () => {
    const result = await format({
      ...bunfig("sortImports = true"),
      ".prettierrc": `{ "semi": false }`,
      "a.ts": imports,
    });
    expect(result.stderr).toBe("");
    expect(result.files["a.ts"]).toBe(sorted.replaceAll(";", ""));
  });

  test.each([
    [`sortImports = "yes"`, "expected boolean or object but received string"],
    ["sortImports = 1", "expected boolean or object but received number"],
    [
      "sortImports = { newlineBetween = false }",
      `Unknown key "newlineBetween" in [format.sortImports]\n  Did you mean "newlinesBetween"?`,
    ],
    ["sortImports = { importOrder = [] }", `Unknown key "importOrder" in [format.sortImports]\n`],
    [`sortImports = { newlinesBetween = "no" }`, "expected boolean but received string"],
    [`sortImports = { groups = "builtin" }`, "expected array but received string"],
    ["sortImports = { internalPattern = [1] }", "expected string but received number"],
    [`sortImports = { order = "up" }`, 'Invalid `sortImports` configuration: `order` must be "asc" or "desc"'],
    [
      `sortImports = { groups = ["packages"] }`,
      "Invalid `sortImports` configuration: unknown group name `packages` in `groups`",
    ],
    [
      "sortImports = { partitionByNewline = true }",
      "`partitionByNewline: true` and `newlinesBetween: true` cannot be used together",
    ],
  ])("%s is refused: %s", async (line, message) => {
    const result = await format({ ...bunfig(line), "a.ts": imports });
    expect(result.stderr).toContain(message);
    expect(result.stderr).toContain("bunfig.toml:2:");
    expect(result.files["a.ts"]).toBe(imports);
    expect(result.exitCode).toBe(2);
  });
});

describe.concurrent("sortTailwindcss", () => {
  /** Tailwind CSS 4, as far as it is asked. A style sheet with `reversed` in it turns the order around. */
  const tailwind = {
    "node_modules/tailwindcss/package.json": JSON.stringify({
      name: "tailwindcss",
      version: "4.0.0",
      main: "index.js",
    }),
    "node_modules/tailwindcss/theme.css": "",
    "node_modules/tailwindcss/index.js": `const order = ["m-2", "flex", "p-4"];
exports.__unstable__loadDesignSystem = async css => {
  const sign = css.includes("reversed") ? -1 : 1;
  return { getClassOrder: classes => classes.map(name => [name, order.includes(name) ? BigInt(sign * order.indexOf(name)) : null]) };
};
`,
  };
  const input = `<a className="p-4 flex m-2" />;\n`;
  const sorted = `<a className="m-2 flex p-4" />;\n`;

  test("true, in every language that has classes", async () => {
    const result = await format({
      ...tailwind,
      ...bunfig("sortTailwindcss = true"),
      "a.jsx": input + wide,
      "a.html": `<a class="p-4 flex m-2"></a>\n`,
      "a.vue": `<template>\n  <a class="p-4 flex m-2"></a>\n</template>\n`,
      "a.css": `a {\n  @apply p-4 flex m-2;\n}\n`,
    });
    expect(result.stderr).toBe("");
    expect(result.files["a.jsx"]).toBe(sorted + broken);
    expect(result.files["a.html"]).toBe(`<a class="m-2 flex p-4"></a>\n`);
    expect(result.files["a.vue"]).toBe(`<template>\n  <a class="m-2 flex p-4"></a>\n</template>\n`);
    expect(result.files["a.css"]).toBe(`a {\n  @apply m-2 flex p-4;\n}\n`);
    expect(result.exitCode).toBe(0);
  });

  test("it is off unless it is set, and the package is not asked for", async () => {
    const result = await format({ "a.jsx": input });
    expect(result.stderr).toBe("");
    expect(result.files["a.jsx"]).toBe(input);
    expect(result.exitCode).toBe(0);
  });

  test("--sort-tailwindcss and --no-sort-tailwindcss", async () => {
    const [on, off] = await Promise.all([
      format({ ...tailwind, "a.jsx": input }, ["--sort-tailwindcss", "."]),
      format({ ...tailwind, ...bunfig("sortTailwindcss = true"), "a.jsx": input }, ["--no-sort-tailwindcss", "."]),
    ]);
    expect(on.files["a.jsx"]).toBe(sorted);
    expect(off.files["a.jsx"]).toBe(input);
  });

  test("a table has the options, and its paths are from the working directory", async () => {
    const result = await format({
      ...tailwind,
      "bunfig.toml": `[format.sortTailwindcss]
stylesheet = "./styles/app.css"
functions = ["cn"]
attributes = ["look"]
preserveDuplicates = true
`,
      "styles/app.css": "/* reversed */\n",
      "src/a.jsx": `<a className="m-2 flex p-4 flex" look="m-2 p-4" other="m-2 p-4" />;\ncn("m-2 p-4");\nother("m-2 p-4");\n`,
    });
    expect(result.stderr).toBe("");
    expect(result.files["src/a.jsx"]).toBe(
      `<a className="p-4 flex flex m-2" look="p-4 m-2" other="m-2 p-4" />;\ncn("p-4 m-2");\nother("m-2 p-4");\n`,
    );
    expect(result.exitCode).toBe(0);
  });

  test("it is laid over a .prettierrc, as the flag is", async () => {
    const files = { ...tailwind, ".prettierrc": `{ "jsxSingleQuote": true }`, "a.jsx": input };
    const result = await format({ ...files, ...bunfig("sortTailwindcss = true") });
    expect(result.stderr).toBe("");
    expect(result.files["a.jsx"]).toBe(sorted.replaceAll('"', "'"));
  });

  test("without the package", async () => {
    const result = await format({ ...bunfig("sortTailwindcss = true"), "a.jsx": input, "b.js": "b  ;\n" });
    expect(result.stderr).toContain("the tailwindcss package was not found");
    expect(result.files["a.jsx"]).toBe(input);
    // A file without classes needs none.
    expect(result.files["b.js"]).toBe("b;\n");
    expect(result.exitCode).toBe(2);
  });

  test.each([
    [`sortTailwindcss = "yes"`, "expected boolean or object but received string"],
    [
      "sortTailwindcss = { function = [] }",
      `Unknown key "function" in [format.sortTailwindcss]\n  Did you mean "functions"?`,
    ],
    [`sortTailwindcss = { functions = "cn" }`, "expected array but received string"],
    ["sortTailwindcss = { attributes = [true] }", "expected string but received boolean"],
    ["sortTailwindcss = { stylesheet = 1 }", "expected string but received number"],
    ["sortTailwindcss = { preserveWhitespace = 1 }", "expected boolean but received number"],
  ])("%s is refused: %s", async (line, message) => {
    const result = await format({ ...tailwind, ...bunfig(line), "a.jsx": input });
    expect(result.stderr).toContain(message);
    expect(result.files["a.jsx"]).toBe(input);
    expect(result.exitCode).toBe(2);
  });
});

describe.concurrent("sortPackageJson", () => {
  const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  const input = json({ version: "1.0.0", scripts: { test: "a", build: "b" }, name: "x" });
  const sorted = json({ name: "x", version: "1.0.0", scripts: { test: "a", build: "b" } });
  const withScripts = json({ name: "x", version: "1.0.0", scripts: { build: "b", test: "a" } });

  test("the key, the flags and the table", async () => {
    const [off, key, flag, under, table] = await Promise.all([
      format({ "package.json": input }),
      format({ ...bunfig("sortPackageJson = true"), "package.json": input, "other.json": input }),
      format({ "package.json": input }, ["--sort-package-json", "."]),
      format({ ...bunfig("sortPackageJson = { sortScripts = true }"), "package.json": input }, [
        "--no-sort-package-json",
        ".",
      ]),
      format({ ...bunfig("sortPackageJson = { sortScripts = true }"), "package.json": input }),
    ]);
    expect(off.files["package.json"]).toBe(input);
    expect(key.files["package.json"]).toBe(sorted);
    expect(key.files["other.json"]).toBe(input);
    expect(flag.files["package.json"]).toBe(sorted);
    expect(under.files["package.json"]).toBe(input);
    expect(table.files["package.json"]).toBe(withScripts);
  });

  test("in a .prettierrc it is an option that Prettier does not know", async () => {
    const result = await format({ ".prettierrc": `{ "sortPackageJson": true }`, "package.json": input });
    expect(result.stderr).toContain("Ignored unknown option { sortPackageJson: true }.");
    expect(result.files["package.json"]).toBe(input);
  });

  test.each([
    ["sortPackageJson = []", "expected boolean or object but received array"],
    [
      "sortPackageJson = { sortScript = true }",
      `Unknown key "sortScript" in [format.sortPackageJson]\n  Did you mean "sortScripts"?`,
    ],
    [`sortPackageJson = { sortScripts = "all" }`, "expected boolean but received string"],
  ])("%s is refused: %s", async (line, message) => {
    const result = await format({ ...bunfig(line), "package.json": input });
    expect(result.stderr).toContain(message);
    expect(result.exitCode).toBe(2);
  });
});

describe.concurrent("jsdoc", () => {
  const input = `/**
 * adds two numbers
 * @returns {number} the sum
 * @param {number} b second
 * @param {number} a   first
 */
export function add(a, b) {}
`;
  const formatted = `/**
 * Adds two numbers
 *
 * @param {number} a First
 * @param {number} b Second
 * @returns {number} The sum
 */
export function add(a, b) {}
`;

  test("the key, the flags and the table", async () => {
    const options = "jsdoc = { capitalizeDescriptions = false, descriptionWithDot = true }";
    const [off, key, flag, under, table, over] = await Promise.all([
      format({ "a.js": input }),
      format({ ...bunfig("jsdoc = true"), "a.js": input }),
      format({ "a.js": input }, ["--jsdoc", "."]),
      format({ ...bunfig(options), "a.js": input }, ["--no-jsdoc", "."]),
      format({ ...bunfig(options), "a.js": input }),
      format({ ...bunfig(options), "a.js": input }, ["--jsdoc", "."]),
    ]);
    expect(off.files["a.js"]).toBe(input);
    expect(key.files["a.js"]).toBe(formatted);
    expect(flag.files["a.js"]).toBe(formatted);
    expect(under.files["a.js"]).toBe(input);
    expect(table.files["a.js"]).toBe(`/**
 * adds two numbers.
 *
 * @param {number} a first.
 * @param {number} b second.
 * @returns {number} the sum
 */
export function add(a, b) {}
`);
    expect(over.files["a.js"]).toBe(table.files["a.js"]);
  });

  test.each([
    [`jsdoc = "all"`, "expected boolean or object but received string"],
    ["jsdoc = { capitalize = true }", `Unknown key "capitalize" in [format.jsdoc]\n`],
    ["jsdoc = { descriptionTag = 1 }", "expected boolean but received number"],
    [`jsdoc = { commentLineStrategy = "one" }`, "Invalid jsdoc.commentLineStrategy value: one."],
  ])("%s is refused: %s", async (line, message) => {
    const result = await format({ ...bunfig(line), "a.js": input });
    expect(result.stderr).toContain(message);
    expect(result.files["a.js"]).toBe(input);
    expect(result.exitCode).toBe(2);
  });
});

describe.concurrent("insertFinalNewline", () => {
  test("the key and the flags", async () => {
    const files = { "a.js": "a  ;\n", "a.css": "a {\n}\n", "a.md": "a\n" };
    const [plain, key, flag, under] = await Promise.all([
      format(files),
      format({ ...bunfig("insertFinalNewline = false"), ...files }),
      format(files, ["--no-insert-final-newline", "."]),
      format({ ...bunfig("insertFinalNewline = false"), ...files }, ["--insert-final-newline", "."]),
    ]);
    expect(plain.files).toEqual({ "a.js": "a;\n", "a.css": "a {\n}\n", "a.md": "a\n" });
    expect(key.files).toMatchObject({ "a.js": "a;", "a.css": "a {\n}", "a.md": "a" });
    expect(flag.files).toEqual({ "a.js": "a;", "a.css": "a {\n}", "a.md": "a" });
    expect(under.files).toMatchObject(plain.files);
  });

  test("in a .prettierrc it is an option that Prettier does not know", async () => {
    const result = await format({ ".prettierrc": `{ "insertFinalNewline": false }`, "a.js": "a  ;\n" });
    expect(result.stderr).toContain("Ignored unknown option { insertFinalNewline: false }.");
    expect(result.files["a.js"]).toBe("a;\n");
  });

  test("a value that is no boolean is refused", async () => {
    const result = await format({ ...bunfig(`insertFinalNewline = "no"`), "a.js": "a  ;\n" });
    expect(result.stderr).toContain("expected boolean but received string");
    expect(result.exitCode).toBe(2);
  });
});

describe.concurrent("TOML", () => {
  const input = `a   = 1\n[b]\nc = [ "d",'e' ]\n`;
  const formatted = `a = 1\n[b]\nc = ["d", 'e']\n`;

  test("is formatted like any other language, bunfig.toml too", async () => {
    const result = await format({ ...bunfig("semi   = false"), "a.toml": input, "a.js": "a  ;\n" });
    expect(result.stderr).toBe("");
    expect(result.files).toEqual({ "bunfig.toml": "[format]\nsemi = false\n", "a.toml": formatted, "a.js": "a\n" });
    expect(result.exitCode).toBe(0);
  });

  test("a file that is named", async () => {
    const result = await format({ "a.toml": input }, ["a.toml"]);
    expect(result.files["a.toml"]).toBe(formatted);
    expect(result.exitCode).toBe(0);
  });

  test("not where a configuration of Prettier counts, which has no TOML", async () => {
    const [all, named, below] = await Promise.all([
      format({ ".prettierrc": "{}", "a.toml": input, "a.js": "a  ;\n" }),
      format({ ".prettierrc": "{}", "a.toml": input }, ["a.toml"]),
      format({ "sub/.prettierrc": "{}", "sub/a.toml": input, "a.toml": input }),
    ]);
    expect(all.files["a.toml"]).toBe(input);
    expect(all.exitCode).toBe(0);
    expect(named.stderr).toContain("No parser could be inferred for file");
    expect(named.exitCode).toBe(2);
    expect(below.files).toMatchObject({ "sub/a.toml": input, "a.toml": formatted });
  });

  test("the lines are as wide as everywhere", async () => {
    const items = Array(9).fill(`"aaaaaaaa"`);
    const result = await format({ "a.toml": `a = [${items.join(", ")}]\n` });
    expect(result.files["a.toml"]).toBe(`a = [\n${items.map(it => `  ${it},\n`).join("")}]\n`);
  });

  test("what is not TOML is an error", async () => {
    const result = await format({ "a.toml": "a = \n", "b.toml": input });
    expect(result.stderr).toContain("a.toml: SyntaxError:");
    expect(result.files).toEqual({ "a.toml": "a = \n", "b.toml": formatted });
    expect(result.exitCode).toBe(2);
  });

  test("there is no key and no flag for it", async () => {
    const [key, flag] = await Promise.all([
      format({ ...bunfig("toml = true"), "a.toml": input }),
      format({ "a.toml": input }, ["--toml", "."]),
    ]);
    expect(key.stderr).toContain(`nknown key "toml" in [format]`);
    expect(flag.stderr).toContain("--toml");
    expect([key.exitCode, flag.exitCode]).toEqual([2, 2]);
    expect([key.files["a.toml"], flag.files["a.toml"]]).toEqual([input, input]);
  });
});

describe.concurrent("overrides", () => {
  const files = {
    "a.js": `a("b");\n`,
    "a.test.js": `a("b");\n`,
    "src/b.test.js": `a("b");\n`,
    "src/skip.test.js": `a("b");\n`,
  };
  const table = `[format]
semi = false

[[format.overrides]]
files = "*.test.js"
excludeFiles = ["src/skip.*"]
options = { singleQuote = true, semi = true }
`;

  test("options for the files that match, over those for all files", async () => {
    const result = await format({ "bunfig.toml": table, ...files });
    expect(result.stderr).toBe("");
    expect(result.files).toMatchObject({
      "a.js": `a("b")\n`,
      "a.test.js": `a('b');\n`,
      "src/b.test.js": `a('b');\n`,
      "src/skip.test.js": `a("b")\n`,
    });
    expect(result.exitCode).toBe(0);
  });

  test("a later one wins, and a flag is for every file", async () => {
    const more = `${table}
[[format.overrides]]
files = ["src/**"]
options = { singleQuote = false, useTabs = true }
`;
    const block = { "src/c.test.js": `{\n  a("b");\n}\n` };
    const [later, flag] = await Promise.all([
      format({ "bunfig.toml": more, ...block }),
      format({ "bunfig.toml": more, ...block }, ["--no-semi", "--single-quote", "--no-use-tabs", "."]),
    ]);
    expect(later.files["src/c.test.js"]).toBe(`{\n\ta("b");\n}\n`);
    expect(flag.files["src/c.test.js"]).toBe(`{\n  a('b')\n}\n`);
  });

  test("they are laid over a .prettierrc, as the other keys are", async () => {
    const result = await format({
      "bunfig.toml": table,
      ".prettierrc": `{ "singleQuote": false, "semi": true }`,
      ...files,
    });
    expect(result.files).toMatchObject({ "a.js": `a("b")\n`, "a.test.js": `a('b');\n` });
  });

  test("parser", async () => {
    const result = await format({
      "bunfig.toml": `[[format.overrides]]\nfiles = ["*.rc", ".babelrc"]\noptions = { parser = "json5" }\n`,
      "a.rc": `{"a":1}\n`,
      "a.other": `{"a":1}\n`,
    });
    expect(result.stderr).toBe("");
    expect(result.files).toMatchObject({ "a.rc": `{ a: 1 }\n`, "a.other": `{"a":1}\n` });
  });

  test("what is built in besides, for some files", async () => {
    const imports = `import b from "./b";\nimport a from "a";\n`;
    const bunfig = `[[format.overrides]]
files = "src/**"
[format.overrides.options]
sortImports = { newlinesBetween = false }
insertFinalNewline = false
`;
    const [result, off, on] = await Promise.all([
      format({ "bunfig.toml": bunfig, "a.js": imports, "src/a.js": imports }),
      format({ "bunfig.toml": bunfig, "src/a.js": imports }, ["--no-sort-imports", "."]),
      format({ "bunfig.toml": bunfig, "a.js": imports, "src/a.js": imports }, ["--sort-imports", "."]),
    ]);
    expect(result.stderr).toBe("");
    expect(result.files).toMatchObject({ "a.js": imports, "src/a.js": `import a from "a";\nimport b from "./b";` });
    expect(off.files["src/a.js"]).toBe(imports.trimEnd());
    // The flag turns it on everywhere, and leaves the options where there are some.
    expect(on.files).toMatchObject({
      "a.js": `import a from "a";\n\nimport b from "./b";\n`,
      "src/a.js": `import a from "a";\nimport b from "./b";`,
    });
  });

  test.each([
    ["overrides = {}", "expected array but received object"],
    ["overrides = [1]", "expected object but received number"],
    ["overrides = [{ options = { semi = false } }]", `an override needs "files"`],
    ["overrides = [{ files = 1 }]", "expected string or array but received number"],
    ["overrides = [{ files = [1] }]", "expected string but received number"],
    [`overrides = [{ files = "a[" }]`, "Invalid glob pattern `a[`"],
    [`overrides = [{ file = "a" }]`, `Unknown key "file" in [format.overrides]\n  Did you mean "files"?`],
    [`overrides = [{ files = "a", options = { semi = 1 } }]`, "expected boolean but received number"],
    [`overrides = [{ files = "a", options = { printWidth = 1.5 } }]`, "Invalid printWidth value: 1.5."],
    [
      `overrides = [{ files = "a", options = { threads = 1 } }]`,
      `Unknown key "threads" in [format.overrides.options]\n`,
    ],
    [`overrides = [{ files = "a", options = { toml = true } }]`, `Unknown key "toml" in [format.overrides.options]\n`],
    [
      `overrides = [{ files = "a", options = { check = true } }]`,
      `Unknown key "check" in [format.overrides.options]\n`,
    ],
    [`overides = []`, `Unknown key "overides" in [format]\n  Did you mean "overrides"?`],
  ])("%s is refused: %s", async (line, message) => {
    const result = await format({ ...bunfig(line), "a.js": "a  ;\n" });
    expect(result.stderr).toContain(message);
    expect(result.files["a.js"]).toBe("a  ;\n");
    expect(result.exitCode).toBe(2);
  });
});

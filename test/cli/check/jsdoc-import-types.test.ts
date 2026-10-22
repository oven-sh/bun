// A JavaScript file names other files in the `import()` types of its JSDoc comments. `tsc` has such a file in the program
// if it finds the type in the comment of a node, whether or not a tag gives the type to a node. The lines here are what
// `tsc` 7.0.2 prints. `differential-cases.json` has these programs with more forms, and there `tsc` itself is the oracle.
// That needs the `typescript7` package, and a debug build runs one in forty of them.
import { afterAll, describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { endChildren, longLimit, spawn } from "../children";
import { env as withoutAgents } from "./differential";

afterAll(endChildren);

const env = {
  ...withoutAgents,
  GITHUB_WORKSPACE: undefined,
  // Of the script that runs the tests.
  npm_lifecycle_event: undefined,
  npm_package_json: undefined,
  BUN_INTERNAL_SCRIPTS_OF_COMMANDS: undefined,
  BUN_INTERNAL_CHECK_SCRIPTS: undefined,
};

// A debug build reads and checks the library in seconds: the smallest one, and unchecked.
const options = { strict: true, noEmit: true, types: [], lib: ["es5"], skipLibCheck: true };
const javascript = { ...options, module: "commonjs", allowJs: true, checkJs: true };
const tsconfig = (compilerOptions: object, files: string[]) => JSON.stringify({ compilerOptions, files });

/** What `bun check` prints for a project of `files`, by line, and its exit code. */
async function check(files: Record<string, string>) {
  using dir = tempDir("bun-check-jsdoc", files);
  const cwd = String(dir);
  await using proc = spawn({ cmd: [bunExe(), "check"], cwd, env, timeout: longLimit, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // A crash, an assertion or a sanitizer report: the test that asserts the exit code says nothing about why.
  if (exitCode !== 0 && exitCode !== 1) console.error(`bun check exited with ${exitCode}:\n${stderr}`);
  const lines = stdout.replaceAll("\\", "/").replaceAll(cwd.replaceAll("\\", "/"), "<dir>").trimEnd().split("\n");
  return { lines, exitCode };
}

const target = `export type O = 1;\nexport const wrong: string = 1;\n`;
const wrongIn = (file: string) => `${file}(2,14): error TS2322: Type 'number' is not assignable to type 'string'.`;
const noParameter = (name: string) =>
  `error TS8024: JSDoc '@param' tag has name '${name}', but there is no parameter with that name.`;

// The first process of a debug build that was just linked reads it from the disk, which takes longer than a test has.
// So the first one is not on the time of a test.
await check({ "tsconfig.json": tsconfig(options, ["a.ts"]), "a.ts": `export {};\n` });

describe.concurrent("bun check, an `import()` type in a JSDoc comment", () => {
  test("in a `@param` tag of a statement that is no function, names a file of the program", async () => {
    expect(
      await check({
        "tsconfig.json": tsconfig(javascript, ["src/main.js"]),
        "other/o.ts": target,
        "src/main.js": `/** @param {any} g */
function wrap(g) { return g; }
/**
 * @param {import('../other/o').O} resource
 */
const use = wrap(function use(/** @type {any} */ resource) { return resource; });
module.exports = { use };
`,
      }),
    ).toEqual({ lines: [wrongIn("other/o.ts")], exitCode: 1 });
  });

  test("in a `@param` tag without a parameter, is where 6059 is reported", async () => {
    expect(
      await check({
        "tsconfig.json": tsconfig({ ...javascript, rootDir: "./src" }, ["src/main.js"]),
        "other/o.ts": `export type O = 1;\n`,
        "src/main.js": `/**
 * @param {number} a
 * @param {import('../other/o').O} missing
 */
function f(a) { return a; }
module.exports = { f };
`,
      }),
    ).toEqual({
      lines: [
        "src/main.js(3,19): error TS6059: File '<dir>/other/o.ts' is not under 'rootDir' '<dir>/src'. 'rootDir' is expected to contain all source files.",
        `src/main.js(3,36): ${noParameter("missing")}`,
      ],
      exitCode: 1,
    });
  });

  // Each form has a file of its own, `src/<name>.js`, which names `other/<name>.ts`. `tsc` finds the type if the tree of a
  // comment of a node has it. The parser of comments drops some of what it reads, and the end of the file is no node.
  const type = (name: string) => `import("../other/${name}").O`;
  const forms: [name: string, isFound: boolean, text: (type: string, name: string) => string][] = [
    ["param-without-parameter", true, t => `/** @param {${t}} missing */\nfunction f() {}\n`],
    [
      "param-of-property-without-parameter",
      true,
      t => `/**\n * @param {Object} o\n * @param {${t}} o.a\n */\nfunction f() {}\n`,
    ],
    [
      "param-under-type-tag",
      true,
      t => `/**\n * @type {(a: number) => number}\n * @param {${t}} a\n */\nfunction f(a) { return a; }\n`,
    ],
    ["second-type-tag", true, t => `/**\n * @type {number}\n * @type {${t}}\n */\nvar x = 1;\n`],
    ["type-of-if-statement", true, t => `var x = 1;\n/** @type {${t}} */\nif (x) x = 2;\n`],
    ["returns-of-variable", true, t => `/** @returns {${t}} */\nvar x = 1;\n`],
    ["throws", true, t => `/** @throws {${t}} */\nfunction f() {}\n`],
    ["this-of-variable", true, t => `/** @this {${t}} */\nvar x = 1;\n`],
    ["template-default-of-variable", true, t => `/** @template [T=${t}] */\nvar x = 1;\n`],
    ["satisfies-of-function", true, t => `/** @satisfies {${t}} */\nfunction f() {}\n`],
    ["overload-of-variable", true, t => `/**\n * @overload\n * @param {${t}} a\n * @returns {void}\n */\nvar x = 1;\n`],
    ["implements-of-variable", true, t => `/** @implements {Base<${t}>} */\nvar x = 1;\n`],
    [
      "this-in-typedef",
      true,
      t => `/**\n * @typedef {Object} Options\n * @this {${t}}\n * @property {number} a\n */\nvar x = 1;\n`,
    ],
    ["comment-of-parameter", true, t => `function f(/** @returns {${t}} */ a) { return a; }\n`],
    ["comment-of-class-member", true, t => `class C {\n  /** @returns {${t}} */\n  a = 1;\n}\n`],
    ["comment-of-case-clause", true, t => `var x = 1;\nswitch (x) {\n  /** @type {${t}} */\n  case 1:\n}\n`],
    ["typedef-at-end-of-file", true, t => `var x = 1;\n/** @typedef {${t}} Alias */\n`],
    [
      "typedef-in-comment-of-inner-node-only",
      true,
      t => `var x = 1; /** @typedef {${t}} Alias */\n/** Then. */\na => a;\n`,
    ],
    [
      "require-in-computed-name",
      true,
      (_, name) => `/** @returns {{ [require("../other/${name}")]: number }} */\nvar x = 1;\n`,
    ],
    [
      "require-in-place-of-import-tag-string",
      true,
      (_, name) => `/** @import (require("../other/${name}")) */\nvar x = 1;\n`,
    ],
    ["type-at-end-of-file", false, t => `var x = 1;\n/** @type {${t}} */\n`],
    ["dotted-typedef-at-end-of-file", false, t => `var x = 1;\n/** @typedef {${t}} Names.Alias */\n`],
    ["comment-of-no-node", false, t => `var x = 1; /** @type {${t}} */\nvar y = 2;\n`],
    ["comment-of-inner-node-only", false, t => `var x = 1; /** @type {${t}} */\n/** Then. */\na => a;\n`],
    [
      "template-after-typedef",
      false,
      t => `/**\n * @typedef {Object} Options\n * @template {${t}} T\n * @property {number} a\n */\nvar x = 1;\n`,
    ],
    [
      "property-after-type-in-typedef",
      false,
      t => `/**\n * @typedef {Object} Options\n * @type {string}\n * @property {${t}} a\n */\nvar x = 1;\n`,
    ],
    ["default-value", false, (_, name) => `/** @param {number} [a=require("../other/${name}")] */\nfunction f(a) {}\n`],
    ["unknown-tag", false, t => `/** @enum {${t}} */\nvar x = { a: 1 };\n`],
    ["parameter-of-no-arrow-function", false, t => `var a = 1;\nvar x = (/** @type {${t}} */ a);\n`],
  ];

  test("names a file of the program if the tree of a comment of a node has it", async () => {
    const files: Record<string, string> = {};
    for (const [name, , text] of forms) {
      files[`src/${name}.js`] = text(type(name), name);
      files[`other/${name}.ts`] = target;
    }
    // Without `checkJs` there is one line for each file that is in the program.
    const roots = forms.map(([name]) => `src/${name}.js`);
    files["tsconfig.json"] = tsconfig({ ...javascript, checkJs: false }, roots);
    const found = forms.filter(([, isFound]) => isFound).map(([name]) => `other/${name}.ts`);
    expect(await check(files)).toEqual({ lines: found.sort().map(wrongIn), exitCode: 1 });
  });

  test("is one reason for a file, for each place where it is written", async () => {
    // A program with `lib: []` needs these. `--explainFiles` then lists no file of the library, whose path is not that of
    // `tsc`.
    const globals = ["Array<T>", "Boolean", "CallableFunction", "Function", "IArguments", "NewableFunction"]
      .concat(["Number", "Object", "RegExp", "String"])
      .map(it => `interface ${it} {}\n`)
      .join("");
    const written: [name: string, text: string][] = [
      [
        "in-two-tags",
        `/**\n * @param {${type("in-two-tags")}} first\n * @param {${type("in-two-tags")}} second\n */\nfunction f() {}\n`,
      ],
      // The tag gives the type to three signatures.
      [
        "for-three-signatures",
        `/**\n * @template {${type("for-three-signatures")}} T\n * @overload\n * @param {T} a\n * @returns {T}\n * @overload\n * @param {T} a\n * @param {T} b\n * @returns {T}\n */\nfunction f(a, b) { return a; }\n`,
      ],
      // The comment is that of the function and of its parameter.
      ["for-two-nodes", `var f = /** @param {${type("for-two-nodes")}} a */ a => a;\n`],
      [
        "on-the-next-line",
        `/**\n * @param {import(\n *   "../other/on-the-next-line").O} missing\n */\nfunction f() {}\n`,
      ],
    ];
    const files: Record<string, string> = { "globals.d.ts": globals };
    for (const [name, text] of written) {
      files[`src/${name}.js`] = text;
      files[`other/${name}.ts`] = `export type O = 1;\n`;
    }
    const roots = ["globals.d.ts", ...written.map(([name]) => `src/${name}.js`)];
    files["tsconfig.json"] = tsconfig({ ...javascript, checkJs: false, lib: [], explainFiles: true }, roots);
    const isListed = "   Part of 'files' list in tsconfig.json";
    const imported = (name: string, text = `"../other/${name}"`) =>
      `   Imported via ${text} from file 'src/${name}.js'`;
    expect(await check(files)).toEqual({
      lines: [
        "globals.d.ts",
        isListed,
        "other/in-two-tags.ts",
        imported("in-two-tags"),
        imported("in-two-tags"),
        "src/in-two-tags.js",
        isListed,
        "other/for-three-signatures.ts",
        imported("for-three-signatures"),
        "src/for-three-signatures.js",
        isListed,
        "other/for-two-nodes.ts",
        imported("for-two-nodes"),
        "src/for-two-nodes.js",
        isListed,
        "other/on-the-next-line.ts",
        // The text of the string starts behind the blanks, and a `*` is none.
        imported("on-the-next-line", `*   "../other/on-the-next-line"`),
        "src/on-the-next-line.js",
        isListed,
      ],
      exitCode: 0,
    });
  });

  // The type is parsed again for the type parameter of the alias, and that is a node whose module the checker resolves.
  // The comment is at the end of the file, which is no node, so the file that it names is not in the program.
  test("in a `@template` tag of a `@typedef` at the end of the file, names no file of the program", async () => {
    expect(
      await check({
        "tsconfig.json": tsconfig(javascript, ["src/main.js"]),
        "other/o.ts": target,
        "src/main.js": `var x = 1;\n/**\n * @template {import("../other/o").O} T\n * @typedef {T} Alias\n */\n`,
      }),
    ).toEqual({
      lines: [
        "src/main.js(3,22): error TS2307: Cannot find module '../other/o' or its corresponding type declarations.",
      ],
      exitCode: 1,
    });
  });

  test("of no node, is resolved in the mode of its attributes, and a module that is not found is no error", async () => {
    expect(
      await check({
        "tsconfig.json": tsconfig({ ...javascript, module: "nodenext", skipLibCheck: false }, ["src/main.cjs"]),
        "node_modules/pkg/package.json": `{ "name": "pkg", "exports": { "import": "./esm.d.mts", "require": "./cjs.d.cts" } }\n`,
        "node_modules/pkg/esm.d.mts": `export type O = 1;\nexport declare const wrong: string = 1;\n`,
        "node_modules/pkg/cjs.d.cts": `export type O = 2;\nexport declare const wrong: number = "";\n`,
        "src/main.cjs": `/**
 * @param {import("pkg", { with: { "resolution-mode": "import" } }).O} first
 * @param {import("./missing").O} second
 */
function f() {}
module.exports = { f };
`,
      }),
    ).toEqual({
      lines: [
        "node_modules/pkg/esm.d.mts(2,22): error TS2322: Type 'number' is not assignable to type 'string'.",
        "node_modules/pkg/esm.d.mts(2,38): error TS1039: Initializers are not allowed in ambient contexts.",
        `src/main.cjs(2,72): ${noParameter("first")}`,
        `src/main.cjs(3,35): ${noParameter("second")}`,
      ],
      exitCode: 1,
    });
  });

  // `tsc` parses a statement of a module again if it has an `await` that can be a name, here before a `(`. What it parses
  // again has no comments for it to look in.
  test("in a statement of a module that is parsed again for `await`, names no file of the program", async () => {
    const awaited = { ...javascript, module: "esnext", target: "es2022", moduleResolution: "bundler", lib: ["es2017"] };
    expect(
      await check({
        "tsconfig.json": tsconfig(awaited, ["src/module.js", "src/script.js"]),
        "other/again.ts": target,
        "other/once.ts": target,
        "other/later.ts": target,
        "other/script.ts": target,
        "src/module.js": `export {};
function foo() { return 1; }
/** @throws {import("../other/again").O} */
await (foo());
/** @throws {import("../other/once").O} */
await foo();
/** @throws {import("../other/later").O} */
function f() {}
`,
        "src/script.js": `function foo() { return 1; }
function await(x) { return x; }
/** @throws {import("../other/script").O} */
await (foo());
`,
      }),
    ).toEqual({
      lines: [
        wrongIn("other/later.ts"),
        wrongIn("other/once.ts"),
        wrongIn("other/script.ts"),
        "src/script.js(2,16): error TS7006: Parameter 'x' implicitly has an 'any' type.",
      ],
      exitCode: 1,
    });
  });
});

// The tree of the file has no place for the type arguments of a second base class. `tsc` has them, and checks nothing in
// them: the file that one names is in the program, and one that names no file is no error.
test.concurrent(
  "bun check, an `import()` type in the type arguments of a second base class is not resolved",
  async () => {
    expect(
      await check({
        "tsconfig.json": tsconfig({ ...options, module: "commonjs" }, ["src/main.ts"]),
        "other/o.ts": target,
        "src/main.ts": `class A {}
class B<T> { x!: T }
class C extends A, B<import("../other/o").O> {}
class D extends A, B<import("../other/missing").O> {}
new C(); new D();
`,
      }),
    ).toEqual({
      lines: [
        wrongIn("other/o.ts"),
        "src/main.ts(3,20): error TS1174: Classes can only extend a single class.",
        "src/main.ts(4,20): error TS1174: Classes can only extend a single class.",
      ],
      exitCode: 1,
    });
  },
);

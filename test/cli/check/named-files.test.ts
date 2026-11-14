import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

const tsconfig = JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ["*.ts"] });

async function check(files: Record<string, string>, ...named: string[]) {
  using dir = tempDir("check-named-files", { "tsconfig.json": tsconfig, ...files });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--no-pretty", ...named],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
  return { errors: (stdout + stderr).match(/error TS\d+/g) ?? [], exitCode: await proc.exited };
}

const usesGlobal = "console.log(declaredElsewhere + 1);\n";

test.each([
  ["a script", { "script.ts": "var declaredElsewhere: number;\n" }],
  [
    "a script with an export in a namespace",
    { "script.ts": "namespace Kept {\n  export const one = 1;\n}\nvar declaredElsewhere: number;\n" },
  ],
  ["declare global", { "rest.ts": "export {};\ndeclare global { var declaredElsewhere: number; }\n" }],
  [
    "a file outside include that an unreached file imports",
    {
      "nobody.ts": `export function load() { return import("./outside/adds"); }\n`,
      "outside/adds.ts": "export {};\ndeclare global { var declaredElsewhere: number; }\n",
    },
  ],
  [
    "a file outside include behind an unreached file of the project",
    {
      "first.ts": `export * from "./second";\n`,
      "second.ts": `import "./outside/adds";\n`,
      "outside/adds.ts": "export {};\ndeclare global { var declaredElsewhere: number; }\n",
    },
  ],
  [
    "a reference",
    {
      "refers.ts": `/// <reference path="./outside/adds.d.ts" />\nexport {};\n`,
      "outside/adds.d.ts": "declare var declaredElsewhere: number;\n",
    },
  ],
])("a named file sees a global declared by %s", async (_, files) => {
  expect(await check({ "main.ts": usesGlobal, ...files }, "main.ts")).toEqual({ errors: [], exitCode: 0 });
});

test("a named file does not see a global of a module nothing reaches, or its errors", async () => {
  const unreached = "export const wrong: string = 1;\n";
  expect(await check({ "main.ts": "export const fine = 1;\n", "unreached.ts": unreached }, "main.ts")).toEqual({
    errors: [],
    exitCode: 0,
  });
});

test("a named file finds the file that it adds to, which nothing imports", async () => {
  const files = {
    "observable.ts": "export declare class Observable<T> {\n  held: T;\n}\n",
    "adds.ts": `declare module "./observable" {\n  interface Observable<T> {\n    map(): T;\n  }\n}\nexport {};\n`,
  };
  expect(await check(files, "adds.ts")).toEqual({ errors: [], exitCode: 0 });
});

test("a file that a named file imports is checked as before", async () => {
  const result = await check(
    { "main.ts": `import { a } from "./used";\nexport const b: string = a;\n`, "used.ts": "export const a = 1;\n" },
    "main.ts",
  );
  expect(result.errors).toEqual(["error TS2322"]);
});

const script = "var declaredElsewhere: number;\n";
const javascript = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, types: [], allowJs: true, checkJs: true },
  include: ["*.ts", "*.js"],
});

test.concurrent.each([
  // What only looks like the `import` or the `export` of a module.
  ["a name that holds import", { "script.ts": `${script}var important = 1;\n` }],
  ["a name that holds export", { "script.ts": `${script}var exported = 1;\n` }],
  ["a string", { "script.ts": `${script}var text = "export";\n` }],
  ["a regular expression", { "script.ts": `${script}var quoted = /['"\`]import/;\nvar other = /export/;\n` }],
  ["a comment", { "script.ts": `${script}// import\n` }],
  ["lines in a comment", { "script.ts": `${script}/*\nimport x from "./main"\nexport {}\n*/\n` }],
  ["lines in a template", { "script.ts": `${script}var t = \`\nimport x from "./main"\nexport const c = 1;\n\`;\n` }],
  ["a dynamic import", { "script.ts": `${script}import("./module");\n`, "module.ts": "export {};\n" }],
  [
    "a dynamic import in a variable",
    { "script.ts": `${script}var m = import("./module");\n`, "module.ts": "export {};\n" },
  ],
  ["a method called import", { "script.ts": `${script}var io = {\n  import() {},\n};\n` }],
  ["a property called export", { "script.ts": `${script}var io = {\n  export: 1,\n};\n` }],
  ["a property called exports", { "script.ts": `${script}var mod = { exports: 1 };\n` }],
  ["methods of a class", { "script.ts": `${script}class S {\n  import() {}\n  export() {}\n}\n` }],
  ["a member of an interface", { "script.ts": `${script}interface O {\n  export?: boolean;\n}\n` }],
  [
    "an alias in a namespace",
    { "script.ts": `${script}namespace L { export const a = 1 }\nnamespace N {\n  import a = L.a;\n}\n` },
  ],
  ["an alias", { "script.ts": `import a = L.a;\nnamespace L { export const a = 1 }\n${script}` }],
  ["an alias with a quote", { "script.ts": `import /* " */ a = L.a;\nnamespace L { export const a = 1 }\n${script}` }],
  ["a directive", { "script.ts": `"use strict";\n${script}var important = 1;\n` }],
  [
    "a name that holds require",
    { "tsconfig.json": javascript, "script.js": "var declaredElsewhere = 1, required = 1;\n" },
  ],
  [
    "a string that holds require(",
    { "tsconfig.json": javascript, "script.js": `var declaredElsewhere = 1;\nvar hint = "call require(name)";\n` },
  ],
  [
    "a comment that holds module.exports",
    { "tsconfig.json": javascript, "script.js": "// module.exports = 1\nvar declaredElsewhere = 1;\n" },
  ],
  // What is written with a comment in between.
  ["declare global", { "rest.ts": "export {};\ndeclare /* a */ global { var declaredElsewhere: number; }\n" }],
  [
    "a file outside include, imported with a comment",
    {
      "nobody.ts": `export const load = () => import(/* webpackChunkName: "a" */ "./outside/adds");\n`,
      "outside/adds.ts": "export {};\ndeclare global { var declaredElsewhere: number; }\n",
    },
  ],
  [
    "a file outside include, imported with a template",
    {
      "nobody.ts": "export const load = () => import(`./outside/adds`);\n",
      "outside/adds.ts": "export {};\ndeclare global { var declaredElsewhere: number; }\n",
    },
  ],
])("a named file sees a global of a file with %s", async (_, files) => {
  const project = { "main.ts": usesGlobal, ...files };
  const clean = { errors: [], exitCode: 0 };
  expect(await Promise.all([check(project), check(project, "main.ts")])).toEqual([clean, clean]);
});

test.concurrent.each([
  ["export {} at the start", "export {};\nvar declaredElsewhere: number;\n"],
  ["export {} at the end", "var declaredElsewhere: number;\nexport {};\n"],
  ["an import", `import "./other";\nvar declaredElsewhere: number;\n`],
  [
    "an import behind comments and a directive",
    `#!/usr/bin/env bun\n/* a */ // b\n"use strict";\nimport "./other";\n${script}`,
  ],
  ["import = require", `import other = require("./other");\n${script}`, { module: "commonjs" }],
  ["import type", `import type { Other } from "./other";\n${script}`],
  ["a require at the start", `const other = require("./other");\n${script}`, { module: "commonjs" }, "js"],
  ["module.exports", `module.exports = 1;\n${script}`, { module: "commonjs" }, "js"],
  ["exports.a", `exports.a = 1;\n${script}`, { module: "commonjs" }, "js"],
  ["a require at the end", `${script}function f() { return require("./other"); }\n`, { module: "commonjs" }, "js"],
])("a named file doesn't see the variable of a module with %s", async (_, text, options = {}, extension = "ts") => {
  const project = {
    "tsconfig.json": JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, types: [], allowJs: extension === "js", ...options },
    }),
    "main.ts": usesGlobal,
    [`module.${extension}`]: text.replace(extension === "js" ? ": number" : "", ""),
    "other.ts": "export type Other = 1;\n",
  };
  const result = { errors: ["error TS2304"], exitCode: 1 };
  expect(await Promise.all([check(project), check(project, "main.ts")])).toEqual([result, result]);
});

test.concurrent("a named file sees what a script adds to a type, to a namespace, and to its own variable", async () => {
  const files = {
    "a-script.ts": [
      "interface Array<T> { last(): T }",
      "declare namespace Shapes { interface Box { width: number } }",
      "var twice: number;",
      "var important = 1;\n",
    ].join("\n"),
    "main.ts": `[1].last().toFixed();\nvar box: Shapes.Box = { width: 1 };\nvar twice: string;\n`,
  };
  expect(await check(files, "main.ts")).toEqual({ errors: ["error TS2403"], exitCode: 1 });
});

describe.concurrent("--no-follow-imports", () => {
  const wrong = (name: string) => `export const ${name}: string = 1;\n`;
  const project = {
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ["src"] }),
    "src/a.ts": `import { b } from "./b";\nexport const a: string = b;\n`,
    "src/b.ts": `import "../lib/used";\nexport const b = 1;\n${wrong("bad")}`,
    "src/c.ts": wrong("c"),
    "src/script.ts": `var important: number;\n${wrong("local").replace("export ", "")}`,
    "lib/used.ts": wrong("used"),
    "lib/unused.ts": wrong("unused"),
  };

  async function run(args: string[], more: Record<string, string> = {}) {
    using dir = tempDir("check-no-follow-imports", { ...project, ...more });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "check", "--no-pretty", "--no-follow-imports", ...args],
      cwd: String(dir),
      env: { ...bunEnv, NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const clean = (text: string) =>
      text
        .replaceAll(String(dir).replaceAll("\\", "/"), "<dir>")
        .replace(/ \[[\d.]+m?s\]/g, "")
        .trim();
    return { stdout: clean(stdout), stderr: clean(stderr), exitCode };
  }
  const TS2322 = "error TS2322: Type 'number' is not assignable to type 'string'.";

  test("reports the named files alone", async () => {
    const one = await run(["src/a.ts"]);
    expect(one).toEqual({
      stdout: `src/a.ts(2,14): ${TS2322}`,
      stderr: "Found 1 error in 1 file, checked 1 file",
      exitCode: 1,
    });
    const { stdout } = await run(["src/c.ts", "lib/used.ts"]);
    expect(stdout.split("\n")).toEqual([`lib/used.ts(1,14): ${TS2322}`, `src/c.ts(1,14): ${TS2322}`]);
  });

  test("a named file without an error passes, and sees the globals of the others", async () => {
    const { stdout, exitCode } = await run(["src/fine.ts"], {
      "src/fine.ts": `import { b } from "./b";\nexport const n: number = b + important;\n`,
    });
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 0 });
  });

  test("takes its files from an @file", async () => {
    const { stdout, exitCode } = await run(["@files.txt"], { "files.txt": "src/a.ts\nsrc/c.ts\n" });
    expect(stdout.split("\n")).toEqual([`src/a.ts(2,14): ${TS2322}`, `src/c.ts(1,14): ${TS2322}`]);
    expect(exitCode).toBe(1);
  });

  test.each([
    ["no file", []],
    ["an empty @file", ["@files.txt"]],
    ["a project alone", ["-p", "tsconfig.json"]],
  ])("needs files: %s", async (_, args) => {
    const { stdout, stderr, exitCode } = await run(args, { "files.txt": "" });
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "",
      stderr: "error: --no-follow-imports needs the files to check\nnote: run 'bun check --help' for more information",
      exitCode: 1,
    });
  });

  test.each([["--build"], ["--aot"]])("doesn't work with %s", async flag => {
    const { stderr, exitCode } = await run([flag, "src/a.ts"]);
    expect(stderr).toContain(`error: --no-follow-imports does not work with ${flag}`);
    expect(exitCode).toBe(1);
  });

  test("a file that the project doesn't have is an error", async () => {
    const { stdout, exitCode } = await run(["lib/unused.ts", "lib/other.ts", "src/c.ts"], { "lib/other.ts": "" });
    expect(stdout.split("\n").map(line => line.replaceAll("/private<dir>", "<dir>"))).toEqual([
      ...["other", "unused"].map(
        name =>
          `error: '<dir>/lib/${name}.ts' is not in the project '<dir>/tsconfig.json'. --no-follow-imports adds no file to it`,
      ),
      `src/c.ts(1,14): ${TS2322}`,
    ]);
    expect(exitCode).toBe(1);
  });

  test("a directory is an error", async () => {
    const { stdout, exitCode } = await run(["src", "src/a.ts"]);
    const [first, ...rest] = stdout.split("\n");
    expect(first).toEndWith("/src' is a directory. --no-follow-imports takes files");
    expect(rest).toEqual([`src/a.ts(2,14): ${TS2322}`]);
    expect(exitCode).toBe(1);
  });

  test("errors about the program are reported wherever they are", async () => {
    const { stdout } = await run(["src/a.ts"], {
      "src/refers.ts": `/// <reference path="./gone.d.ts" />\n${wrong("own")}`,
    });
    expect(stdout.split("\n")).toEqual([
      `src/a.ts(2,14): ${TS2322}`,
      "src/refers.ts(1,22): error TS6053: File './gone.d.ts' not found.",
    ]);
  });

  test("a file that no project of a solution has is an error", async () => {
    const { stdout, exitCode } = await run(["lib/unused.ts", "src/c.ts"], {
      "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.src.json" }] }),
      "tsconfig.src.json": JSON.stringify({
        compilerOptions: { strict: true, composite: true, types: [], noEmit: true },
        include: ["src/c.ts"],
      }),
    });
    const [first, ...rest] = stdout.split("\n");
    expect(first).toMatch(/^error: '.*\/lib\/unused.ts' is not in the project '.*\/tsconfig.json'/);
    expect(rest).toEqual([`src/c.ts(1,14): ${TS2322}`]);
    expect(exitCode).toBe(1);
  });

  test("without a tsconfig.json the named files are the project", async () => {
    using dir = tempDir("check-no-follow-imports-alone", {
      "a.ts": `import "./b";\n${wrong("a")}`,
      "b.ts": wrong("b"),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "check", "--no-pretty", "--no-follow-imports", "a.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: `a.ts(2,14): ${TS2322}`, exitCode: 1 });
  });
});

// `\` is a separator on Windows.
test.concurrent.skipIf(isWindows)("a named file with a backslash in its name is the file of that name", async () => {
  const files = { "a\\b.ts": "export const x: number = 's';\n", "fine.ts": "export {};\n" };
  const wrong = { errors: ["error TS2322"], exitCode: 1 };
  expect(
    await Promise.all([
      check(files),
      check(files, "a\\b.ts"),
      check(files, "--no-follow-imports", "a\\b.ts"),
      check({ ...files, "a/b.ts": "export {};\n" }, "a\\b.ts"),
      // As for `tsc`, if there is no such file.
      check(files, ".\\fine.ts"),
    ]),
  ).toEqual([wrong, wrong, wrong, wrong, { errors: [], exitCode: 0 }]);
  const excluded = { ...files, "tsconfig.json": JSON.stringify({ files: ["fine.ts"] }) };
  expect(await check(excluded, "--no-follow-imports", "a\\b.ts")).toEqual({ errors: [], exitCode: 1 });
});

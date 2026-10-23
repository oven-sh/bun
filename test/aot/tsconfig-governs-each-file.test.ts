import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const shared = {
  target: "ESNext",
  module: "Preserve",
  moduleResolution: "bundler",
  noEmit: true,
  types: [] as string[],
  strict: true,
};
const config = (more: object = {}, rest: object = {}) =>
  JSON.stringify({ compilerOptions: { ...shared, ...more }, ...rest });

async function run(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...args], cwd);
  return { said: stdout + stderr, exitCode };
}

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
// `bun check` writes `file(line,column): error TS1: ..`, a build `error: TS1: ..` and under it `at <folder>/file:line:column`.
const errors = (said: string) =>
  [
    ...[...said.matchAll(/^(\S+)\(\d+,\d+\): error (TS\d+)/gm)].map(
      match => `${match[1].replaceAll("\\", "/")} ${match[2]}`,
    ),
    ...[...said.matchAll(/^error: (TS\d+):.*\n +at .*tsconfig-governs-each-file[^\\/]*[\\/](.+):\d+:\d+$/gm)].map(
      match => `${match[2].replaceAll("\\", "/")} ${match[1]}`,
    ),
  ].sort();
const codes = (said: string) => [...new Set([...said.matchAll(/\bTS\d+/g)].map(match => match[0]))].sort();

const smells = `export function smells(flag: boolean, loose) {\n  const unused = 1;\n  if (flag) return 1;\n}\n`;
const lenient = { noImplicitAny: false, noImplicitReturns: false, noUnusedLocals: false };

function threeProjects(outer: string, inner: string, ending: string, more: (name: string) => string) {
  return {
    "tsconfig.json": config({ ...lenient, noImplicitReturns: true }),
    [`top${ending}`]: smells + more("top"),
    [`${outer}/tsconfig.json`]: config({ ...lenient, noUnusedLocals: true }),
    [`${outer}/middle${ending}`]: smells + more("middle"),
    [`${outer}/${inner}/tsconfig.json`]: config({ ...lenient, noImplicitAny: true }),
    [`${outer}/${inner}/deep${ending}`]: smells + more("deep"),
  };
}

const called = () => `smells(true, 1);\n`;
const tested = (name: string) => `test(${JSON.stringify(name)}, () => { expect(smells(true, 1)).toBe(1); });\n`;
const expected = (outer: string, inner: string, ending: string) =>
  [`${outer}/${inner}/deep${ending} TS7006`, `${outer}/middle${ending} TS6133`, `top${ending} TS7030`].sort();

test("bun check --aot: each entry point is checked under the tsconfig.json nearest to it, in any order", async () => {
  using dir = tempDir("tsconfig-governs-each-file", threeProjects("pkg", "test", ".ts", called));
  const files = ["top.ts", "pkg/middle.ts", "pkg/test/deep.ts"];
  for (const order of [files, [...files].reverse(), [files[1], files[2], files[0]]]) {
    const { said, exitCode } = await run(String(dir), "check", "--aot", ...order);
    expect(errors(said)).toEqual(expected("pkg", "test", ".ts"));
    expect(exitCode).toBe(1);
  }
});

test("bun check --aot: an imported file is checked under its own tsconfig.json", async () => {
  using dir = tempDir("tsconfig-governs-each-file", {
    ...threeProjects("pkg", "test", ".ts", called),
    "pkg/test/main.ts": `import "../../top";\nimport "../middle";\nimport "./deep";\n`,
  });
  const { said } = await run(String(dir), "check", "--aot", "pkg/test/main.ts");
  expect(errors(said)).toEqual(expected("pkg", "test", ".ts"));
  const fromInside = await run(join(String(dir), "pkg", "test"), "check", "--aot", "main.ts");
  expect(codes(fromInside.said)).toEqual(["TS6133", "TS7006", "TS7030"]);
});

test("bun build --compile --aot agrees with bun check --aot", async () => {
  using dir = tempDir("tsconfig-governs-each-file", {
    ...threeProjects("pkg", "test", ".ts", called),
    "pkg/test/main.ts": `import "../../top";\nimport "../middle";\nimport "./deep";\n`,
  });
  const { said, exitCode } = await run(
    String(dir),
    "build",
    "--compile",
    "--aot",
    "pkg/test/main.ts",
    "--outfile",
    "program",
  );
  expect(codes(said)).toEqual(["TS6133", "TS7006", "TS7030"]);
  expect(said.split("TS7006").length - 1).toBe(1);
  expect(said.split("TS6133").length - 1).toBe(1);
  expect(said.split("TS7030").length - 1).toBe(1);
  expect(exitCode).toBe(1);
}, 120_000);

test("bun test --aot agrees, whatever the folders are called", async () => {
  for (const [outer, inner] of [
    ["pkg", "test"],
    ["aaa", "aaa"],
    ["zzz", "zzz"],
    ["aaa", "zzz"],
  ]) {
    using dir = tempDir("tsconfig-governs-each-file", threeProjects(outer, inner, ".test.ts", tested));
    const { said, exitCode } = await run(String(dir), "test", "--aot");
    expect(errors(said)).toEqual(expected(outer, inner, ".test.ts"));
    expect(passed(said)).toEqual([]);
    expect(exitCode).toBe(1);
  }
});

test("a source file that tests under two tsconfig.json files import is checked under its own", async () => {
  const box = `export class Box {\n  value: number;\n  set(value: number) { this.value = value; return this; }\n}\n`;
  const uses = (name: string, from: string) =>
    `import { Box } from ${JSON.stringify(from)};\ntest(${JSON.stringify(name)}, () => { expect(new Box().set(1).value).toBe(1); });\n`;
  for (const first of ["a-strict", "z-strict"]) {
    using dir = tempDir("tsconfig-governs-each-file", {
      "lib/tsconfig.json": config({ strictPropertyInitialization: false }),
      "lib/box.ts": box,
      "lib/own.test.ts": uses("beside it", "./box"),
      [`${first}/tsconfig.json`]: config(),
      [`${first}/other.test.ts`]: uses("from a stricter project", "../lib/box"),
    });
    const { said, exitCode } = await run(String(dir), "test", "--aot");
    expect(errors(said)).toEqual([]);
    expect(passed(said)).toEqual(["beside it", "from a stricter project"]);
    expect(exitCode).toBe(0);
  }
  using dir = tempDir("tsconfig-governs-each-file", {
    "lib/tsconfig.json": config(),
    "lib/box.ts": box,
    "lenient/tsconfig.json": config({ strictPropertyInitialization: false }),
    "lenient/other.test.ts": uses("never run", "../lib/box"),
  });
  const { said } = await run(String(dir), "test", "--aot");
  expect(errors(said)).toEqual(["lib/box.ts TS2564"]);
});

test("a type error fails its test file alone and beside a test file of another tsconfig.json", async () => {
  using dir = tempDir("tsconfig-governs-each-file", {
    "a/tsconfig.json": config(),
    "a/a.test.ts": `test("a", () => { expect(1).toBe(1); });\n`,
    "b/tsconfig.json": config(),
    "b/b.test.ts": `const n: number = "text";\ntest("b", () => { expect(n as unknown).toBe("text"); });\n`,
  });
  const together = await run(String(dir), "test", "--aot");
  expect(errors(together.said)).toEqual(["b/b.test.ts TS2322"]);
  expect(passed(together.said)).toEqual(["a"]);
  const alone = await run(String(dir), "test", "--aot", "./b/b.test.ts");
  expect(errors(alone.said)).toEqual(["b/b.test.ts TS2322"]);
  expect(passed(alone.said)).toEqual([]);
});

test("under a tsconfig.json that only has references, the referenced project that includes a file governs it", async () => {
  using dir = tempDir("tsconfig-governs-each-file", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.test.json" }],
    }),
    "tsconfig.app.json": config(
      { ...lenient, composite: true, noEmit: false, outDir: "out/app" },
      { include: ["src"] },
    ),
    "tsconfig.test.json": config(
      { ...lenient, composite: true, noEmit: false, outDir: "out/test", noUnusedLocals: true },
      { include: ["test"] },
    ),
    "src/app.ts": smells,
    "test/fine.test.ts": `import { smells } from "../src/app";\ntest("the application's options", () => { expect(smells(true, 1)).toBe(1); });\n`,
    "test/unused.test.ts": smells + tested("never run"),
  });
  const { said } = await run(String(dir), "test", "--aot");
  expect(errors(said)).toEqual(["test/unused.test.ts TS6133"]);
  expect(passed(said)).toEqual(["the application's options"]);
});

test("a build under a tsconfig.json that only has references goes by the referenced project that includes each file", async () => {
  using dir = tempDir("tsconfig-governs-each-file", {
    "tsconfig.json": JSON.stringify({
      files: [],
      references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.tools.json" }],
    }),
    "tsconfig.app.json": config(
      { ...lenient, composite: true, noEmit: false, outDir: "out/app" },
      { include: ["src"] },
    ),
    "tsconfig.tools.json": config(
      { ...lenient, composite: true, noEmit: false, outDir: "out/tools", noUnusedLocals: true },
      { include: ["tools"] },
    ),
    "src/app.ts": smells + `console.log(smells(true, 1));\n`,
    "src/with-tools.ts": `import { smells } from "../tools/tool";\nconsole.log(smells(true, 1));\n`,
    "tools/tool.ts": smells,
  });
  const outfile = join(String(dir), "program");
  for (const command of [
    ["check", "--aot", "src/app.ts"],
    ["build", "--compile", "--aot", "src/app.ts", "--outfile", outfile],
  ]) {
    const { said, exitCode } = await run(String(dir), ...command);
    expect(errors(said)).toEqual([]);
    expect(exitCode).toBe(0);
  }
  await using ran = Bun.spawn({ cmd: [outfile], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  expect(await ran.stdout.text()).toBe("1\n");
  const { said, exitCode } = await run(
    String(dir),
    "build",
    "--compile",
    "--aot",
    "src/with-tools.ts",
    "--outfile",
    outfile,
  );
  expect(errors(said)).toEqual(["tools/tool.ts TS6133"]);
  expect(exitCode).toBe(1);
}, 120_000);

test("a build declares what the types of an imported file's tsconfig.json declare", async () => {
  using dir = tempDir("tsconfig-governs-each-file", {
    "app/tsconfig.json": config(),
    "app/main.ts": `import { known, type Size } from "../lib/index";\nconst size: Size = 1;\nconsole.log(known, size);\n`,
    "lib/tsconfig.json": config({ types: ["widget"] }),
    "lib/index.ts": `import type * as kit from "widget-kit";\nexport type Size = ReturnType<typeof kit.size>;\nexport const known: boolean = typeof WIDGET_VERSION === "number";\n`,
    "node_modules/@types/widget/package.json": JSON.stringify({
      name: "@types/widget",
      version: "1.0.0",
      types: "index.d.ts",
    }),
    "node_modules/@types/widget/index.d.ts": `declare const WIDGET_VERSION: number;\ndeclare module "widget-kit" {\n  export function size(): number;\n}\n`,
  });
  const outfile = join(String(dir), "program");
  const checked = await run(String(dir), "check", "--aot", "app/main.ts");
  expect({ errors: errors(checked.said), exitCode: checked.exitCode }).toEqual({ errors: [], exitCode: 0 });
  const built = await run(String(dir), "build", "--compile", "--aot", "app/main.ts", "--outfile", outfile);
  expect({ codes: codes(built.said), exitCode: built.exitCode }).toEqual({ codes: [], exitCode: 0 });
  await using ran = Bun.spawn({ cmd: [outfile], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  expect(await ran.stdout.text()).toBe("false 1\n");
}, 120_000);

test("the lib of one test file's tsconfig.json does not reach the files of another", async () => {
  using dir = tempDir("tsconfig-governs-each-file", {
    "tsconfig.json": config({ lib: ["ES2020"], noImplicitOverride: true }),
    "src/failure.ts": `export class Failure extends Error {\n  readonly cause: Error | undefined;\n  constructor(cause?: Error) {\n    super("failed");\n    this.cause = cause;\n  }\n}\n`,
    "main.test.ts": `import { Failure } from "./src/failure";\ntest("main", () => { expect(new Failure().cause).toBeUndefined(); });\n`,
    "sub/tsconfig.json": config({ lib: ["ES2022"] }),
    "sub/sub.test.ts": `test("sub", () => { expect(1).toBe(1); });\n`,
  });
  const { said, exitCode } = await run(String(dir), "test", "--aot");
  expect(codes(said)).toEqual([]);
  expect(passed(said)).toEqual(["main", "sub"]);
  expect(exitCode).toBe(0);
});

// TODO: today the program is the project of the first file of the run. Errors that are expected here are not reported; nothing valid is refused.
test.todo(
  "what the tsconfig.json files of all the test files agree on holds for the program, Bun's defaults where they differ",
  async () => {
    const usesTheDom = (name: string) =>
      `const body: BodyInit = ${JSON.stringify(name)};\ntest(${JSON.stringify(name)}, () => { expect(body).toBe(${JSON.stringify(name)}); });\n`;
    const packages = (first: object, second: object) => ({
      "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./first" }, { path: "./second" }] }),
      "first/tsconfig.json": config({ composite: true, noEmit: false, outDir: "out", ...first }),
      "first/first.test.ts": usesTheDom("first"),
      "second/tsconfig.json": config({ composite: true, noEmit: false, outDir: "out", ...second }),
      "second/second.test.ts": usesTheDom("second"),
    });
    {
      using dir = tempDir("tsconfig-governs-each-file", packages({}, {}));
      for (const files of [["first"], ["second"], []]) {
        const { said, exitCode } = await run(String(dir), "test", "--aot", ...files);
        expect(codes(said)).toEqual([]);
        expect(passed(said)).toEqual(files.length ? files : ["first", "second"]);
        expect(exitCode).toBe(0);
      }
    }
    using dir = tempDir("tsconfig-governs-each-file", packages({ lib: ["ESNext", "DOM"] }, { lib: ["ES2022", "DOM"] }));
    const { said } = await run(String(dir), "test", "--aot");
    expect(errors(said)).toEqual(["first/first.test.ts TS2304", "second/second.test.ts TS2304"]);
    expect(passed(said)).toEqual([]);
  },
);

test("rootDir has no say about the test files of other tsconfig.json files", async () => {
  using dir = tempDir("tsconfig-governs-each-file", {
    "tsconfig.json": config({ rootDir: "./src", outDir: "./dist", noEmit: false }, { include: ["./src/**/*.ts"] }),
    "src/one.ts": `export const one = 1;\n`,
    "test/tsconfig.json": JSON.stringify({
      extends: "../tsconfig.json",
      compilerOptions: { rootDir: "." },
      include: ["."],
    }),
    "test/one.test.ts": `// declare global\nimport { one } from "../src/one";\ntest("one", () => { expect(one).toBe(1); });\n`,
    "fixtures/a/tsconfig.json": config(),
    "fixtures/a/a.test.ts": `test("a fixture", () => { expect(1).toBe(1); });\n`,
  });
  const { said, exitCode } = await run(String(dir), "test", "--aot");
  expect(codes(said)).toEqual([]);
  expect(passed(said)).toEqual(["a fixture", "one"]);
  expect(exitCode).toBe(0);
});

test("strictNullChecks is the program's: a file of a project without it that needs the leniency stops the build of a strict program", async () => {
  using dir = tempDir("tsconfig-governs-each-file", {
    "strict/tsconfig.json": config(),
    "strict/main.ts": `import { nothing } from "../lax/lax";\nconsole.log(nothing);\n`,
    "lax/tsconfig.json": config({ strict: false }),
    "lax/lax.ts": `export const nothing: number = null;\n`,
  });
  const together = await run(String(dir), "check", "--aot", "strict/main.ts");
  expect(errors(together.said)).toEqual(["lax/lax.ts TS2322"]);
  expect(together.said).not.toContain("TS100010");
  expect(together.exitCode).toBe(1);
  const alone = await run(String(dir), "check", "--aot", "lax/lax.ts");
  expect({ errors: errors(alone.said), exitCode: alone.exitCode }).toEqual({ errors: [], exitCode: 0 });
});

test("the sources of a referenced workspace package stand in for its build output", async () => {
  const built = { composite: true, noEmit: false, outDir: "lib", rootDir: "src" };
  using dir = tempDir("tsconfig-governs-each-file", {
    "package.json": JSON.stringify({ name: "workspace", workspaces: ["packages/*"] }),
    "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "packages/types" }, { path: "packages/app" }] }),
    "packages/types/package.json": JSON.stringify({
      name: "@workspace/types",
      version: "1.0.0",
      main: "lib/index.js",
      types: "lib/index.d.ts",
    }),
    "packages/types/tsconfig.json": config(built, { include: ["src"] }),
    "packages/types/src/index.ts": `export interface Rule {\n  level: number;\n}\n`,
    "packages/app/package.json": JSON.stringify({
      name: "@workspace/app",
      version: "1.0.0",
      dependencies: { "@workspace/types": "workspace:*" },
    }),
    "packages/app/tsconfig.json": config(built, { include: ["src"], references: [{ path: "../types" }] }),
    "packages/app/src/app.test.ts": `import type { Rule } from "@workspace/types";\nconst rule: Rule = { level: 1 };\ntest("a rule", () => { expect(rule.level).toBe(1); });\n`,
  });
  mkdirSync(join(String(dir), "node_modules", "@workspace"), { recursive: true });
  symlinkSync(join(String(dir), "packages", "types"), join(String(dir), "node_modules", "@workspace", "types"), "dir");
  for (const cwd of [String(dir), join(String(dir), "packages", "app")]) {
    const { said, exitCode } = await run(cwd, "test", "--aot");
    expect(codes(said)).toEqual([]);
    expect(passed(said)).toEqual(["a rule"]);
    expect(exitCode).toBe(0);
  }
});

test("in a build the sources of a referenced workspace package stand in for its build output", async () => {
  const built = { composite: true, noEmit: false, outDir: "lib", rootDir: "src" };
  using dir = tempDir("tsconfig-governs-each-file", {
    "package.json": JSON.stringify({ name: "workspace", workspaces: ["packages/*"] }),
    "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "packages/types" }, { path: "packages/app" }] }),
    "packages/types/package.json": JSON.stringify({
      name: "@workspace/types",
      version: "1.0.0",
      main: "lib/index.js",
      types: "lib/index.d.ts",
    }),
    "packages/types/tsconfig.json": config(built, { include: ["src"] }),
    "packages/types/src/index.ts": `export interface Rule {\n  level: number;\n}\n`,
    "packages/app/package.json": JSON.stringify({
      name: "@workspace/app",
      version: "1.0.0",
      dependencies: { "@workspace/types": "workspace:*" },
    }),
    "packages/app/tsconfig.json": config(built, { include: ["src"], references: [{ path: "../types" }] }),
    "packages/app/src/main.ts": `import type { Rule } from "@workspace/types";\nconst rule: Rule = { level: 1 };\nconsole.log(rule.level);\n`,
    "packages/app/src/wrong.ts": `import type { Rule } from "@workspace/types";\nconst rule: Rule = { level: "one" };\nconsole.log(rule.level);\n`,
  });
  mkdirSync(join(String(dir), "node_modules", "@workspace"), { recursive: true });
  symlinkSync(join(String(dir), "packages", "types"), join(String(dir), "node_modules", "@workspace", "types"), "dir");
  const outfile = join(String(dir), "program");
  const accepted = await run(
    String(dir),
    "build",
    "--compile",
    "--aot",
    "packages/app/src/main.ts",
    "--outfile",
    outfile,
  );
  expect({ codes: codes(accepted.said), exitCode: accepted.exitCode }).toEqual({ codes: [], exitCode: 0 });
  await using ran = Bun.spawn({ cmd: [outfile], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
  expect(await ran.stdout.text()).toBe("1\n");
  const refused = await run(
    String(dir),
    "build",
    "--compile",
    "--aot",
    "packages/app/src/wrong.ts",
    "--outfile",
    outfile,
  );
  expect(errors(refused.said)).toEqual(["packages/app/src/wrong.ts TS2322"]);
}, 120_000);

const jsxRuntime = (prefix: string) => ({
  "jsx-runtime.ts": `export function jsx(tag: string, props: { children?: unknown }): string { return ${JSON.stringify(prefix)} + tag + ":" + String(props.children); }\nexport const jsxs = jsx;\nexport const jsxDEV = jsx;\nexport const Fragment = "fragment";\nexport namespace JSX {\n  export type Element = string;\n  export interface IntrinsicElements { [name: string]: { children?: unknown } }\n}\n`,
  "jsx-dev-runtime.ts": `export * from "./jsx-runtime";\n`,
});
const under = (folder: string, files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).map(([name, text]) => [`${folder}/${name}`, text]));

test("bun test --aot takes decorators as bun test compiles them: by the tsconfig.json of the working directory", async () => {
  const marked = (mark: string) =>
    `let count = 0;\n${mark}\n@mark\nclass Marked {}\ntest("marked", () => { console.log(Marked.name + " got " + count); });\n`;
  using dir = tempDir("tsconfig-governs-each-file", {
    "tsconfig.json": config({ experimentalDecorators: false }),
    "legacy/tsconfig.json": config({ experimentalDecorators: true }),
    "legacy/standard-style.test.ts": marked(
      `function mark(value: Function, context: ClassDecoratorContext) { count = arguments.length; }`,
    ),
    "legacy/legacy-style.test.ts": marked(`function mark(target: Function) { count = arguments.length; }`),
  });
  for (const aot of [[], ["--aot"]]) {
    const outside = await run(String(dir), "test", ...aot, "legacy/standard-style.test.ts");
    expect(codes(outside.said)).toEqual([]);
    expect(outside.said).toContain("Marked got 2");
    expect(outside.exitCode).toBe(0);
    const inside = await run(join(String(dir), "legacy"), "test", ...aot, "legacy-style.test.ts");
    expect(codes(inside.said)).toEqual([]);
    expect(inside.said).toContain("Marked got 1");
    expect(inside.exitCode).toBe(0);
  }
});

const runtime = (name: string, result: string, made: string) => ({
  [`node_modules/${name}/package.json`]: JSON.stringify({ name, version: "1.0.0" }),
  [`node_modules/${name}/jsx-runtime.ts`]: `export function jsx(tag: string, props: { children?: unknown }): ${result} { return ${made}; }\nexport const jsxs = jsx;\nexport const jsxDEV = jsx;\nexport const Fragment = "fragment";\nexport namespace JSX {\n  export type Element = ${result};\n  export interface IntrinsicElements { [name: string]: { children?: unknown } }\n}\n`,
  [`node_modules/${name}/jsx-dev-runtime.ts`]: `export * from "./jsx-runtime";\n`,
});

test("bun run --aot takes JSX as bun run compiles it: by the tsconfig.json of the working directory", async () => {
  using dir = tempDir("tsconfig-governs-each-file", {
    ...runtime("text-jsx", "string", `tag + ":" + String(props.children)`),
    ...runtime("length-jsx", "number", `(tag + ":" + String(props.children)).length`),
    "tsconfig.json": config({ jsx: "react-jsx", jsxImportSource: "text-jsx" }),
    "inner/tsconfig.json": config({ jsx: "react-jsx", jsxImportSource: "length-jsx" }),
    "inner/text.tsx": `const shown: string = <b>x</b>;\nconsole.log(shown);\n`,
    "inner/length.tsx": `const shown: number = <b>x</b>;\nconsole.log(shown);\n`,
  });
  for (const aot of [[], ["--aot"]]) {
    expect(await run(String(dir), "run", ...aot, "inner/text.tsx")).toEqual({ said: "b:x\n", exitCode: 0 });
    expect(await run(join(String(dir), "inner"), "run", ...aot, "length.tsx")).toEqual({ said: "3\n", exitCode: 0 });
  }
});

test("a @jsxImportSource comment counts wherever it stands in the file, as without --aot", async () => {
  using dir = tempDir("tsconfig-governs-each-file", {
    ...under("own-jsx", jsxRuntime("own ")),
    "tsconfig.json": config({ jsx: "react-jsx" }),
    "late.test.tsx": `import { expect, test } from "bun:test";\n/** @jsxImportSource ./own-jsx */\ntest("late", () => { expect(<b>x</b>).toBe("own b:x"); });\n`,
  });
  for (const aot of [[], ["--aot"]]) {
    const { said, exitCode } = await run(String(dir), "test", ...aot);
    expect(codes(said)).toEqual([]);
    expect(passed(said)).toEqual(["late"]);
    expect(exitCode).toBe(0);
  }
});

test("bun check --aot takes JSX and decorators as bun build --compile compiles them: by the tsconfig.json nearest to each file", async () => {
  using dir = tempDir("tsconfig-governs-each-file", {
    ...runtime("text-jsx", "string", `tag + ":" + String(props.children)`),
    ...runtime("length-jsx", "number", `(tag + ":" + String(props.children)).length`),
    "tsconfig.json": config({ jsx: "react-jsx", jsxImportSource: "text-jsx", experimentalDecorators: false }),
    "main.tsx": `import { length } from "./inner/length";\nimport { marked } from "./legacy/marked";\nconst shown: string = <b>x</b>;\nconsole.log(shown, length, marked);\n`,
    "inner/tsconfig.json": config({ jsx: "react-jsx", jsxImportSource: "length-jsx" }),
    "inner/length.tsx": `export const length: number = <b>x</b>;\n`,
    "inner/wrong.tsx": `export const wrong: string = <b>x</b>;\n`,
    "legacy/tsconfig.json": config({ experimentalDecorators: true }),
    "legacy/marked.ts": `function mark(target: any, key: string) { (target.marked ??= []).push(key); }\nexport class Marked { @mark two(): number { return 2; } }\nexport const marked: string = (Marked.prototype as any).marked.join();\n`,
  });
  const outfile = join(String(dir), "out");
  for (const aot of [[], ["--aot"]]) {
    const built = await run(String(dir), "build", "--compile", ...aot, "./main.tsx", "--outfile", outfile);
    expect({ codes: codes(built.said), exitCode: built.exitCode }).toEqual({ codes: [], exitCode: 0 });
    await using ran = Bun.spawn({ cmd: [outfile], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
    expect(await ran.stdout.text()).toBe("b:x 3 two\n");
  }
  const checked = await run(String(dir), "check", "--aot", "main.tsx");
  expect({ errors: errors(checked.said), exitCode: checked.exitCode }).toEqual({ errors: [], exitCode: 0 });
  const refused = await run(String(dir), "build", "--compile", "--aot", "./inner/wrong.tsx", "--outfile", outfile);
  expect(codes(refused.said)).toContain("TS2322");
  expect(refused.exitCode).not.toBe(0);
  expect(errors((await run(String(dir), "check", "--aot", "inner/wrong.tsx")).said)).toEqual([
    "inner/wrong.tsx TS2322",
  ]);
}, 120_000);

test("bun check --aot passes the decorators that a build compiles", async () => {
  using dir = tempDir("tsconfig-governs-each-file", {
    "tsconfig.json": config({ experimentalDecorators: false }),
    "main.ts": `import { count } from "./marked";\nconsole.log(count);\n`,
    "marked.ts": `export let count = 0;\nfunction mark(value: Function, context: ClassDecoratorContext) { count = arguments.length; }\n@mark\nclass Marked {}\nexport const name = Marked.name;\n`,
    "wrong.ts": `function mark(value: Function, context: ClassDecoratorContext) {}\n@mark\nclass Marked {}\nexport const wrong: string = Marked.length;\n`,
  });
  const outfile = join(String(dir), "out");
  for (const aot of [[], ["--aot"]]) {
    const built = await run(String(dir), "build", "--compile", ...aot, "./main.ts", "--outfile", outfile);
    expect({ codes: codes(built.said), exitCode: built.exitCode }).toEqual({ codes: [], exitCode: 0 });
    if (aot.length)
      expect(built.said).toMatch(
        /^[\d.]+% of property accesses are one load: \d+ free, \d+ tested, \d+ by name \(\d+\)$/m,
      );
    await using ran = Bun.spawn({ cmd: [outfile], cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
    expect(await ran.stdout.text()).toBe("2\n");
  }
  const checked = await run(String(dir), "check", "--aot", "main.ts");
  expect(checked.said).toContain("No type errors");
  expect(checked.said).not.toContain("does not support");
  expect(checked.said).not.toContain("compiled untyped");
  expect(checked.exitCode).toBe(0);
  const refused = await run(String(dir), "build", "--compile", "--aot", "./wrong.ts", "--outfile", outfile);
  expect(codes(refused.said)).toContain("TS2322");
  expect(refused.exitCode).not.toBe(0);
  expect(errors((await run(String(dir), "check", "--aot", "wrong.ts")).said)).toEqual(["wrong.ts TS2322"]);
}, 120_000);

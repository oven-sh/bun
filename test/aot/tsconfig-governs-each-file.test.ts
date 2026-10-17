import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

const shared = { target: "ESNext", module: "Preserve", moduleResolution: "bundler", noEmit: true, types: [] as string[], strict: true };
const config = (more: object = {}, rest: object = {}) => JSON.stringify({ compilerOptions: { ...shared, ...more }, ...rest });

async function run(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { said: stdout + stderr, exitCode };
}

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
const errors = (said: string) => [...said.matchAll(/^(\S+)\(\d+,\d+\): error (TS\d+)/gm)].map(match => `${match[1]} ${match[2]}`).sort();
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
const expected = (outer: string, inner: string, ending: string) => [`${outer}/${inner}/deep${ending} TS7006`, `${outer}/middle${ending} TS6133`, `top${ending} TS7030`].sort();

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
  const { said, exitCode } = await run(String(dir), "build", "--compile", "--aot", "pkg/test/main.ts", "--outfile", "program");
  expect(codes(said)).toEqual(["TS6133", "TS7006", "TS7030"]);
  expect(said.split("TS7006").length - 1).toBe(1);
  expect(said.split("TS6133").length - 1).toBe(1);
  expect(said.split("TS7030").length - 1).toBe(1);
  expect(exitCode).toBe(1);
}, 120_000);

test("bun test --aot agrees, whatever the folders are called", async () => {
  for (const [outer, inner] of [["pkg", "test"], ["aaa", "aaa"], ["zzz", "zzz"], ["aaa", "zzz"]]) {
    using dir = tempDir("tsconfig-governs-each-file", threeProjects(outer, inner, ".test.ts", tested));
    const { said, exitCode } = await run(String(dir), "test", "--aot");
    expect(errors(said)).toEqual(expected(outer, inner, ".test.ts"));
    expect(passed(said)).toEqual([]);
    expect(exitCode).toBe(1);
  }
});

test("a source file that tests under two tsconfig.json files import is checked under its own", async () => {
  const box = `export class Box {\n  value: number;\n  set(value: number) { this.value = value; return this; }\n}\n`;
  const uses = (name: string, from: string) => `import { Box } from ${JSON.stringify(from)};\ntest(${JSON.stringify(name)}, () => { expect(new Box().set(1).value).toBe(1); });\n`;
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
    "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.test.json" }] }),
    "tsconfig.app.json": config({ ...lenient, composite: true, noEmit: false, outDir: "out/app" }, { include: ["src"] }),
    "tsconfig.test.json": config({ ...lenient, composite: true, noEmit: false, outDir: "out/test", noUnusedLocals: true }, { include: ["test"] }),
    "src/app.ts": smells,
    "test/fine.test.ts": `import { smells } from "../src/app";\ntest("the application's options", () => { expect(smells(true, 1)).toBe(1); });\n`,
    "test/unused.test.ts": smells + tested("never run"),
  });
  const { said } = await run(String(dir), "test", "--aot");
  expect(errors(said)).toEqual(["test/unused.test.ts TS6133"]);
  expect(passed(said)).toEqual(["the application's options"]);
});

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

test("rootDir has no say about the test files of other tsconfig.json files", async () => {
  using dir = tempDir("tsconfig-governs-each-file", {
    "tsconfig.json": config({ rootDir: "./src", outDir: "./dist", noEmit: false }, { include: ["./src/**/*.ts"] }),
    "src/one.ts": `export const one = 1;\n`,
    "test/tsconfig.json": JSON.stringify({ extends: "../tsconfig.json", compilerOptions: { rootDir: "." }, include: ["."] }),
    "test/one.test.ts": `// declare global\nimport { one } from "../src/one";\ntest("one", () => { expect(one).toBe(1); });\n`,
    "fixtures/a/tsconfig.json": config(),
    "fixtures/a/a.test.ts": `test("a fixture", () => { expect(1).toBe(1); });\n`,
  });
  const { said, exitCode } = await run(String(dir), "test", "--aot");
  expect(codes(said)).toEqual([]);
  expect(passed(said)).toEqual(["a fixture", "one"]);
  expect(exitCode).toBe(0);
});

test("beside a project with strictNullChecks, a file of a project without it that needs the leniency runs untyped", async () => {
  const files = {
    "strict/tsconfig.json": config(),
    "strict/strict.test.ts": `test("strict", () => { expect(1).toBe(1); });\n`,
    "lax/tsconfig.json": config({ strict: false }),
    "lax/lax.test.ts": `const nothing: number = null;\ntest("lax", () => { expect(nothing).toBeNull(); });\n`,
  };
  using dir = tempDir("tsconfig-governs-each-file", files);
  const together = await run(String(dir), "test", "--aot");
  expect(errors(together.said)).toEqual([]);
  expect(together.said).toContain("TS100010");
  expect(passed(together.said)).toEqual(["lax", "strict"]);
  const alone = await run(String(dir), "test", "--aot", "./lax/lax.test.ts");
  expect(errors(alone.said)).toEqual([]);
  expect(alone.said).not.toContain("TS100010");
  expect(passed(alone.said)).toEqual(["lax"]);
});

test("the sources of a referenced workspace package stand in for its build output", async () => {
  const built = { composite: true, noEmit: false, outDir: "lib", rootDir: "src" };
  using dir = tempDir("tsconfig-governs-each-file", {
    "package.json": JSON.stringify({ name: "workspace", workspaces: ["packages/*"] }),
    "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "packages/types" }, { path: "packages/app" }] }),
    "packages/types/package.json": JSON.stringify({ name: "@workspace/types", version: "1.0.0", main: "lib/index.js", types: "lib/index.d.ts" }),
    "packages/types/tsconfig.json": config(built, { include: ["src"] }),
    "packages/types/src/index.ts": `export interface Rule {\n  level: number;\n}\n`,
    "packages/app/package.json": JSON.stringify({ name: "@workspace/app", version: "1.0.0", dependencies: { "@workspace/types": "workspace:*" } }),
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

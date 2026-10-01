import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";

// `lib.*.d.ts` come from the `typescript` package a project has installed.
const typescript = dirname(require.resolve("typescript/package.json"));

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    noEmit: true,
    target: "esnext",
    module: "esnext",
    moduleResolution: "bundler",
    lib: ["esnext"],
    types: [],
    skipLibCheck: true,
  },
});

function project(files: Record<string, string>, { withTypeScript = true } = {}) {
  const dir = tempDir("bun-check", {
    "tsconfig.json": tsconfig,
    // Neither the DOM's types nor Node's are loaded, which keeps the tests fast.
    "console.d.ts": `declare var console: { log(...args: unknown[]): void };\n`,
    ...files,
  });
  if (withTypeScript) {
    mkdirSync(join(String(dir), "node_modules"), { recursive: true });
    symlinkSync(typescript, join(String(dir), "node_modules", "typescript"), "junction");
  }
  return dir;
}

// Neither an agent nor continuous integration, whatever runs the tests.
const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  NO_COLOR: "1",
  // Nothing installed globally stands in for what a project lacks.
  BUN_INSTALL_GLOBAL_DIR: "/nowhere",
};

async function run(cwd: string, cmd: string[], extra: Record<string, string | undefined> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    cwd,
    env: { ...env, ...extra },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const clean = (text: string) =>
    text
      .replaceAll(cwd, "<dir>")
      .replaceAll("\\", "/")
      .replace(/\[\d+(\.\d+)?m?s\]/g, "[time]")
      .trim();
  return { stdout: clean(stdout), stderr: clean(stderr), exitCode };
}

const check = (dir: { toString(): string }, args: string[] = [], extra = {}) =>
  run(String(dir), ["check", ...args], extra);

describe.concurrent("bun check", () => {
  test("a project without errors", async () => {
    using dir = project({
      "index.ts": `import { double } from "./math";\nconsole.log(double(2).toFixed(1));\n`,
      "math.ts": `export const double = (n: number) => n * 2;\n`,
    });
    const { stdout, stderr, exitCode } = await check(dir);
    expect(stdout).toBe("");
    expect(stderr).toMatchInlineSnapshot(`"✓ No type errors in 2 files [time]"`);
    expect(exitCode).toBe(0);
  });

  test("one line an error where nobody is looking", async () => {
    using dir = project({
      "index.ts": `const n: number = "one";\nconst s: string = n;\nexport {};\n`,
    });
    const { stdout, stderr, exitCode } = await check(dir);
    expect(stdout).toMatchInlineSnapshot(`
      "index.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.
      index.ts(2,7): error TS2322: Type 'number' is not assignable to type 'string'."
    `);
    expect(stderr).toMatchInlineSnapshot(`"Found 2 errors in 1 file, checked 1 file [time]"`);
    expect(exitCode).toBe(1);
  });

  test("--pretty shows the source around each error", async () => {
    using dir = project({
      "index.ts": `interface User {\n  id: number;\n  name: string;\n}\n\nconst ada: User = {\n  id: "1",\n  name: "Ada",\n};\n\nconsole.log(ada.nmae);\n`,
    });
    const { stdout, exitCode } = await check(dir, ["--pretty"]);
    expect(stdout).toMatchInlineSnapshot(`
      "6 | const ada: User = {
      7 |   id: "1",
            ^^
      error TS2322: Type 'string' is not assignable to type 'number'.
            at index.ts:7:3
            note: The expected type comes from property 'id' which is declared here on type 'User'
              at index.ts:2:3
              2 |   id: number;
                    ^^

       9 | };
      10 | 
      11 | console.log(ada.nmae);
                           ^^^^
      error TS2339: Property 'nmae' does not exist on type 'User'.
            at index.ts:11:17"
    `);
    expect(exitCode).toBe(1);
  });

  test("an agent gets tags, the source, and no colors", async () => {
    using dir = project({
      "index.ts": `export function f(a: number) {\n  return a.lenght;\n}\n`,
    });
    const { stdout, exitCode } = await check(dir, [], { AGENT: "1", NO_COLOR: undefined, FORCE_COLOR: "1" });
    expect(stdout).toMatchInlineSnapshot(`
      "<error file="index.ts" line="2" column="12" code="TS2339">
      Property 'lenght' does not exist on type 'number'.
      <source>
      1 | export function f(a: number) {
      2 |   return a.lenght;
                     ^^^^^^
      3 | }
      </source>
      </error>"
    `);
    expect(exitCode).toBe(1);
  });

  test("GitHub Actions gets annotations", async () => {
    using dir = project({ "src/a.ts": `export const a: string = 1;\n` });
    const { stdout, exitCode } = await check(dir, [], { GITHUB_ACTIONS: "true" });
    expect(stdout).toMatchInlineSnapshot(`
      "src/a.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.
      ::error file=src/a.ts,line=1,col=14,endLine=1,endColumn=15,title=TS2322::Type 'number' is not assignable to type 'string'."
    `);
    expect(exitCode).toBe(1);
  });

  test("the reasons under an error", async () => {
    using dir = project({
      "index.ts": `interface A { a: { b: { c: number } } }\nconst x = { a: { b: { c: "no" } } };\nconst y: A = x;\nexport { y };\n`,
    });
    const { stdout } = await check(dir);
    expect(stdout).toMatchInlineSnapshot(`
      "index.ts(3,7): error TS2322: Type '{ a: { b: { c: string; }; }; }' is not assignable to type 'A'.
        The types of 'a.b.c' are incompatible between these types.
          Type 'string' is not assignable to type 'number'."
    `);
  });

  test("errors come file by file, in order, whatever thread finds them", async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 60; i++) {
      files[`src/m${String(i).padStart(2, "0")}.ts`] =
        `export const v${i}: string = ${i};\nexport const w${i}: number = "${i}";\n`;
    }
    using dir = project(files);
    const { stdout, exitCode } = await check(dir);
    const lines = stdout.split("\n");
    expect(lines).toHaveLength(120);
    expect(lines).toEqual(lines.toSorted());
    expect(lines[0]).toBe(`src/m00.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.`);
    expect(lines[119]).toBe(`src/m59.ts(2,14): error TS2322: Type 'string' is not assignable to type 'number'.`);
    expect(exitCode).toBe(1);
  });

  test("--threads 1 says the same", async () => {
    using dir = project({
      "a.ts": `import { b } from "./b";\nexport const a: number = b;\n`,
      "b.ts": `export const b = "b";\nexport const c: boolean = b;\n`,
    });
    const [one, many] = await Promise.all([check(dir, ["--threads", "1"]), check(dir)]);
    expect(one.stdout).toBe(many.stdout);
    expect(one.stdout).toMatchInlineSnapshot(`
      "a.ts(2,14): error TS2322: Type 'string' is not assignable to type 'number'.
      b.ts(2,14): error TS2322: Type 'string' is not assignable to type 'boolean'."
    `);
  });

  test("what else an error has to do with is shown under it", async () => {
    using dir = project({
      "types.ts": `export interface User {\n  id: number;\n  email: string;\n}\n`,
      "index.ts": `import type { User } from "./types";\nconst ada: User = { id: 1 };\nconst o = { colour: "red" };\no.color;\nexport {};\n`,
    });
    const [pretty, agent, plain] = await Promise.all([
      check(dir, ["--pretty"]),
      check(dir, [], { AGENT: "1" }),
      check(dir),
    ]);
    expect(pretty.stdout).toMatchInlineSnapshot(`
      "1 | import type { User } from "./types";
      2 | const ada: User = { id: 1 };
                ^^^
      error TS2741: Property 'email' is missing in type '{ id: number; }' but required in type 'User'.
            at index.ts:2:7
            note: 'email' is declared here.
              at types.ts:3:3
              3 |   email: string;
                    ^^^^^

      2 | const ada: User = { id: 1 };
      3 | const o = { colour: "red" };
      4 | o.color;
            ^^^^^
      error TS2551: Property 'color' does not exist on type '{ colour: string; }'. Did you mean 'colour'?
            at index.ts:4:3
            note: 'colour' is declared here.
              at index.ts:3:13"
    `);
    expect(agent.stdout).toMatchInlineSnapshot(`
      "<error file="index.ts" line="2" column="7" code="TS2741">
      Property 'email' is missing in type '{ id: number; }' but required in type 'User'.
      <source>
      1 | import type { User } from "./types";
      2 | const ada: User = { id: 1 };
                ^^^
      3 | const o = { colour: "red" };
      4 | o.color;
      </source>
      <related file="types.ts" line="3" column="3">'email' is declared here.</related>
      </error>
      <error file="index.ts" line="4" column="3" code="TS2551">
      Property 'color' does not exist on type '{ colour: string; }'. Did you mean 'colour'?
      <source>
      1 | import type { User } from "./types";
      2 | const ada: User = { id: 1 };
      3 | const o = { colour: "red" };
      4 | o.color;
            ^^^^^
      5 | export {};
      </source>
      <related file="index.ts" line="3" column="13">'colour' is declared here.</related>
      </error>"
    `);
    // As `tsc --pretty false` has it.
    expect(plain.stdout).toMatchInlineSnapshot(`
      "index.ts(2,7): error TS2741: Property 'email' is missing in type '{ id: number; }' but required in type 'User'.
      index.ts(4,3): error TS2551: Property 'color' does not exist on type '{ colour: string; }'. Did you mean 'colour'?"
    `);
  });

  describe("a project in a bad way", () => {
    const files = {
      // The same mistake sixty times in two files, another three times, and one that is by itself.
      "a.ts": Array.from({ length: 40 }, (_, i) => `console.lgo(${i});`).join("\n") + `\nexport {};\n`,
      "b.ts":
        Array.from({ length: 20 }, (_, i) => `console.lgo(${i});`).join("\n") +
        `\nconst a: string = 1, b: string = 2, c: string = 3;\nmissing;\nexport {};\n`,
    };

    test("each kind of error once, what there is most of first", async () => {
      using dir = project(files);
      const { stdout, stderr, exitCode } = await check(dir, ["--pretty"]);
      expect(stdout).toMatchInlineSnapshot(`
        "1 | console.lgo(0);
                    ^^^
        error TS2339: Property 'lgo' does not exist on type '{ log(...args: unknown[]): void; }'.
              at a.ts:1:9
              60 times in 2 files
                40  a.ts:1
                20  b.ts:1

        19 | console.lgo(18);
        20 | console.lgo(19);
        21 | const a: string = 1, b: string = 2, c: string = 3;
                   ^
        error TS2322: Type 'number' is not assignable to type 'string'.
              at b.ts:21:7
              3 times on this line

        20 | console.lgo(19);
        21 | const a: string = 1, b: string = 2, c: string = 3;
        22 | missing;
             ^^^^^^^
        error TS2304: Cannot find name 'missing'.
              at b.ts:22:1"
      `);
      expect(stderr).toMatchInlineSnapshot(`
        "Found 64 errors in 2 files, checked 2 files [time]

          24  b.ts:1
          40  a.ts:1"
      `);
      expect(exitCode).toBe(1);
    });

    test("for an agent too", async () => {
      using dir = project(files);
      const { stdout } = await check(dir, [], { AGENT: "1" });
      expect(stdout).toMatchInlineSnapshot(`
        "<error file="a.ts" line="1" column="9" code="TS2339" times="60">
        Property 'lgo' does not exist on type '{ log(...args: unknown[]): void; }'.
        <source>
        1 | console.lgo(0);
                    ^^^
        2 | console.lgo(1);
        3 | console.lgo(2);
        </source>
        <also>a.ts:2:9 a.ts:3:9 a.ts:4:9 a.ts:5:9 a.ts:6:9 a.ts:7:9 a.ts:8:9 a.ts:9:9 a.ts:10:9 a.ts:11:9 and 49 more</also>
        </error>
        <error file="b.ts" line="21" column="7" code="TS2322" times="3">
        Type 'number' is not assignable to type 'string'.
        <source>
        18 | console.lgo(17);
        19 | console.lgo(18);
        20 | console.lgo(19);
        21 | const a: string = 1, b: string = 2, c: string = 3;
                   ^
        22 | missing;
        23 | export {};
        </source>
        <also>b.ts:21:22 b.ts:21:37</also>
        </error>
        <error file="b.ts" line="22" column="1" code="TS2304">
        Cannot find name 'missing'.
        <source>
        19 | console.lgo(18);
        20 | console.lgo(19);
        21 | const a: string = 1, b: string = 2, c: string = 3;
        22 | missing;
             ^^^^^^^
        23 | export {};
        </source>
        </error>"
      `);
    });

    test("--all shows every one, and so does what is not for reading", async () => {
      using dir = project(files);
      const [all, plain] = await Promise.all([check(dir, ["--pretty", "--all"]), check(dir)]);
      expect(all.stdout.match(/error TS/g)).toHaveLength(64);
      expect(plain.stdout.split("\n")).toHaveLength(64);
    });

    test("file lists are never truncated", async () => {
      // The same error in 60 files, so it is grouped.
      using dir = project(
        Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`f${i}.ts`, `console.lgo(${i});\nexport {};\n`])),
      );
      const { stdout, stderr } = await check(dir, ["--pretty"]);
      expect(stdout).toContain("60 times in 60 files");
      expect(stdout.match(/^ +1 {2}f\d+\.ts:1$/gm)).toHaveLength(60);
      expect(stderr.match(/^ +1 {2}f\d+\.ts:1$/gm)).toHaveLength(60);
      expect(stdout + stderr).not.toContain("more files");
    });

    test("fifty errors are each shown", async () => {
      using dir = project({
        "a.ts": Array.from({ length: 50 }, (_, i) => `console.lgo(${i});`).join("\n") + `\nexport {};\n`,
      });
      const { stdout } = await check(dir, ["--pretty"]);
      expect(stdout.match(/error TS/g)).toHaveLength(50);
    });
  });

  describe("one kind of error at a time, as tsc has it", () => {
    test("what does not parse is all that is said", async () => {
      using dir = project({
        "a.ts": `const a = ;\nexport {};\n`,
        "b.ts": `export const b: string = 1;\n`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`"a.ts(1,11): error TS1109: Expression expected."`);
      expect(exitCode).toBe(1);
    });

    test("so are options that do not go together", async () => {
      using dir = project({
        "tsconfig.json": `{ "compilerOptions": { "noEmit": true, "checkJs": true, "allowJs": false, "lib": ["esnext"], "types": [] } }`,
        "b.ts": `export const b: string = 1;\n`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"tsconfig.json(1,40): error TS5052: Option 'checkJs' cannot be specified without specifying option 'allowJs'."`,
      );
      expect(exitCode).toBe(1);
    });
  });

  test("says how to get the types of what Bun provides", async () => {
    using dir = project({
      "console.d.ts": ``,
      "index.ts": `import { test } from "bun:test";\nconsole.log(test);\n`,
    });
    const [pretty, plain] = await Promise.all([check(dir, ["--pretty"]), check(dir)]);
    expect(pretty.stderr).toMatchInlineSnapshot(`
      "hint: Bun's type definitions (console, fetch, Bun, bun:test) are not installed. Run: bun add -d @types/bun
      Found 2 errors in 1 file, checked 1 file [time]"
    `);
    expect(plain.stderr).not.toContain("hint");
  });

  describe("what is checked", () => {
    test("the project of the nearest tsconfig.json, from a directory below it", async () => {
      using dir = project({
        "src/deep/a.ts": `export const a: string = 1;\n`,
        "other.ts": `export const o: string = 2;\n`,
      });
      const { stdout } = await run(join(String(dir), "src", "deep"), ["check"]);
      expect(stdout).toMatchInlineSnapshot(`
        "../../other.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'."
      `);
    });

    test("-p takes a file or a directory", async () => {
      using dir = project({
        "packages/a/tsconfig.json": tsconfig,
        "packages/a/index.ts": `export const a: string = 1;\n`,
        "index.ts": `export const root: string = 2;\n`,
      });
      const [byDirectory, byFile] = await Promise.all([
        check(dir, ["-p", "packages/a"]),
        check(dir, ["--project=packages/a/tsconfig.json"]),
      ]);
      expect(byDirectory.stdout).toMatchInlineSnapshot(
        `"packages/a/index.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'."`,
      );
      expect(byFile.stdout).toBe(byDirectory.stdout);
    });

    test("files that are named, and what they import, with the options of the project", async () => {
      using dir = project({
        "a.ts": `import "./b";\nlet a;\nexport const x: string = a;\n`,
        "b.ts": `export const b: string = 1;\n`,
        "unrelated.ts": `export const u: string = 1;\n`,
      });
      const { stdout } = await check(dir, ["a.ts"]);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,14): error TS2322: Type 'undefined' is not assignable to type 'string'.
        b.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'."
      `);
    });

    test("a file that is named means what it means in the project", async () => {
      using dir = project({
        // Nothing imports these two. What they declare is there for every file all the same.
        "globals.ts": `declare global {\n  var answer: number;\n}\nexport {};\n`,
        "more.ts": `declare module "./lib" {\n  interface Options {\n    extra: boolean;\n  }\n}\nexport {};\n`,
        "lib.ts": `export interface Options {\n  name: string;\n}\n`,
        "index.ts": `import type { Options } from "./lib";\nconst o: Options = { name: "a", extra: true };\nconsole.log(o, answer.toFixed());\n`,
        // Neither is this, and it is not checked.
        "other.ts": `export const wrong: string = 1;\n`,
        "broken.ts": `const = ;\n`,
      });
      const { stdout, stderr, exitCode } = await check(dir, ["index.ts"]);
      expect(stdout).toBe("");
      expect(stderr).toMatchInlineSnapshot(`"✓ No type errors in 2 files [time]"`);
      expect(exitCode).toBe(0);
    });

    test("include and exclude", async () => {
      using dir = project({
        "tsconfig.json": JSON.stringify({
          ...JSON.parse(tsconfig),
          include: ["src/**/*"],
          exclude: ["src/generated"],
        }),
        "src/a.ts": `export const a: string = 1;\n`,
        "src/generated/g.ts": `export const g: string = 1;\n`,
        "scripts/s.ts": `export const s: string = 1;\n`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"src/a.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'."`,
      );
    });

    test("extends, with comments and trailing commas", async () => {
      using dir = project({
        "base.json": `{\n  // the options everybody has\n  "compilerOptions": ${JSON.stringify(JSON.parse(tsconfig).compilerOptions)},\n}`,
        "tsconfig.json": `{ "extends": "./base.json", "compilerOptions": { "noImplicitAny": false, }, }`,
        "a.ts": `export function f(x) {\n  return x;\n}\nexport const n: null = undefined;\n`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(4,14): error TS2322: Type 'undefined' is not assignable to type 'null'."`,
      );
    });

    test("without a tsconfig.json", async () => {
      using dir = tempDir("bun-check", { "a.ts": `export const a: string = 1;\n` });
      mkdirSync(join(String(dir), "node_modules"));
      symlinkSync(typescript, join(String(dir), "node_modules", "typescript"), "junction");
      const { stdout, exitCode } = await check(dir, ["a.ts"]);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'."`,
      );
      expect(exitCode).toBe(1);
    });

    test("declaration files are checked unless skipLibCheck says not to", async () => {
      const files = { "types.d.ts": `declare const a: Missing;\n`, "a.ts": `export const b = a;\n` };
      using skipping = project(files);
      using looking = project({
        ...files,
        "tsconfig.json": JSON.stringify({
          compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, skipLibCheck: false },
        }),
      });
      const [skipped, looked] = await Promise.all([check(skipping), check(looking)]);
      expect(skipped.stdout).toBe("");
      expect(looked.stdout).toMatchInlineSnapshot(`"types.d.ts(1,18): error TS2304: Cannot find name 'Missing'."`);
    });
  });

  describe("files nothing imports", () => {
    test("a test, and the helper next to it that it imports", async () => {
      using dir = project({
        "src/add.ts": `export const add = (a: number, b: number) => a + b;\n`,
        "test/helper.ts": `import { add } from "../src/add";\nexport const three = add(1, 2);\nexport const wrong: string = three;\n`,
        "test/add.test.ts": `import { three } from "./helper";\nimport { add } from "../src/add";\nconst s: string = add(three, "1");\nexport {};\n`,
        "test/other.test.ts": `import { three } from "./helper";\nthree.toFixed().nope;\n`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "test/add.test.ts(3,7): error TS2322: Type 'number' is not assignable to type 'string'.
        test/add.test.ts(3,30): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
        test/helper.ts(3,14): error TS2322: Type 'number' is not assignable to type 'string'.
        test/other.test.ts(2,17): error TS2339: Property 'nope' does not exist on type 'string'."
      `);
    });

    test("what a file nothing imports adds to the global scope is seen everywhere", async () => {
      using dir = project({
        "test/setup.ts": `declare global {\n  var answer: number;\n}\nexport {};\n`,
        "test/script.ts": `declare const fromScript: string;\n`,
        "src/a.ts": `export const a: string = answer;\nexport const b: number = fromScript;\n`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "src/a.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.
        src/a.ts(2,14): error TS2322: Type 'string' is not assignable to type 'number'."
      `);
    });

    test("types made in one file do not leak into the next", async () => {
      const files: Record<string, string> = {};
      for (let i = 0; i < 40; i++) {
        files[`test/t${i}.test.ts`] =
          `const o = { k${i}: ${i}, same: "s" };\ntype T = typeof o;\nconst p: T = { k${i}: "x", same: "s" };\nexport {};\n`;
      }
      using dir = project(files);
      const { stdout } = await check(dir, ["--threads", "2"]);
      const lines = stdout.split("\n");
      expect(lines).toHaveLength(40);
      for (const line of lines) {
        expect(line).toMatch(
          /^test\/t\d+\.test\.ts\(3,16\): error TS2322: Type 'string' is not assignable to type 'number'\.$/,
        );
      }
    });
  });

  describe("modules", () => {
    test("a package with types, a package without, and one that is not there", async () => {
      using dir = project({
        "node_modules/typed/package.json": `{ "name": "typed", "types": "./types.d.ts", "main": "./index.js" }`,
        "node_modules/typed/types.d.ts": `export declare function typed(): number;\n`,
        "node_modules/typed/index.js": `exports.typed = () => 1;\n`,
        "node_modules/untyped/package.json": `{ "name": "untyped", "main": "./index.js" }`,
        "node_modules/untyped/index.js": `exports.untyped = () => 1;\n`,
        "a.ts": `import { typed } from "typed";\nimport { untyped } from "untyped";\nimport { missing } from "missing";\nexport const s: string = typed();\nexport { untyped, missing };\n`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,25): error TS7016: Could not find a declaration file for module 'untyped'. '<dir>/node_modules/untyped/index.js' implicitly has an 'any' type.
        a.ts(3,25): error TS2307: Cannot find module 'missing' or its corresponding type declarations.
        a.ts(4,14): error TS2322: Type 'number' is not assignable to type 'string'."
      `);
    });

    test("paths, exports conditions and JSON", async () => {
      using dir = project({
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            ...JSON.parse(tsconfig).compilerOptions,
            resolveJsonModule: true,
            paths: { "@/*": ["./src/*"] },
          },
        }),
        "node_modules/cond/package.json": `{ "name": "cond", "exports": { ".": { "types": "./t.d.ts", "default": "./i.js" }, "./sub": { "types": "./sub.d.ts" } } }`,
        "node_modules/cond/t.d.ts": `export declare const main: 1;\n`,
        "node_modules/cond/sub.d.ts": `export declare const sub: 2;\n`,
        "src/util.ts": `export const util = true;\n`,
        "src/data.json": `{ "count": 3 }`,
        "src/a.ts": `import { util } from "@/util";\nimport { main } from "cond";\nimport { sub } from "cond/sub";\nimport hidden from "cond/hidden";\nimport data from "./data.json";\nexport const all: [false, 2, 1, string] = [util, main, sub, data.count];\nexport { hidden };\n`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "src/a.ts(4,20): error TS2307: Cannot find module 'cond/hidden' or its corresponding type declarations.
        src/a.ts(6,44): error TS2322: Type 'true' is not assignable to type 'false'.
        src/a.ts(6,50): error TS2322: Type '1' is not assignable to type '2'.
        src/a.ts(6,56): error TS2322: Type '2' is not assignable to type '1'.
        src/a.ts(6,61): error TS2322: Type 'number' is not assignable to type 'string'."
      `);
    });

    test("types from @types, and only those that are asked for", async () => {
      using dir = project({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, types: ["wanted"] },
        }),
        "node_modules/@types/wanted/index.d.ts": `declare const wanted: number;\n`,
        "node_modules/@types/unwanted/index.d.ts": `declare const unwanted: number;\n`,
        "a.ts": `export const a = [wanted, unwanted];\n`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(1,27): error TS2552: Cannot find name 'unwanted'. Did you mean 'wanted'?"`,
      );
    });
  });

  describe("what is in a file", () => {
    test("@ts-expect-error, @ts-ignore and @ts-nocheck", async () => {
      using dir = project({
        "a.ts": `// @ts-expect-error\nexport const a: string = 1;\n// @ts-ignore\nexport const b: string = 2;\n// @ts-expect-error\nexport const c: string = "fine";\n`,
        "b.ts": `// @ts-nocheck\nexport const d: string = 3;\n`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`"a.ts(5,1): error TS2578: Unused '@ts-expect-error' directive."`);
    });

    test("syntax errors", async () => {
      using dir = project({ "a.ts": `export const a = (;\nexport const b: string = 1;\n` });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`"a.ts(1,19): error TS1109: Expression expected."`);
      expect(exitCode).toBe(1);
    });

    test("JavaScript with checkJs goes by its JSDoc", async () => {
      using dir = project({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, allowJs: true, checkJs: true },
        }),
        "a.js": `/**\n * @param {number} n\n * @returns {string}\n */\nexport function f(n) {\n  return n;\n}\nf("1");\n/** @type {{ a: number }} */\nexport const o = { a: "x" };\n`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.js(6,3): error TS2322: Type 'number' is not assignable to type 'string'.
        a.js(8,3): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
        a.js(10,20): error TS2322: Type 'string' is not assignable to type 'number'."
      `);
    });

    test("JSX", async () => {
      using dir = project({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, jsx: "preserve" },
        }),
        "jsx.d.ts": `declare namespace JSX {\n  interface Element {}\n  interface IntrinsicElements {\n    div: { id?: string };\n  }\n}\n`,
        "a.tsx": `function Card(props: { title: string }) {\n  return <div id={props.title} />;\n}\nexport const a = <Card title={1} />;\nexport const b = <div id="x" nope />;\nexport const c = <span />;\n`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.tsx(4,24): error TS2322: Type 'number' is not assignable to type 'string'.
        a.tsx(5,30): error TS2322: Type '{ id: string; nope: true; }' is not assignable to type '{ id?: string | undefined; }'.
          Property 'nope' does not exist on type '{ id?: string | undefined; }'.
        a.tsx(6,18): error TS2339: Property 'span' does not exist on type 'JSX.IntrinsicElements'."
      `);
    });

    test("lines that end in CRLF, tabs, and characters wider than a byte", async () => {
      using dir = project({
        "a.ts": `const é = "é";\r\n\tconst 名前: number = é;\r\nconst s = "😀😀"; const n: number = s;\r\nexport { 名前, n };\r\n`,
      });
      const [plain, pretty] = await Promise.all([check(dir), check(dir, ["--pretty"])]);
      expect(plain.stdout).toMatchInlineSnapshot(`
        "a.ts(2,8): error TS2322: Type 'string' is not assignable to type 'number'.
        a.ts(3,25): error TS2322: Type 'string' is not assignable to type 'number'."
      `);
      expect(pretty.stdout).toMatchInlineSnapshot(`
        "1 | const é = "é";
        2 |  const 名前: number = é;
                   ^^^^
        error TS2322: Type 'string' is not assignable to type 'number'.
              at a.ts:2:8

        1 | const é = "é";
        2 |  const 名前: number = é;
        3 | const s = "😀😀"; const n: number = s;
                                    ^
        error TS2322: Type 'string' is not assignable to type 'number'.
              at a.ts:3:25"
      `);
    });

    test("generics, overloads, narrowing and conditional types", async () => {
      using dir = project({
        "a.ts": `
function pick<T, K extends keyof T>(o: T, k: K): T[K] { return o[k]; }
const n: string = pick({ a: 1, b: "x" }, "a");
pick({ a: 1 }, "c");

function over(a: string): string;
function over(a: number): number;
function over(a: any) { return a; }
over(true);

type Shape = { kind: "circle"; r: number } | { kind: "square"; s: number };
function area(shape: Shape) {
  switch (shape.kind) {
    case "circle": return shape.r ** 2;
    case "square": return shape.r;
  }
}

type Unwrap<T> = T extends Promise<infer U> ? Unwrap<U> : T;
const u: Unwrap<Promise<Promise<number>>> = "no";
export { n, area, u };
`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,7): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(4,16): error TS2345: Argument of type '"c"' is not assignable to parameter of type '"a"'.
        a.ts(9,6): error TS2769: No overload matches this call.
          The last overload gave the following error.
            Argument of type 'boolean' is not assignable to parameter of type 'number'.
        a.ts(15,33): error TS2339: Property 'r' does not exist on type '{ kind: "square"; s: number; }'.
        a.ts(20,7): error TS2322: Type 'string' is not assignable to type 'number'."
      `);
    });
  });

  describe("what TypeScript's own tests do not cover", () => {
    test("a variable its own initializer refers to through a callback", async () => {
      using dir = project({
        "a.ts": `
interface Server<W> { port: number | undefined; data: W }
declare function serve<W = undefined>(options: { fetch(request: string): string }): Server<W>;
declare function plain(options: { fetch(request: string): string }): Server<string>;
declare const untyped: any;
const server = serve({ fetch() { return \`\${server.port}\`; } });
// The arguments of the only signature there is, if it is not generic, are not looked at for the type of the variable.
const fine = plain({ fetch() { return \`\${fine.port}\`; } });
const a = untyped(a);
const later = untyped(() => later);
export {};
`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(6,7): error TS7022: 'server' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,24): error TS7023: 'fetch' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(9,7): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(9,19): error TS2448: Block-scoped variable 'a' used before its declaration."
      `);
    });

    test("two versions of a package that declare the same module", async () => {
      using dir = project({
        "one.d.ts": `declare module "thing" {\n  class Thing {\n    constructor(size: number);\n    one: string;\n  }\n}\n`,
        "two.d.ts": `declare module "thing" {\n  class Thing {\n    constructor(size: number);\n    two: string;\n  }\n}\n`,
        // One constructor, not two overloads, and what only the second has is not there.
        "a.ts": `import { Thing } from "thing";\nnew Thing("big").two;\n`,
      });
      const { stdout } = await check(dir, ["a.ts"]);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,11): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
        a.ts(2,18): error TS2339: Property 'two' does not exist on type 'Thing'."
      `);
    });
  });

  describe("when it cannot start", () => {
    test("TypeScript's lib files are nowhere to be found", async () => {
      using dir = project({ "a.ts": `export const a = 1;\n` }, { withTypeScript: false });
      const { stdout, stderr, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"error: Cannot find TypeScript's standard library (lib.es5.d.ts and the rest), which declares Array, Promise and everything else that is built in. It comes with the typescript package: bun add -d typescript"`,
      );
      expect(stderr).toMatchInlineSnapshot(`"Found 1 error, checked 0 files [time]"`);
      expect(exitCode).toBe(1);
    });

    test("a tsconfig.json that is wrong", async () => {
      using dir = project({
        "tsconfig.json": `{ "compilerOptions": { "strict": "yes", "target": "es1", "nonsense": true } }`,
        "a.ts": `export const a = 1;\n`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "console.d.ts(1,13): error TS2403: Subsequent variable declarations must have the same type.  Variable 'console' must be of type 'Console', but here has type '{ log(...args: unknown[]): void; }'.
        tsconfig.json(1,34): error TS5024: Compiler option 'strict' requires a value of type boolean.
        tsconfig.json(1,51): error TS6046: Argument for '--target' option must be: 'es6', 'es2015', 'es2016', 'es2017', 'es2018', 'es2019', 'es2020', 'es2021', 'es2022', 'es2023', 'es2024', 'es2025', 'esnext'.
        tsconfig.json(1,58): error TS5023: Unknown compiler option 'nonsense'."
      `);
      expect(exitCode).toBe(1);
    });

    test("-p names nothing", async () => {
      using dir = project({});
      const { stdout, stderr, exitCode } = await check(dir, ["-p", "nowhere"]);
      expect(stdout + stderr).toMatchInlineSnapshot(
        `"error TS5058: The specified path does not exist: '<dir>/nowhere'.Found 1 error, checked 0 files [time]"`,
      );
      expect(exitCode).toBe(1);
    });

    test("a flag it does not know", async () => {
      using dir = project({});
      const { stderr, exitCode } = await check(dir, ["--frobnicate"]);
      expect(stderr).toMatchInlineSnapshot(`
        "error: Unknown flag "--frobnicate"
        note: run 'bun check --help' for more information"
      `);
      expect(exitCode).toBe(1);
    });
  });

  test("--help", async () => {
    using dir = project({});
    const { stdout, exitCode } = await check(dir, ["--help"]);
    expect(stdout).toContain("Usage: bun check [flags] [...files or directories]");
    expect(stdout).toContain("--project <path>");
    expect(exitCode).toBe(0);
  });
});

describe.concurrent("--check", () => {
  test("bun --check runs a file that type checks", async () => {
    using dir = project({ "a.ts": `const n: number = 1;\nconsole.log("ran", n);\n` });
    const { stdout, stderr, exitCode } = await run(String(dir), ["--check", "a.ts"]);
    expect(stdout).toBe("ran 1");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("bun run --check does not run a file that does not, nor one that imports one", async () => {
    using dir = project({
      "a.ts": `import "./b";\nconsole.log("ran");\n`,
      "b.ts": `export const b: string = 1;\n`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["run", "--check", "a.ts"]);
    expect(stdout).toBe("");
    expect(stderr).toMatchInlineSnapshot(`
      "b.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.
      Found 1 error in 1 file, checked 2 files [time]"
    `);
    expect(exitCode).toBe(1);
  });

  test("without --check the same file runs", async () => {
    using dir = project({ "a.ts": `const s: string = 1 as any as number;\nconsole.log("ran", s);\n` });
    const { stdout, exitCode } = await run(String(dir), ["a.ts"]);
    expect(stdout).toBe("ran 1");
    expect(exitCode).toBe(0);
  });

  test("bun build --check", async () => {
    using dir = project({
      "good.ts": `export const good: number = 1;\nconsole.log(good);\n`,
      "bad.ts": `export const bad: number = "1";\nconsole.log(bad);\n`,
    });
    const [good, bad] = await Promise.all([
      run(String(dir), ["build", "--check", "good.ts", "--outdir", "out-good"]),
      run(String(dir), ["build", "--check", "bad.ts", "--outdir", "out-bad"]),
    ]);
    expect(good.exitCode).toBe(0);
    expect(await Bun.file(join(String(dir), "out-good", "good.js")).exists()).toBe(true);
    expect(bad.stderr).toMatchInlineSnapshot(`
      "bad.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.
      Found 1 error in 1 file, checked 1 file [time]"
    `);
    expect(await Bun.file(join(String(dir), "out-bad", "bad.js")).exists()).toBe(false);
    expect(bad.exitCode).toBe(1);
  });

  test("bun test --check", async () => {
    using dir = project({
      "bun-test.d.ts": `declare module "bun:test" {\n  export function test(name: string, fn: () => void): void;\n  export function expect(value: unknown): { toBe(expected: unknown): void };\n}\n`,
      "good.test.ts": `import { test, expect } from "bun:test";\ntest("good", () => expect(1).toBe(1));\n`,
      "bad/bad.test.ts": `import { test, expect } from "bun:test";\nconst n: string = 1;\ntest("bad", () => expect(n).toBe(1));\n`,
    });
    const [good, bad] = await Promise.all([
      run(String(dir), ["test", "--check", "good.test.ts"]),
      run(String(dir), ["test", "--check", "bad/bad.test.ts"]),
    ]);
    expect(good.stderr).toContain("1 pass");
    expect(good.exitCode).toBe(0);
    expect(bad.stderr).toContain(`error TS2322: Type 'number' is not assignable to type 'string'.`);
    expect(bad.stderr).not.toContain("1 pass");
    expect(bad.exitCode).toBe(1);
  });
});

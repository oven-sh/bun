import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// `bun check` reads `lib.*.d.ts` from the `typescript` package installed in the project.
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

const withResolveJsonModule = JSON.stringify({
  compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, resolveJsonModule: true },
});

function project(files: Record<string, string>, { withTypeScript = true } = {}) {
  const dir = tempDir("bun-check", {
    "tsconfig.json": tsconfig,
    // Avoids loading the DOM and Node.js type definitions, which keeps the tests fast.
    "console.d.ts": `declare var console: { log(...args: unknown[]): void };\n`,
    ...files,
  });
  if (withTypeScript) {
    mkdirSync(join(String(dir), "node_modules"), { recursive: true });
    symlinkSync(typescript, join(String(dir), "node_modules", "typescript"), "junction");
  }
  return dir;
}

// Disable AI agent and CI detection regardless of the environment the tests run in.
const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  NO_COLOR: "1",
  // Prevent fallback to globally installed packages.
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
      .replaceAll("\\", "/")
      .replaceAll(cwd.replaceAll("\\", "/"), "<dir>")
      .replace(/\[\d+(\.\d+)?m?s\]/g, "[time]")
      .trim();
  return { stdout: clean(stdout), stderr: clean(stderr), exitCode };
}

const check = (dir: { toString(): string }, args: string[] = [], extra = {}) =>
  run(String(dir), ["check", ...args], extra);

// Some sandboxes have no pseudo-terminals.
const hasTerminal = (() => {
  try {
    new Bun.Terminal({}).close();
    return true;
  } catch {
    return false;
  }
})();

// Runs `cmd` as a person does: in a terminal, with colors. The progress line is drawn at once instead of after 300 ms.
async function inTerminal(cwd: string, cmd: string[]) {
  const decoder = new TextDecoder();
  let output = "";
  await using child = Bun.spawn({
    cmd: [bunExe(), ...cmd],
    cwd,
    env: { ...env, NO_COLOR: undefined, FORCE_COLOR: "1", BUN_DEBUG_TEST_CHECK_PROGRESS_DELAY_MS: "0" },
    terminal: {
      cols: 80,
      rows: 24,
      data(_terminal, chunk) {
        output += decoder.decode(chunk, { stream: true });
      },
    },
  });
  const exitCode = await child.exited;
  return {
    output: Bun.stripANSI(output),
    hasColors: output.includes("\x1b[3"),
    exitCode,
    signalCode: child.signalCode,
  };
}

describe.concurrent("bun check", () => {
  test("colors change nothing but the colors", async () => {
    using dir = project({
      "index.ts": `interface User {\n  id: number;\n}\n\nconst ada: User = {\n  id: "1",\n};\nconsole.log(\`\${ada.nmae}\`);\n`,
    });
    const [plain, colored] = await Promise.all([
      check(dir, ["--pretty"]),
      check(dir, ["--pretty"], { NO_COLOR: undefined, FORCE_COLOR: "1" }),
    ]);
    const withoutColors = (text: string) =>
      Bun.stripANSI(text)
        .replace(/\[\d+(\.\d+)?m?s\]/g, "[time]")
        .trim();
    expect(colored.stdout).toContain("\x1b[");
    expect(colored.stderr).toContain("\x1b[");
    expect(withoutColors(colored.stdout)).toBe(plain.stdout);
    expect(withoutColors(colored.stderr)).toBe(plain.stderr);
    expect(colored.exitCode).toBe(1);
  });

  test("the typescript package may be installed globally", async () => {
    using dir = project({ "index.ts": `const wrong: string = 1;\n` }, { withTypeScript: false });
    using globalDir = tempDir("bun-check-global", {});
    mkdirSync(join(String(globalDir), "node_modules"), { recursive: true });
    symlinkSync(typescript, join(String(globalDir), "node_modules", "typescript"), "junction");
    const { stdout, exitCode } = await check(dir, [], { BUN_INSTALL_GLOBAL_DIR: String(globalDir) });
    expect(stdout).toMatchInlineSnapshot(
      `"index.ts(1,7): error TS2322: Type 'number' is not assignable to type 'string'."`,
    );
    expect(exitCode).toBe(1);
  });

  // The progress line is drawn by a thread of its own, and only for a person at a terminal.
  test.skipIf(isWindows || !hasTerminal)("shows progress in a terminal", async () => {
    using dir = project({ "index.ts": `const wrong: string = 1;\n` });
    let output = "";
    await using proc = Bun.spawn({
      cmd: [bunExe(), "check"],
      cwd: String(dir),
      env: { ...env, BUN_DEBUG_TEST_CHECK_PROGRESS_DELAY_MS: "0" },
      terminal: {
        cols: 80,
        rows: 24,
        data(_terminal, chunk) {
          output += new TextDecoder().decode(chunk);
        },
      },
    });
    const exitCode = await proc.exited;
    expect(output).toContain("Loading");
    expect(output).toContain("TS2322");
    expect(proc.signalCode).toBeNull();
    expect(exitCode).toBe(1);
  });

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

  test("prints one line per error when stdout is not a terminal", async () => {
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

  test("--pretty prints a source excerpt for each error", async () => {
    using dir = project({
      "index.ts": `interface User {\n  id: number;\n  name: string;\n}\n\nconst ada: User = {\n  id: "1",\n  name: "Ada",\n};\n\nconsole.log(ada.nmae);\n`,
    });
    const { stdout, exitCode } = await check(dir, ["--pretty"]);
    expect(stdout).toMatchInlineSnapshot(`
      "6 | const ada: User = {
      7 |   id: "1",
            ^
      error: TS2322: Type 'string' is not assignable to type 'number'.
          at index.ts:7:3

      2 |   id: number;
            ^
      note: The expected type comes from property 'id' which is declared here on type 'User'
         at index.ts:2:3

       9 | };
      10 | 
      11 | console.log(ada.nmae);
                           ^
      error: TS2339: Property 'nmae' does not exist on type 'User'.
          at index.ts:11:17"
    `);
    expect(exitCode).toBe(1);
  });

  test("AI agents get tagged output with source excerpts and no colors", async () => {
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

  test("prints annotations on GitHub Actions", async () => {
    using dir = project({ "src/a.ts": `export const a: string = 1;\n` });
    const { stdout, exitCode } = await check(dir, [], { GITHUB_ACTIONS: "true" });
    expect(stdout).toMatchInlineSnapshot(`
      "src/a.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.
      ::error file=src/a.ts,line=1,col=14,endLine=1,endColumn=15,title=TS2322::Type 'number' is not assignable to type 'string'."
    `);
    expect(exitCode).toBe(1);
  });

  test("prints the message chain of an error", async () => {
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

  test("output is sorted by file and position, independent of thread scheduling", async () => {
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

  test("--threads 1 produces the same output", async () => {
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

  test("modules that enter the same cycles produce the same output on any number of threads", async () => {
    // Whichever file is checked first enters each cycle: the variances of type parameters, recursive aliases, and
    // functions and constants without annotations, each through a ring of modules.
    const n = isDebug || isASAN ? 24 : 60;
    const files: Record<string, string> = {};
    for (let i = 0; i < n; i++) {
      const [a, b, d] = [(i + 1) % n, (i + 7) % n, (i * 3 + 2) % n];
      files[`m${i}.ts`] = [
        ...[...new Set([a, b, d])]
          .filter(j => j !== i)
          .map(j => `import { f${j}, g${j}, C${j}, v${j}, type T${j}, type R${j} } from "./m${j}";`),
        `export interface T${i}<A> { a: A; next: T${a}<A[]> | null; take(x: T${b}<A>): void; give(): T${d}<A> }`,
        `export type R${i}<X, N extends unknown[] = []> = N["length"] extends 6 ? X : R${a}<{ m${i}: X }, [...N, 1]>;`,
        `export function f${i}(x: number) { return x > 0 ? { k: "m${i}" as const, inner: f${a}(x - 1) } : null; }`,
        `export function g${i}(x: number) { return ${i === 0 ? "x" : `{ k: ${i}, inner: g${Math.floor(i / 2)}(x) }`}; }`,
        `export class C${i}<A> { constructor(public v: A) {} map<B>(h: (a: A) => B): C${b}<B> { return new C${b}(h(this.v)); } }`,
        `export const v${i} = new C${a}(${i}).map(x => [x, v${d}] as const);`,
        // `never` puts the types in the messages.
        `const r${i}: never = f${d}(1);`,
        `const s${i}: never = g${b}(1);`,
        `const t${i}: T${a}<string> = null! as T${a}<unknown>;`,
        `const u${i}: T${b}<unknown> = null! as T${b}<string>;`,
        `const w${i}: never = null! as R${d}<${i}>;`,
        `const y${i}: never = v${b};`,
        `r${i}; s${i}; t${i}; u${i}; w${i}; y${i};\n`,
      ].join("\n");
    }
    using dir = project(files);
    const [one, ...others] = await Promise.all(
      [1, 2, 3, 8, 16].map(threads => check(dir, ["--threads", String(threads)])),
    );
    expect(one.stdout.split("\n").length).toBeGreaterThan(n * 6);
    for (const { stdout, exitCode } of others) {
      expect(stdout).toBe(one.stdout);
      expect(exitCode).toBe(1);
    }
    expect(one.exitCode).toBe(1);
  });

  test("prints related information under an error", async () => {
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
                ^
      error: TS2741: Property 'email' is missing in type '{ id: number; }' but required in type 'User'.
          at index.ts:2:7

      3 |   email: string;
            ^
      note: 'email' is declared here.
         at types.ts:3:3

      2 | const ada: User = { id: 1 };
      3 | const o = { colour: "red" };
      4 | o.color;
            ^
      error: TS2551: Property 'color' does not exist on type '{ colour: string; }'. Did you mean 'colour'?
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
    // Same format as `tsc --pretty false`.
    expect(plain.stdout).toMatchInlineSnapshot(`
      "index.ts(2,7): error TS2741: Property 'email' is missing in type '{ id: number; }' but required in type 'User'.
      index.ts(4,3): error TS2551: Property 'color' does not exist on type '{ colour: string; }'. Did you mean 'colour'?"
    `);
  });

  describe("many errors", () => {
    const files = {
      // One error repeated 60 times across two files, a second one 3 times, and a third one once.
      "a.ts": Array.from({ length: 40 }, (_, i) => `console.lgo(${i});`).join("\n") + `\nexport {};\n`,
      "b.ts":
        Array.from({ length: 20 }, (_, i) => `console.lgo(${i});`).join("\n") +
        `\nconst a: string = 1, b: string = 2, c: string = 3;\nmissing;\nexport {};\n`,
    };

    test("groups repeated errors, most frequent first", async () => {
      using dir = project(files);
      const { stdout, stderr, exitCode } = await check(dir, ["--pretty"]);
      expect(stdout).toMatchInlineSnapshot(`
        "1 | console.lgo(0);
                    ^
        error: TS2339: Property 'lgo' does not exist on type '{ log(...args: unknown[]): void; }'.
            at a.ts:1:9
            60 times in 2 files
              40  a.ts:1
              20  b.ts:1

        19 | console.lgo(18);
        20 | console.lgo(19);
        21 | const a: string = 1, b: string = 2, c: string = 3;
                   ^
        error: TS2322: Type 'number' is not assignable to type 'string'.
            at b.ts:21:7
            3 times on this line

        20 | console.lgo(19);
        21 | const a: string = 1, b: string = 2, c: string = 3;
        22 | missing;
             ^
        error: TS2304: Cannot find name 'missing'.
            at b.ts:22:1"
      `);
      expect(stderr).toMatchInlineSnapshot(`
        "Found 64 errors in 2 files, checked 2 files [time]

          24  b.ts:1
          40  a.ts:1"
      `);
      expect(exitCode).toBe(1);
    });

    test("groups repeated errors for AI agents", async () => {
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

    test("--all and machine-readable output list every error", async () => {
      using dir = project(files);
      const [all, plain] = await Promise.all([check(dir, ["--pretty", "--all"]), check(dir)]);
      expect(all.stdout.match(/error: TS/g)).toHaveLength(64);
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

    test("50 errors are not grouped", async () => {
      using dir = project({
        "a.ts": Array.from({ length: 50 }, (_, i) => `console.lgo(${i});`).join("\n") + `\nexport {};\n`,
      });
      const { stdout } = await check(dir, ["--pretty"]);
      expect(stdout.match(/error: TS/g)).toHaveLength(50);
    });
  });

  describe("diagnostic stages, as in tsc", () => {
    test("syntax errors suppress semantic errors", async () => {
      using dir = project({
        "a.ts": `const a = ;\nexport {};\n`,
        "b.ts": `export const b: string = 1;\n`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`"a.ts(1,11): error TS1109: Expression expected."`);
      expect(exitCode).toBe(1);
    });

    test("compiler option errors suppress semantic errors", async () => {
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

  test("suggests installing @types/bun", async () => {
    using dir = project({
      "console.d.ts": ``,
      "index.ts": `import { test } from "bun:test";\nconsole.log(test);\n`,
    });
    const [pretty, plain] = await Promise.all([check(dir, ["--pretty"]), check(dir)]);
    expect(pretty.stderr).toMatchInlineSnapshot(`
      "hint: Bun's type definitions (console, fetch, Bun, bun:test) are not installed. Run: bun add -d @types/bun
      Found 2 errors in 1 file, checked 1 file [time]"
    `);
    expect(plain.stderr).toBe(pretty.stderr);
  });

  describe("input selection", () => {
    test("finds the nearest tsconfig.json from a subdirectory", async () => {
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

    test("-p accepts a file or a directory", async () => {
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

    test("path arguments: checks those files and their imports with the compiler options of the project", async () => {
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

    test("path arguments: global declarations of the whole project stay visible", async () => {
      using dir = project({
        // These two files are not imported, but their global declarations are visible in every file.
        "globals.ts": `declare global {\n  var answer: number;\n}\nexport {};\n`,
        "more.ts": `declare module "./lib" {\n  interface Options {\n    extra: boolean;\n  }\n}\nexport {};\n`,
        "lib.ts": `export interface Options {\n  name: string;\n}\n`,
        "index.ts": `import type { Options } from "./lib";\nconst o: Options = { name: "a", extra: true };\nconsole.log(o, answer.toFixed());\n`,
        // Not imported either, and not checked.
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

    test("--listFiles and --listFilesOnly", async () => {
      using dir = project({
        "a.ts": `import "./b";\nexport const a: string = 1;\n`,
        "b.ts": `export {};\n`,
      });
      const [after, only] = await Promise.all([check(dir, ["--listFiles"]), check(dir, ["--listFilesOnly"])]);
      // Lib files are listed first. A file is listed after its imports.
      const listed = (stdout: string) => stdout.split("\n").filter(line => !line.includes("/typescript/lib/lib."));
      expect(after.stdout).toContain("/typescript/lib/lib.es5.d.ts");
      expect(listed(after.stdout).map(line => line.replace(/^\S*\//, ""))).toEqual([
        "a.ts(2,14): error TS2322: Type 'number' is not assignable to type 'string'.",
        "b.ts",
        "a.ts",
        "console.d.ts",
      ]);
      expect(listed(only.stdout).map(line => line.replace(/^\S*\//, ""))).toEqual(["b.ts", "a.ts", "console.d.ts"]);
      expect(after.exitCode).toBe(1);
      expect(only.exitCode).toBe(0);
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

    test.skipIf(process.platform === "win32")("a named pipe in the project directory is ignored", async () => {
      using dir = project({ "a.ts": `export const a: string = 1;\n` });
      // Reading a pipe that nobody writes to blocks forever.
      expect(Bun.spawnSync(["mkfifo", join(String(dir), "pipe.ts")]).exitCode).toBe(0);
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'."`,
      );
      expect(exitCode).toBe(1);
    });

    test("workspaces without a root tsconfig.json: one project per package, default options for the other files", async () => {
      const implicitAny = `export function f(x) {\n  return x;\n}\n`;
      const loose = JSON.stringify({ compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, strict: false } });
      using dir = tempDir("bun-check", {
        "package.json": JSON.stringify({ workspaces: ["packages/*", "!packages/left-out", "tools"] }),
        "packages/loose/tsconfig.json": loose,
        "packages/loose/index.ts": implicitAny,
        "packages/strict/tsconfig.json": tsconfig,
        // A file imported from another package is checked by that package's project.
        "packages/strict/index.ts":
          `import { f as loose } from "../loose/index";\nexport const a: string = loose(1);\n` + implicitAny,
        "packages/left-out/tsconfig.json": loose,
        "packages/left-out/index.ts": implicitAny,
        "tools/tsconfig.json": loose,
        "tools/index.ts": implicitAny,
        "scripts/build.ts": implicitAny,
      });
      mkdirSync(join(String(dir), "node_modules"));
      symlinkSync(typescript, join(String(dir), "node_modules", "typescript"), "junction");
      const { stdout, stderr, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "packages/left-out/index.ts(1,19): error TS7006: Parameter 'x' implicitly has an 'any' type.
        packages/strict/index.ts(3,19): error TS7006: Parameter 'x' implicitly has an 'any' type.
        scripts/build.ts(1,19): error TS7006: Parameter 'x' implicitly has an 'any' type."
      `);
      expect(stderr).toMatchInlineSnapshot(`
        "Found 3 errors in 3 files, checked 5 files across 4 projects [time]

          1  packages/left-out/index.ts:1
          1  packages/strict/index.ts:3
          1  scripts/build.ts:1"
      `);
      expect(exitCode).toBe(1);
    });

    test("declaration files are checked unless skipLibCheck is set", async () => {
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

  describe("project references", () => {
    const options = {
      strict: true,
      composite: true,
      target: "esnext",
      module: "esnext",
      moduleResolution: "bundler",
      lib: ["esnext"],
      types: [],
      skipLibCheck: true,
    };
    const monorepo = (extra: Record<string, string> = {}) =>
      project({
        // A solution-style tsconfig.json: only `references`, no files.
        "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "packages/app" }] }),
        "console.d.ts": "",
        "packages/lib/tsconfig.json": JSON.stringify({ compilerOptions: options, include: ["src"] }),
        "packages/lib/src/index.ts": `export const double = (n: number) => n * 2;\n`,
        "packages/app/tsconfig.json": JSON.stringify({
          compilerOptions: { ...options, noImplicitAny: false },
          include: ["src"],
          references: [{ path: "../lib" }],
        }),
        "packages/app/src/index.ts": `import { double } from "../../lib/src/index";\nexport const four: number = double(2);\n`,
        ...extra,
      });

    test("checks every referenced project without a build", async () => {
      using dir = monorepo();
      const { stdout, stderr, exitCode } = await check(dir);
      expect(stdout).toBe("");
      expect(stderr).toMatchInlineSnapshot(`"✓ No type errors in 2 files across 2 projects [time]"`);
      expect(exitCode).toBe(0);
    });

    test("reports errors in transitively referenced projects", async () => {
      using dir = monorepo({ "packages/lib/src/broken.ts": `export const wrong: string = 1;\n` });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"packages/lib/src/broken.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'."`,
      );
      expect(exitCode).toBe(1);
    });

    test("checks each project with its own compiler options and each file once", async () => {
      using dir = monorepo({
        // Implicit any: an error under lib's options, allowed under app's.
        "packages/lib/src/loose.ts": `export function f(x) {\n  return x;\n}\n`,
        "packages/app/src/loose.ts": `import { f } from "../../lib/src/loose";\nexport function g(x) {\n  return f(x);\n}\n`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"packages/lib/src/loose.ts(1,19): error TS7006: Parameter 'x' implicitly has an 'any' type."`,
      );
    });

    test("resolves imports of the build output of a referenced package without a build", async () => {
      // Nothing was built: no `dist` directory exists.
      using dir = project({
        "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "packages/app" }] }),
        "console.d.ts": "",
        "packages/lib/package.json": JSON.stringify({
          name: "lib",
          exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } },
        }),
        "packages/lib/tsconfig.json": JSON.stringify({
          compilerOptions: { ...options, rootDir: "src", outDir: "dist" },
          include: ["src"],
        }),
        "packages/lib/src/index.ts": `export const double = (n: number) => n * 2;\n`,
        // A scoped package, found through `main` and a directory, with `declarationDir`.
        "packages/scoped/package.json": JSON.stringify({
          name: "@scope/pkg",
          main: "./build/js",
          types: "./build/types",
        }),
        "packages/scoped/tsconfig.json": JSON.stringify({
          compilerOptions: {
            ...options,
            jsx: "preserve",
            rootDir: "src",
            outDir: "build/js",
            declarationDir: "build/types",
          },
          include: ["src"],
        }),
        "packages/scoped/src/index.tsx": `export const triple = (n: number) => n * 3;\n`,
        "packages/app/tsconfig.json": JSON.stringify({
          compilerOptions: options,
          include: ["src"],
          references: [{ path: "../lib" }, { path: "../scoped" }],
        }),
        "packages/app/src/index.ts": [
          `import { double } from "lib";`,
          `import { triple } from "@scope/pkg";`,
          `export const a: string = double(2);`,
          `export const b: string = triple(2);`,
          ``,
        ].join("\n"),
      });
      const modules = join(String(dir), "packages/app/node_modules");
      mkdirSync(join(modules, "@scope"), { recursive: true });
      symlinkSync(join(String(dir), "packages/lib"), join(modules, "lib"), "junction");
      symlinkSync(join(String(dir), "packages/scoped"), join(modules, "@scope/pkg"), "junction");
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "packages/app/src/index.ts(3,14): error TS2322: Type 'number' is not assignable to type 'string'.
        packages/app/src/index.ts(4,14): error TS2322: Type 'number' is not assignable to type 'string'."
      `);
    });

    test("does not generate build output for a project that is not referenced", async () => {
      using dir = project({
        "tsconfig.json": JSON.stringify({ compilerOptions: { ...options, composite: false }, include: ["app"] }),
        "console.d.ts": "",
        "lib/package.json": JSON.stringify({ name: "lib", types: "./dist/index.d.ts" }),
        "lib/tsconfig.json": JSON.stringify({
          compilerOptions: { ...options, rootDir: "src", outDir: "dist" },
          include: ["src"],
        }),
        "lib/src/index.ts": `export const double = (n: number) => n * 2;\n`,
        "app/index.ts": `import { double } from "lib";\nexport const a = double(2);\n`,
      });
      mkdirSync(join(String(dir), "node_modules"), { recursive: true });
      symlinkSync(join(String(dir), "lib"), join(String(dir), "node_modules/lib"), "junction");
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"app/index.ts(1,24): error TS2307: Cannot find module 'lib' or its corresponding type declarations."`,
      );
    });

    test("reports a reference to a missing project", async () => {
      using dir = monorepo({
        "tsconfig.json": JSON.stringify({
          files: [],
          references: [{ path: "packages/app" }, { path: "packages/gone" }],
        }),
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`"error TS6053: File '<dir>/packages/gone/tsconfig.json' not found."`);
      expect(exitCode).toBe(1);
    });

    test("a referenced project is seen through its declaration files", async () => {
      using dir = monorepo({
        "packages/lib/tsconfig.json": JSON.stringify({
          compilerOptions: { ...options, stripInternal: true },
          include: ["src"],
        }),
        "packages/lib/src/index.ts": `
export type Image = {
  src: string;
  /** @internal */
  path: string;
};
export class Box {
  private size = 1;
  /** @internal */
  open() {}
  grow() {
    return this.size + 1;
  }
}
`,
        "packages/app/src/index.ts": `
import { Box, type Image } from "../../lib/src/index";
export const image: Image = { src: "a" };
new Box().open();
export const n: string = new Box().grow();
`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "packages/app/src/index.ts(4,11): error TS2339: Property 'open' does not exist on type 'Box'.
        packages/app/src/index.ts(5,14): error TS2322: Type 'number' is not assignable to type 'string'."
      `);
      // Nothing is written.
      expect(existsSync(join(String(dir), "packages/lib/src/index.d.ts"))).toBe(false);
    });

    test("global declarations loaded by a referenced project do not leak into the referencing project", async () => {
      using dir = monorepo({
        "packages/lib/src/globals.d.ts": `declare const secret: number;\n`,
        "packages/lib/src/index.ts": `/// <reference path="./globals.d.ts" />\nexport const twice = () => secret * 2;\n`,
        "packages/app/src/index.ts": `import { twice } from "../../lib/src/index";\nexport const a = twice() + secret;\n`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"packages/app/src/index.ts(2,28): error TS2304: Cannot find name 'secret'."`,
      );
    });

    test("a project that fails under noEmitOnError emits no declaration files", async () => {
      using dir = monorepo({
        "packages/lib/package.json": JSON.stringify({ name: "lib", types: "./dist/index.d.ts" }),
        "packages/lib/tsconfig.json": JSON.stringify({
          compilerOptions: { ...options, noEmitOnError: true, rootDir: "src", outDir: "dist" },
          include: ["src"],
        }),
        "packages/lib/src/index.ts": `export const double = (n: number) => n * 2;\nexport const wrong: string = 1;\n`,
        "packages/app/src/index.ts": [
          `import { double } from "lib";`,
          `import { wrong } from "../../lib/src/index";`,
          `export const a = double(2), b = wrong;`,
          ``,
        ].join("\n"),
      });
      const modules = join(String(dir), "packages/app/node_modules");
      mkdirSync(modules, { recursive: true });
      symlinkSync(join(String(dir), "packages/lib"), join(modules, "lib"), "junction");
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "packages/app/src/index.ts(1,24): error TS2307: Cannot find module 'lib' or its corresponding type declarations.
        packages/app/src/index.ts(2,23): error TS6305: Output file '<dir>/packages/lib/dist/index.d.ts' has not been built from source file '<dir>/packages/lib/src/index.ts'.
        packages/lib/src/index.ts(2,14): error TS2322: Type 'number' is not assignable to type 'string'."
      `);
    });

    test("imports in a generated declaration file resolve from the location of the source file", async () => {
      using dir = monorepo({
        "packages/lib/tsconfig.json": JSON.stringify({
          compilerOptions: { ...options, rootDir: ".", outDir: "build" },
          include: ["src"],
        }),
        // Not emitted: from build/src/index.d.ts, "../types/id" is not there.
        "packages/lib/types/id.d.ts": `export type Id = string;\n`,
        "packages/lib/src/index.ts": `import type { Id } from "../types/id";\nexport declare const id: Id;\n`,
        "packages/app/src/index.ts": `import { id } from "../../lib/src/index";\nexport const n: number = id;\n`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"packages/app/src/index.ts(2,14): error TS2322: Type 'string' is not assignable to type 'number'."`,
      );
    });

    test("generated declaration files keep literal types, expando properties and untyped parameters", async () => {
      using dir = monorepo({
        "packages/lib/src/index.ts": `
type Icon = "gear" | "x" | (string & NonNullable<unknown>);
export const app = { icon: "gear" } satisfies { icon?: Icon };
const Component = (props: { value: string }) => props.value;
Component.isStatic = () => true;
export default Component;
// @ts-expect-error
export const handler = (context, next) => next();
`,
        "packages/app/src/index.ts": `
import Component, { app, handler } from "../../lib/src/index";
export const a: 1 = app.icon;
export const b: 1 = Component.isStatic;
export const c: 1 = handler;
`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "packages/app/src/index.ts(3,14): error TS2322: Type '"gear"' is not assignable to type '1'.
        packages/app/src/index.ts(4,14): error TS2322: Type '() => boolean' is not assignable to type '1'.
        packages/app/src/index.ts(5,14): error TS2322: Type '(context: any, next: any) => any' is not assignable to type '1'."
      `);
    });

    test("a type of a referenced package whose exports point at its sources can be named", async () => {
      using dir = monorepo({
        "packages/lib/package.json": JSON.stringify({ name: "lib", exports: { "./*": "./src/*.ts" } }),
        "packages/lib/tsconfig.json": JSON.stringify({
          compilerOptions: { ...options, rootDir: "src", outDir: "dist" },
          include: ["src"],
        }),
        "packages/lib/src/Types.ts": `export interface Box<T> {\n  value: T;\n}\n`,
        "packages/lib/src/Make.ts": `import type { Box } from "./Types";\nexport declare function make<T>(value: T): Box<T>;\n`,
        // The declaration file says `import("lib/Types").Box<number>`, which index.ts does not import.
        "packages/app/src/index.ts": `import { make } from "lib/Make";\nexport const made = make(1);\nexport const wrong: string = made.value;\n`,
      });
      mkdirSync(join(String(dir), "packages/app/node_modules"), { recursive: true });
      symlinkSync(join(String(dir), "packages/lib"), join(String(dir), "packages/app/node_modules/lib"), "junction");
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"packages/app/src/index.ts(3,14): error TS2322: Type 'number' is not assignable to type 'string'."`,
      );
    });

    test("a generated declaration file names a dependency by its package name in a project with paths", async () => {
      using dir = monorepo({
        "packages/lib/tsconfig.json": JSON.stringify({
          compilerOptions: { ...options, rootDir: "src", outDir: "dist", paths: { "@/*": ["./src/client/*"] } },
          include: ["src"],
        }),
        "packages/lib/node_modules/dep/package.json": JSON.stringify({ name: "dep", types: "index.d.ts" }),
        "packages/lib/node_modules/dep/index.d.ts": `export { make } from "./make";\n`,
        "packages/lib/node_modules/dep/make.d.ts": `import type { Box } from "./box";\nexport declare function make<T>(value: T): Box<T>;\n`,
        "packages/lib/node_modules/dep/box.d.ts": `export interface Box<T> {\n  value: T;\n}\n`,
        "packages/lib/src/client/one.ts": `export const one = 1;\n`,
        "packages/lib/src/index.ts": `import { make } from "dep";\nimport { one } from "@/one";\nexport const made = make(one);\n`,
        "packages/app/src/index.ts": `import { made } from "../../lib/src/index";\nexport const wrong: string = made.value;\n`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"packages/app/src/index.ts(2,14): error TS2322: Type 'number' is not assignable to type 'string'."`,
      );
    });

    describe("a referenced project written in JavaScript", () => {
      const library = {
        "packages/lib/tsconfig.json": JSON.stringify({
          compilerOptions: {
            ...options,
            allowJs: true,
            checkJs: true,
            module: "nodenext",
            moduleResolution: "nodenext",
            rootDir: "src",
            outDir: "dist",
          },
          include: ["src"],
        }),
        "packages/lib/src/main.js": `/** @typedef {{ id: number, name: string }} User */

/**
 * Says hello.
 * @param {User} user
 */
function greet(user) {
  return "hi " + user.name;
}

class Counter {
  constructor() {
    this.count = 0;
    /** @type {string | undefined} */
    this.label = undefined;
  }
  /** @protected */
  reset() {
    this.count = 0;
  }
}

exports.greet = greet;
exports.Counter = Counter;
exports.limit = 10;
exports.Box = class {
  /** @param {number} size */
  constructor(size) {
    this.size = size;
  }
};
`,
        "packages/lib/src/single.js": `const { Counter } = require("./main");

/** @param {number} start */
module.exports = function make(start) {
  const counter = new Counter();
  counter.count = start;
  return counter;
};
`,
        "packages/lib/src/esm.mjs": `/** @template T @param {T} value @returns {T[]} */
export function wrap(value) {
  return [value];
}
export default class Shape {
  static kind = "shape";
  area() {
    return 1;
  }
}
`,
        "packages/app/src/index.ts": `import lib = require("../../lib/src/main.js");
import make = require("../../lib/src/single.js");
import Shape, { wrap } from "../../lib/src/esm.mjs";

const user: lib.User = { id: "1", name: "Ada" };
const text: number = lib.greet({ id: 1, name: "Ada" });
const counter = new lib.Counter();
counter.reset();
const label: string = counter.label;
const limit: string = lib.limit;
const size: string = new lib.Box(1).size;
const made: string = make(1);
const wrapped: number[] = wrap("a");
const kind: number = Shape.kind;
`,
      };
      const app = (compilerOptions: object) =>
        JSON.stringify({
          compilerOptions: { ...options, module: "nodenext", moduleResolution: "nodenext", ...compilerOptions },
          include: ["src"],
          references: [{ path: "../lib" }],
        });

      test("is seen through its declaration files", async () => {
        using dir = monorepo({ ...library, "packages/app/tsconfig.json": app({ allowJs: true }) });
        const { stdout } = await check(dir);
        expect(stdout).toMatchInlineSnapshot(`
          "packages/app/src/index.ts(5,26): error TS2322: Type 'string' is not assignable to type 'number'.
          packages/app/src/index.ts(6,7): error TS2322: Type 'string' is not assignable to type 'number'.
          packages/app/src/index.ts(8,9): error TS2445: Property 'reset' is protected and only accessible within class 'Counter' and its subclasses.
          packages/app/src/index.ts(9,7): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
            Type 'undefined' is not assignable to type 'string'.
          packages/app/src/index.ts(10,7): error TS2322: Type 'number' is not assignable to type 'string'.
          packages/app/src/index.ts(11,7): error TS2322: Type 'number' is not assignable to type 'string'.
          packages/app/src/index.ts(12,7): error TS2322: Type 'Counter' is not assignable to type 'string'.
          packages/app/src/index.ts(13,7): error TS2322: Type 'string[]' is not assignable to type 'number[]'.
            Type 'string' is not assignable to type 'number'.
          packages/app/src/index.ts(14,7): error TS2322: Type 'string' is not assignable to type 'number'."
        `);
      });

      test("has no declaration files under noEmit", async () => {
        // A `helpers.d.ts` next to `helpers.js` would be resolved in its place by the second project.
        const compilerOptions = {
          ...options,
          module: "nodenext",
          moduleResolution: "nodenext",
          allowJs: true,
          checkJs: true,
          noEmit: true,
        };
        const index = (name: string) => `const { help } = require("../helpers");\nexports.${name} = help();\n`;
        using dir = project({
          "tsconfig.json": JSON.stringify({
            compilerOptions,
            include: ["./helpers.js"],
            references: [{ path: "./one" }, { path: "./two" }],
          }),
          "console.d.ts": "",
          "helpers.js": `exports.help = () => 1;\n`,
          "one/tsconfig.json": JSON.stringify({ compilerOptions, include: ["./*.js"] }),
          "one/index.js": index("one"),
          "two/tsconfig.json": JSON.stringify({ compilerOptions, include: ["./*.js"] }),
          "two/index.js": index("two"),
        });
        const { stdout } = await check(dir);
        expect(
          stdout
            .split("\n")
            .filter(line => line.includes("TS6307"))
            .map(line => line.slice(0, 40)),
        ).toEqual(["one/index.js(1,26): error TS6307: File '", "two/index.js(1,26): error TS6307: File '"]);
      });

      test("is imported without allowJs where an untyped import is no error", async () => {
        using dir = monorepo({ ...library, "packages/app/tsconfig.json": app({ noImplicitAny: false }) });
        const { stdout } = await check(dir);
        expect(stdout.split("\n").filter(line => line.includes("error TS")).length).toBe(9);
      });

      test("cannot be imported by a project that does not allow JavaScript", async () => {
        using dir = monorepo({ ...library, "packages/app/tsconfig.json": app({}) });
        const { stdout } = await check(dir);
        expect(stdout.split("\n").map(line => line.slice(0, line.indexOf(":", line.indexOf("TS"))))).toEqual([
          "packages/app/src/index.ts(1,22): error TS7016",
          "packages/app/src/index.ts(2,23): error TS7016",
          "packages/app/src/index.ts(3,29): error TS7016",
        ]);
      });
    });
  });

  describe("files that are not imported", () => {
    test("checks a test file and the helper it imports", async () => {
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

    test("global declarations in a file that is not imported are visible everywhere", async () => {
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

    test("file-local types do not leak into other files", async () => {
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
    test("typed, untyped and missing packages", async () => {
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

    test("loads only the @types packages listed in `types`", async () => {
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

  describe("language features", () => {
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

    test("checkJs uses JSDoc types", async () => {
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

    test("CRLF line endings, tabs and multi-byte characters", async () => {
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
                   ^
        error: TS2322: Type 'string' is not assignable to type 'number'.
            at a.ts:2:8

        1 | const é = "é";
        2 |  const 名前: number = é;
        3 | const s = "😀😀"; const n: number = s;
                                    ^
        error: TS2322: Type 'string' is not assignable to type 'number'.
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

  describe("cases not covered by TypeScript's test suite", () => {
    test("a variable referenced in a callback inside its own initializer", async () => {
      using dir = project({
        "a.ts": `
interface Server<W> { port: number | undefined; data: W }
declare function serve<W = undefined>(options: { fetch(request: string): string }): Server<W>;
declare function plain(options: { fetch(request: string): string }): Server<string>;
declare const untyped: any;
const server = serve({ fetch() { return \`\${server.port}\`; } });
// With a single non-generic signature, the call arguments are not checked while the type of the variable is being resolved.
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
        // The declarations are not merged: one constructor, not two overloads, and no members from the second version.
        "a.ts": `import { Thing } from "thing";\nnew Thing("big").two;\n`,
      });
      const { stdout } = await check(dir, ["a.ts"]);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,11): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
        a.ts(2,18): error TS2339: Property 'two' does not exist on type 'Thing'."
      `);
    });

    test("instantiating a generic intersection can reduce it to never", async () => {
      using dir = project({
        "a.ts": `
type Narrowed<T, C> = T extends C ? T : C extends T ? C : T & C;
declare function narrowed<const T0, const T1>(t0: T0, t1: T1): Narrowed<T0, T1>;
declare function typed<T>(): T;
declare function id<T>(x: T): T;
type Eq<L, R> = (<T>() => T extends (L & T) | T ? true : false) extends (<T>() => T extends (R & T) | T ? true : false) ? true : false;

type Direct = { readonly a: "cat" } & { readonly a: "dog" };
type ViaAlias = Narrowed<{ readonly a: "cat" }, { readonly a: "dog" }>;
const viaCall = narrowed(typed<{ readonly a: "cat" }>(), typed<{ readonly a: "dog" }>());
const viaId = id(viaCall);

const p1: 1 = null! as Eq<Direct, never>;
const p2: 2 = null! as Eq<ViaAlias, never>;
const p3: 3 = null! as Eq<typeof viaCall, never>;
const p4: 4 = null! as Eq<typeof viaId, never>;
const q1: 1 = null! as Direct;
const q2: 2 = null! as ViaAlias;
const q3: 3 = viaCall;
const q4: 4 = viaId;
export {};
`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(13,7): error TS2322: Type 'true' is not assignable to type '1'.
        a.ts(14,7): error TS2322: Type 'true' is not assignable to type '2'.
        a.ts(15,7): error TS2322: Type 'true' is not assignable to type '3'.
        a.ts(16,7): error TS2322: Type 'true' is not assignable to type '4'."
      `);
    });

    test("an intersection with a type parameter is reduced by the constraint of the parameter", async () => {
      using dir = project({
        "a.ts": `
type R<D extends { ok: 1 }> = D;
// a type parameter whose constraint is an object type
type A1<D extends { type: 'a' }> = R<D & { type: 'c' }>;
// .. a union
type A2<D extends { type: 'a' } | { type: 'b' }> = R<D & { type: 'c' }>;
// .. an indexed access
type A3<M extends Record<string, { type: 'a' }>, K extends keyof M> = R<M[K] & { type: 'c' }>;
// not generic
type A4 = R<{ type: 'a' } & { type: 'c' }>;
// generic, and the conflict is between the two that are not
type A5<D> = R<D & { type: 'a' } & { type: 'c' }>;
function f1<D extends { type: 'a' }>(x: D & { type: 'c' }) { const p: 1 = x; }
function f2<D extends { type: 'a' } | { type: 'b' }>(x: D & { type: 'c' }) { const p: 2 = x; }
export {};
`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toBe("");
    });

    test("a context-sensitive function inherits type parameters from its contextual signature", async () => {
      using dir = project({
        "a.ts": `
type NodeKind = "a" | "b";
type T = <kind extends NodeKind>(kind: kind, inner: { k: kind }) => { k: kind } | null;
declare const k: NodeKind;
const m1 = ((kind, inner) => ({ ...inner })) satisfies T;
m1<"a">("a", { k: "a" });
m1("a", { k: "a" });
m1(k, { k });
const r1: 1 = m1("a", { k: "a" });
const m5 = ((kind, inner) => inner) satisfies T;
m5(k, { k });
const m6 = ((kind) => null) satisfies T;
m6(k);
declare function id<F>(f: F): F;
const m7 = id<T>((kind, inner) => inner);
m7(k, { k });
export {};
`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(9,7): error TS2322: Type '{ k: "a"; }' is not assignable to type '1'."`,
      );
    });

    test("constraint of a distributive conditional type over an inferred type parameter", async () => {
      using dir = project({
        "a.ts": `
type Fn = (...args: any[]) => unknown;
type collect<fn, result> = result & fn extends (...args: infer args) => infer returns
  ? result extends fn ? never : collect<fn, result & ((...args: args) => returns)> | ((...args: args) => returns)
  : never;
type flat<fn, result> = result & fn extends (...args: infer args) => infer returns
  ? result extends fn ? never : ((...args: args) => returns)
  : never;
type one<fn> = fn extends (...args: infer args) => infer returns ? collect<fn, returns> | ((...args: args) => returns) : never;

function b1<fn extends Fn>(a: Parameters<collect<fn, unknown>>) { const x: 1 = a.length; }
function b2<fn extends Fn>(a: Parameters<flat<fn, unknown>>) { const x: 2 = a.length; }
function b3<fn extends Fn>(a: Parameters<one<fn>>) { const x: 3 = a.length; }
function c1<fn extends Fn>(a: collect<fn, unknown>) { const x: 1 = a(); }
function c2<fn extends Fn>(a: flat<fn, unknown>) { const x: 2 = a(); }
function c3<fn extends Fn>(a: one<fn>) { const x: 3 = a(); }
export {};
`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(11,73): error TS2322: Type 'number' is not assignable to type '1'.
        a.ts(12,70): error TS2322: Type 'number' is not assignable to type '2'.
        a.ts(13,60): error TS2322: Type 'number' is not assignable to type '3'.
        a.ts(15,58): error TS2322: Type 'unknown' is not assignable to type '2'.
        a.ts(16,48): error TS2322: Type 'unknown' is not assignable to type '3'."
      `);
    });

    test("constraint of a recursive conditional type", async () => {
      using dir = project({
        "a.ts": `
type Type = { values: string };
type FS<C extends Record<string, Type>, S> = S extends Type ? FS<C, C[keyof C]> : never;
type V<T extends Type> = T["values"];
function a1<C extends Record<string, Type>, P extends C, K extends keyof P>(a: V<FS<C, P[K]>>) { const t: string = a; }
function a2<C extends Record<string, Type>, P extends C>(a: V<FS<C, P[keyof P]>>) { const t: string = a; }
function a3<C extends Record<string, Type>>(a: V<FS<C, C[string]>>) { const t: string = a; }
function a4<C extends Record<string, Type>>(a: V<FS<C, C[keyof C]>>) { const t: string = a; }
function a5<C extends Record<string, Type>>(a: V<FS<C, Type>>) { const t: string = a; }
function p1<C extends Record<string, Type>>(a: FS<C, C[keyof C]>["values"]) { const s: string = a; }
function p4<C extends Record<string, Type>, P extends C>(a: FS<C, P[string]>["values"]) { const s: string = a; }
function r1<C extends Record<string, Type>>(a: FS<C, C[keyof C]>) { a.values; }
type Wrapped<T extends Type> = { values: T["values"] };
type FromObject<Context extends Record<string, Type>, Props extends Context, Shape extends Record<keyof Props, Type> = {
  [Key in keyof Props]: Wrapped<FS<Context, Props[Key]>>;
}> = Shape;
export {};
`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(6,91): error TS2322: Type 'V<FS<C, P[keyof P]>>' is not assignable to type 'string'.
          Type 'FS<C, P[string | number | symbol]>["values"]' is not assignable to type 'string'.
            Type 'FS<C, P[string]>["values"] | FS<C, P[number]>["values"] | FS<C, P[symbol]>["values"]' is not assignable to type 'string'.
              Type 'FS<C, P[string]>["values"]' is not assignable to type 'string'.
                Type 'FS<C, C[string]>["values"]' is not assignable to type 'string'.
                  Type 'FS<C, C[keyof C]>["values"]' is not assignable to type 'string'.
        a.ts(7,77): error TS2322: Type 'V<FS<C, C[string]>>' is not assignable to type 'string'.
          Type 'FS<C, C[keyof C]>["values"]' is not assignable to type 'string'.
        a.ts(8,78): error TS2322: Type 'V<FS<C, C[keyof C]>>' is not assignable to type 'string'.
          Type 'FS<C, C[string | number | symbol]>["values"]' is not assignable to type 'string'.
        a.ts(9,72): error TS2322: Type 'V<FS<C, C[keyof C]>>' is not assignable to type 'string'.
          Type 'FS<C, C[string | number | symbol]>["values"]' is not assignable to type 'string'.
        a.ts(10,48): error TS2536: Type '"values"' cannot be used to index type 'FS<C, C[keyof C]>'.
        a.ts(10,85): error TS2322: Type 'FS<C, C[keyof C]>["values"]' is not assignable to type 'string'.
          Type 'FS<C, C[string | number | symbol]>["values"]' is not assignable to type 'string'.
        a.ts(11,61): error TS2536: Type '"values"' cannot be used to index type 'FS<C, P[string]>'.
        a.ts(11,97): error TS2322: Type 'FS<C, P[string]>["values"]' is not assignable to type 'string'.
          Type 'FS<C, C[string]>["values"]' is not assignable to type 'string'.
            Type 'FS<C, C[keyof C]>["values"]' is not assignable to type 'string'.
        a.ts(12,71): error TS2339: Property 'values' does not exist on type 'FS<C, C[keyof C]>'."
      `);
    });

    test("members of a mapped type requested while they are being resolved", async () => {
      using dir = project({
        "a.ts": `
type Property<T> = T extends Doc ? T : Converted<T>;
type Converted<T> = T extends Record<string, any> ? { [K in keyof T]: Property<T[K]> } : T;
type RequireId<T> = T extends { _id?: infer U } ? T & { _id: U } : T & { _id: number };

declare class Schema<Raw = { [key: string]: { schema: number } }, Lean = RequireId<Converted<Raw>>> {
    lean: Lean;
}

declare class Doc {
    schema: Schema;
}

export declare const first: Schema;
export {};
`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toBe("");
    });

    test("the return type of a union call signature is resolved lazily", async () => {
      using dir = project({
        "a.ts": `
class Query<Row> {
  declare row: Row;
  where(filter: string): Both<Row | null> {
    return null!;
  }
  limit(n: number): Both<Row> {
    return null!;
  }
  #first(filter: string | undefined) {
    const scoped = filter === undefined ? this : this.where(filter);
    return scoped.limit(1).#tagged();
  }
  #tagged() {
    return this;
  }
}
type Both<Row> = Query<Row> & { extra: Row };
export {};
`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(7,21): error TS2577: Return type annotation circularly references itself.
        a.ts(10,3): error TS7023: '#first' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions."
      `);
    });

    test("`string & {}` keeps literal union members, however the empty type literal is spelled", async () => {
      using dir = project({
        "a.ts": `
type Empty = {};
declare const kept: "a" | (string & NonNullable<unknown>);
declare const lost: "a" | (string & Empty);
export const a: 1 = kept;
export const b: 1 = lost;
export const c: 1 = { icon: "gear" } satisfies { icon?: "gear" | (string & NonNullable<unknown>) };
`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(5,14): error TS2322: Type '"a" | (string & {})' is not assignable to type '1'.
          Type '"a"' is not assignable to type '1'.
        a.ts(6,14): error TS2322: Type 'string' is not assignable to type '1'.
        a.ts(7,14): error TS2322: Type '{ icon: "gear"; }' is not assignable to type '1'."
      `);
    });

    test("instantiations of one mapped type are ordered by creation in a union", async () => {
      using dir = project({
        "a.ts": `
type Flat<T> = { [K in keyof T]: T[K] } & {};
export type Early = typeof second;
declare const first: Flat<{ a: 1 }>;
declare const second: Flat<{ b: 1 }>;
export const x: 1 = null! as typeof first | typeof second;
`,
      });
      const { stdout } = await check(dir);
      expect(stdout.split("\n")[0]).toBe(
        "a.ts(6,14): error TS2322: Type '{ b: 1; } | { a: 1; }' is not assignable to type '1'.",
      );
    });

    test("a parameter annotation that depends on the parameter types of its own function", async () => {
      using dir = project({
        "a.ts": `
function f(a: ReturnType<typeof f>) {
  return a;
}
export {};
`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(2,12): error TS2502: 'a' is referenced directly or indirectly in its own type annotation."`,
      );
    });

    test("discriminant narrowing ignores union members whose constraint is never", async () => {
      using dir = project({
        "a.ts": `
type ValueOf<T, K extends keyof T = keyof T> = T[K];
type Tools = Record<string, { a: string }>;
type Denied<TOOLS extends Tools> = { type: "denied" } & ValueOf<{ [NAME in keyof TOOLS]: { type: "denied"; name: NAME } }>;
type Part<TOOLS extends Tools> = { type: "a"; id: string } | { type: "b" } | Denied<TOOLS>;
export function f<TOOLS extends Tools>(part: Exclude<Part<TOOLS>, { type: "denied" }>) {
  return part.type === "a" ? part.id : undefined;
}
export function g<N extends never>(part: { type: "a"; id: string } | { type: "b" } | N) {
  return part.type === "a" ? part.id : undefined;
}
`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toBe("");
    });

    test("a type assertion to an intersection with a deferred conditional type", async () => {
      using dir = project({
        "a.ts": `
type Output<O> = [O] extends [never] ? { a?: undefined } : { a: O };
export function f<O>(x: { t?: string } & { a: { code: number } }) {
  return x as { t?: string } & Output<O>;
}
`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toBe("");
    });

    // TypeScript keeps the variances it measures while one of them is still being measured, so they depend on which type of a cycle is
    // compared first. `tsc --singleThreaded` reports the error in model.ts only if global.ts is checked before it.
    describe("variances of mutually recursive types are measured in program order", () => {
      const files = {
        "directives.ts": `
export interface Binding<Value = any, Modifiers extends string = string> {
  value: Value;
  modifiers: Partial<Record<Modifiers, boolean>>;
  dir: ObjectDirective<any, Value, Modifiers>;
}
export type Hook<Host = any, Value = any, Modifiers extends string = string> = (
  el: Host,
  binding: Binding<Value, Modifiers>,
) => void;
export type SSRHook<Value = any, Modifiers extends string = string> = (
  binding: Binding<Value, Modifiers>,
) => object | undefined;
export interface ObjectDirective<Host = any, Value = any, Modifiers extends string = string> {
  __mod?: Modifiers;
  created?: Hook<Host, Value, Modifiers>;
  getSSRProps?: SSRHook<Value, Modifiers>;
}
export type FunctionDirective<Host = any, Value = any, Modifiers extends string = string> = Hook<Host, Value, Modifiers>;
export type Directive<Host = any, Value = any, Modifiers extends string = string> =
  | ObjectDirective<Host, Value, Modifiers>
  | FunctionDirective<Host, Value, Modifiers>;
`,
        "global.ts": `
import type { Directive } from "./directives";
declare function register(name: string, directive: Directive): void;
export function use<T>(directive: Directive<T, number>) {
  register("x", directive);
}
`,
        "model.ts": `
import type { ObjectDirective } from "./directives";
declare const select: ObjectDirective<{ s: 1 }, any, "number">;
declare const checkbox: ObjectDirective<{ c: 1 }>;
function pick(tag: string) {
  return tag === "SELECT" ? select : checkbox;
}
export const dynamic: ObjectDirective<{ s: 1 } | { c: 1 }> = {};
dynamic.getSSRProps = binding => {
  const model = pick("a");
  return model.getSSRProps ? model.getSSRProps(binding) : undefined;
};
`,
      };

      test.each([1, 8])("with the earlier file, on %d threads", async threads => {
        using dir = project(files);
        const { stdout } = await check(dir, ["--threads", String(threads)]);
        expect(stdout).toMatchInlineSnapshot(`
          "model.ts(11,48): error TS2345: Argument of type 'Binding<any, string>' is not assignable to parameter of type 'Binding<any, "number">'.
            Types of property 'dir' are incompatible.
              Type 'ObjectDirective<any, any, string>' is not assignable to type 'ObjectDirective<any, any, "number">'.
                Type 'string' is not assignable to type '"number"'."
        `);
      });

      test("without the earlier file", async () => {
        const { "global.ts": _, ...rest } = files;
        using dir = project(rest);
        const { stdout } = await check(dir);
        expect(stdout).toBe("");
      });
    });

    test("an intersection with a conditional type whose constraint is any", async () => {
      using dir = project({
        "a.ts": `
type Values = Record<string, any>;
type OptionsIfAvailable<T> = T extends { Options: infer O } ? O : any;
interface Model {
  Options: { x?: number };
}
interface Runnable<I, O> {
  invoke(input: I): O;
}
class Base {
  call(values: Values & { signal?: string; timeout?: number }): Values {
    return values;
  }
}
export class Chain<M extends Model | Runnable<string, string>> extends Base {
  call(values: Values & OptionsIfAvailable<M>): Values {
    return super.call(values);
  }
}
`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toBe("");
    });

    test("an inference from a string literal to keyof T that does not satisfy the constraint of T", async () => {
      // The object made up for the literal has no implicit index signature, so T is its constraint.
      using dir = project({
        "a.ts": `
type ToolSet = Record<string, { input: any }>;
type Call<T extends ToolSet> = { [N in keyof T]: { toolName: N & string; input: T[N]["input"] } }[keyof T];
type Step<T extends ToolSet> = { calls: Call<T>[] };
declare function has<T extends ToolSet>(...names: Array<keyof T | (string & {})>): (steps: Step<T>[]) => boolean;
declare const steps: Step<ToolSet>[];
has("weather")(steps);
export const wrong: number = has("weather");
`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(8,14): error TS2322: Type '(steps: Step<ToolSet>[]) => boolean' is not assignable to type 'number'."`,
      );
    });

    test("the members of a spread union of named unions are in the order of the named unions", async () => {
      using dir = project({
        "a.ts": `
type Out = { execute: () => void } | { execute?: never };
type Fn = Out & { type?: "function" };
type Dyn = Out & { type: "dynamic" };
declare const tool: Fn | Dyn;
export const wrong: number = { ...tool, kind: 1 };
`,
      });
      const { stdout } = await check(dir, ["--noErrorTruncation"]);
      expect(stdout.split("\n")[0]).toBe(
        `a.ts(6,14): error TS2322: Type '{ execute: () => void; type: "dynamic"; kind: number; } | { execute?: undefined; type: "dynamic"; kind: number; } | { execute: () => void; type?: "function" | undefined; kind: number; } | { execute?: undefined; type?: "function" | undefined; kind: number; }' is not assignable to type 'number'.`,
      );
    });

    const isolatedDeclarations = ["--declaration", "true", "--isolatedDeclarations", "true"];

    test("isolatedDeclarations: every property of `export default {} satisfies T` is reported", async () => {
      using dir = project({
        "satisfies.ts": `export default { list: ["x"], nested: { list: ["y"] } } satisfies object;
`,
      });
      const { stdout, exitCode } = await check(dir, isolatedDeclarations);
      expect(stdout).toMatchInlineSnapshot(`
        "satisfies.ts(1,24): error TS9017: Only const arrays can be inferred with --isolatedDeclarations.
        satisfies.ts(1,47): error TS9017: Only const arrays can be inferred with --isolatedDeclarations.
        satisfies.ts(1,57): error TS9037: Default exports can't be inferred with --isolatedDeclarations."
      `);
      expect(exitCode).toBe(1);
    });

    test("isolatedDeclarations: a method whose return type is circular needs an annotation", async () => {
      using dir = project({
        "recursive.ts": `export class Registry {
  static next(n: number) {
    if (n > 3) {
      return this.next(n - 1);
    }
    return n;
  }
}
`,
      });
      const { stdout, exitCode } = await check(dir, isolatedDeclarations);
      expect(stdout).toMatchInlineSnapshot(`
        "recursive.ts(2,10): error TS7023: 'next' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        recursive.ts(2,10): error TS9008: Method must have an explicit return type annotation with --isolatedDeclarations."
      `);
      expect(exitCode).toBe(1);
    });

    test("isolatedDeclarations: a property assigned to an overloaded function makes its value visible", async () => {
      using dir = project({
        "overloads.ts": `let hidden = new Date("");
export function create(): number;
export function create<T>(): T;
export function create() {
  return 1;
}
create.extra = hidden;
`,
      });
      const { stdout, exitCode } = await check(dir, isolatedDeclarations);
      expect(stdout).toMatchInlineSnapshot(`
        "overloads.ts(1,5): error TS9010: Variable must have an explicit type annotation with --isolatedDeclarations.
        overloads.ts(7,1): error TS9023: Assigning properties to functions without declaring them is not supported with --isolatedDeclarations. Add an explicit declaration for the properties assigned to this function."
      `);
      expect(exitCode).toBe(1);
    });

    test("isolatedDeclarations: a type inferred through a mapped type from a literal does not require widening", async () => {
      using dir = project({
        "reverse.ts": `interface Box<A> {
  a: A;
}
declare const str: Box<string>;
declare function struct<A>(p: { [K in keyof A]: Box<A[K]> }): Box<{ [K in keyof A]: A[K] }>;
export const outer = struct({ a: str, b: struct({ c: str }) });
`,
      });
      const { stdout, exitCode } = await check(dir, isolatedDeclarations);
      expect(stdout).toMatchInlineSnapshot(`
        "reverse.ts(6,14): error TS9010: Variable must have an explicit type annotation with --isolatedDeclarations.
        reverse.ts(6,34): error TS9013: Expression type can't be inferred with --isolatedDeclarations.
        reverse.ts(6,42): error TS9013: Expression type can't be inferred with --isolatedDeclarations.
        reverse.ts(6,54): error TS9013: Expression type can't be inferred with --isolatedDeclarations."
      `);
      expect(exitCode).toBe(1);
    });

    test("isolatedDeclarations: `exports.a = e` is an assignment to an expando, `module.exports = e` is not", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions":{"strict":true,"noEmit":true,"target":"esnext","module":"esnext","moduleResolution":"bundler","lib":["esnext"],"types":[],"skipLibCheck":true,"allowJs":true,"checkJs":true,"declaration":true,"isolatedDeclarations":true}}`,
        "lib.d.ts": `export declare function f(): number;
`,
        "properties.cjs": `const { f } = require("./lib");
exports.one = f();
module.exports.two = { n: f() };
`,
        "whole.cjs": `const { f } = require("./lib");
module.exports = { one: f() };
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "tsconfig.json(1,162): error TS5053: Option 'allowJs' cannot be specified with option 'isolatedDeclarations'.
        whole.cjs(2,1): error TS9013: Expression type can't be inferred with --isolatedDeclarations.
        whole.cjs(2,25): error TS9013: Expression type can't be inferred with --isolatedDeclarations."
      `);
      expect(exitCode).toBe(1);
    });

    test("isolatedDeclarations: a property of a mapped type has the declarations of the property it maps", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions":{"strict":true,"noEmit":true,"target":"esnext","module":"esnext","moduleResolution":"bundler","lib":["esnext"],"types":[],"skipLibCheck":true,"declaration":true,"isolatedDeclarations":true}}`,
        "a.ts": `type Infer<D> = D extends "number" ? number : D extends "string" ? string
  : D extends object ? { [K in keyof D]: Infer<D[K]> } : never;
declare function type<const D>(d: D): { t: Infer<D> };
export const T = type({ top: "number", deep: { first: "string", second: "number", third: "number" } });
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(4,14): error TS9010: Variable must have an explicit type annotation with --isolatedDeclarations.
        a.ts(4,73): error TS9013: Expression type can't be inferred with --isolatedDeclarations."
      `);
      expect(exitCode).toBe(1);
    });

    test("printing `[Symbol.iterator]` resolves the type of every variable in scope", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions":{"strict":true,"noEmit":true,"target":"esnext","module":"esnext","moduleResolution":"bundler","lib":["esnext"],"types":[],"skipLibCheck":true}}`,
        "a.ts": `export function f(key: any) {
  const chunks = { name: "b", [Symbol.iterator]() { return 1; } };
  const input = chunks[key];
  return input;
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,9): error TS7022: 'input' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(3,17): error TS7053: Element implicitly has an 'any' type because expression of type 'any' can't be used to index type '{ name: string; [Symbol.iterator](): number; }'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a generator with a return type annotation needs the global IterableIterator too", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions":{"strict":true,"noEmit":true,"target":"esnext","module":"esnext","moduleResolution":"bundler","lib":["es5"],"types":[],"skipLibCheck":true}}`,
        "a.ts": `interface Shape { x: number }
export function* sync(): Shape { yield 1; }
export async function* async(): Shape { yield 1; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "error TS2318: Cannot find global type 'AsyncIterableIterator'.
        error TS2318: Cannot find global type 'IterableIterator'.
        a.ts(2,26): error TS2741: Property 'x' is missing in type '{}' but required in type 'Shape'.
        a.ts(3,33): error TS2741: Property 'x' is missing in type '{}' but required in type 'Shape'."
      `);
      expect(exitCode).toBe(1);
    });

    // Two installed copies of one version of a package are one package: the second is redirected to the first.
    test("a redirected copy of a package is named through the links to the copy in the program", async () => {
      const store = (hash: string) => `node_modules/.pnpm/tsup@8.5.0_${hash}/node_modules/tsup`;
      const copy = (hash: string) => ({
        [`${store(hash)}/package.json`]: `{ "name": "tsup", "version": "8.5.0", "types": "./dist/index.d.ts" }
`,
        [`${store(hash)}/dist/index.d.ts`]: `export interface Options { entry?: string[] }
export declare function defineConfig(o: Options): Options;
`,
      });
      using dir = project({
        "tsconfig.json": `{ "compilerOptions": { "strict": true, "noEmit": true, "declaration": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true } }
`,
        ...copy("a"),
        ...copy("b"),
        "kit/a.ts": `import { defineConfig } from "tsup";
export default defineConfig({});
`,
        "orm/b.ts": `import { defineConfig } from "tsup";
export default defineConfig({});
`,
      });
      mkdirSync(join(String(dir), "kit/node_modules"), { recursive: true });
      symlinkSync(join(String(dir), store("a")), join(String(dir), "node_modules/tsup"), "junction");
      symlinkSync(join(String(dir), store("b")), join(String(dir), "kit/node_modules/tsup"), "junction");
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"orm/b.ts(2,1): error TS2883: The inferred type of 'default' cannot be named without a reference to 'Options' from '../kit/node_modules/tsup/dist'. This is likely not portable. A type annotation is necessary."`,
      );
      expect(exitCode).toBe(1);
    });

    test("a redirected copy of a package is named by the copy next to the importing file", async () => {
      const copy = (at: string) => ({
        [`${at}/node_modules/x/package.json`]: `{ "name": "x", "version": "1.0.0", "types": "./index.d.ts" }
`,
        [`${at}/node_modules/x/index.d.ts`]: `export interface Options { entry?: string[] }
export declare function defineConfig(o: Options): Options;
`,
        [`${at}/m.ts`]: `import { defineConfig } from "x";
export default defineConfig({});
export const c = defineConfig({});
`,
      });
      using dir = project({
        "tsconfig.json": `{ "compilerOptions": { "strict": true, "noEmit": true, "declaration": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true } }
`,
        ...copy("a"),
        ...copy("b"),
        "b/n.ts": `import { c } from "../a/m";
export const d = c;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    });

    test("a class has no construct signatures while its static index signatures are computed", async () => {
      using dir = project({
        "a.ts": `declare const first: any, second: any;
export class C {
  constructor(x: number) {}
  static [first]() {
    return 1;
  }
  static [second]() {
    return new C(1);
  }
  static plain() {
    return new C(1);
  }
}
export const made = new C(1);
`,
      });
      const { stdout, exitCode } = await check(dir);
      // The index signature is the union of the two methods. Reducing it infers their return types.
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(8,16): error TS2351: This expression is not constructable.
          Type 'typeof C' has no construct signatures."
      `);
      expect(exitCode).toBe(1);
    });

    test("patterns inherited through `extends` are relative to the extending file", async () => {
      using dir = project({
        "pkg/tsconfig.json": `{ "compilerOptions": { "noEmit": true, "types": [], "lib": ["esnext"] }, "exclude": ["dist", "__tests__"] }
`,
        "pkg/same.json": `{ "extends": "./tsconfig.json", "include": ["./missing.tsx"] }
`,
        "pkg/inner/parent.json": `{ "extends": "../tsconfig.json", "include": ["./missing.tsx"] }
`,
        "shared/base.json": `{ "compilerOptions": { "noEmit": true, "types": [], "lib": ["esnext"] }, "include": ["lib/none/*.ts"], "exclude": ["out/**/*"] }
`,
        "shared/deep/mid.json": `{ "extends": "../base.json" }
`,
        "pkg/chain.json": `{ "extends": "../shared/deep/mid.json" }
`,
      });
      const specified = async (config: string) => {
        const { stdout } = await check(dir, ["-p", config]);
        expect(stdout).toContain("error TS18003: No inputs were found in config file");
        return stdout.slice(stdout.indexOf("Specified"));
      };
      expect(await specified("pkg/same.json")).toBe(
        `Specified 'include' paths were '["./missing.tsx"]' and 'exclude' paths were '["dist","__tests__"]'.`,
      );
      expect(await specified("pkg/inner/parent.json")).toBe(
        `Specified 'include' paths were '["./missing.tsx"]' and 'exclude' paths were '["../dist","../__tests__"]'.`,
      );
      expect(await specified("pkg/chain.json")).toBe(
        `Specified 'include' paths were '["../shared/deep/../lib/none/*.ts"]' and 'exclude' paths were '["../shared/deep/../out/**/*"]'.`,
      );
    });

    test("two instantiations of an alias for a union are printed again, which counts towards the length limit", async () => {
      using dir = project({
        "a.ts": `type Base<I, O, C> = { input: I; output: O; context: C; execute?: () => void; needsApproval?: boolean; onInputAvailable?: () => void };
type FunctionTool<I, O, C> = Base<I, O, C> & { type?: "function" };
type DynamicTool<I, O, C> = Base<I, O, C> & { type: "dynamic" };
type DefinedTool<I, O, C> = Base<I, O, C> & { type: "defined"; id: string };
type ExecutedTool<I, O, C> = Base<I, O, C> & { type: "executed"; id: string };
type Tool<I = any, O = any, C = any> = FunctionTool<I, O, C> | DynamicTool<I, O, C> | DefinedTool<I, O, C> | ExecutedTool<I, O, C>;
type ToolSet = Record<string, (Tool<never, never, any> | Tool<any, any, any> | Tool<any, never, any> | Tool<never, any, any>) & Pick<Tool<any, any, any>, "execute" | "needsApproval" | "onInputAvailable">>;
declare const s: ToolSet;
export const n: number = s["x"];
export function f<T extends ToolSet[keyof ToolSet]>(t: T) { const p: number = t; return p; }
type U = { x: Tool<never, never, any> | Tool<any, any, any> | Tool<any, never, any> | Tool<never, any, any> };
declare const u: U;
export const q: number = u.x;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(9,14): error TS2322: Type '(Tool<any, any, any> | Tool<any, never, any> | Tool<...> | Tool<...>) & Pick<...>' is not assignable to type 'number'.
          Type 'Base<any, any, any> & { type?: "function" | undefined; } & Pick<Tool<any, any, any>, "execute" | "needsApproval" | "onInputAvailable">' is not assignable to type 'number'.
        a.ts(10,67): error TS2322: Type '(Tool<any, any, any> | Tool<any, never, any> | Tool<...> | Tool<...>) & Pick<...>' is not assignable to type 'number'.
          Type 'Base<any, any, any> & { type?: "function" | undefined; } & Pick<Tool<any, any, any>, "execute" | "needsApproval" | "onInputAvailable">' is not assignable to type 'number'.
        a.ts(13,14): error TS2322: Type 'Tool<any, any, any> | Tool<any, never, any> | Tool<...> | Tool<...>' is not assignable to type 'number'.
          Type 'DefinedTool<any, any, any>' is not assignable to type 'number'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an array in an object in an array that is explained is a tuple", async () => {
      using dir = project({
        "a.ts": `interface GError { message: string; path: ReadonlyArray<string | number>; locations: number; nodes: number; source: number; positions: number; a: 1; b: 1 }
declare function enqueue(chunk: { completed: { id: string; errors: GError[] }[]; hasNext: boolean }): void;
enqueue({ completed: [{ id: "0", errors: [{ message: "m", path: ["greeting", "recipient"] }] }], hasNext: false });
interface Case { codec: number; accepts: readonly unknown[]; rejects: readonly unknown[]; extra: number }
export const cases: Case[] = [{ codec: 1, accepts: ["a", "b"], rejects: [1, null, "x"] }];
export const nested: { x: { y: number[] }[] }[] = [{ x: [{ y: ["s"] }] }];
export const cond: { v: number[]; w: number }[] = [{ v: true ? [1, 2] : [3] }];
export const spread: { v: number[]; w: number }[] = [{ ...{ v: [1, 2] } }];
export const fn: { v: () => number[]; w: number }[] = [{ v: () => [1, 2] }];
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,43): error TS2740: Type '{ message: string; path: [string, string]; }' is missing the following properties from type 'GError': locations, nodes, source, positions, and 2 more.
        a.ts(5,31): error TS2741: Property 'extra' is missing in type '{ codec: number; accepts: [string, string]; rejects: [number, null, string]; }' but required in type 'Case'.
        a.ts(6,64): error TS2322: Type 'string' is not assignable to type 'number'.
        a.ts(7,52): error TS2741: Property 'w' is missing in type '{ v: [number] | [number, number]; }' but required in type '{ v: number[]; w: number; }'.
        a.ts(8,54): error TS2741: Property 'w' is missing in type '{ v: number[]; }' but required in type '{ v: number[]; w: number; }'.
        a.ts(9,56): error TS2741: Property 'w' is missing in type '{ v: () => number[]; }' but required in type '{ v: () => number[]; w: number; }'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a \`unique symbol\` that is no key of a type is named with its module", async () => {
      using dir = project({
        "a.ts": `import { KEY, NS, C } from "./lib/deep/keys";
import * as all from "./lib/deep/keys";
const LOCAL = Symbol("l");
declare const o: { a: number };
export const r1 = o[KEY];
export const r2 = o[NS.INNER];
export const r3 = o[C.S];
export const r4 = o[LOCAL];
export const r5 = o[all.KEY];
export const r6 = o[Symbol.iterator];
`,
        "lib/deep/keys.ts": `export const KEY = Symbol("k");
export namespace NS { export const INNER = Symbol("i"); }
export class C { static readonly S: unique symbol = Symbol("s"); }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(5,19): error TS7053: Element implicitly has an 'any' type because expression of type 'unique symbol' can't be used to index type '{ a: number; }'.
          Property '["./lib/deep/keys".KEY]' does not exist on type '{ a: number; }'.
        a.ts(6,19): error TS7053: Element implicitly has an 'any' type because expression of type 'unique symbol' can't be used to index type '{ a: number; }'.
          Property '["./lib/deep/keys".NS.INNER]' does not exist on type '{ a: number; }'.
        a.ts(7,19): error TS7053: Element implicitly has an 'any' type because expression of type 'unique symbol' can't be used to index type '{ a: number; }'.
          Property '["./lib/deep/keys".C.S]' does not exist on type '{ a: number; }'.
        a.ts(8,19): error TS7053: Element implicitly has an 'any' type because expression of type 'unique symbol' can't be used to index type '{ a: number; }'.
          Property '[LOCAL]' does not exist on type '{ a: number; }'.
        a.ts(9,19): error TS7053: Element implicitly has an 'any' type because expression of type 'unique symbol' can't be used to index type '{ a: number; }'.
          Property '["./lib/deep/keys".KEY]' does not exist on type '{ a: number; }'.
        a.ts(10,19): error TS7053: Element implicitly has an 'any' type because expression of type 'unique symbol' can't be used to index type '{ a: number; }'.
          Property '[SymbolConstructor.iterator]' does not exist on type '{ a: number; }'."
      `);
      expect(exitCode).toBe(1);
    });

    test("two types with one name are told apart by their modules", async () => {
      using dir = project({
        "a.ts": `import { use } from "one";
import { plugin, options } from "two";
import * as ts1 from "ns1";
import * as ts2 from "ns2";
use(plugin, options);
ts1.take(ts2.checker);
`,
        "node_modules/one/package.json": `{ "name": "one", "version": "1.0.0", "types": "index.d.ts" }
`,
        "node_modules/one/index.d.ts": `interface Plugin<A = any> { name: string; one: A }
type Option = Plugin | false;
export { type Plugin, type Option };
export declare function use(p: Plugin, o: Option[]): void;
`,
        "node_modules/two/package.json": `{ "name": "two", "version": "1.0.0", "types": "index.d.ts" }
`,
        "node_modules/two/index.d.ts": `interface Plugin<A = any> { name: string; two: A }
type Option = Plugin | false;
export { type Plugin, type Option };
export declare const plugin: Plugin;
export declare const options: Option[];
`,
        "node_modules/ns1/package.json": `{ "name": "ns1", "version": "1.0.0", "types": "index.d.ts" }
`,
        "node_modules/ns1/index.d.ts": `declare namespace ts { interface Checker { a: number } function take(c: Checker): void; }
export = ts;
`,
        "node_modules/ns2/package.json": `{ "name": "ns2", "version": "1.0.0", "types": "index.d.ts" }
`,
        "node_modules/ns2/index.d.ts": `declare namespace ts { interface Checker { b: number } const checker: Checker; }
export = ts;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout.replace(/import\("[^"]*\/node_modules\//g, 'import("')).toMatchInlineSnapshot(`
        "a.ts(5,5): error TS2741: Property 'one' is missing in type 'import("two/index").Plugin<any>' but required in type 'import("one/index").Plugin<any>'.
        a.ts(6,10): error TS2741: Property 'a' is missing in type 'import("ns2/index").Checker' but required in type 'import("ns1/index").Checker'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a well-known symbol is named without \`Symbol.\` where no declaration names it", async () => {
      using dir = project({
        "a.ts": `type S = { [Symbol.toStringTag]: string; [Symbol.iterator]?: number };
declare function asClause<T>(): { [K in keyof T as K]: "x" };
declare function byKeys<K extends PropertyKey>(): { [P in K]: "x" };
declare function homomorphic<T>(): { [K in keyof T]: "x" };
declare function exclude<T>(): { [K in Exclude<keyof T, "none">]: "x" };
export const a: number = asClause<S>();
export const b: number = byKeys<keyof S>();
export const c: number = homomorphic<S>();
export const d: number = exclude<S>();
export const e: number = byKeys<typeof Symbol.unscopables>();
export const f: number = asClause<string[]>();
declare const own: unique symbol;
export const g: number = byKeys<typeof own>();
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(6,14): error TS2322: Type '{ [Symbol.toStringTag]: "x"; [Symbol.iterator]?: "x" | undefined; }' is not assignable to type 'number'.
        a.ts(7,14): error TS2322: Type '{ [iterator]: "x"; [toStringTag]: "x"; }' is not assignable to type 'number'.
        a.ts(8,14): error TS2322: Type '{ [Symbol.toStringTag]: "x"; [Symbol.iterator]?: "x" | undefined; }' is not assignable to type 'number'.
        a.ts(9,14): error TS2322: Type '{ [iterator]: "x"; [toStringTag]: "x"; }' is not assignable to type 'number'.
        a.ts(10,14): error TS2322: Type '{ [unscopables]: "x"; }' is not assignable to type 'number'.
        a.ts(11,14): error TS2322: Type '{ [x: number]: "x"; length: "x"; toString: "x"; toLocaleString: "x"; pop: "x"; push: "x"; concat: "x"; join: "x"; reverse: "x"; shift: "x"; slice: "x"; sort: "x"; splice: "x"; unshift: "x"; indexOf: "x"; lastIndexOf: "x"; ... 25 more ...; with: "x"; }' is not assignable to type 'number'.
        a.ts(13,14): error TS2322: Type '{ [own]: "x"; }' is not assignable to type 'number'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an alias that does not use its type parameter is instantiated", async () => {
      using dir = project({
        "a.ts": `type H<T> = string | number;
declare const pair: H<1>[] & H<2>[];
export const y: boolean = pair;
type Brand<T> = number & {};
declare const brands: [Brand<"a">, Brand<"b">];
export const z: boolean = brands;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,14): error TS2322: Type 'H<1>[] & H<2>[]' is not assignable to type 'boolean'.
        a.ts(6,14): error TS2322: Type '[number, number]' is not assignable to type 'boolean'."
      `);
      expect(exitCode).toBe(1);
    });

    test("the type of an object literal with a spread is printed from the literal", async () => {
      using dir = project({
        "a.ts": `interface Many { adminAPIKey?: string | null | undefined; organization?: string | null | undefined; project?: string | null | undefined; webhookSecret?: string | null | undefined; baseURL?: string | null | undefined; p6?: number; p7?: number; p8?: number; p9?: number }
declare const many: Many;
declare const annotated: { f?: () => Promise<string>; g: (x: Map<string, number>) => void; h: Promise<string>; i: Array<Promise<string>> };
declare function take(x: { required: number; [key: string]: unknown }): void;
take({ last: annotated.f, ...many });
take({ last: annotated.g, ...many });
take({ last: annotated.h, ...many });
take({ last: annotated.i, ...many });
const inferred = () => Promise.resolve("s");
take({ last: inferred, ...many });
function generic<T>(): () => Promise<T> { return null!; }
take({ last: generic<string>(), ...many });
declare const literal: { adminAPIKey?: string | null | undefined; organization?: string | null | undefined; project?: string | null | undefined; webhookSecret?: string | null | undefined; baseURL?: string | null | undefined; p6?: number; p7?: number; p8?: number; p9?: number; last: Promise<string> };
take(literal);
declare const quoted: { kind: 'single'; other: Missing; method(x: Map<string, number>): Promise<string>; get acc(): Promise<string> };
take(quoted);
class K { adminAPIKey?: string | null | undefined; organization?: string | null | undefined; project?: string | null | undefined; webhookSecret?: string | null | undefined; baseURL?: string | null | undefined; p6?: number; p7?: number; p8?: number; p9?: number; last!: Promise<string> }
take({ ...new K() });
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(5,6): error TS2741: Property 'required' is missing in type '{ adminAPIKey?: string | null | undefined; organization?: string | null | undefined; project?: string | null | undefined; webhookSecret?: string | null | undefined; baseURL?: string | null | undefined; ... 4 more ...; last: (() => Promise<string>) | undefined; }' but required in type '{ [key: string]: unknown; required: number; }'.
        a.ts(6,6): error TS2741: Property 'required' is missing in type '{ adminAPIKey?: string | null | undefined; organization?: string | null | undefined; project?: string | null | undefined; webhookSecret?: string | null | undefined; baseURL?: string | null | undefined; ... 4 more ...; last: (x: Map<string, number>) => void; }' but required in type '{ [key: string]: unknown; required: number; }'.
        a.ts(7,6): error TS2741: Property 'required' is missing in type '{ adminAPIKey?: string | null | undefined; organization?: string | null | undefined; project?: string | null | undefined; webhookSecret?: string | null | undefined; baseURL?: string | null | undefined; ... 4 more ...; last: Promise<...>; }' but required in type '{ [key: string]: unknown; required: number; }'.
        a.ts(8,6): error TS2741: Property 'required' is missing in type '{ adminAPIKey?: string | null | undefined; organization?: string | null | undefined; project?: string | null | undefined; webhookSecret?: string | null | undefined; baseURL?: string | null | undefined; ... 4 more ...; last: Promise<...>[]; }' but required in type '{ [key: string]: unknown; required: number; }'.
        a.ts(10,6): error TS2741: Property 'required' is missing in type '{ adminAPIKey?: string | null | undefined; organization?: string | null | undefined; project?: string | null | undefined; webhookSecret?: string | null | undefined; baseURL?: string | null | undefined; ... 4 more ...; last: () => Promise<...>; }' but required in type '{ [key: string]: unknown; required: number; }'.
        a.ts(12,6): error TS2741: Property 'required' is missing in type '{ adminAPIKey?: string | null | undefined; organization?: string | null | undefined; project?: string | null | undefined; webhookSecret?: string | null | undefined; baseURL?: string | null | undefined; ... 4 more ...; last: () => Promise<...>; }' but required in type '{ [key: string]: unknown; required: number; }'.
        a.ts(14,6): error TS2741: Property 'required' is missing in type '{ adminAPIKey?: string | null | undefined; organization?: string | null | undefined; project?: string | null | undefined; webhookSecret?: string | null | undefined; baseURL?: string | null | undefined; ... 4 more ...; last: Promise<...>; }' but required in type '{ [key: string]: unknown; required: number; }'.
        a.ts(15,48): error TS2304: Cannot find name 'Missing'.
        a.ts(16,6): error TS2741: Property 'required' is missing in type '{ kind: "single"; other: Missing; method(x: Map<string, number>): Promise<string>; readonly acc: Promise<string>; }' but required in type '{ [key: string]: unknown; required: number; }'.
        a.ts(18,6): error TS2741: Property 'required' is missing in type '{ adminAPIKey?: string | null | undefined; organization?: string | null | undefined; project?: string | null | undefined; webhookSecret?: string | null | undefined; baseURL?: string | null | undefined; ... 4 more ...; last: Promise<string>; }' but required in type '{ [key: string]: unknown; required: number; }'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an aliased intersection with a class is named by its members where it is indexed", async () => {
      using dir = project({
        "a.ts": `class User { id = 1 }
declare const s1: unique symbol;
type Loaded<T> = T & {} & { [s1]?: T };
declare const u: Loaded<User>;
declare const k: any;
export const r1 = u[k];
type Plain<T> = T & { x: 1 };
declare const p: Plain<{ y: 2 }>;
export const r2 = p[k];
declare const q: Plain<User>;
export const r3 = q[k];
export const r4 = q["nope"];
export type T1 = Plain<User>["nope"];
export type T2 = Plain<User>[number];
export const r5 = q[0];
q["nope"] = 1;
declare const sym: unique symbol;
export const r6 = q[sym];
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(6,19): error TS7053: Element implicitly has an 'any' type because expression of type 'any' can't be used to index type 'User & { [s1]?: User | undefined; }'.
        a.ts(9,19): error TS7053: Element implicitly has an 'any' type because expression of type 'any' can't be used to index type 'Plain<{ y: 2; }>'.
        a.ts(11,19): error TS7053: Element implicitly has an 'any' type because expression of type 'any' can't be used to index type 'User & { x: 1; }'.
        a.ts(12,19): error TS7053: Element implicitly has an 'any' type because expression of type '"nope"' can't be used to index type 'User & { x: 1; }'.
          Property 'nope' does not exist on type 'User & { x: 1; }'.
        a.ts(13,30): error TS2339: Property 'nope' does not exist on type 'User & { x: 1; }'.
        a.ts(14,30): error TS2537: Type 'User & { x: 1; }' has no matching index signature for type 'number'.
        a.ts(15,19): error TS7053: Element implicitly has an 'any' type because expression of type '0' can't be used to index type 'User & { x: 1; }'.
          Property '0' does not exist on type 'User & { x: 1; }'.
        a.ts(16,1): error TS7053: Element implicitly has an 'any' type because expression of type '"nope"' can't be used to index type 'User & { x: 1; }'.
          Property 'nope' does not exist on type 'User & { x: 1; }'.
        a.ts(18,19): error TS7053: Element implicitly has an 'any' type because expression of type 'unique symbol' can't be used to index type 'User & { x: 1; }'.
          Property '[sym]' does not exist on type 'User & { x: 1; }'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a union of more than forty object types is reduced", async () => {
      using dir = project({
        "tsconfig.json": withResolveJsonModule,
        "a.ts": `import big from "./big.json";
export const b: number = big.versions[0][0];
`,
        "big.json": JSON.stringify({
          versions: Array.from({ length: 60 }, (_, i) => [`v${i}`, { chrome: `${i}`, firefox: "x" }]),
        }),
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,14): error TS2322: Type 'string | { chrome: string; firefox: string; }' is not assignable to type 'number'.
          Type 'string' is not assignable to type 'number'."
      `);
      expect(exitCode).toBe(1);
    });

    test("the type of a JSON file is printed from its text", async () => {
      using dir = project({
        "tsconfig.json": withResolveJsonModule,
        "a.ts": `import big from "./big.json";
export const a: number = big;
`,
        "big.json": JSON.stringify({
          env: { builtin: true },
          globals: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`global${i}`, "readonly"])),
          rules: { r1: "off" },
        }),
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(2,14): error TS2322: Type '{ env: { builtin: boolean; }; globals: { global0: string; global1: string; global2: string; global3: string; global4: string; global5: string; global6: string; global7: string; global8: string; global9: string; global10: string; global11: string; global12: string; global13: string; global14: string; global15: string...' is not assignable to type 'number'."`,
      );
      expect(exitCode).toBe(1);
    });

    test('the replacement suggested for `baseUrl: ".."` starts with `./`', async () => {
      using dir = project({
        "sub/tsconfig.json": `{ "compilerOptions": { "baseUrl": "..", "noEmit": true, "types": [], "lib": ["esnext"] }, "files": ["../a.ts"] }
`,
        "a.ts": `export const a = 1;
`,
      });
      const { stdout, exitCode } = await check(dir, ["-p", "sub/tsconfig.json"]);
      expect(stdout).toMatchInlineSnapshot(`
        "sub/tsconfig.json(1,24): error TS5102: Option 'baseUrl' has been removed. Please remove it from your configuration.
          Use '"paths": {"*": ["./../*"]}' instead."
      `);
      expect(exitCode).toBe(1);
    });

    test("an object literal is not printed from its text if an array in it has objects of several shapes", async () => {
      using dir = project({
        "tsconfig.json": withResolveJsonModule,
        "obj.json": `{ "obj": { "items": [{ "x": 12 }, { "x": 12, "y": 12 }, { "x": 0, "err": true }] } }
`,
        "obj.ts": `export const obj = { obj: { items: [{ x: 12 }, { x: 12, y: 12 }, { x: 0, err: true }] } };
`,
        "a.ts": `import j from "./obj.json";
import { obj } from "./obj";
export const a: number = j;
export const b: number = obj;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,14): error TS2322: Type '{ obj: { items: ({ x: number; y?: undefined; err?: undefined; } | { x: number; y: number; err?: undefined; } | { y?: undefined; x: number; err: boolean; })[]; }; }' is not assignable to type 'number'.
        a.ts(4,14): error TS2322: Type '{ obj: { items: ({ y?: undefined; err?: undefined; x: number; } | { err?: undefined; x: number; y: number; } | { y?: undefined; x: number; err: boolean; })[]; }; }' is not assignable to type 'number'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a file that is imported twice by one file has the second reason where the second import is", async () => {
      using dir = project({
        "tsconfig.json": `{ "compilerOptions": { "rootDir": "in", "outDir": "dist", "types": [], "lib": ["esnext"], "module": "esnext", "moduleResolution": "bundler" }, "include": ["in"] }
`,
        "in/main.ts": `import { a } from "../out/shared";
import { m } from "./middle";
import type { A } from "../out/shared";
import { l } from "./last";
export const x: A = a + m + l;
`,
        "in/middle.ts": `import { a } from "../out/shared";
export const m = a;
`,
        "in/last.ts": `import { a } from "../out/shared";
export const l = a;
`,
        "out/shared.ts": `export const a = 1;
export type A = number;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout.replaceAll("<dir>/", "")).toMatchInlineSnapshot(`
        "in/last.ts(1,19): error TS6059: File 'out/shared.ts' is not under 'rootDir' 'in'. 'rootDir' is expected to contain all source files.
          The file is in the program because:
            Imported via "../out/shared" from file 'in/last.ts'
            Imported via "../out/shared" from file 'in/main.ts'
            Imported via "../out/shared" from file 'in/middle.ts'
            Imported via "../out/shared" from file 'in/main.ts'"
      `);
      expect(exitCode).toBe(1);
    });

    test("a reference whose type arguments refer to it in a union is compared with its syntax", async () => {
      using dir = project({
        "tsconfig.json": `{ "compilerOptions": { "strict": true, "declaration": true, "emitDeclarationOnly": true, "outDir": "dist", "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true } }
`,
        "a.ts": `interface Box<T> {
  next: T;
}
type Rec = Box<Rec | string>;
declare function make(): Rec;
export const made = make();
export const list = [make()];
export const wrong: number = { a: make() };
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(8,14): error TS2322: Type '{ a: Rec; }' is not assignable to type 'number'."`,
      );
      expect(exitCode).toBe(1);
    });

    test("the default library of \`target: es5\` is lib.d.ts", async () => {
      using dir = project({
        "tsconfig.json": `{ "compilerOptions": { "target": "es5", "noEmit": true, "types": [] } }
`,
        "a.ts": `export const a = [1].length;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"tsconfig.json(1,34): error TS5108: Option 'target=ES5' has been removed. Please remove it from your configuration."`,
      );
      expect(exitCode).toBe(1);
    });

    test("the default library is checked without \`skipLibCheck\`", async () => {
      using dir = project({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, skipLibCheck: false },
        }),
        "globals.d.ts": `interface Array<T> {
  readonly length: number;
}
`,
        "a.ts": `export const a = 1;
`,
      });
      const { stdout, exitCode } = await check(dir);
      // In the order of the paths: the library is in node_modules.
      expect(stdout.replace(/^.*\/(lib\.[a-z0-9.]+\.d\.ts)\(\d+,\d+\)/gm, "$1(N,N)")).toMatchInlineSnapshot(`
        "globals.d.ts(2,12): error TS2687: All declarations of 'length' must have identical modifiers.
        lib.es5.d.ts(N,N): error TS2687: All declarations of 'length' must have identical modifiers."
      `);
      expect(exitCode).toBe(1);
    });

    test("a name that is printed from the text counts with the white space before it", async () => {
      using dir = project({
        "tsconfig.json": withResolveJsonModule,
        // The white space in it counts.
        "package.json": `{"exports": {"./entry0": {"types": "t", "default": "d"}, "./entry1": {"types": "t", "node": null, "default": "d"}, "./entry2": {"types": "t", "default": "d"}, "./entry3": {"types": "t", "default": "d"}, "./entry4": {"types": "t", "default": "d"}, "./entry5": {"types": "t", "default": "d"}, "./entry6": {"types": "t", "default": "d"}, "./entry7": {"types": "t", "default": "d"}, "./entry8": {"types": "t", "default": "d"}, "./entry9": {"types": "t", "default": "d"}, "./entry10": {"types": "t", "default": "d"}, "./entry11": {"types": "t", "default": "d"}, "./entry12": {"types": "t", "default": "d"}, "./entry13": {"types": "t", "default": "d"}}}`,
        "a.ts": `import json from "./package.json";
export const a: number = json.exports;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(2,14): error TS2322: Type '{ "./entry0": { types: string; default: string; }; "./entry1": { types: string; node: null; default: string; }; "./entry2": { types: string; default: string; }; "./entry3": { types: string; default: string; }; "./entry4": { types: string; default: string; }; "./entry5": { types: string; default: string; }; ... 7 mor...' is not assignable to type 'number'."`,
      );
      expect(exitCode).toBe(1);
    });

    test("the constraint of an inferred type is checked by the comparison in progress", async () => {
      using dir = project({
        "a.ts": `declare class One<T> {
  value: T;
  and<U extends One<any>>(other: U): One<[T, U]>;
  or<U extends One<any>>(other: U): One<T | U>;
}
declare class Two<T> {
  value: T;
  and<U extends Two<any>>(other: U): Two<[T, U]>;
  or<U extends Two<any>>(other: U): Two<T | U>;
}
declare const one: One<number>;
export const two: Two<number> = one;
export const wrong: Two<string> = one;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(13,14): error TS2322: Type 'One<number>' is not assignable to type 'Two<string>'.
          Types of property 'value' are incompatible.
            Type 'number' is not assignable to type 'string'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a parenthesized mapped type with type arguments in its key, after `|` or `&`", async () => {
      using dir = project({
        "types.ts": `type J<T, S> = string;
type P2<T, D> = string[];
export type C1<T> = 1 | ({ [P in J<P2<T, []>, '.'>]?: number });
export type C2<T> = 1 | ({ [P in J<P2<T, 1>, '.'>]?: number });
export type C3<T> = 1 | ({ [P in J<T, []>]?: number });
export type C4<T> = 1 | ({ [P in J<T, 1>]?: number });
export type C5<T> = 1 | ({ [P in string]?: number });
export type C6<T> = 1 | ({ [P in J<T, '.'>]: number });
export type C7<T> = 1 | ({ [P in keyof T]: number });
export type C8<T> = 1 & ({ [P in J<T, 1>]?: number });
export type C9 = 1 | ({ [k: string]: number });
export type D1 = 1 | ({ [P in J<1, 2>]: number });
export type After = 2;
`,
        "index.ts": `export type { C1, C2, C3, C4, C5, C6, C7, C8, C9, D1, After } from "./types";
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    });

    test("a constraint `typeof C<T>` is instantiated with what is inferred for `T`", async () => {
      using dir = project({
        "a.ts": `type Map1 = Record<string, (...args: any[]) => void>;
declare class N<T extends Map1 = Record<never, never>> { _m?: T; }
declare function reg<E extends Record<never, never>, M extends typeof N<E>>(m: M): M;
class Mine extends N {}
export const r1 = reg(Mine);
declare function reg2<E extends Map1, M extends typeof N<E>>(m: M): M;
export const r2 = reg2(Mine);
declare function reg3<E extends Map1>(m: typeof N<E>): E;
export const r3 = reg3(Mine);
declare class Box<T> { value: T; }
declare function same<T, C extends typeof Box<T>>(t: T, c: C): C;
class NumBox extends Box<number> {}
export const r4 = same(1, NumBox);
export const r5 = same("s", NumBox);
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(14,29): error TS2345: Argument of type 'typeof NumBox' is not assignable to parameter of type '{ new (): Box<string>; prototype: Box<any>; }'.
          Type 'NumBox' is not assignable to type 'Box<string>'.
            Type 'number' is not assignable to type 'string'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a mapped type over `T` is an array in the true branch of `T extends X[]`", async () => {
      using dir = project({
        "a.ts": `interface Z { z: 1 }
interface V { v: 1 }
type Conv<T> = T extends Z ? V : never;
type NeedsArray<A extends V[]> = A;
export type A1<T> = T extends Z[] ? NeedsArray<{ [I in keyof T]: T[I] extends Z ? Conv<T[I]> : never }> : never;
export type A2<T extends Z[]> = NeedsArray<{ [I in keyof T]: T[I] extends Z ? Conv<T[I]> : never }>;
export type A3<T> = T extends [infer A extends Z, ...infer Rest extends Z[]] ? NeedsArray<[Conv<A>, ...{ [K in keyof Rest]: Conv<Rest[K]> }]> : never;
export type A4<T> = T extends readonly Z[] ? NeedsArray<{ -readonly [I in keyof T]: V }> : never;
export type A5<T> = T extends Z[] ? { [I in keyof T]: V }["length"] : never;
export const n: A5<[Z, Z]> = 2;
export const r: A1<[Z, Z]> = [{ v: 1 }, { v: 1 }];
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    });

    test("an unknown option that is `null` is not reported", async () => {
      using dir = project({
        "tsconfig.json": `{
  "compilerOptions": {
    "noEmit": true,
    "types": [],
    "charset": null,
    "nonsense": null,
    "other": 1,
    "out": "x",
    "strict": null,
    "keyofStringsOnly": null
  },
  "unknownTop": null,
  "typeAcquisition": { "bogus": null }
}
`,
        "a.ts": `export const a = 1;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "console.d.ts(1,13): error TS2403: Subsequent variable declarations must have the same type.  Variable 'console' must be of type 'Console', but here has type '{ log(...args: unknown[]): void; }'.
        tsconfig.json(7,5): error TS5023: Unknown compiler option 'other'.
        tsconfig.json(8,5): error TS5023: Unknown compiler option 'out'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a protected member is accessible through `this` narrowed by `this is X`", async () => {
      using dir = project({
        "a.ts": `interface Resolved { readonly model: { id: string } }
export class Base {
  protected service = { create(id: string) { return id; } };
  model: { id: string } | undefined;
  isResolved(): this is Resolved { return !!this.model; }
  set(id: string) {
    if (!this.isResolved()) { return; }
    this.model.id = this.service.create(id);
  }
}
export class Derived<M> extends Base {
  protected other!: M;
  go() {
    if (this.isResolved()) { return [this.other, this.service]; }
    return [];
  }
}
export function outside(b: Base) {
  if (b.isResolved()) { b.service; }
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(19,27): error TS2445: Property 'service' is protected and only accessible within class 'Base' and its subclasses."`,
      );
      expect(exitCode).toBe(1);
    });

    test("a method of the contextual `this` that returns `never` ends the flow", async () => {
      using dir = project({
        "a.ts": `interface Context { skip(): never; retries(n: number): this; }
declare function setup(fn: (this: Context) => void): void;
declare function get(): string | undefined;
let host: string;
setup(function () {
  const target = get();
  if (!target) { this.skip(); }
  host = target;
});
setup(function <T>() {
  const target = get();
  if (!target) { this.skip(); }
  host = target;
});
export const o = {
  skip(): never { throw 0; },
  run() {
    const target = get();
    if (!target) { this.skip(); }
    host = target;
  },
};
export { host };
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(12,18): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.
        a.ts(13,3): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
          Type 'undefined' is not assignable to type 'string'.
        a.ts(20,5): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
          Type 'undefined' is not assignable to type 'string'."
      `);
      expect(exitCode).toBe(1);
    });

    test("the member of a union that is an instantiation of the same alias explains the error", async () => {
      using dir = project({
        "a.ts": `type Box<T> = { value: T };
declare let b: Box<boolean>;
export const x: Box<string> | Box<number> = b;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,14): error TS2322: Type 'Box<boolean>' is not assignable to type 'Box<string> | Box<number>'.
          Type 'Box<boolean>' is not assignable to type 'Box<string>'.
            Type 'boolean' is not assignable to type 'string'."
      `);
      expect(exitCode).toBe(1);
    });

    test("the type arguments of an interface merged with an imported value are checked", async () => {
      using dir = project({
        "main.ts": `import { A } from "./v";
interface A<T extends string> { x: T }
export let a: A<number>;
export const v = A;
`,
        "v.ts": `export const A = 1;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"main.ts(3,17): error TS2344: Type 'number' does not satisfy the constraint 'string'."`,
      );
      expect(exitCode).toBe(1);
    });

    test("an alias of a constant is not read-only for `delete`", async () => {
      using dir = project({
        "a.ts": `import * as ns from "./re";
delete ns.reexported;
delete ns.own;
`,
        "ns.ts": `export const c = 1;
`,
        "re.ts": `export { c as reexported } from "./ns";
export let own = 1;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,8): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(3,8): error TS2790: The operand of a 'delete' operator must be optional."
      `);
      expect(exitCode).toBe(1);
    });

    test("an error about a named function or class expression is at its name", async () => {
      using dir = project({
        "a.ts": `declare function on(cb: (x: number) => void): void;
on(function handler(x: string) {});
on(class Named {});
export const x: number = function () { return 1; };
export const y: number = function named() { return 1; };
export const z: number = class Klass {};
export function r(): number { return function inner() {}; }
export const arr: number[] = [function el() {}];
export const arrow = (): number => function body() {};
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,13): error TS2345: Argument of type '(x: string) => void' is not assignable to parameter of type '(x: number) => void'.
          Types of parameters 'x' and 'x' are incompatible.
            Type 'number' is not assignable to type 'string'.
        a.ts(3,10): error TS2345: Argument of type 'typeof Named' is not assignable to parameter of type '(x: number) => void'.
          Type 'typeof Named' provides no match for the signature '(x: number): void'.
        a.ts(4,14): error TS2322: Type '() => number' is not assignable to type 'number'.
        a.ts(5,35): error TS2322: Type '() => number' is not assignable to type 'number'.
        a.ts(6,14): error TS2322: Type 'typeof Klass' is not assignable to type 'number'.
        a.ts(7,31): error TS2322: Type '() => void' is not assignable to type 'number'.
        a.ts(8,40): error TS2322: Type '() => void' is not assignable to type 'number'.
        a.ts(9,45): error TS2322: Type '() => void' is not assignable to type 'number'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an element beyond the longest tuple of a union is not elaborated", async () => {
      using dir = project({
        "a.ts": `export const t: [number] | [number, string] = [1, "a", true];
export const u: [number] | [number, string] = [1, 2];
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,14): error TS2322: Type '[number, string, boolean]' is not assignable to type '[number] | [number, string]'.
          Type '[number, string, boolean]' is not assignable to type '[number, string]'.
            Source has 3 element(s) but target allows only 2.
        a.ts(2,51): error TS2322: Type 'number' is not assignable to type 'string'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an assertion method is found on a union whose members declare it once", async () => {
      using dir = project({
        "a.ts": `type Asserts = { isStr(v: unknown): asserts v is string };
declare const mapped: { [K in keyof Asserts]: Asserts[K] };
declare const union: Asserts | (Asserts & { x: 1 });
export function m(v: unknown) { mapped.isStr(v); return v.length; }
export function n(v: unknown) { union.isStr(v); return v.length; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    });

    test("a type argument is compared with its constraint as seen from that type: `this` in the constraint", async () => {
      using dir = project({
        "a.ts": `interface Comparable { compareTo: (o: this) => number }
class Num implements Comparable { v = 0; compareTo = (o: Num) => this.v - o.v; }
declare function max<T extends Comparable>(a: T, b: T): T;
export const a = max(new Num, new Num);
export const b = max<Num>(new Num, new Num);
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    });

    test("an empty array literal is a subtype of an array type with optional properties", async () => {
      using dir = project({
        "a.ts": `interface Tagged extends Array<number> { tag?: string }
declare const t: Tagged;
declare const c: boolean;
export const r = c ? [] : t;
export const tag = r.tag;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    });

    test("a callback keeps its contextual parameter types while the type of a loop is incomplete", async () => {
      using dir = project({
        "a.ts": `export function noLoop(names: readonly string[] | undefined) {
  if (!names) { return true; }
  if (names.every(a1 => a1.length > 0)) { return true; }
  return false;
}
export function notNarrowed(names: readonly string[]) {
  while (true) { if (names.every(a2 => a2.length > 0)) { return true; } }
}
export function noPredicate(names: readonly string[] | undefined) {
  if (!names) { return true; }
  while (true) { if (names.some(a3 => a3.length > 0)) { return true; } }
}
export function notACondition(names: readonly string[] | undefined) {
  if (!names) { return true; }
  while (true) { const ok = names.every(a4 => a4.length > 0); if (ok) { return true; } }
}
export function forOf(names: readonly string[] | undefined, xs: number[]) {
  if (!names) { return true; }
  for (const x of xs) { if (names.every(a5 => a5.length > x)) { return true; } }
  return false;
}
export function mutable(names: string[] | undefined) {
  if (!names) { return true; }
  while (true) { if (names.every(a6 => a6.length > 0)) { return true; } }
}
export function negated(names: string[] | undefined) {
  if (!names) { return true; }
  while (true) { if (!names.every(a7 => a7.length > 0)) { continue; } return 1; }
}
export function filterInLoop(names: (string | number)[] | undefined) {
  if (!names) { return true; }
  while (true) { if (names.filter(a8 => typeof a8 === "string").length) { return true; } }
}
declare function isStr(x: unknown, f: (v: string) => void): x is string;
export function ownGuard(v: string | number | undefined) {
  if (v === undefined) { return; }
  while (true) { if (isStr(v, a9 => a9.length)) { return v; } }
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    });

    test("an initializer that calls a single signature does not restart the analysis of a loop", async () => {
      using dir = project({
        "a.ts": `declare function deepEqual<T>(actual: unknown, expected: T): asserts actual is T;
declare const assert: { deepEqual<T>(actual: unknown, expected: T): asserts actual is T };
interface Session { run(): Promise<{ r: string }>; }
declare function open(): Promise<Session>;
export async function f(phases: string[]) {
  let session: Session | undefined;
  session = await open();
  for (const phase of phases) {
    if (phase !== "a") { session = await open(); }
    const one = await session.run();
    const two = await session.run();
    deepEqual({ results: [one, two].map(x => x.r) }, { results: ["s", "s"] });
  }
}
export async function g(phases: string[]) {
  let session: Session | undefined;
  session = await open();
  for (const phase of phases) {
    if (phase !== "a") { session = await open(); }
    const one = await session.run();
    assert.deepEqual(one, { r: "s" });
  }
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    });

    test("type arguments that violate a constraint leave `typeof C<T>` as `typeof C`", async () => {
      using dir = project({
        "a.ts": `declare class Msg { m: 1 }
declare class Res<T extends Msg = Msg> { req: T; constructor(req: T); }
type NeedsNumber<A extends number> = A;
export function bad<R extends typeof Res<string>>() { type X = NeedsNumber<R>; return null! as X; }
export function good<R extends typeof Res<Msg>>() { type X = NeedsNumber<R>; return null! as X; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(4,42): error TS2344: Type 'string' does not satisfy the constraint 'Msg'.
        a.ts(4,76): error TS2344: Type 'R' does not satisfy the constraint 'number'.
          Type 'typeof Res' is not assignable to type 'number'.
        a.ts(5,74): error TS2344: Type 'R' does not satisfy the constraint 'number'.
          Type 'typeof Res<Msg>' is not assignable to type 'number'."
      `);
      expect(exitCode).toBe(1);
    });

    test("the type arguments of an `extends` clause are compared with the constraint as it is", async () => {
      using dir = project({
        "a.ts": `declare class Emitter { on(event: string): this; }
declare class Dispatcher<T, Parent extends Scope> extends Emitter { object: T; parent: Parent | undefined; }
type Scope = Dispatcher<unknown, any>;
declare class Page extends Dispatcher<1, any> { page: 1; }
declare class Frame extends Dispatcher<2, any> { frame: 1; }
export class Handle<Parent extends Page | Frame = Page | Frame> extends Dispatcher<3, Parent> {}
export type Reference<Parent extends Page | Frame> = Dispatcher<3, Parent>;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    });

    test("an enum member as a condition is reported for a local enum, not for one that the module exports", async () => {
      using dir = project({
        "a.ts": `export const enum S { Before = -1, After = 1 }
export enum P { Zero = 0, One = 1 }
enum L { Zero = 0, One = 1 }
export const c1 = S.After ? 1 : 2;
export const c2 = P.Zero ? 1 : 2;
export const c3 = L.One ? 1 : 2;
if (P.One) { c1; }
if (L.One) { c1; }
export const c4 = L.One && 1;
namespace N { export enum E { A = 1 } export const inside = E.A ? 1 : 2; }
export const c5 = N.E.A ? 1 : 2;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(6,19): error TS2845: This condition will always return 'true'.
        a.ts(8,5): error TS2845: This condition will always return 'true'.
        a.ts(9,19): error TS2845: This condition will always return 'true'.
        a.ts(11,19): error TS2845: This condition will always return 'true'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a property is narrowed in a union that has a member with a template literal index signature", async () => {
      using dir = project({
        "a.ts": `type A = { k: "a"; v: string } | { k: "b"; v: number };
export function template(o: { readonly u: A } | { readonly [k: \`u\${string}\`]: A }) {
  const isA = o.u.k === "a";
  if (isA) { return o.u.v.length; }
  return 0;
}
export function mutableTemplate(o: { readonly u: A } | { [k: \`u\${string}\`]: A }) {
  const isA = o.u.k === "a";
  if (isA) { return o.u.v.length; }
  return 0;
}
export function stringIndex(o: { u: A } | { readonly [k: string]: A }) {
  const isA = o.u.k === "a";
  if (isA) { return o.u.v.length; }
  return 0;
}
export function getter(o: { get u(): A }) {
  const isA = o.u.k === "a";
  if (isA) { return o.u.v.length; }
  return 0;
}
class C { get u(): A { return null!; } }
export function classGetter(o: C) {
  const isA = o.u.k === "a";
  if (isA) { return o.u.v.length; }
  return 0;
}
export function tuple(o: readonly [A] | readonly [A, 1]) {
  const isA = o[0].k === "a";
  if (isA) { return o[0].v.length; }
  return 0;
}
export function arr(o: readonly [A] | readonly A[]) {
  const isA = o[0].k === "a";
  if (isA) { return o[0].v.length; }
  return 0;
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    });

    test("a discriminant that an index signature provides, under `noUncheckedIndexedAccess`", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "noUncheckedIndexedAccess": true}}`,
        "a.ts": `type U = { k: "a"; a: 1 } | { k: "b"; b: 1 } | { [x: string]: "c" | 1 };
export function f(o: U) {
  if (o.k === undefined) { const n: never = o; return n; }
  if (o.k !== undefined) { const n: never = o; return n; }
  return o;
}
type T = [k: "a", a: 1] | [k: "b"] | ["c", ...string[]];
export function g(o: T) {
  if (o[1] === undefined) { const n: never = o; return n; }
  if (o[1] === 1) { const n: never = o; return n; }
  return o;
}
type V = { k: "a"; a: 1 } | { k: "b"; b: 1 } | { [x: \`k\${string}\`]: "c" };
export function h(o: V) {
  if (o.k === "c") { const n: never = o; return n; }
  if (o.k === undefined) { const n: never = o; return n; }
  switch (o.k) { case "a": return o.a; case "b": return o.b; default: { const n: never = o; return n; } }
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(4,34): error TS2322: Type 'U' is not assignable to type 'never'.
          Type '{ k: "a"; a: 1; }' is not assignable to type 'never'.
        a.ts(9,35): error TS2322: Type 'T' is not assignable to type 'never'.
          Type '[k: "b"]' is not assignable to type 'never'.
        a.ts(10,27): error TS2322: Type 'T' is not assignable to type 'never'.
          Type '[k: "b"]' is not assignable to type 'never'.
        a.ts(15,28): error TS2322: Type '{ [x: \`k\${string}\`]: "c"; }' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("narrowing by `in`: a union with a member that reduces to `never`", async () => {
      using dir = project({
        "a.ts": `type A = { a: 1 }; type B = { b?: 2 }; type I = { [k: string]: 3 }; type P = { [k: \`a\${string}\`]: 4 };
declare const sym: unique symbol;
export function f1<T extends A | B>(x: T | I) { if ("a" in x) { const n: never = x; return n; } else { const n: never = x; return n; } }
export function f2<T extends A | I>(x: T | B) { if ("a" in x) { const n: never = x; return n; } else { const n: never = x; return n; } }
export function f3<T extends A | P>(x: T | B) { if ("a" in x) { const n: never = x; return n; } else { const n: never = x; return n; } }
export function f4(x: A | B | I | P) { if ("a" in x) { const n: never = x; return n; } else { const n: never = x; return n; } }
export function f5(x: A | B | I | P) { if (sym in x) { const n: never = x; return n; } else { const n: never = x; return n; } }
export function f6(x: A | B | (() => void)) { if ("call" in x) { const n: never = x; return n; } else { const n: never = x; return n; } }
export function f7(x: A | B) { if ("toString" in x) { const n: never = x; return n; } else { const n: never = x; return n; } }
class C { private a = 1; } class D { private a = 2; }
export function f8<T extends C | D>(x: T | B) { if ("a" in x) { const n: never = x; return n; } else { const n: never = x; return n; } }
const lit = Math.random() ? { a: 1 } : { c: 1 };
export function f9<T extends typeof lit>(x: T | B) { if ("a" in x) { const n: never = x; return n; } else { const n: never = x; return n; } }
export function f10(x: (A & { k: 1 } & { k: 2 }) | B | string[]) { if ("a" in x) { const n: never = x; return n; } else { const n: never = x; return n; } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,71): error TS2322: Type 'A | I' is not assignable to type 'never'.
          Type 'A' is not assignable to type 'never'.
        a.ts(3,110): error TS2322: Type 'B | I' is not assignable to type 'never'.
          Type 'B' is not assignable to type 'never'.
        a.ts(4,71): error TS2322: Type 'A | I' is not assignable to type 'never'.
          Type 'A' is not assignable to type 'never'.
        a.ts(4,110): error TS2322: Type 'B | I' is not assignable to type 'never'.
          Type 'B' is not assignable to type 'never'.
        a.ts(5,71): error TS2322: Type 'A | P' is not assignable to type 'never'.
          Type 'A' is not assignable to type 'never'.
        a.ts(5,110): error TS2322: Type 'B | P' is not assignable to type 'never'.
          Type 'B' is not assignable to type 'never'.
        a.ts(6,62): error TS2322: Type 'A | I | P' is not assignable to type 'never'.
          Type 'A' is not assignable to type 'never'.
        a.ts(6,101): error TS2322: Type 'B | I | P' is not assignable to type 'never'.
          Type 'B' is not assignable to type 'never'.
        a.ts(7,62): error TS2322: Type '(A | B | I | P) & Record<unique symbol, unknown>' is not assignable to type 'never'.
          Type 'A & Record<unique symbol, unknown>' is not assignable to type 'never'.
        a.ts(7,101): error TS2322: Type 'A | B | I | P' is not assignable to type 'never'.
          Type 'A' is not assignable to type 'never'.
        a.ts(8,72): error TS2322: Type '() => void' is not assignable to type 'never'.
        a.ts(8,111): error TS2322: Type 'A | B' is not assignable to type 'never'.
          Type 'A' is not assignable to type 'never'.
        a.ts(9,61): error TS2322: Type 'A | B' is not assignable to type 'never'.
          Type 'A' is not assignable to type 'never'.
        a.ts(11,71): error TS2322: Type 'C | D' is not assignable to type 'never'.
          Type 'C' is not assignable to type 'never'.
        a.ts(11,110): error TS2322: Type 'B' is not assignable to type 'never'.
        a.ts(13,76): error TS2322: Type '{ a: number; c?: undefined; } | { a?: undefined; c: number; }' is not assignable to type 'never'.
          Type '{ a: number; c?: undefined; }' is not assignable to type 'never'.
        a.ts(13,115): error TS2322: Type 'B | { a?: undefined; c: number; }' is not assignable to type 'never'.
          Type 'B' is not assignable to type 'never'.
        a.ts(14,90): error TS2322: Type '(string[] & Record<"a", unknown>) | (B & Record<"a", unknown>)' is not assignable to type 'never'.
          Type 'string[] & Record<"a", unknown>' is not assignable to type 'never'.
        a.ts(14,129): error TS2322: Type 'string[] | B' is not assignable to type 'never'.
          Type 'string[]' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a default in a destructuring assignment removes `undefined` from a type parameter", async () => {
      using dir = project({
        "a.ts": `export function f<T extends string | undefined>(o: { a: T }, p: [T]) {
  let x: string | number | undefined;
  let y: string | number | undefined;
  ({ a: x = 1 } = o);
  const n1: never = x;
  [y = 1] = p;
  const n2: never = y;
  return [n1, n2];
}
export function g(o: { a: void | number | undefined }) {
  let x: string | number | void | undefined;
  ({ a: x = "s" } = o);
  const n1: never = x;
  return n1;
}
export function h<T extends string | undefined>(o: { a: T }) {
  let { a: x = 1 }: { a?: string | number | T } = o;
  const n1: never = x;
  x = 2;
  return n1;
}
export function i<T extends number | undefined, U extends T>(o: { a: U | null }) {
  let x: number | string | null | undefined;
  ({ a: x = "s" } = o);
  const n1: never = x;
  return n1;
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(5,9): error TS2322: Type 'string | number' is not assignable to type 'never'.
          Type 'string' is not assignable to type 'never'.
        a.ts(7,9): error TS2322: Type 'string | number' is not assignable to type 'never'.
          Type 'string' is not assignable to type 'never'.
        a.ts(13,9): error TS2322: Type 'string | number' is not assignable to type 'never'.
          Type 'string' is not assignable to type 'never'.
        a.ts(18,9): error TS2322: Type 'string | number' is not assignable to type 'never'.
          Type 'string' is not assignable to type 'never'.
        a.ts(25,9): error TS2322: Type 'string | number | null' is not assignable to type 'never'.
          Type 'null' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a default in a destructuring assignment removes `undefined` next to `void`", async () => {
      using dir = project({
        "a.ts": `export function plain(o: { x?: string }, p: [string?]) {
  let x: string | number | undefined;
  ({ x = 1 } = o);
  const n1: never = x;
  [x = 2] = p;
  const n2: never = x;
  for ({ x = 3 } of [o]) { const n3: never = x; n3; }
  return [n1, n2];
}
export function generic<T extends string | undefined>(o: { x: T }) {
  let x: string | number | undefined;
  ({ x = 1 } = o);
  const n1: never = x;
  for ({ x = 3 } of [o]) { const n3: never = x; n3; }
  const { x: y = 1 } = o;
  const n4: never = y;
  return [n1, n4];
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(4,9): error TS2322: Type 'string | number' is not assignable to type 'never'.
          Type 'string' is not assignable to type 'never'.
        a.ts(6,9): error TS2322: Type 'string | number' is not assignable to type 'never'.
          Type 'string' is not assignable to type 'never'.
        a.ts(7,34): error TS2322: Type 'string | number' is not assignable to type 'never'.
          Type 'string' is not assignable to type 'never'.
        a.ts(13,9): error TS2322: Type 'string | number' is not assignable to type 'never'.
          Type 'string' is not assignable to type 'never'.
        a.ts(14,34): error TS2322: Type 'string | number' is not assignable to type 'never'.
          Type 'string' is not assignable to type 'never'.
        a.ts(16,9): error TS2322: Type 'string | 1' is not assignable to type 'never'.
          Type 'string' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an empty object literal with expando members is not an empty object type in an intersection", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "a.js": `const o = {};
o.x = 1;
o.y = "s";
/** @template T @param {T} t @returns {T & typeof o} */
function both(t) { return /** @type {any} */ (t); }
export const r1 = both("s");
/** @type {never} */
export const n1 = r1;
/** @type {never} */
export const n2 = Math.random() ? o : 1;
/** @param {string | typeof o | null | undefined} v */
export function f(v) {
  /** @type {never} */
  const n = v;
  if (v != null) { /** @type {never} */ const m = v; return m; }
  return n;
}
/** @type {never} */
export const n3 = /** @type {string & typeof o} */ (/** @type {any} */ (1));
/** @type {never} */
export const n4 = /** @type {(undefined | null | typeof o)} */ (/** @type {any} */ (1));
/** @template T @param {T} t @returns {NonNullable<T> & typeof o} */
function nn(t) { return /** @type {any} */ (t); }
/** @type {never} */
export const n5 = nn(/** @type {string | undefined} */ ("s"));
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.js(8,14): error TS2322: Type '"s" & { x: number; y: string; }' is not assignable to type 'never'.
        a.js(10,14): error TS2322: Type '1 | { x: number; y: string; }' is not assignable to type 'never'.
          Type '1' is not assignable to type 'never'.
        a.js(14,9): error TS2322: Type 'string | { x: number; y: string; } | null | undefined' is not assignable to type 'never'.
          Type 'undefined' is not assignable to type 'never'.
        a.js(19,14): error TS2322: Type 'string & { x: number; y: string; }' is not assignable to type 'never'.
        a.js(21,14): error TS2322: Type '{ x: number; y: string; } | null | undefined' is not assignable to type 'never'.
          Type 'undefined' is not assignable to type 'never'.
        a.js(25,14): error TS2322: Type 'string & { x: number; y: string; }' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("narrowing to a literal keeps only the generic template literal member of a union", async () => {
      using dir = project({
        "a.ts": `declare function isAb(v: unknown): v is "ab";
declare function isK(v: unknown): v is "k";
export function f<T extends string>(x: \`a\${T}\` | { k: 1 }) {
  if (isAb(x)) { const n: never = x; return n; }
  return x;
}
export function g<T extends string>(x: Uppercase<T> | { k: 1 }) {
  if (isAb(x)) { const n: never = x; return n; }
  return x;
}
export function h<T extends { k: 1 }>(x: keyof T | { k: 1 }) {
  if (isK(x)) { const n: never = x; return n; }
  return x;
}
export function i<T extends string>(x: (\`a\${T}\` & { tag: 1 }) | { k: 1 }) {
  if (isAb(x)) { const n: never = x; return n; }
  return x;
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(4,24): error TS2322: Type '\`a\${T}\` & "ab"' is not assignable to type 'never'.
        a.ts(8,24): error TS2322: Type '({ k: 1; } | Uppercase<T>) & "ab"' is not assignable to type 'never'.
          Type '{ k: 1; } & "ab"' is not assignable to type 'never'.
        a.ts(12,23): error TS2322: Type '"k"' is not assignable to type 'never'.
        a.ts(16,24): error TS2322: Type '({ k: 1; } | (\`a\${T}\` & { tag: 1; })) & "ab"' is not assignable to type 'never'.
          Type '{ k: 1; } & "ab"' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a type guard that is a member of the narrowed reference, after the member itself was narrowed", async () => {
      using dir = project({
        "a.ts": `type G = (v: unknown) => v is { a: 1 };
export function byTypeof(x: { m: string | G; a?: 1 }) {
  if (typeof x.m === "function" && x.m(x)) { const n: never = x; return n; }
  return x;
}
export function byTypeofEarly(x: { m: string | G; a?: 1 }) {
  if (typeof x.m !== "function") return 0;
  if (x.m(x)) { const n: never = x; return n; }
  return x;
}
export function byAssignment(x: { m: string | G; a?: 1 }, g: G) {
  x.m = g;
  if (x.m(x)) { const n: never = x; return n; }
  return x;
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,52): error TS2322: Type '{ m: string | G; a?: 1 | undefined; } & { a: 1; }' is not assignable to type 'never'.
        a.ts(8,23): error TS2322: Type '{ m: string | G; a?: 1 | undefined; } & { a: 1; }' is not assignable to type 'never'.
        a.ts(13,23): error TS2322: Type '{ m: string | G; a?: 1 | undefined; } & { a: 1; }' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("narrowing survives a `finally` block with a sequence of `if` statements", async () => {
      using dir = project({
        "a.ts": `declare function work(): void;
declare const c: boolean;
export function f(input: { v: string } | undefined) {
  const data = input;
  if (!data) { throw new Error("missing"); }
  let n = 0;
  try {
    work();
  } finally {
    if (c) { n = 0; } if (c) { n = 1; } if (c) { n = 2; } if (c) { n = 3; }
    if (c) { n = 4; } if (c) { n = 5; } if (c) { n = 6; } if (c) { n = 7; }
    if (c) { n = 8; } if (c) { n = 9; } if (c) { n = 10; } if (c) { n = 11; }
    if (c) { n = 12; } if (c) { n = 13; } if (c) { n = 14; } if (c) { n = 15; }
    if (c) { n = 16; } if (c) { n = 17; } if (c) { n = 18; } if (c) { n = 19; }
    if (c) { n = 20; } if (c) { n = 21; } if (c) { n = 22; } if (c) { n = 23; }
    if (c) { n = 24; } if (c) { n = 25; } if (c) { n = 26; } if (c) { n = 27; }
  }
  return data.v + n;
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    });

    test("a shared flow node in a `finally` block has the type of its first visit", async () => {
      using dir = project({
        "a.ts": `declare const c: boolean;
declare function work(): void;
export function iife(x: string | number) {
  (() => {
    try {
      if (typeof x === "string") return;
      work();
    } finally {
      if (c) { work(); }
    }
  })();
  const n: never = x;
  return n;
}
export function iifeOtherOrder(x: string | number) {
  (() => {
    try {
      if (typeof x !== "string") { work(); } else { return; }
    } finally {
      if (c) { work(); }
      if (c) { work(); }
    }
  })();
  const n: never = x;
  return n;
}
export class K {
  v: string | number;
  constructor(x: string | number) {
    this.v = x;
    try {
      if (typeof x === "string") return;
      this.v = 1;
    } finally {
      if (c) { work(); }
    }
    const n: never = x;
  }
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(12,9): error TS2322: Type 'string' is not assignable to type 'never'.
        a.ts(24,9): error TS2322: Type 'string' is not assignable to type 'never'.
        a.ts(37,11): error TS2322: Type 'number' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a numeric property name is not applicable to a `${number}` index signature", async () => {
      using dir = project({
        "a.ts": `type T = { [k: \`\${number}\`]: string };
const a = { 0: 1 };
export const t1: T = a;
const b = { "0": 1 };
export const t2: T = b;
type U = { [k: \`a\${string}\`]: string };
const c = { ab: 1, b: 2 };
export const u1: U = c;
declare function f<V>(o: { [k: \`\${number}\`]: V }): V;
export const r1 = f({ 0: 1, "1": "s" });
export const n1: number = r1;
interface I { [k: \`\${number}\`]: string }
interface J extends I { 0: number }
interface K extends I { "0": number }
export type X = [J, K];
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(5,14): error TS2322: Type '{ "0": number; }' is not assignable to type 'T'.
          Property '"0"' is incompatible with index signature.
            Type 'number' is not assignable to type 'string'.
        a.ts(8,14): error TS2322: Type '{ ab: number; b: number; }' is not assignable to type 'U'.
          Property 'ab' is incompatible with index signature.
            Type 'number' is not assignable to type 'string'.
        a.ts(11,14): error TS2322: Type 'string' is not assignable to type 'number'.
        a.ts(14,25): error TS2411: Property '"0"' of type 'number' is not assignable to '\`\${number}\`' index type 'string'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an optional property that includes `void` against an index signature", async () => {
      using dir = project({
        "a.ts": `declare const o: { a?: void | number };
export const r: { [k: string]: number } = o;
declare const p: { a?: number };
export const s: { [k: string]: number } = p;
export function f<T extends number | undefined>(q: { a?: T }) {
  const t: { [k: string]: number } = q;
  return t;
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(6,9): error TS2322: Type '{ a?: T | undefined; }' is not assignable to type '{ [k: string]: number; }'.
          Property 'a' is incompatible with index signature.
            Type 'T' is not assignable to type 'number'.
              Type 'number | undefined' is not assignable to type 'number'.
                Type 'undefined' is not assignable to type 'number'."
      `);
      expect(exitCode).toBe(1);
    });

    test("the suggestion for a misspelled property breaks ties in declaration order", async () => {
      using dir = project({
        "a.ts": `interface Base { valuea: number }
interface Derived extends Base { valueb: number }
export const d: Derived = { valuea: 1, valueb: 2, value: 3 };
interface Late extends Early { countb: number }
interface Early { counta: number }
export const l: Late = { counta: 1, countb: 2, count: 3 };
type Both = { titleb: number } & { titlea: number };
export const b: Both = { titlea: 1, titleb: 2, title: 3 };
declare class K { constructor(); widthb: number; widtha: number }
export const k: K = { widtha: 1, widthb: 2, width: 3 };
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,51): error TS2561: Object literal may only specify known properties, but 'value' does not exist in type 'Derived'. Did you mean to write 'valuea'?
        a.ts(6,48): error TS2561: Object literal may only specify known properties, but 'count' does not exist in type 'Late'. Did you mean to write 'countb'?
        a.ts(8,48): error TS2561: Object literal may only specify known properties, but 'title' does not exist in type 'Both'. Did you mean to write 'titleb'?
        a.ts(10,45): error TS2561: Object literal may only specify known properties, but 'width' does not exist in type 'K'. Did you mean to write 'widthb'?"
      `);
      expect(exitCode).toBe(1);
    });

    test("a mapped type takes `readonly` from a property of `Function`", async () => {
      using dir = project({
        "a.ts": `type A = { x?: number; y: string };
type B = { x: number; y: string };
type P = Pick<A | B, "x">;
export const p: P = {};
type C = { readonly z: number } | { z: number };
type Q = Pick<C, "z">;
declare const q: Q;
q.z = 1;
type F = Pick<() => void, "name" | "length">;
declare const f: F;
f.name = "a";
f.length = 1;
type O = Pick<{ a: 1 }, never> & { [K in "toString"]: {}[K] };
declare const o: O;
export const s: number = o.toString;
type I = Pick<{ a?: 1 } & { a: 1 | 2; b?: 2 }, "a" | "b">;
export const i: I = {};
type S = Pick<string, "length">;
declare const ss: S;
ss.length = 2;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(8,3): error TS2540: Cannot assign to 'z' because it is a read-only property.
        a.ts(9,27): error TS2344: Type '"length" | "name"' does not satisfy the constraint 'never'.
          Type '"length"' is not assignable to type 'never'.
        a.ts(11,3): error TS2540: Cannot assign to 'name' because it is a read-only property.
        a.ts(12,3): error TS2540: Cannot assign to 'length' because it is a read-only property.
        a.ts(13,55): error TS2536: Type 'K' cannot be used to index type '{}'.
        a.ts(15,14): error TS2322: Type '() => string' is not assignable to type 'number'.
        a.ts(17,14): error TS2741: Property 'a' is missing in type '{}' but required in type 'I'.
        a.ts(20,4): error TS2540: Cannot assign to 'length' because it is a read-only property."
      `);
      expect(exitCode).toBe(1);
    });

    test("an assertion to a union is explained by the member that the comparison in progress selects", async () => {
      using dir = project({
        "a.ts": `type U = { k: "a"; x: number } | { k: 1; x: string };
declare const s: { k: string; x: boolean };
export const u = s as U;
type V = { k: 1; x: string } | { k: "a"; x: number };
export const v = s as V;
declare const t: U;
export const same = s === t;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,18): error TS2352: Conversion of type '{ k: string; x: boolean; }' to type 'U' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
          Type '{ k: string; x: boolean; }' is not comparable to type '{ k: "a"; x: number; }'.
            Types of property 'x' are incompatible.
              Type 'boolean' is not comparable to type 'number'.
        a.ts(5,18): error TS2352: Conversion of type '{ k: string; x: boolean; }' to type 'V' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
          Type '{ k: string; x: boolean; }' is not comparable to type '{ k: "a"; x: number; }'.
            Types of property 'x' are incompatible.
              Type 'boolean' is not comparable to type 'number'.
        a.ts(7,21): error TS2367: This comparison appears to be unintentional because the types '{ k: string; x: boolean; }' and 'U' have no overlap."
      `);
      expect(exitCode).toBe(1);
    });

    test("a method found through `Function`, `Object` or a union is not narrowed by an assignment", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "exactOptionalPropertyTypes": true, "noUncheckedIndexedAccess": true}}`,
        "a.ts": `declare let u: { a?: number } | { a?: string };
export const r1: number | string = u.a;
export function f1() { u.a = 1; const x: number = u.a; return x; }
export function f2() { if (u.a !== undefined) { const x: number | string = u.a; return x; } return 0; }
declare let v: { a?: number; m(): void } | { a?: number; m(): void };
export function f3() { v.a = undefined; }
export function f4() { v["a"] = undefined; const y: number = v["a"]; return y; }
declare let fn: () => void;
export function f5() { fn.call = fn.call; const c = fn.bind; return c; }
declare let w: { readonly a?: number } | { a?: number };
export function f6() { w.a = 1; delete w.a; }
declare let i: { a?: number } & { b?: string };
export function f7() { i.a = undefined; i.b = undefined; const z: number = i.a; return z; }
declare let un: { [k: string]: number } | { a?: number };
export function f8() { const q: number = un.a; un.a = undefined; return q; }
declare let arr: number[] | string[];
export function f9() { arr.length = 1; const l: number = arr.length; arr[0] = undefined; return l; }
class C { x?: number; static s?: string; }
declare let cu: C | { x?: string };
export function f10() { cu.x = undefined; C.s = undefined; let t = cu.x; t = undefined; return t; }
`,
        "b.ts": `declare let fn: () => void;
export function g1() { if (!fn.bind) { const n: never = fn.bind; return n; } return 0; }
declare let o: { m(): void };
export function g2() { if (!o.m) { const n: never = o.m; return n; } return 0; }
declare let obj: { x: 1 };
export function g3() { if (!obj.toString) { const n: never = obj.toString; return n; } return 0; }
declare let uo: { m(): void } | { m(): string };
export function g4() { if (!uo.m) { const n: never = uo.m; return n; } return 0; }
declare let same: { m(): void; a: 1 } | { m(): void; a: 2 };
export function g5() { if (!same.m) { const n: never = same.m; return n; } return 0; }
interface I { m(): void }
declare let si: (I & { a: 1 }) | (I & { a: 2 });
export function g6() { if (!si.m) { const n: never = si.m; return n; } return 0; }
export function g7() { if (typeof fn.name !== "string") { const n: never = fn.name; return n; } return 0; }
export function g8(s: string) { if (!s.charAt) { const n: never = s.charAt; return n; } return 0; }
export function g9() { if (!fn["bind"]) { const n: never = fn["bind"]; return n; } return 0; }
export function g10() { if (!si["m"]) { const n: never = si["m"]; return n; } return 0; }
export function g11() { if (!uo["m"]) { const n: never = uo["m"]; return n; } return 0; }
export function g12() { if (!o["m"]) { const n: never = o["m"]; return n; } return 0; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,14): error TS2322: Type 'string | number | undefined' is not assignable to type 'string | number'.
          Type 'undefined' is not assignable to type 'string | number'.
        a.ts(6,24): error TS2412: Type 'undefined' is not assignable to type 'number' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the type of the target.
        a.ts(7,24): error TS2322: Type 'undefined' is not assignable to type 'number'.
        a.ts(7,50): error TS2322: Type 'undefined' is not assignable to type 'number'.
        a.ts(11,26): error TS2540: Cannot assign to 'a' because it is a read-only property.
        a.ts(11,40): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(13,24): error TS2412: Type 'undefined' is not assignable to type 'number' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the type of the target.
        a.ts(13,41): error TS2412: Type 'undefined' is not assignable to type 'string' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the type of the target.
        a.ts(13,64): error TS2322: Type 'undefined' is not assignable to type 'number'.
        a.ts(15,30): error TS2322: Type 'number | undefined' is not assignable to type 'number'.
          Type 'undefined' is not assignable to type 'number'.
        a.ts(15,48): error TS2412: Type 'undefined' is not assignable to type 'number' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the type of the target.
        a.ts(17,70): error TS2322: Type 'undefined' is not assignable to type 'string | number'.
        a.ts(20,25): error TS2412: Type 'undefined' is not assignable to type 'string | number' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the type of the target.
        a.ts(20,43): error TS2412: Type 'undefined' is not assignable to type 'string' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the type of the target.
        b.ts(2,46): error TS2322: Type '{ <T>(this: T, thisArg: ThisParameterType<T>): OmitThisParameter<T>; <T, A extends any[], B extends any[], R>(this: (this: T, ...args: [...A, ...B]) => R, thisArg: T, ...args: A): (...args: B) => R; }' is not assignable to type 'never'.
        b.ts(4,42): error TS2322: Type '() => void' is not assignable to type 'never'.
        b.ts(6,51): error TS2322: Type '() => string' is not assignable to type 'never'.
        b.ts(13,43): error TS2322: Type '() => void' is not assignable to type 'never'.
        b.ts(15,56): error TS2322: Type '(pos: number) => string' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("`await (x as P)` as an initializer has the type of the assertion", async () => {
      using dir = project({
        "a.ts": `declare function wrap<T>(f: () => T): T;
declare const o: { m(f: () => number): number; n: { k(f: () => number): string } } | undefined;
export async function a1() {
  const v = await (wrap(() => v) as Promise<number>);
  return v;
}
export function a2() {
  const v = o?.m(() => v ?? 1);
  return v;
}
export function a3() {
  const v = o?.n.k(() => v ? 1 : 2);
  return v;
}
export function a4() {
  const v = (wrap(() => v) as number);
  return v;
}
export function a5() {
  const v = <number>wrap(() => v);
  return v;
}
export function a6(xs: number[]) {
  let s: number | string = 1;
  for (const x of xs) {
    const w = s === (wrap(() => w) as number) ? 1 : x;
    s = w;
  }
}
export function a7() {
  const v = o!.m(() => v);
  return v;
}
`,
        "b.ts": `declare function wrap<T>(f: () => T): T;
declare function id<T>(x: T): T;
export async function b1(xs: number[]) {
  let s: number | string = 1;
  for (const x of xs) {
    s = await (id(s) as Promise<number>);
    s = x;
  }
  return s;
}
export function b2(xs: number[]) {
  let s: number | string | undefined;
  for (const x of xs) {
    const t = [id(s) as number][0];
    const u = { p: id(t) as string }.p;
    s = x ? t : u;
  }
  return s;
}
export function b3(k: 1 | 2 | 3) {
  const v = k === (wrap(() => v) as 1) ? 1 : 2;
  switch (k) { case (wrap(() => w) as 2): break; }
  const w = 1;
  return v;
}
export async function b4() {
  const a = await (await (wrap(() => a) as Promise<Promise<number>>));
  const b = await <Promise<string>>wrap(() => b);
  const c = (await (wrap(() => c) as Promise<boolean>))!;
  return [a, b, c];
}
export class K { p = await0(wrap(() => this.p) as number); q = wrap(() => this.q) as string; }
declare function await0(n: number): number;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(4,20): error TS2352: Conversion of type 'number' to type 'Promise<number>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
        a.ts(8,9): error TS7022: 'v' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,18): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(12,9): error TS7022: 'v' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,20): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(26,11): error TS7022: 'w' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        b.ts(6,16): error TS2352: Conversion of type 'number' to type 'Promise<number>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
        b.ts(15,20): error TS2352: Conversion of type 'number' to type 'string' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
        b.ts(21,9): error TS7022: 'v' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        b.ts(21,25): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        b.ts(27,27): error TS2352: Conversion of type 'number' to type 'Promise<Promise<number>>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
        b.ts(28,19): error TS2352: Conversion of type 'string' to type 'Promise<string>' may be a mistake because neither type sufficiently overlaps with the other. If this was intentional, convert the expression to 'unknown' first.
        b.ts(29,9): error TS7022: 'c' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        b.ts(29,26): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions."
      `);
      expect(exitCode).toBe(1);
    });

    test("a constraint is circular through a conditional type, a template literal or a string mapping", async () => {
      using dir = project({
        "a.ts": `export function f1<T extends U, U extends T>(t: T, u: U) { t.x; u.x; const a: U = t; return a; }
export function f2<T extends T["a"]>(t: T) { return t.a; }
export function f3<T extends keyof T>(t: T) { const s: string | number | symbol = t; return s; }
export function f4<T extends U["a"], U extends { a: T }>(t: T, u: U) { const z: U["a"] = t; return [z, u.a]; }
export function f5<T extends (T extends string ? 1 : 2)>(t: T) { const n: number = t; return n; }
export function f6<T extends U | string, U extends T | number>(t: T) { const n: string | number = t; return n; }
export function f7<T extends U & { a: 1 }, U extends T & { b: 1 }>(t: T) { return [t.a, t.b]; }
export type A1<T extends A1<T>> = T;
export interface I1<T extends I1<T>["x"]> { x: T }
export function f8<T extends \`\${T & string}x\`>(t: T) { const s: string = t; return s; }
export function f9<T extends [T]>(t: T) { return t[0][0]; }
export function f10<T extends Uppercase<T & string>>(t: T) { const s: string = t; return s; }
export class C<T extends C<T>["p"]> { p!: T; m(t: T) { return t.q; } }
`,
        "b.ts": `type Check<X> = X extends string ? 1 : 2;
type Boxed<X> = [X] extends [string] ? 1 : 2;
type Tpl<X extends string> = \`\${X}x\`;
export function h1<T extends Check<T>>(t: T) { const n: number = t; return n; }
export function h2<T extends Boxed<T>>(t: T) { const n: number = t; return n; }
export function h3<T extends Tpl<T & string>>(t: T) { const s: string = t; return s; }
export function h4<T extends Check<U>, U extends T>(t: T, u: U) { const n: number = t; const m: number = u; return [n, m]; }
export function h5<T extends Check<U>, U extends string>(t: T) { const n: number = t; return n; }
export function h6<T extends Check<T[]>>(t: T) { const n: number = t; return n; }
export function h7<T extends Check<keyof T>>(t: T) { const n: number = t; return n; }
export function h8<T extends \`a\${U}\`, U extends \`b\${T}\`>(t: T, u: U) { const s: string = t; const r: string = u; return [s, r]; }
export function h9<T extends Capitalize<U>, U extends string>(t: T) { const s: string = t; return s; }
export function h10<T extends { a: Check<T> }>(t: T) { const n: number = t.a; return n; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,30): error TS2313: Type parameter 'T' has a circular constraint.
        a.ts(1,43): error TS2313: Type parameter 'U' has a circular constraint.
        a.ts(1,62): error TS2339: Property 'x' does not exist on type 'T'.
        a.ts(1,67): error TS2339: Property 'x' does not exist on type 'U'.
        a.ts(1,76): error TS2322: Type 'T' is not assignable to type 'U'.
          'U' could be instantiated with an arbitrary type which could be unrelated to 'T'.
        a.ts(2,30): error TS2313: Type parameter 'T' has a circular constraint.
        a.ts(2,30): error TS2536: Type '"a"' cannot be used to index type 'T'.
        a.ts(2,55): error TS2339: Property 'a' does not exist on type 'T'.
        a.ts(4,30): error TS2313: Type parameter 'T' has a circular constraint.
        a.ts(5,30): error TS2313: Type parameter 'T' has a circular constraint.
        a.ts(5,72): error TS2322: Type 'T' is not assignable to type 'number'.
        a.ts(6,30): error TS2313: Type parameter 'T' has a circular constraint.
        a.ts(6,52): error TS2313: Type parameter 'U' has a circular constraint.
        a.ts(6,78): error TS2322: Type 'T' is not assignable to type 'string | number'.
        a.ts(7,30): error TS2313: Type parameter 'T' has a circular constraint.
        a.ts(7,54): error TS2313: Type parameter 'U' has a circular constraint.
        a.ts(7,86): error TS2339: Property 'a' does not exist on type 'T'.
        a.ts(7,91): error TS2339: Property 'b' does not exist on type 'T'.
        a.ts(8,26): error TS2313: Type parameter 'T' has a circular constraint.
        a.ts(9,31): error TS2313: Type parameter 'T' has a circular constraint.
        a.ts(10,30): error TS2313: Type parameter 'T' has a circular constraint.
        a.ts(10,62): error TS2322: Type 'T' is not assignable to type 'string'.
        a.ts(12,31): error TS2313: Type parameter 'T' has a circular constraint.
        a.ts(12,68): error TS2322: Type 'T' is not assignable to type 'string'.
        a.ts(13,26): error TS2313: Type parameter 'T' has a circular constraint.
        a.ts(13,65): error TS2339: Property 'q' does not exist on type 'T'.
        b.ts(4,30): error TS2313: Type parameter 'T' has a circular constraint.
        b.ts(4,54): error TS2322: Type 'T' is not assignable to type 'number'.
        b.ts(6,30): error TS2313: Type parameter 'T' has a circular constraint.
        b.ts(6,61): error TS2322: Type 'T' is not assignable to type 'string'.
        b.ts(7,30): error TS2313: Type parameter 'T' has a circular constraint.
        b.ts(7,50): error TS2313: Type parameter 'U' has a circular constraint.
        b.ts(7,73): error TS2322: Type 'T' is not assignable to type 'number'.
        b.ts(7,94): error TS2322: Type 'U' is not assignable to type 'number'.
        b.ts(11,30): error TS2313: Type parameter 'T' has a circular constraint.
        b.ts(11,34): error TS2322: Type 'U' is not assignable to type 'string | number | bigint | boolean | null | undefined'.
        b.ts(11,49): error TS2313: Type parameter 'U' has a circular constraint.
        b.ts(11,53): error TS2322: Type 'T' is not assignable to type 'string | number | bigint | boolean | null | undefined'.
        b.ts(11,78): error TS2322: Type 'T' is not assignable to type 'string'.
        b.ts(11,99): error TS2322: Type 'U' is not assignable to type 'string'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a position beyond the fixed elements of a variadic rest parameter is an indexed access type", async () => {
      using dir = project({
        "a.ts": `export function f1<A extends unknown[]>(cb: (...args: [number, ...A, string]) => void) {
  const g: (a: number, b: boolean, c: string) => void = cb;
  const h: (a: string) => void = cb;
  cb(1, "s"); cb(1);
  return [g, h];
}
export function f2<A extends unknown[]>(cb: (...args: [...A, string]) => void, other: (x: number, y: string) => void) {
  cb = other; other = cb;
  const p: Parameters<typeof cb>[0] = 1;
  return p;
}
declare function take<A extends unknown[]>(f: (...args: [...A, number]) => void, cb: (...args: [...A, number]) => void): A;
export const t1 = take((a: string, b: number) => {}, (x, y) => { x.length; y.toFixed(); });
export const t2 = take((a: string, b: number) => {}, (x, y, z) => { z; });
export function f3<A extends [string, ...number[]]>(cb: (...args: A) => void) {
  const g: (a: string, b: number) => void = cb; const h: (a: number) => void = cb;
  cb("a", 1); cb(1);
  return [g, h];
}
export function f4<A extends unknown[], B extends unknown[]>(x: (...args: [...A, ...B]) => void, y: (...args: [...B, ...A]) => void) { x = y; return (a: 1, b: 2) => x(a, b); }
export function f5<T extends readonly unknown[]>(fn: (first: boolean, ...rest: [...T, number]) => void) {
  fn(true, 1); const q: (f: boolean, a: string, n: number) => void = fn; const cbk: typeof fn = (f, a, b) => { f; a; b; };
  return [q, cbk];
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,9): error TS2322: Type '(...args: [number, ...A, string]) => void' is not assignable to type '(a: number, b: boolean, c: string) => void'.
          Types of parameters 'args' and 'b' are incompatible.
            Type '[b: boolean, c: string]' is not assignable to type '[...A, string]'.
              Source provides no match for variadic element at position 0 in target.
        a.ts(3,9): error TS2322: Type '(...args: [number, ...A, string]) => void' is not assignable to type '(a: string) => void'.
          Types of parameters 'args_0' and 'a' are incompatible.
            Type '[a: string]' is not assignable to type '[number, ...A, string]'.
              Source has 1 element(s) but target requires 3.
        a.ts(4,9): error TS2345: Argument of type '["s"]' is not assignable to parameter of type '[...A, string]'.
          Source has 1 element(s) but target requires 2.
        a.ts(4,15): error TS2345: Argument of type '[]' is not assignable to parameter of type '[...A, string]'.
          Source has 0 element(s) but target requires 2.
        a.ts(8,3): error TS2322: Type '(x: number, y: string) => void' is not assignable to type '(...args: [...A, string]) => void'.
          Types of parameters 'x' and 'args' are incompatible.
            Type '[...A, string]' is not assignable to type '[x: number, y: string]'.
              Type '[...unknown[], string]' is not assignable to type '[x: number, y: string]'.
                Target requires 2 element(s) but source may have fewer.
        a.ts(8,15): error TS2322: Type '(...args: [...A, string]) => void' is not assignable to type '(x: number, y: string) => void'.
          Types of parameters 'args' and 'x' are incompatible.
            Type '[x: number, y: string]' is not assignable to type '[...A, string]'.
              Source provides no match for variadic element at position 0 in target.
        a.ts(14,54): error TS2345: Argument of type '(x: string, y: number, z: [...A, number][2]) => void' is not assignable to parameter of type '(a: string, args_1: number) => void'.
          Target signature provides too few arguments. Expected 3 or more, but got 2.
        a.ts(16,9): error TS2322: Type '(...args: A) => void' is not assignable to type '(a: string, b: number) => void'.
          Types of parameters 'args' and 'a' are incompatible.
            Type '[a: string, b: number]' is not assignable to type 'A'.
              '[a: string, b: number]' is assignable to the constraint of type 'A', but 'A' could be instantiated with a different subtype of constraint '[string, ...number[]]'.
        a.ts(16,55): error TS2322: Type '(...args: A) => void' is not assignable to type '(a: number) => void'.
          Types of parameters 'args' and 'a' are incompatible.
            Type '[a: number]' is not assignable to type 'A'.
              'A' could be instantiated with an arbitrary type which could be unrelated to '[a: number]'.
        a.ts(17,6): error TS2345: Argument of type '["a", 1]' is not assignable to parameter of type 'A'.
          '["a", 1]' is assignable to the constraint of type 'A', but 'A' could be instantiated with a different subtype of constraint '[string, ...number[]]'.
        a.ts(17,18): error TS2345: Argument of type '[number]' is not assignable to parameter of type 'A'.
          'A' could be instantiated with an arbitrary type which could be unrelated to '[number]'.
        a.ts(20,136): error TS2322: Type '(...args: [...B, ...A]) => void' is not assignable to type '(...args: [...A, ...B]) => void'.
          Types of parameters 'args' and 'args' are incompatible.
            Type '[...A, ...B]' is not assignable to type '[...B, ...A]'.
              Type at position 0 in source is not compatible with type at position 0 in target.
                Type 'A' is not assignable to type 'B'.
                  'A' is assignable to the constraint of type 'B', but 'B' could be instantiated with a different subtype of constraint 'unknown[]'.
        a.ts(20,168): error TS2345: Argument of type '[1, 2]' is not assignable to parameter of type '[...A, ...B]'.
          Source provides no match for variadic element at position 0 in target.
        a.ts(22,12): error TS2345: Argument of type '[1]' is not assignable to parameter of type '[...T, number]'.
          Source has 1 element(s) but target requires 2.
        a.ts(22,22): error TS2322: Type '(first: boolean, ...rest: [...T, number]) => void' is not assignable to type '(f: boolean, a: string, n: number) => void'.
          Types of parameters 'rest' and 'a' are incompatible.
            Type '[a: string, n: number]' is not assignable to type '[...T, number]'.
              Source provides no match for variadic element at position 0 in target.
        a.ts(22,80): error TS2322: Type '(f: boolean, a: number | T[number], b: [...T, number][1]) => void' is not assignable to type '(first: boolean, ...rest: [...T, number]) => void'.
          Types of parameters 'a' and 'rest' are incompatible.
            Type '[...T, number]' is not assignable to type '[a: number | T[number], b: [...T, number][1]]'.
              Type '[...unknown[], number]' is not assignable to type '[a: number | T[number], b: [...T, number][1]]'.
                Target requires 2 element(s) but source may have fewer."
      `);
      expect(exitCode).toBe(1);
    });

    test("the position of an error about a function, a class or a `satisfies` expression as an operand", async () => {
      using dir = project({
        "a.ts": `declare let n: number;
declare const o: { [k: string]: number };
if (function f1() {}) { n; }
for (const x of function f2() {}) { x; }
export const s1 = [...function f3() {}];
delete function f4() {};
export const m1 = 1 * function f5() {};
export const m2 = function f6() {} * 1;
export const i1 = function f7() {} in {};
switch (n) { case function f8() {}: break; }
export function* g1(): Generator<number> { yield function f9() {}; }
class A1 extends function f10() {} {}
export const e1 = o[function f11() {}];
export const c1 = function f12() {} ? 1 : 2;
export const c2 = function f13() {} ?? 1;
export const c3 = !function f14() {};
export const m3 = 1 * class K1 {};
export const e2 = o[class K2 {}];
for (const x of class K3 {}) { x; }
export const c4 = class K4 {} ? 1 : 2;
export const i2 = class K5 {} in {};
export const i3 = 1 instanceof function f15() {};
export const i4 = {} instanceof (1 satisfies number);
export const m4 = 1 * ("a" satisfies string);
export const e3 = o[{} satisfies {}];
declare function va(...a: number[]): void;
va(...function f16() {});
export const t1 = function f17() {}\`x\`;
export const n1 = new function f18() {}();
export const a2 = async () => { for await (const y of function f19() {}) { y; } };
export const u1 = -class K6 {};
export const u2 = function f20() {}++;
export { A1 };
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,14): error TS2872: This kind of expression is always truthy.
        a.ts(4,26): error TS2488: Type '() => void' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(5,32): error TS2488: Type '() => void' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(6,17): error TS2703: The operand of a 'delete' operator must be a property reference.
        a.ts(7,32): error TS2363: The right-hand side of an arithmetic operation must be of type 'any', 'number', 'bigint' or an enum type.
        a.ts(8,28): error TS2362: The left-hand side of an arithmetic operation must be of type 'any', 'number', 'bigint' or an enum type.
        a.ts(9,28): error TS2322: Type '() => void' is not assignable to type 'string | number | symbol'.
        a.ts(10,28): error TS2678: Type '() => void' is not comparable to type 'number'.
        a.ts(11,59): error TS2322: Type '() => void' is not assignable to type 'number'.
        a.ts(12,27): error TS2507: Type '() => void' is not a constructor function type.
        a.ts(13,30): error TS2538: Type '() => void' cannot be used as an index type.
        a.ts(14,28): error TS2872: This kind of expression is always truthy.
        a.ts(15,28): error TS2869: Right operand of ?? is unreachable because the left operand is never nullish.
        a.ts(16,29): error TS2872: This kind of expression is always truthy.
        a.ts(17,29): error TS2363: The right-hand side of an arithmetic operation must be of type 'any', 'number', 'bigint' or an enum type.
        a.ts(18,27): error TS2538: Type 'typeof K2' cannot be used as an index type.
        a.ts(19,23): error TS2488: Type 'typeof K3' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(20,25): error TS2872: This kind of expression is always truthy.
        a.ts(21,25): error TS2322: Type 'typeof K5' is not assignable to type 'string | number | symbol'.
        a.ts(22,19): error TS2358: The left-hand side of an 'instanceof' expression must be of type 'any', an object type or a type parameter.
        a.ts(23,33): error TS2359: The right-hand side of an 'instanceof' expression must be either of type 'any', a class, function, or other type assignable to the 'Function' interface type, or an object type with a 'Symbol.hasInstance' method.
        a.ts(24,23): error TS2363: The right-hand side of an arithmetic operation must be of type 'any', 'number', 'bigint' or an enum type.
        a.ts(25,24): error TS2538: Type '{}' cannot be used as an index type.
        a.ts(27,16): error TS2488: Type '() => void' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(28,36): error TS2554: Expected 0 arguments, but got 1.
        a.ts(29,19): error TS7009: 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.
        a.ts(30,64): error TS2504: Type '() => void' must have a '[Symbol.asyncIterator]()' method that returns an async iterator.
        a.ts(32,28): error TS2356: An arithmetic operand must be of type 'any', 'number', 'bigint' or an enum type."
      `);
      expect(exitCode).toBe(1);
    });

    test("the suggestion for a misspelled name breaks ties in program order", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true}, "files": ["a.ts"]}`,
        "a.ts": `/// <reference path="./b.ts" />
var longNameA = 1;
interface Thing { propertyA: number }
longNameX;
declare const t: Thing;
t.propertyX;
`,
        "b.ts": `var longNameB = 2;
interface Thing { propertyB: number }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(4,1): error TS2552: Cannot find name 'longNameX'. Did you mean 'longNameB'?
        a.ts(6,3): error TS2551: Property 'propertyX' does not exist on type 'Thing'. Did you mean 'propertyB'?"
      `);
      expect(exitCode).toBe(1);
    });

    test("an indexed access into a mapped type with a remapped key", async () => {
      using dir = project({
        "a.ts": `type M<T extends string> = { [K in "a" | "b" as \`\${K}\${T}\`]: K };
export type A1<T extends string> = M<T>[\`a\${T}\`];
export type A2<T extends string> = M<T>[\`c\${T}\`];
type R<T> = { [K in keyof T as \`get\${K & string}\`]: T[K] };
export type A3<T> = R<T>[\`get\${keyof T & string}\`];
export type A4<T, K extends keyof T> = R<T>[K];
type F<T extends string, U> = { [K in T as K extends U ? K : never]: K };
export type A5<T extends string, U> = F<T, U>[T];
type G<T extends string> = { [K in T as \`x\${K}\`]: K };
export type A6<T extends string> = G<T>[\`x\${T}\`];
export type A7<T extends string> = G<T>[T];
export type A8<T extends string> = G<T | "q">["xq"];
export type C1<T, K> = T[K extends keyof T ? K : never];
export type C2<T, K extends string> = T[K extends keyof T ? K : never];
export type C5<T, K> = T[K extends keyof T ? K : keyof T];
export type C6<T, K> = T[K extends string ? K : never];
export type C7<T, K, U extends keyof T> = T[K extends U ? K : never];
class P1 { private x = 1; a = 1 }
class P2 { private x = 2; b = 1 }
export type C3<T extends P1 & P2> = T["zzz"];
export type C4<T extends P1 & P2, K extends string> = T[K];
export function f<T extends P1 & P2, K extends string>(t: T, k: K) { return t[k]; }
`,
        "b.ts": `export type D1<T extends { k: "a" } & { k: "b" }> = T["zzz"];
export type D2<T extends { k: "a" } & { k: "b" }, K extends string> = T[K];
class Q1 { private x = 1; }
class Q2 { private x = 2; }
interface I1 extends Q1 {}
export type D3<T extends Q1 & I1> = T["zzz"];
export type D4<T extends Q1 & Q2 | { a: 1 }> = T["zzz"];
export type D5<T extends Q1 & Q2 | { a: 1 }> = T["a"];
export class Impl implements Q1 { x = 1; }
type Both = Q1 & Q2;
export class Impl2 implements Both {}
type Same = Q1 & I1;
export class Impl3 implements Same {}
type Disc = { k: "a" } & { k: "b" };
export class Impl4 implements Disc {}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,36): error TS2536: Type '\`c\${T}\`' cannot be used to index type 'M<T>'.
        a.ts(5,21): error TS2536: Type '\`get\${keyof T & string}\`' cannot be used to index type 'R<T>'.
        a.ts(6,40): error TS2536: Type 'K' cannot be used to index type 'R<T>'.
        a.ts(8,39): error TS2536: Type 'T' cannot be used to index type 'F<T, U>'.
        a.ts(11,36): error TS2536: Type 'T' cannot be used to index type 'G<T>'.
        a.ts(16,24): error TS2536: Type 'K extends string ? K : never' cannot be used to index type 'T'.
        b.ts(6,37): error TS2536: Type '"zzz"' cannot be used to index type 'T'.
        b.ts(7,48): error TS2536: Type '"zzz"' cannot be used to index type 'T'.
        b.ts(9,14): error TS2720: Class 'Impl' incorrectly implements class 'Q1'. Did you mean to extend 'Q1' and inherit its members as a subclass?
          Property 'x' is private in type 'Q1' but not in type 'Impl'.
        b.ts(11,31): error TS2422: A class can only implement an object type or intersection of object types with statically known members.
        b.ts(13,14): error TS2420: Class 'Impl3' incorrectly implements interface 'Q1 & I1'.
          Property 'x' is missing in type 'Impl3' but required in type 'Q1'.
        b.ts(15,31): error TS2422: A class can only implement an object type or intersection of object types with statically known members."
      `);
      expect(exitCode).toBe(1);
    });

    test("`(a.p) += v` is checked against the type that is read", async () => {
      using dir = project({
        "a.ts": `class A { get p(): number { return 1; } set p(v: number | string) {} }
declare const a: A;
a.p += "s";
a["p"] += "s";
(a.p) += "s";
(a["p"]) += "s";
a.p ??= "s";
a["p"] ??= "s";
a.p ||= "s";
a["p"] ||= "s";
a["p"] = "s";
declare const k: "p";
a[k] += "s";
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(5,1): error TS2322: Type 'string' is not assignable to type 'number'."`,
      );
      expect(exitCode).toBe(1);
    });

    test("a comparison without an error node that exceeds the depth limit is reported at the type reference", async () => {
      using dir = project({
        "a.ts": `type UnionToIntersect<U> = (U extends unknown ? (arg: U) => 0 : never) extends (arg: infer I) => 0 ? I : never;
type UnionLast<U> = UnionToIntersect<U extends unknown ? (x: U) => 0 : never> extends (x: infer L) => 0 ? L : never;
type UnionToTuple<U, L = UnionLast<U>> = [U] extends [never] ? [] : [...UnionToTuple<Exclude<U, L>>, L];
type Assert<T, E> = T extends E ? T : never;
interface Schema { kind: string }
interface Literal<T> extends Schema { value: T }
type Wrap<T extends Schema[]> = T extends [] ? never : T;
export type Result<T extends string> = Wrap<Assert<UnionToTuple<{ [K in T]: Literal<K> }[T]>, Schema[]>>;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(8,40): error TS2321: Excessive stack depth comparing types 'UnionToTuple<{ [K in T]: Literal<K>; }[T], UnionLast<{ [K in T]: Literal<K>; }[T]>>' and 'Schema[]'."`,
      );
      expect(exitCode).toBe(1);
    });

    test("a call of a variable without an annotation, in a loop that assigns the result to it", async () => {
      using dir = project({
        "a.ts": `export function l1(xs: number[]) {
  let v = undefined;
  for (const x of xs) { v = v(x); }
  return v;
}
export function l2(xs: number[]) {
  let v;
  for (const x of xs) { v = v(x); }
  return v;
}
export function l3(xs: number[]) {
  let v = undefined;
  for (const x of xs) { v = v.p; }
  return v;
}
export function l4(xs: number[]) {
  let v = null;
  for (const x of xs) { v = new v(x); }
  return v;
}
export function l5() {
  let v = undefined;
  v = v(1);
  return v;
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,29): error TS2722: Cannot invoke an object which is possibly 'undefined'.
        a.ts(3,29): error TS18048: 'v' is possibly 'undefined'.
        a.ts(8,29): error TS2722: Cannot invoke an object which is possibly 'undefined'.
        a.ts(8,29): error TS18048: 'v' is possibly 'undefined'.
        a.ts(13,29): error TS18048: 'v' is possibly 'undefined'.
        a.ts(18,33): error TS18047: 'v' is possibly 'null'.
        a.ts(23,7): error TS2722: Cannot invoke an object which is possibly 'undefined'.
        a.ts(23,7): error TS18048: 'v' is possibly 'undefined'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a function in a JSX attribute of a JavaScript file has a minimum argument count", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"noEmit": true, "allowJs": true, "checkJs": true, "strict": true, "noImplicitAny": false, "target": "esnext", "module": "preserve", "moduleResolution": "bundler", "moduleDetection": "force", "jsx": "preserve", "types": []}, "files": ["d.d.ts", "a.js", "b.jsx", "c.tsx"]}`,
        "a.js": `take(async (v) => v * 2);
take(async function (v) { return v; });
/** @type {() => Promise<any>} */
export const f = async (v) => v;
/** @type {{ action: () => Promise<any> }} */
export const o = { action: async (v) => v };
async function named(v) { return v; }
take(named);
`,
        "b.jsx": `export const x = <Button action={async (v) => v * 2}>a</Button>;
export const x2 = <Button action={async (v) => v * 2} />;
export const x3 = <Button action={(v) => Promise.resolve(v)} />;
export const x4 = <Button action={async function (v) { return v; }} />;
export const x5 = <Button action={1} />;
`,
        "c.tsx": `export const x2 = <Button action={async (v) => v * 2} />;
export const x3 = <Button action={(v) => Promise.resolve(v)} />;
export const x4 = <Button action={async function (v) { return v; }} />;
`,
        "d.d.ts": `declare namespace JSX { interface Element {} interface IntrinsicElements { div: {} } interface ElementChildrenAttribute { children: {} } }
declare function take(action: () => Promise<any>): void;
declare function Button(props: { action: () => Promise<any>; children?: any }): JSX.Element;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.js(1,6): error TS2345: Argument of type '(v: any) => Promise<number>' is not assignable to parameter of type '() => Promise<any>'.
          Target signature provides too few arguments. Expected 1 or more, but got 0.
        a.js(2,6): error TS2345: Argument of type '(v: any) => Promise<any>' is not assignable to parameter of type '() => Promise<any>'.
          Target signature provides too few arguments. Expected 1 or more, but got 0.
        a.js(4,14): error TS2322: Type '(v: any) => Promise<any>' is not assignable to type '() => Promise<any>'.
          Target signature provides too few arguments. Expected 1 or more, but got 0.
        a.js(6,20): error TS2322: Type '(v: any) => Promise<any>' is not assignable to type '() => Promise<any>'.
          Target signature provides too few arguments. Expected 1 or more, but got 0.
        b.jsx(1,26): error TS2322: Type '(v: any) => Promise<number>' is not assignable to type '() => Promise<any>'.
          Target signature provides too few arguments. Expected 1 or more, but got 0.
        b.jsx(2,27): error TS2322: Type '(v: any) => Promise<number>' is not assignable to type '() => Promise<any>'.
          Target signature provides too few arguments. Expected 1 or more, but got 0.
        b.jsx(3,27): error TS2322: Type '(v: any) => Promise<any>' is not assignable to type '() => Promise<any>'.
          Target signature provides too few arguments. Expected 1 or more, but got 0.
        b.jsx(4,27): error TS2322: Type '(v: any) => Promise<any>' is not assignable to type '() => Promise<any>'.
          Target signature provides too few arguments. Expected 1 or more, but got 0.
        b.jsx(5,27): error TS2322: Type 'number' is not assignable to type '() => Promise<any>'.
        c.tsx(1,27): error TS2322: Type '(v: any) => Promise<number>' is not assignable to type '() => Promise<any>'.
          Target signature provides too few arguments. Expected 1 or more, but got 0.
        c.tsx(2,27): error TS2322: Type '(v: any) => Promise<any>' is not assignable to type '() => Promise<any>'.
          Target signature provides too few arguments. Expected 1 or more, but got 0.
        c.tsx(3,27): error TS2322: Type '(v: any) => Promise<any>' is not assignable to type '() => Promise<any>'.
          Target signature provides too few arguments. Expected 1 or more, but got 0."
      `);
      expect(exitCode).toBe(1);
    });

    test("a variable initialized by a call in a loop that assigns it back: the quick type, overloads and a second constant", async () => {
      using dir = project({
        "a.ts": `interface S { nxt: S | null; get(): S | null; over(a: string): S; over(a: number): S | null; gen<T>(x: T): T; self: S }
declare function mk(): S; declare function one(s: S): S | null; declare function gen<T>(x: T): T;
export function c01() { let s: S | null = mk(); while (s) { const t = s.get(); s = t; } }
export function c02() { let s: S | null = mk(); while (s) { const t = s.over(1); s = t; } }
export function c03() { let s: S | null = mk(); while (s) { const t = s.gen(1); s = t ? null : null; } }
export function c04() { let s: S | null = mk(); while (s) { const t = one(s); s = t; } }
export function c05() { let s: S | null = mk(); while (s) { const t = gen(s); s = t; } }
export function c06() { let s: S | null = mk(); while (s) { const t = s.self.get(); s = t; } }
export function c07() { let s: S | null = mk(); while (s) { const t = s.get(); const u = t; s = u; } }
export function c08() { let s: S | null = mk(); while (s) { const t = s.get(); const u = t?.nxt ?? null; s = u; } }
export function c09() { let s: S | null = mk(); while (s) { const t = s.nxt; const u = t; s = u; } }
export function c10() { let s: S | null = mk(); while (s) { const t = s.get()!; s = t; } }
export function c11() { let s: S | null = mk(); while (s) { const t = s.get() ?? null; s = t; } }
export function c12() { let s: S | null = mk(); while (s) { const t = (s.get()); s = t; } }
export function c13() { let s: S | null = mk(); while (s) { const t = s.get(); s = t && t.nxt; } }
export function c14() { let s: S | null = mk(); for (;;) { const t = s.get(); if (!t) break; s = t; } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(4,67): error TS7022: 't' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,67): error TS7022: 't' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,67): error TS7022: 't' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(9,67): error TS7022: 't' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(9,86): error TS7022: 'u' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,67): error TS7022: 't' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,86): error TS7022: 'u' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(11,67): error TS7022: 't' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(11,84): error TS7022: 'u' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,67): error TS7022: 't' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(13,67): error TS7022: 't' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(16,66): error TS7022: 't' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(16,70): error TS18047: 's' is possibly 'null'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a variable in a loop that is assigned back is circular for every kind of initializer that is checked", async () => {
      using dir = project({
        "a.ts": `interface S { nxt: S | null; id: string; n: number; kids: S[]; gen<T>(x: T): T; over(a: string): S; over(a: number): S | null; p: Promise<S | null> }
declare function mk(id?: string): S; declare function idf<T>(x: T): T; declare const c: boolean; declare class G<T> { constructor(x: T); v: T } declare function tg<T>(s: TemplateStringsArray, x: T): T; declare function ov(a: S): S | null; declare function ov(a: null): null;
export async function a0() { let s: S | null = mk(); while (s) { const cur = await s.p; s = cur; } }
export async function a1() { let s: S | null = mk(); while (s) { const cur = \`\${s.id}\`; s = mk(cur); } }
export async function a2() { let s: S | null = mk(); while (s) { const cur = new G(s); s = cur.v; } }
export async function a3() { let s: S | null = mk(); while (s) { const cur = tg\`\${s}\`; s = cur; } }
export async function a4() { let s: S | null = mk(); while (s) { const cur = s.n + 1; s = cur ? s.nxt : null; } }
export async function a5() { let s: S | null = mk(); while (s) { const cur = -s.n; s = cur ? s.nxt : null; } }
export async function a6() { let s: S | null = mk(); while (s) { const cur = !s.nxt; s = cur ? null : s.nxt; } }
export async function a7() { let s: S | null = mk(); while (s) { const cur = typeof s.nxt; s = cur ? s.nxt : null; } }
export async function a8() { let s: S | null = mk(); while (s) { const cur = void s; s = cur ?? null; } }
export async function a9() { let s: S | null = mk(); while (s) { const cur = (s, s.nxt); s = cur; } }
export async function a10() { let s: S | null = mk(); while (s) { const cur = s.nxt && s.nxt.nxt; s = cur; } }
export async function a11() { let s: S | null = mk(); while (s) { const cur = s.nxt || null; s = cur; } }
export async function a12() { let s: S | null = mk(); while (s) { const cur = [...s.kids]; s = cur[0]; } }
export async function a13() { let s: S | null = mk(); while (s) { const cur = { ...s }; s = cur.nxt; } }
export async function a14() { let s: S | null = mk(); while (s) { const cur = s.nxt satisfies S | null; s = cur; } }
export async function a15() { let s: S | null = mk(); while (s) { const cur = <S | null>s.nxt; s = cur; } }
export async function a16() { let s: S | null = mk(); while (s) { const cur = s.nxt!; s = cur; } }
export async function a17() { let s: S | null = mk(); while (s) { const cur = s?.nxt; s = cur; } }
export async function a18() { let s: S | null = mk(); while (s) { const cur = s.kids?.[0]; s = cur; } }
export async function a19() { let s: S | null = mk(); while (s) { const cur = ov(s); s = cur; } }
export async function a20() { let s: S | null = mk(); while (s) { const cur = s.over(1); s = cur; } }
export async function a21() { let s: S | null = mk(); while (s) { const cur = idf(s.nxt); s = cur; } }
export async function a22() { let s: S | null = mk(); while (s) { const cur = s.gen(s.nxt); s = cur; } }
export async function a23() { let s: S | null = mk(); while (s) { const cur = (() => s.nxt)(); s = cur; } }
export async function a24() { let s: S | null = mk(); while (s) { const cur = (function () { return s; })(); s = cur; } }
export async function a25() { let s: S | null = mk(); while (s) { const cur = s.n++; s = cur ? s.nxt : null; } }
export async function a26() { let s: S | null = mk(); while (s) { const cur = s.id in s; s = cur ? s.nxt : null; } }
export async function a27() { let s: S | null = mk(); while (s) { const cur = s instanceof Object; s = cur ? s.nxt : null; } }
export async function a28() { let s: S | null = mk(); while (s) { const cur = s.n === 1; s = cur ? s.nxt : null; } }
export async function a29() { let s: S | null = mk(); while (s) { const cur = class { static v = s }; s = cur.v; } }
export async function a30() { let s: S | null = mk(); while (s) { const cur = { get v() { return s; } }; s = cur.v; } }
export async function a31() { let s: S | null = mk(); while (s) { const cur = { v() { return s; } }; s = cur.v(); } }
export async function a32() { let s: S | null = mk(); while (s) { const cur = [s] as const; s = cur[0]; } }
export async function a33() { let s: S | null = mk(); while (s) { const cur = { v: s } as const; s = cur.v; } }
export async function a34() { let s: S | null = mk(); while (s) { const cur = c ? { v: s } : { v: null }; s = cur.v; } }
export async function a35() { let s: S | null = mk(); while (s) { const cur = [{ v: s }]; s = cur[0].v; } }
export async function a36() { let s: S | null = mk(); while (s) { const cur = idf({ v: s }); s = cur.v; } }
export async function a37() { let s: S | null = mk(); while (s) { const cur = { v: s }.v; s = cur; } }
export async function a38() { let s: S | null = mk(); while (s) { const cur = [s][0]; s = cur; } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,72): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,72): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,72): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,72): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,72): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(9,72): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,72): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,72): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,79): error TS2695: Left side of comma operator is unused and has no side effects.
        a.ts(13,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(14,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(15,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(16,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(17,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(19,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(20,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(21,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(22,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(23,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(24,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(25,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(26,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(26,80): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(27,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(27,80): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(28,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(29,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(30,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(31,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(35,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(36,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(37,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(38,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(39,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(40,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(41,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("a variable in a loop is circular for every kind of expression that assigns it back", async () => {
      using dir = project({
        "a.ts": `interface S { nxt: S | null; id: string; n: number; kids: S[]; gen<T>(x: T): T; over(a: string): S; over(a: number): S | null; p: Promise<S | null>; get(): S | null }
declare function mk(id?: string): S; declare function mkN(s: S | null): S | null; declare function idf<T>(x: T): T; declare const c: boolean; declare class G<T> { constructor(x: T); v: T } declare class H { constructor(x: S | null); v: S | null } declare function tg<T>(s: TemplateStringsArray, x: T): T; declare function ov(a: S): S | null; declare function ov(a: null): null; declare function pr(s: S | null): Promise<S | null>;
export async function a0() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = cur; } }
export async function a1() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = cur!; } }
export async function a2() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = (cur); } }
export async function a3() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = cur as S; } }
export async function a4() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = cur satisfies S | null; } }
export async function a5() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = <S>cur; } }
export async function a6() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = cur ?? null; } }
export async function a7() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = cur || null; } }
export async function a8() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = cur && cur.nxt; } }
export async function a9() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = c ? cur : null; } }
export async function a10() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = cur ? cur.nxt : null; } }
export async function a11() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = cur?.nxt ?? null; } }
export async function a12() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = mkN(cur); } }
export async function a13() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = idf(cur); } }
export async function a14() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = await pr(cur); } }
export async function a15() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = await cur; } }
export async function a16() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = new G(cur).v; } }
export async function a17() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = new H(cur).v; } }
export async function a18() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = tg\`\${cur}\`; } }
export async function a19() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = { v: cur }.v; } }
export async function a20() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = [cur][0]; } }
export async function a21() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = (() => cur)(); } }
export async function a22() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = cur === null ? null : cur; } }
export async function a23() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = (cur, null); } }
export async function a24() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = mk(cur?.id); } }
export async function a25() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = mk(\`\${cur}\`); } }
export async function a26() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = cur?.get() ?? null; } }
export async function a27() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = cur?.gen(cur) ?? null; } }
export async function a28() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = cur?.over(1) ?? null; } }
export async function a29() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = cur?.kids[0] ?? null; } }
export async function a30() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = cur?.kids.find(k => k.id) ?? null; } }
export async function a31() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = [cur].find(k => k) ?? null; } }
export async function a32() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = Object.assign({}, cur); } }
export async function a33() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = { ...mk(), nxt: cur }; } }
export async function a34() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = mkN(mkN(cur)); } }
export async function a35() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = typeof cur === "object" ? null : mk(); } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,72): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,72): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,72): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,72): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(9,72): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,72): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(11,72): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,72): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(13,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(14,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(16,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(18,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(19,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(20,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(21,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(22,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(23,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(24,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(24,91): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(25,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(26,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(26,91): error TS2695: Left side of comma operator is unused and has no side effects.
        a.ts(29,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(30,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(31,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(32,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(33,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(33,105): error TS7006: Parameter 'k' implicitly has an 'any' type.
        a.ts(34,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(35,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(36,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(38,73): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("a call with a single signature is circular if it is read through a second constant", async () => {
      using dir = project({
        "a.ts": `interface S { nxt: S | null; get(): S | null } declare function mk(): S; declare function mkN(s: S | null): S | null;
export function a15() { let s: S | null = mk(); while (s) { const t = s.get(), u = t; s = u; } }
export function b1() { let s: S | null = mk(); while (s) { const t = s.get(); const u = t; s = u; } }
export function b2() { let s: S | null = mk(); while (s) { const t = mkN(s); const u = t; s = u; } }
export function b3() { let s: S | null = mk(); while (s) { const t = s.get(); const u = t ?? null; s = u; } }
export function b4() { let s: S | null = mk(); while (s) { const t = s.get(); const u = t?.nxt; s = u ?? null; } }
export function b5() { let s: S | null = mk(); while (s) { const t = s.get(); s = t && t.nxt; } }
export function b6() { let s: S | null = mk(); while (s) { const t = s.get(); if (!t) { break; } const u = t.nxt; s = u; } }
export function b7() { let s: S | null = mk(); while (s) { const t = s.get(); const u = mkN(t); s = u; } }
export function b8() { let s: S | null = mk(); while (s) { const t = s.get(); const u = t as S; s = u; } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,67): error TS7022: 't' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(2,80): error TS7022: 'u' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(3,66): error TS7022: 't' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(3,85): error TS7022: 'u' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,66): error TS7022: 't' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,85): error TS7022: 'u' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,66): error TS7022: 't' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,85): error TS7022: 'u' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,66): error TS7022: 't' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,104): error TS7022: 'u' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("a generic assertion in a loop is resolved for every reference", async () => {
      using dir = project({
        "a.ts": `declare function deep<T>(a: unknown, e: T): asserts a is T;
interface Sess { exec(c: string): { out: string; code: number }; id: string }
declare function connect(id?: string): Sess;
export function t5(c: boolean) {
  let s: Sess | null = connect();
  while (s !== null) {
    const cur = s;
    const res = cur.exec("y");
    deep(res, 1);
    s = c ? null : connect(cur.id);
  }
}
export function t6(c: boolean) {
  let s: Sess | null = connect();
  while (s !== null) {
    const cur = s;
    s = c ? null : connect(cur.id);
  }
}
export function t7(c: boolean) {
  let s: Sess | null = connect();
  while (s !== null) {
    const cur = s;
    deep(cur, 1);
    s = connect();
  }
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(7,11): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,11): error TS7022: 'res' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(16,11): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(23,11): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("a compound assignment to an accessor compares with the type of the setter as narrowed", async () => {
      using dir = project({
        "a.ts": `export class Ac {
  get v(): string { return ""; }
  set v(x: string | number) {}
  get n(): number { return 1; }
  set n(x: number | string) {}
  m() {
    this.v = 1;
    this.v += 1;
  }
  k() {
    this.n += "s";
    this["n"] += "s";
  }
  j(c: boolean) {
    this.n = "a";
    this.n += 1;
    if (c) { this.n = 2; }
    this.n += "z";
  }
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(8,5): error TS2322: Type 'string' is not assignable to type 'number'.
        a.ts(16,5): error TS2322: Type 'number' is not assignable to type 'string'."
      `);
      expect(exitCode).toBe(1);
    });

    test("where a long type is cut off does not depend on how many declarations come before it", async () => {
      using dir = project({
        // The estimate of the length counts the internal name of a property that a `unique symbol` names.
        "index.ts": `${Array.from({ length: 1200 }, (_, i) => `declare const d${i}: ${i};`).join("\n")}
declare const NamedGroupsS: unique symbol; declare const CapturedGroupsArrS: unique symbol; declare const ValueS: unique symbol; declare const FlagsS: unique symbol;
declare const r: RegExp;
export const m: { [NamedGroupsS]: string; [CapturedGroupsArrS]: (string | undefined)[]; [ValueS]: string; [FlagsS]: "d" | "i" | "m" | "s" | "u" | "y" } = r;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"index.ts(1203,14): error TS2739: Type 'RegExp' is missing the following properties from type '{ [NamedGroupsS]: string; [CapturedGroupsArrS]: (string | undefined)[]; [ValueS]: string; [FlagsS]: "d" | "i" | "m" | "s" | "u" | "y"; }': [NamedGroupsS], [CapturedGroupsArrS], [ValueS], [FlagsS]"`,
      );
      expect(exitCode).toBe(1);
    });

    test("a recursive type behind a signature in a conditional type is cut off one level later", async () => {
      using dir = project({
        "a.ts": `type U<A> =
  A extends (...args: infer T) => infer R ? (...args: T) => U<R> :
  A extends object ? { [K in keyof A]: U<A[K]> } :
  A;
interface Req { url: string; clone(): Req }
declare const u: U<Req>;
export const n1: number = u;
declare const v: U<Req | string>;
export const n2: number = v;
declare const w: U<[Req | string, number]>;
export const n3: number = w;
export const n4: number = w[0];
declare function ev<A>(f: (a: U<A>) => void, a: A): void;
declare const rq: Req | string;
ev(([a]) => { const n5: number = a; return n5; }, [rq] as [Req | string]);
ev((a) => { const n6: number = a; return n6; }, rq);
`,
        "b.ts": `type V<A> = A extends object ? { [K in keyof A]: V<A[K]> } : A;
interface Q { self: Q; n: number }
declare const q: V<Q>;
export const m1: number = q;
type W<A> = A extends () => infer R ? () => W<R> : A extends object ? { [K in keyof A]: W<A[K]> } : A;
interface Q2 { clone(): Q2; n: number }
declare const q2: W<Q2>;
export const m2: number = q2;
interface Q3 { clone: () => Q3; n: number }
declare const q3: W<Q3>;
export const m3: number = q3;
type X<A> = A extends () => infer R ? { f: X<R> } : A extends object ? { [K in keyof A]: X<A[K]> } : A;
declare const q4: X<Q3>;
export const m4: number = q4;
type Y<A> = A extends object ? { [K in keyof A]: () => Y<A[K]> } : A;
declare const q5: Y<Q>;
export const m5: number = q5;
type Z<A> = { [K in keyof A]: () => Z<A[K]> };
declare const q6: Z<Q>;
export const m6: number = q6;
export const m7: number = q2.clone;
export const m8: number = q2.clone();
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(7,14): error TS2322: Type '{ url: string; clone: () => { url: string; clone: ...; }; }' is not assignable to type 'number'.
        a.ts(9,14): error TS2322: Type 'string | { url: string; clone: () => { url: string; clone: ...; }; }' is not assignable to type 'number'.
          Type 'string' is not assignable to type 'number'.
        a.ts(11,14): error TS2322: Type '[string | { url: string; clone: () => { url: string; clone: ...; }; }, number]' is not assignable to type 'number'.
        a.ts(12,14): error TS2322: Type 'string | { url: string; clone: () => { url: string; clone: ...; }; }' is not assignable to type 'number'.
          Type 'string' is not assignable to type 'number'.
        a.ts(15,21): error TS2322: Type 'string | { url: string; clone: () => { url: string; clone: ...; }; }' is not assignable to type 'number'.
          Type 'string' is not assignable to type 'number'.
        a.ts(16,19): error TS2322: Type 'string | { url: string; clone: () => { url: string; clone: ...; }; }' is not assignable to type 'number'.
          Type 'string' is not assignable to type 'number'.
        b.ts(4,14): error TS2322: Type '{ self: ...; n: number; }' is not assignable to type 'number'.
        b.ts(8,14): error TS2322: Type '{ clone: () => { clone: ...; n: number; }; n: number; }' is not assignable to type 'number'.
        b.ts(11,14): error TS2322: Type '{ clone: () => { clone: ...; n: number; }; n: number; }' is not assignable to type 'number'.
        b.ts(14,14): error TS2322: Type '{ clone: { f: ...; }; n: number; }' is not assignable to type 'number'.
        b.ts(17,14): error TS2322: Type '{ self: () => ...; n: () => number; }' is not assignable to type 'number'.
        b.ts(20,14): error TS2322: Type 'Z<Q>' is not assignable to type 'number'.
        b.ts(21,14): error TS2322: Type '() => { clone: ...; n: number; }' is not assignable to type 'number'.
        b.ts(22,14): error TS2322: Type '{ clone: () => { clone: ...; n: number; }; n: number; }' is not assignable to type 'number'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a type node in the false branch of a conditional type depends on its infer type parameters", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext", "dom", "dom.iterable"], "types": [], "skipLibCheck": true}}`,
        "a.ts": `interface JSHandle<T = any> { h(): T; dispose(): Promise<void> }
type NoHandles<Arg> =
  Arg extends JSHandle ? never :
  Arg extends (...args: infer T) => PromiseLike<infer U> ? (...args: T) => Promise<NoHandles<U>> :
  Arg extends (...args: infer T) => infer R ? (...args: T) => NoHandles<R> :
  Arg extends object ? { [Key in keyof Arg]: NoHandles<Arg[Key]> } :
  Arg;
type Unboxed<Arg> =
  Arg extends JSHandle<infer T> ? T :
  Arg extends (...args: infer T) => PromiseLike<infer U> ? (...args: T) => Promise<Unboxed<U>> :
  Arg extends (...args: infer T) => infer R ? (...args: T) => Unboxed<R> :
  Arg extends NoHandles<Arg> ? Arg :
  Arg extends [infer A0] ? [Unboxed<A0>] :
  Arg extends [infer A0, infer A1] ? [Unboxed<A0>, Unboxed<A1>] :
  Arg extends Array<infer T> ? Array<Unboxed<T>> :
  Arg extends object ? { [Key in keyof Arg]: Unboxed<Arg[Key]> } :
  Arg;
declare function evaluate<R, Arg>(f: (arg: Unboxed<Arg>) => R | Promise<R>, arg: Arg): Promise<R>;
export function go(input: RequestInfo, init?: RequestInit) {
  return evaluate(([input, init]) => fetch(input, init), [input, init] as [RequestInfo, RequestInit]);
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(20,44): error TS2345: Argument of type 'string | { readonly body: { readonly locked: boolean; cancel: (reason?: any) => Promise<void>; getReader: (options?: ReadableStreamGetReaderOptions | undefined) => ReadableStreamReader<...>; ... 4 more ...; values: (options?: ReadableStreamIteratorOptions | undefined) => { ...; }; } | null; ... 20 more ...; clone: (...' is not assignable to parameter of type 'URL | RequestInfo'.
          Type '{ readonly body: { readonly locked: boolean; cancel: (reason?: any) => Promise<void>; getReader: (options?: ReadableStreamGetReaderOptions | undefined) => ReadableStreamReader<...>; ... 4 more ...; values: (options?: ReadableStreamIteratorOptions | undefined) => { ...; }; } | null; ... 20 more ...; clone: () => { .....' is not assignable to type 'URL | RequestInfo'.
            Type '{ readonly body: { readonly locked: boolean; cancel: (reason?: any) => Promise<void>; getReader: (options?: ReadableStreamGetReaderOptions | undefined) => ReadableStreamReader<...>; ... 4 more ...; values: (options?: ReadableStreamIteratorOptions | undefined) => { ...; }; } | null; ... 20 more ...; clone: () => { .....' is not assignable to type 'Request'.
              Types of property 'body' are incompatible.
                Type '{ readonly locked: boolean; cancel: (reason?: any) => Promise<void>; getReader: (options?: ReadableStreamGetReaderOptions | undefined) => ReadableStreamReader<...>; ... 4 more ...; values: (options?: ReadableStreamIteratorOptions | undefined) => { ...; }; } | null' is not assignable to type 'ReadableStream<Uint8Array<ArrayBuffer>> | null'.
                  Type '{ readonly locked: boolean; cancel: (reason?: any) => Promise<void>; getReader: (options?: ReadableStreamGetReaderOptions | undefined) => ReadableStreamReader<...>; ... 4 more ...; values: (options?: ReadableStreamIteratorOptions | undefined) => { ...; }; }' is not assignable to type 'ReadableStream<Uint8Array<ArrayBuffer>>'.
                    The types returned by 'getReader(...)' are incompatible between these types.
                      Type 'ReadableStreamReader<Uint8Array<ArrayBuffer>>' is not assignable to type 'ReadableStreamBYOBReader'.
                        Type 'ReadableStreamDefaultReader<Uint8Array<ArrayBuffer>>' is not assignable to type 'ReadableStreamBYOBReader'.
                          The types returned by 'read(...)' are incompatible between these types.
                            Type 'Promise<ReadableStreamReadResult<Uint8Array<ArrayBuffer>>>' is not assignable to type 'Promise<ReadableStreamReadResult<T>>'.
                              Type 'ReadableStreamReadResult<Uint8Array<ArrayBuffer>>' is not assignable to type 'ReadableStreamReadResult<T>'.
                                Type 'ReadableStreamReadDoneResult<Uint8Array<ArrayBuffer>>' is not assignable to type 'ReadableStreamReadResult<T>'.
                                  Type 'ReadableStreamReadDoneResult<Uint8Array<ArrayBuffer>>' is not assignable to type 'ReadableStreamReadDoneResult<T>'.
                                    Type 'Uint8Array<ArrayBuffer>' is not assignable to type 'T'.
                                      'Uint8Array<ArrayBuffer>' is assignable to the constraint of type 'T', but 'T' could be instantiated with a different subtype of constraint 'ArrayBufferView<ArrayBuffer>'."
      `);
      expect(exitCode).toBe(1);
    });

    test("types written in the false branch of a conditional type that has an infer type", async () => {
      using dir = project({
        "a.ts": `interface Cast<t> { cast: t }
type Fn<A> = A extends Cast<infer R> ? R : (x: A) => A;
type Ob<A> = A extends Cast<infer R> ? R : { a: A; b?: A[]; f?: (x: A) => Ob<A> };
type Tu<A> = A extends Cast<infer R extends string> ? R : [A, A[]];
type Rec<A> = A extends Cast<infer R> ? R : { v: A; next?: Rec<A>; m(): Rec<A> };
declare function take(cb: () => Ob<1>): void; take(() => ({ a: 1 })); take(() => ({ a: 2 }));
declare function take2<T>(v: T, cb: () => Ob<T>): T; export const c1: never = take2(1, () => ({ a: 1 }));
declare function take3<const T>(v: T, o: Ob<1>): T; export const c2: never = take3([1], { a: 1 });
declare function take4(cb: Fn<1>): void; take4(x => { const p: never = x; return x; });
declare function take5(o: Ob<"a">): void; take5({ a: "a", f: x => { const p: never = x; return { a: x }; } });
export const c3 = { a: 1 } satisfies Ob<1>; export const c4: never = c3;
export const c5: Ob<number> = { a: 1, b: ["x"] };
export const c6: Tu<number> = [1, ["x"]];
export const c7: never = null! as Rec<1>;
export const c8: never = (null! as Rec<1>).m();
export const c9: never = (null! as Rec<1>).next;
export const d1: Rec<1> = null! as Rec<2>;
class C<T> { p!: Ob<T>; q!: Rec<T>; m(x: Fn<T>): Tu<T> { return null!; } }
export const d2: never = new C<1>().p; export const d3: never = new C<1>().m; export const d4: C<1> = new C<2>();
export const d5: never = null! as Promise<Ob<1>> extends Promise<infer U> ? U : 0;
export async function d6(): Promise<Ob<1>> { return { a: 2 }; }
export function d7<T>(x: Ob<T>, y: Rec<T>): void { const p: never = x; const q: never = y; const r: never = x.a; }
export const d8: never = [null! as Ob<1>, null! as Ob<2>];
export const d9: never = (null! as boolean) ? (null! as Ob<1>) : (null! as Fn<1>);
type Deep<A> = A extends Cast<infer R> ? R : A extends Cast<infer S>[] ? S : { a: A; c: A extends 1 ? { one: A } : { other: A } };
export const e1: never = null! as Deep<1>; export const e2: never = null! as Deep<2>["c"];
export const e3: never = null! as { [K in keyof Deep<1>]: Deep<1>[K] };
type UU<A> = A extends (...args: infer T) => infer R ? (...args: T) => UU<R> : A extends object ? { [K in keyof A]: UU<A[K]> } : A;
interface Req { url: string; clone(): Req; self: Req; arr: Req[] }
export const e4: never = null! as UU<Req>; export const e5: never = (null! as UU<Req>).clone(); export const e6: never = (null! as UU<Req>).arr;
export const e7: UU<Req> = null! as Req; export const e8: Req = null! as UU<Req>;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(6,85): error TS2322: Type '2' is not assignable to type '1'.
        a.ts(7,67): error TS2322: Type 'number' is not assignable to type 'never'.
        a.ts(8,66): error TS2322: Type '[1]' is not assignable to type 'never'.
        a.ts(9,61): error TS2322: Type '1' is not assignable to type 'never'.
        a.ts(10,75): error TS2322: Type '"a"' is not assignable to type 'never'.
        a.ts(11,58): error TS2322: Type '{ a: 1; }' is not assignable to type 'never'.
        a.ts(12,43): error TS2322: Type 'string' is not assignable to type 'number'.
        a.ts(13,36): error TS2322: Type 'string' is not assignable to type 'number'.
        a.ts(14,14): error TS2322: Type '{ v: 1; next?: ... | undefined; m(): ...; }' is not assignable to type 'never'.
        a.ts(15,14): error TS2322: Type '{ v: 1; next?: ... | undefined; m(): ...; }' is not assignable to type 'never'.
        a.ts(16,14): error TS2322: Type '{ v: 1; next?: ... | undefined; m(): ...; } | undefined' is not assignable to type 'never'.
          Type 'undefined' is not assignable to type 'never'.
        a.ts(17,14): error TS2322: Type '{ v: 2; next?: ... | undefined; m(): ...; }' is not assignable to type '{ v: 1; next?: ... | undefined; m(): ...; }'.
          Types of property 'v' are incompatible.
            Type '2' is not assignable to type '1'.
        a.ts(19,14): error TS2322: Type '{ a: 1; b?: 1[] | undefined; f?: ((x: 1) => ...) | undefined; }' is not assignable to type 'never'.
        a.ts(19,53): error TS2322: Type '(x: (x: 1) => 1) => [1, 1[]]' is not assignable to type 'never'.
        a.ts(19,92): error TS2322: Type 'C<2>' is not assignable to type 'C<1>'.
          The types of 'p.a' are incompatible between these types.
            Type '2' is not assignable to type '1'.
        a.ts(20,14): error TS2322: Type '{ a: 1; b?: 1[] | undefined; f?: ((x: 1) => ...) | undefined; }' is not assignable to type 'never'.
        a.ts(21,55): error TS2322: Type '2' is not assignable to type '1'.
        a.ts(22,58): error TS2322: Type 'Ob<T>' is not assignable to type 'never'.
          Type 'unknown' is not assignable to type 'never'.
        a.ts(22,78): error TS2322: Type 'Rec<T>' is not assignable to type 'never'.
          Type 'unknown' is not assignable to type 'never'.
        a.ts(22,98): error TS2322: Type 'any' is not assignable to type 'never'.
        a.ts(22,111): error TS2339: Property 'a' does not exist on type 'Ob<T>'.
        a.ts(23,14): error TS2322: Type '({ a: 1; b?: 1[] | undefined; f?: ((x: 1) => ...) | undefined; } | { a: 2; b?: 2[] | undefined; f?: ((x: 2) => ...) | undefined; })[]' is not assignable to type 'never'.
        a.ts(24,14): error TS2322: Type '((x: 1) => 1) | { a: 1; b?: 1[] | undefined; f?: ((x: 1) => ...) | undefined; }' is not assignable to type 'never'.
          Type '(x: 1) => 1' is not assignable to type 'never'.
        a.ts(24,26): error TS2873: This kind of expression is always falsy.
        a.ts(26,14): error TS2322: Type '{ a: 1; c: { one: 1; }; }' is not assignable to type 'never'.
        a.ts(26,57): error TS2322: Type '{ other: 2; }' is not assignable to type 'never'.
        a.ts(27,14): error TS2322: Type '{ a: 1; c: { one: 1; }; }' is not assignable to type 'never'.
        a.ts(30,14): error TS2322: Type '{ url: string; clone: () => { url: string; clone: ...; self: ...; arr: ...[]; }; self: ...; arr: ...[]; }' is not assignable to type 'never'.
        a.ts(30,57): error TS2322: Type '{ url: string; clone: () => { url: string; clone: ...; self: ...; arr: ...[]; }; self: ...; arr: ...[]; }' is not assignable to type 'never'.
        a.ts(30,110): error TS2322: Type '{ url: string; clone: () => { url: string; clone: ...; self: ...; arr: ...[]; }; self: ...; arr: ...[]; }[]' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a template literal type whose placeholder is tagged with an object type is not generic", async () => {
      using dir = project({
        "a.ts": `interface Tag<T> { t: T }
export function f<T>() {
  const a: never = null! as ("a" extends \`\${string & Tag<T>}\` ? 1 : 2);
  const b: never = null! as (\`x\${string & Tag<T>}\` extends string ? 1 : 2);
  const c: never = null! as ("A" extends Uppercase<string & Tag<T>> ? 1 : 2);
  const d: never = null! as { [k: \`x\${string & Tag<T>}\`]: 1 };
  const e: never = null! as { a: 1 }[\`\${string & Tag<T>}\` & "a"];
  return [a, b, c, d, e];
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,9): error TS2322: Type '2' is not assignable to type 'never'.
        a.ts(4,9): error TS2322: Type '1' is not assignable to type 'never'.
        a.ts(5,9): error TS2322: Type '2' is not assignable to type 'never'.
        a.ts(6,9): error TS2322: Type '{ [k: \`x\${string & Tag<T>}\`]: 1; }' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a member of a literal whose contextual type is never has the contextual type never", async () => {
      using dir = project({
        "a.ts": `declare function idf<T>(v: T): T;
declare function k4<T>(cb: (x: number) => T): T;
declare function k12<T>(o: { v: T; cb: (x: T) => void }): T;
declare function k15<A extends unknown[]>(cb: (...a: A) => void, ...a: A): A;
declare function k18<T>(cb: (x: T) => void, v: T): T;
declare function mk<T>(): T;
export const a1: never = [k4((x, y) => { const p: never = y; })];
export const a2: never = { v: k4((x, y) => { const p: never = y; }) };
export const a3: never = [k12({ v: 1, cb: idf(x => { const p: never = x; }) })];
export const a4: never = [k15(idf(x => { const p: never = x; }), 1, "a")];
export const a5: never = { v: k18(idf(x => { const p: never = x; }), 1) };
export const a6: never = [mk()];
export const a7: never = { v: mk() };
export const a8: never = [[mk()]];
export const a9: never = { v: { w: mk() } };
export const b1: never = [...[mk()]];
export const b2: never = { ["v"]: mk() };
export const b3: never = { v: x => x };
export const b4: never = [x => x];
export function b5<T extends never>(): T { return [mk()]; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(7,14): error TS2322: Type 'never[]' is not assignable to type 'never'.
        a.ts(7,30): error TS2345: Argument of type '(x: any, y: any) => void' is not assignable to parameter of type '(x: number) => void'.
          Target signature provides too few arguments. Expected 2 or more, but got 1.
        a.ts(7,31): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(7,34): error TS7006: Parameter 'y' implicitly has an 'any' type.
        a.ts(7,48): error TS2322: Type 'any' is not assignable to type 'never'.
        a.ts(8,14): error TS2322: Type '{ v: never; }' is not assignable to type 'never'.
        a.ts(8,34): error TS2345: Argument of type '(x: any, y: any) => void' is not assignable to parameter of type '(x: number) => void'.
          Target signature provides too few arguments. Expected 2 or more, but got 1.
        a.ts(8,35): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(8,38): error TS7006: Parameter 'y' implicitly has an 'any' type.
        a.ts(8,52): error TS2322: Type 'any' is not assignable to type 'never'.
        a.ts(9,14): error TS2322: Type 'never[]' is not assignable to type 'never'.
        a.ts(9,33): error TS2322: Type 'number' is not assignable to type 'never'.
        a.ts(10,14): error TS2322: Type '[x: never][]' is not assignable to type 'never'.
        a.ts(10,69): error TS2554: Expected 2 arguments, but got 3.
        a.ts(11,14): error TS2322: Type '{ v: never; }' is not assignable to type 'never'.
        a.ts(11,70): error TS2345: Argument of type '1' is not assignable to parameter of type 'never'.
        a.ts(12,14): error TS2322: Type 'never[]' is not assignable to type 'never'.
        a.ts(13,14): error TS2322: Type '{ v: never; }' is not assignable to type 'never'.
        a.ts(14,14): error TS2322: Type 'never[][]' is not assignable to type 'never'.
        a.ts(15,14): error TS2322: Type '{ v: { w: never; }; }' is not assignable to type 'never'.
        a.ts(16,14): error TS2322: Type 'unknown[]' is not assignable to type 'never'.
        a.ts(17,14): error TS2322: Type '{ v: never; }' is not assignable to type 'never'.
        a.ts(18,14): error TS2322: Type '{ v: (x: any) => any; }' is not assignable to type 'never'.
        a.ts(18,31): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(19,14): error TS2322: Type '((x: any) => any)[]' is not assignable to type 'never'.
        a.ts(19,27): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(20,44): error TS2322: Type 'never[]' is not assignable to type 'T'.
          'T' could be instantiated with an arbitrary type which could be unrelated to 'never[]'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an element of an array literal whose contextual type is never", async () => {
      using dir = project({
        "a.ts": `declare function lit<const T>(t: T): T;
export function f(): never { return lit({ a: [1, { b: "x" }] }); }
export const g: never = lit({ a: { b: [1] } });
export const h: never = lit([[1]]);
export const i: never = { a: [1] } as const;
declare function take(x: never): void; take({ a: [1] } as const);
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,30): error TS2322: Type '{ readonly a: [1, { readonly b: "x"; }]; }' is not assignable to type 'never'.
        a.ts(3,14): error TS2322: Type '{ readonly a: { b: [1]; }; }' is not assignable to type 'never'.
        a.ts(4,14): error TS2322: Type '[[1]]' is not assignable to type 'never'.
        a.ts(5,14): error TS2322: Type '{ readonly a: [1]; }' is not assignable to type 'never'.
        a.ts(6,45): error TS2345: Argument of type '{ readonly a: [1]; }' is not assignable to parameter of type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a variable without an annotation is assigned a literal that contains it, in a loop", async () => {
      using dir = project({
        "a.ts": `declare const c: boolean; declare function idf<T>(v: T): T;
export function a1() { let x = []; while (c) { x = { v: x }; } return x; }
export function a2() { let x = []; while (c) { x = [x]; } return x; }
export function a3() { let x = []; while (c) { x = idf(x); } return x; }
export function a4() { let x = []; while (c) { x = { v: [x] }; } return x; }
export function a5() { let x = []; while (c) { x = [{ v: x }]; } return x; }
export function a6() { let x = []; while (c) { x = { x }; } return x; }
export function a7() { let x = []; while (c) { x = { v: x, ...{} }; } return x; }
export function a8() { let x = []; while (c) { x = c ? { v: x } : []; } return x; }
export function a9() { let x = []; while (c) { x = idf({ v: x }); } return x; }
`,
        "b.ts": `declare const c: boolean; declare function gnum<T>(v: T): number; declare function ov(v: unknown): number; declare function ov(v: string, w: string): string;
export function b1() { let x = []; while (c) { x = gnum(x); } return x; }
export function b2() { let x = []; while (c) { x = ov(x); } return x; }
export function b3() { let x = []; while (c) { x = c ? 1 : x; } return x; }
export function b4() { let x = []; while (c) { x = x ? 1 : 2; } return x; }
export function b5() { let x = []; while (c) { x = \`\${x}\`; } return x; }
export function b6() { let x = []; while (c) { x = typeof x; } return x; }
export function b7() { let x = []; while (c) { x = (x, 1); } return x; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,28): error TS7034: Variable 'x' implicitly has type 'any[]' in some locations where its type cannot be determined.
        a.ts(2,54): error TS2353: Object literal may only specify known properties, and 'v' does not exist in type 'any[]'.
        a.ts(2,57): error TS7005: Variable 'x' implicitly has an 'any[]' type.
        a.ts(3,28): error TS7034: Variable 'x' implicitly has type 'any[]' in some locations where its type cannot be determined.
        a.ts(3,53): error TS7005: Variable 'x' implicitly has an 'any[]' type.
        a.ts(3,66): error TS7005: Variable 'x' implicitly has an 'any[]' type.
        a.ts(4,28): error TS7034: Variable 'x' implicitly has type 'any[]' in some locations where its type cannot be determined.
        a.ts(4,56): error TS7005: Variable 'x' implicitly has an 'any[]' type.
        a.ts(5,28): error TS7034: Variable 'x' implicitly has type 'any[]' in some locations where its type cannot be determined.
        a.ts(5,54): error TS2353: Object literal may only specify known properties, and 'v' does not exist in type 'any[]'.
        a.ts(5,58): error TS7005: Variable 'x' implicitly has an 'any[]' type.
        a.ts(6,28): error TS7034: Variable 'x' implicitly has type 'any[]' in some locations where its type cannot be determined.
        a.ts(6,58): error TS7005: Variable 'x' implicitly has an 'any[]' type.
        a.ts(6,73): error TS7005: Variable 'x' implicitly has an 'any[]' type.
        a.ts(7,28): error TS7034: Variable 'x' implicitly has type 'any[]' in some locations where its type cannot be determined.
        a.ts(7,54): error TS2353: Object literal may only specify known properties, and 'x' does not exist in type 'any[]'.
        a.ts(7,54): error TS7005: Variable 'x' implicitly has an 'any[]' type.
        a.ts(8,28): error TS7034: Variable 'x' implicitly has type 'any[]' in some locations where its type cannot be determined.
        a.ts(8,54): error TS2353: Object literal may only specify known properties, and 'v' does not exist in type 'any[]'.
        a.ts(8,57): error TS7005: Variable 'x' implicitly has an 'any[]' type.
        a.ts(9,28): error TS7034: Variable 'x' implicitly has type 'any[]' in some locations where its type cannot be determined.
        a.ts(9,58): error TS2353: Object literal may only specify known properties, and 'v' does not exist in type 'any[]'.
        a.ts(9,61): error TS7005: Variable 'x' implicitly has an 'any[]' type.
        a.ts(10,28): error TS7034: Variable 'x' implicitly has type 'any[]' in some locations where its type cannot be determined.
        a.ts(10,48): error TS2740: Type '{ v: any[]; }' is missing the following properties from type 'any[]': length, pop, push, concat, and 35 more.
        a.ts(10,61): error TS7005: Variable 'x' implicitly has an 'any[]' type.
        b.ts(2,28): error TS7034: Variable 'x' implicitly has type 'any[]' in some locations where its type cannot be determined.
        b.ts(2,48): error TS2322: Type 'number' is not assignable to type 'any[]'.
        b.ts(2,57): error TS7005: Variable 'x' implicitly has an 'any[]' type.
        b.ts(3,28): error TS7034: Variable 'x' implicitly has type 'any[]' in some locations where its type cannot be determined.
        b.ts(3,48): error TS2322: Type 'number' is not assignable to type 'any[]'.
        b.ts(3,55): error TS7005: Variable 'x' implicitly has an 'any[]' type.
        b.ts(4,28): error TS7034: Variable 'x' implicitly has type 'any[]' in some locations where its type cannot be determined.
        b.ts(4,48): error TS2322: Type '1 | any[]' is not assignable to type 'any[]'.
          Type 'number' is not assignable to type 'any[]'.
        b.ts(4,60): error TS7005: Variable 'x' implicitly has an 'any[]' type.
        b.ts(5,28): error TS7034: Variable 'x' implicitly has type 'any[]' in some locations where its type cannot be determined.
        b.ts(5,48): error TS2322: Type 'number' is not assignable to type 'any[]'.
          Type 'number' is not assignable to type 'any[]'.
        b.ts(5,52): error TS7005: Variable 'x' implicitly has an 'any[]' type.
        b.ts(6,28): error TS7034: Variable 'x' implicitly has type 'any[]' in some locations where its type cannot be determined.
        b.ts(6,48): error TS2322: Type 'string' is not assignable to type 'any[]'.
        b.ts(6,55): error TS7005: Variable 'x' implicitly has an 'any[]' type.
        b.ts(7,28): error TS7034: Variable 'x' implicitly has type 'any[]' in some locations where its type cannot be determined.
        b.ts(7,48): error TS2322: Type 'string' is not assignable to type 'any[]'.
          Type 'string' is not assignable to type 'any[]'.
        b.ts(7,59): error TS7005: Variable 'x' implicitly has an 'any[]' type.
        b.ts(8,28): error TS7034: Variable 'x' implicitly has type 'any[]' in some locations where its type cannot be determined.
        b.ts(8,48): error TS2322: Type 'number' is not assignable to type 'any[]'.
        b.ts(8,53): error TS2695: Left side of comma operator is unused and has no side effects.
        b.ts(8,53): error TS7005: Variable 'x' implicitly has an 'any[]' type."
      `);
      expect(exitCode).toBe(1);
    });

    test("the type of an object literal that reads the incomplete type of a loop", async () => {
      using dir = project({
        "a.ts": `declare const c: boolean; declare const o: { k: 1 };
export function t1() { let x; while (c) { x = { v: x }; } const r: never = x; }
export function t2() { let x; while (c) { x = { v: { w: x } }; } const r: never = x; }
export function t3() { let x; while (c) { x = { ...o, v: x }; } const r: never = x; }
export function t4() { let x; while (c) { x = c ? { v: x } : 1; } const r: never = x; }
export function t5() { let x; while (c) { x = [{ v: x }]; } const r: never = x; }
export function t6() { let x; while (c) { x = { x }; } const r: never = x; }
export function t7() { let x; do { x = { v: x }; } while (c); const r: never = x; }
export function t8() { let x; for (;;) { if (c) break; x = { a: 1, v: x, w: x }; } const r: never = x; }
export function t9() { let x; while (c) { while (c) { x = { v: x }; } } const r: never = x; }
export function u1() { let x = null; while (!x) { x = { v: x }; } const r: never = x; }
export function u2() { let x; while (c) { x = { v: x }.v; } const r: never = x; }
export function u3() { let x; while (c) { x = { v: x, m() { return 1; }, get g() { return 2; } }; } const r: never = x; }
export function u4() { let x; while (c) { const y = { v: x }; x = y; } const r: never = x; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,65): error TS2322: Type '{ v: undefined; } | undefined' is not assignable to type 'never'.
          Type 'undefined' is not assignable to type 'never'.
        a.ts(3,72): error TS2322: Type '{ v: { w: undefined; }; } | undefined' is not assignable to type 'never'.
          Type 'undefined' is not assignable to type 'never'.
        a.ts(4,71): error TS2322: Type '{ k: 1; v: undefined; } | undefined' is not assignable to type 'never'.
          Type 'undefined' is not assignable to type 'never'.
        a.ts(5,73): error TS2322: Type 'number | { v: undefined; } | undefined' is not assignable to type 'never'.
          Type 'undefined' is not assignable to type 'never'.
        a.ts(6,67): error TS2322: Type '{ v: undefined; }[] | undefined' is not assignable to type 'never'.
          Type 'undefined' is not assignable to type 'never'.
        a.ts(7,62): error TS2322: Type '{ x: undefined; } | undefined' is not assignable to type 'never'.
          Type 'undefined' is not assignable to type 'never'.
        a.ts(8,69): error TS2322: Type '{ v: { v: undefined; } | undefined; }' is not assignable to type 'never'.
        a.ts(9,90): error TS2322: Type '{ a: number; v: undefined; w: undefined; } | undefined' is not assignable to type 'never'.
          Type 'undefined' is not assignable to type 'never'.
        a.ts(10,79): error TS2322: Type '{ v: undefined; } | undefined' is not assignable to type 'never'.
          Type 'undefined' is not assignable to type 'never'.
        a.ts(11,73): error TS2322: Type '{ v: null; }' is not assignable to type 'never'.
        a.ts(12,67): error TS2322: Type 'undefined' is not assignable to type 'never'.
        a.ts(13,107): error TS2322: Type '{ v: undefined; m(): number; readonly g: number; } | undefined' is not assignable to type 'never'.
          Type 'undefined' is not assignable to type 'never'.
        a.ts(14,49): error TS7022: 'y' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(14,78): error TS2322: Type 'any' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("x = { v: x } in loops, where x has no annotation", async () => {
      using dir = project({
        "a.ts": `declare const c: boolean;
export function a1() { let x; while (c) { x = { v: x }; } const r: never = x; }
export function a2() { let x = []; while (c) { x = { v: x }; } const r: never = x; }
export function a3() { const x = []; while (c) { x = { v: x }; } const r: never = x; }
export function a4() { let x; while (c) { x = [x]; } const r: never = x; }
export function a5() { let x; while (c) { x = { v: x, w: 1 }; } return x; }
export function a6() { let x = null; for (const i of [1]) { x = { v: x }; } x.foo; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,65): error TS2322: Type '{ v: undefined; } | undefined' is not assignable to type 'never'.
          Type 'undefined' is not assignable to type 'never'.
        a.ts(3,28): error TS7034: Variable 'x' implicitly has type 'any[]' in some locations where its type cannot be determined.
        a.ts(3,54): error TS2353: Object literal may only specify known properties, and 'v' does not exist in type 'any[]'.
        a.ts(3,57): error TS7005: Variable 'x' implicitly has an 'any[]' type.
        a.ts(3,70): error TS2322: Type 'any[]' is not assignable to type 'never'.
        a.ts(4,30): error TS7034: Variable 'x' implicitly has type 'any[]' in some locations where its type cannot be determined.
        a.ts(4,50): error TS2588: Cannot assign to 'x' because it is a constant.
        a.ts(4,59): error TS7005: Variable 'x' implicitly has an 'any[]' type.
        a.ts(4,72): error TS2322: Type 'any[]' is not assignable to type 'never'.
        a.ts(5,60): error TS2322: Type 'undefined[] | undefined' is not assignable to type 'never'.
          Type 'undefined' is not assignable to type 'never'.
        a.ts(7,77): error TS18047: 'x' is possibly 'null'.
        a.ts(7,79): error TS2339: Property 'foo' does not exist on type '{ v: null; }'."
      `);
      expect(exitCode).toBe(1);
    });

    test("object literals between a loop variable and what is assigned back to it", async () => {
      using dir = project({
        "a.ts": `interface S { nxt: S | null; id: string; kids: S[]; gen<T>(x: T): T; over(a: string): S; over(a: number): S | null }
declare function mk(id?: string): S; declare function wrap<T>(x: T): { w: T }; declare const c: boolean;
export function o1() { let s: S | null = mk(); while (s) { const cur = { v: s }; s = cur.v; } }
export function o2() { let s: S | null = mk(); while (s) { const cur = { s }; s = cur.s; } }
export function o3() { let s: S | null = mk(); while (s) { const cur = { a: { b: s.nxt } }; s = cur.a.b; } }
export function o4() { let s: S | null = mk(); while (s) { const cur = { ...{ v: s } }; s = cur.v; } }
export function o5() { let s: S | null = mk(); while (s) { const cur = { v: s, n: 1 }; s = c ? cur.v : null; } }
export function o6() { let s: S | null = mk(); while (s) { const cur = { f: () => s }; s = cur.f(); } }
export function o7() { let s: S | null = mk(); while (s) { const cur = { get g() { return s; } }; s = cur.g; } }
export function o8() { let s: S | null = mk(); while (s) { const { v } = { v: s }; s = v; } }
export function o9() { let s: S | null = mk(); while (s) { const cur = { v: s } as const; s = cur.v; } }
export function o10() { let s: S | null = mk(); while (s) { const cur = wrap({ v: s }); s = cur.w.v; } }
export function o11() { let s: S | null = mk(); while (s) { const cur = [{ v: s }]; s = cur[0].v; } }
export function o12() { let s: S | null = mk(); while (s) { const cur = { v: s.nxt }; const d = cur.v; s = d; } }
export function k1() { let s: S | null = mk(); while (s) { const cur = s.kids.find(k => true); s = cur ?? null; } }
export function k2() { let s: S | null = mk(); while (s) { const cur = s.kids.find(k => k.id === "a"); s = cur || null; } }
export function k3() { let s: S | null = mk(); while (s) { const cur = s.kids.find(function (k) { return true; }); s = cur === undefined ? null : cur; } }
export function k4() { let s: S | null = mk(); while (s) { const cur = s.kids.map(k => k)[0]; s = cur; } }
export function k5() { let s: S | null = mk(); while (s) { const cur = s.over(1); s = cur; } }
export function k6() { let s: S | null = mk(); while (s) { const cur = s.kids.filter(Boolean); s = cur[0]; } }
export function k7() { let s: S | null = mk(); while (s) { const cur = s.gen(() => s); s = cur(); } }
export function k8() { let s: S | null = mk(); while (s) { const cur = s.kids.at(0); s = cur ?? null; } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,68): error TS7022: 'v' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(11,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,67): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(13,67): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(14,67): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(14,93): error TS7022: 'd' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(15,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(16,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(17,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(18,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(19,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(20,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(21,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("return f() checks the callee f while another resolution is in progress", async () => {
      using dir = project({
        "a.ts": `export function p1() { const a = (x = (b() as any)) => x; function b() { return a(); } }
export function p2() { const a = (x = b()) => x; function b() { return a(); } }
export function p3() { const a = (x = (b as any)) => x; const b = a(); }
export function p4() { const a = (x = (b() as any)) => 1; function b() { return a(); } }
export function p5() { const a = (x = [b()]) => x; function b() { return a(); } }
export function p6() { const a = (x = (b() as any)) => x; const b = () => a(); }
export function p7() { const a = (x = (b() as any)) => x; function b() { return a; } }
export function p8() { const a = (x: any = b()) => x; function b() { return a(); } }
export function p9() { const a = (x: any = b()) => 1; function b() { return a(); } }
export function q1() { const a = function (x = (b() as any)) { return x; }; function b() { return a(); } }
export function q2() { const a = { m(x = (b() as any)) { return x; } }; function b() { return a.m(); } }
export function q3() { const a = (x = (b() as any)) => x; function b() { return a(1); } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,30): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(1,68): error TS7023: 'b' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(2,30): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(2,59): error TS7023: 'b' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(3,30): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(3,63): error TS7022: 'b' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,30): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,68): error TS7023: 'b' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(5,30): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,61): error TS7023: 'b' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(7,30): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,68): error TS7023: 'b' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(8,30): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,64): error TS7023: 'b' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(9,30): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(9,64): error TS7023: 'b' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(10,30): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,86): error TS7023: 'b' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(12,30): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,68): error TS7023: 'b' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions."
      `);
      expect(exitCode).toBe(1);
    });

    test("a type predicate is inferred from the body of a function that is being checked", async () => {
      using dir = project({
        "a.ts": `declare function g2<R>(f: ((v: number) => R) | null): R[];
declare function h1<R>(f?: (v: number) => R): R[];
declare function h2<R>(f: ((v: number) => R) | string): R[];
declare function h3<R>(f: ((v: number) => R) | ((v: number) => R[])): R[];
declare function h4<R>(o: { f: ((v: number) => R) | null }): R[];
declare function h5<R>(o: { f?: (v: number) => R }): R[];
declare function g5<S extends number>(f: (v: number) => v is S): S; declare function g5(f: (v: number) => unknown): number;
declare function h6<S extends number>(f: (v: number) => v is S): S;
declare function h7(f: (v: number) => v is 1): 1;
export const c2 = g2(v => c2);
export const e1 = h1(v => e1);
export const e2 = h2(v => e2);
export const e3 = h3(v => e3);
export const e4 = h4({ f: v => e4 });
export const e5 = h5({ f: v => e5 });
export const c5 = g5(v => c5 === v);
export const e6 = h6(v => e6 === v);
export const e7 = h7(v => e7 === v);
export const e8 = g2(function (v) { return e8; });
export const e9 = Promise.resolve(1).then(v => e9);
export const e10 = [1].find(x => e10 === x);
export const e11 = [1].filter(x => e11.length === x);
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(10,14): error TS7022: 'c2' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(11,14): error TS7022: 'e1' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,14): error TS7022: 'e2' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(13,14): error TS7022: 'e3' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(14,14): error TS7022: 'e4' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(15,14): error TS7022: 'e5' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(16,14): error TS7022: 'c5' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(17,14): error TS7022: 'e6' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(17,22): error TS2345: Argument of type '(v: number) => boolean' is not assignable to parameter of type '(v: number) => v is number'.
          Signature '(v: number): boolean' must be a type predicate.
        a.ts(19,14): error TS7022: 'e8' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(20,14): error TS7022: 'e9' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(21,14): error TS7022: 'e10' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(22,14): error TS7022: 'e11' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("unique symbol types of constants that are exported and of those that are not", async () => {
      using dir = project({
        "a.ts": `export const s1 = Symbol(), s2 = Symbol("d");
export const t1: typeof s1 = s2;
const l1 = Symbol(), l2 = Symbol();
export const t2: typeof l1 = l2;
export const t3: typeof s1 = l2;
export function f(a: typeof s1, b: typeof s2) { a = b; const x: string = a; return x; }
export class S { static readonly k = Symbol(); static readonly j = Symbol(); }
export const t4: typeof S.k = S.j;
class L { static readonly k = Symbol(); static readonly j = Symbol(); }
export const t5: typeof L.k = L.j;
namespace N { export const n1 = Symbol(); export const n2 = Symbol(); }
export const t6: typeof N.n1 = N.n2;
export namespace M { export const m1 = Symbol(); export const m2 = Symbol(); }
export const t7: typeof M.m1 = M.m2;
export const t8: { [s1]: number } = { [s2]: 1 };
export const t9: string = { [s1]: 1, [L.k]: 2 };
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,14): error TS2322: Type 'typeof import("<dir>/a").s2' is not assignable to type 'typeof import("<dir>/a").s1'.
        a.ts(4,14): error TS2322: Type 'typeof l2' is not assignable to type 'typeof l1'.
        a.ts(5,14): error TS2322: Type 'typeof l2' is not assignable to type 'typeof import("<dir>/a").s1'.
        a.ts(6,49): error TS2322: Type 'typeof import("<dir>/a").s2' is not assignable to type 'typeof import("<dir>/a").s1'.
        a.ts(6,62): error TS2322: Type 'typeof import("<dir>/a").s1' is not assignable to type 'string'.
        a.ts(8,14): error TS2322: Type 'typeof import("<dir>/a").S.j' is not assignable to type 'typeof import("<dir>/a").S.k'.
        a.ts(10,14): error TS2322: Type 'typeof L.j' is not assignable to type 'typeof L.k'.
        a.ts(12,14): error TS2322: Type 'typeof N.n2' is not assignable to type 'typeof N.n1'.
        a.ts(14,14): error TS2322: Type 'typeof import("<dir>/a").M.m2' is not assignable to type 'typeof import("<dir>/a").M.m1'.
        a.ts(15,39): error TS2353: Object literal may only specify known properties, and '[s2]' does not exist in type '{ [s1]: number; }'.
        a.ts(16,14): error TS2322: Type '{ [s1]: number; [L.k]: number; }' is not assignable to type 'string'."
      `);
      expect(exitCode).toBe(1);
    });

    test("eleven shapes of interfaces and classes that extend each other", async () => {
      using dir = project({
        "a.ts": `// Each namespace is one shape of cycle. \`never\` puts the type of an inherited member in the message.
namespace C3 { export interface A extends B { a: 1 } export interface B extends C { b: 2 } export interface C extends A { c: 3 } }
declare const c3a: C3.A, c3b: C3.B, c3c: C3.C;
export const c3 = [c3a.a, c3a.b, c3a.c, c3b.a, c3b.b, c3b.c, c3c.a, c3c.b, c3c.c];
namespace Two { export interface P extends Q { p: 1 } export interface Q extends P, R { q: 2 } export interface R extends Q { r: 3 } }
declare const twp: Two.P, twq: Two.Q, twr: Two.R;
export const two = [twp.p, twp.q, twp.r, twq.p, twq.q, twq.r, twr.p, twr.q, twr.r];
namespace Late { export interface A extends D0, B, E { a: 1 } export interface D0 { d: 0 } export interface B extends A { b: 2 } export interface E extends B { e: 3 } }
declare const lta: Late.A, ltb: Late.B, lte: Late.E;
export const late = [lta.a, lta.b, lta.d, lta.e, ltb.a, ltb.b, ltb.d, ltb.e, lte.a, lte.b, lte.d, lte.e];
namespace Part { export interface A extends X, B { a: 1 } export interface X extends Y { x: 0 } export interface Y { y: 0 } export interface B extends A, Y { b: 2 } }
declare const pta: Part.A, ptb: Part.B;
export const part = [pta.a, pta.b, pta.x, pta.y, ptb.a, ptb.b, ptb.x, ptb.y];
namespace Gen { export interface A<T> extends B<T[]> { a: T } export interface B<T> extends A<T> { b: T } }
declare const gna: Gen.A<string>, gnb: Gen.B<string>;
export const gen = [gna.a, gna.b, gnb.a, gnb.b];
namespace Use { declare const v: F; export const u = v.e; export interface E extends F { e: 1 } export interface F extends E { f: 2 } }
declare const use: Use.E, usf: Use.F;
export const uses = [use.e, use.f, usf.e, usf.f];
namespace Out { export interface Z extends A { z: 0 } export interface A extends B { a: 1 } export interface B extends A { b: 2 } }
declare const otz: Out.Z;
export const out = [otz.z, otz.a, otz.b];
namespace Cls { export declare class A extends B { a: 1 } export declare class B extends C { b: 2 } export declare class C extends A { c: 3 } }
declare const cla: Cls.A, clb: Cls.B, clc: Cls.C;
export const cls = [cla.a, cla.b, cla.c, clb.a, clb.b, clb.c, clc.a, clc.b, clc.c];
namespace Mix { export declare class A { a: 1 } export interface A extends I {} export interface I extends A { i: 2 } }
declare const mxa: Mix.A, mxi: Mix.I;
export const mix = [mxa.a, mxa.i, mxi.a, mxi.i];
namespace Mem { export interface A extends Pick<B, "b">, B { a: 1 } export interface B extends A { b: 2 } }
declare const mea: Mem.A, meb: Mem.B;
export const mem = [mea.a, mea.b, meb.a, meb.b];
namespace Key { export interface A extends Record<keyof B, 1> { a: 1 } export interface B extends A { b: 2 } }
declare const kya: Key.A, kyb: Key.B;
export const key = [kya.a, kya.b, kyb.a, kyb.b];
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,33): error TS2310: Type 'A' recursively references itself as a base type.
        a.ts(2,71): error TS2310: Type 'B' recursively references itself as a base type.
        a.ts(2,109): error TS2310: Type 'C' recursively references itself as a base type.
        a.ts(4,31): error TS2339: Property 'b' does not exist on type 'A'.
        a.ts(4,38): error TS2339: Property 'c' does not exist on type 'A'.
        a.ts(4,73): error TS2339: Property 'b' does not exist on type 'C'.
        a.ts(5,34): error TS2310: Type 'P' recursively references itself as a base type.
        a.ts(5,72): error TS2310: Type 'Q' recursively references itself as a base type.
        a.ts(5,113): error TS2310: Type 'R' recursively references itself as a base type.
        a.ts(7,32): error TS2339: Property 'q' does not exist on type 'P'.
        a.ts(7,39): error TS2339: Property 'r' does not exist on type 'P'.
        a.ts(7,60): error TS2339: Property 'r' does not exist on type 'Q'.
        a.ts(8,35): error TS2310: Type 'A' recursively references itself as a base type.
        a.ts(8,109): error TS2310: Type 'B' recursively references itself as a base type.
        a.ts(8,147): error TS2310: Type 'E' recursively references itself as a base type.
        a.ts(10,33): error TS2339: Property 'b' does not exist on type 'A'.
        a.ts(10,47): error TS2339: Property 'e' does not exist on type 'A'.
        a.ts(10,75): error TS2339: Property 'e' does not exist on type 'B'.
        a.ts(11,35): error TS2310: Type 'A' recursively references itself as a base type.
        a.ts(11,142): error TS2310: Type 'B' recursively references itself as a base type.
        a.ts(13,33): error TS2339: Property 'b' does not exist on type 'A'.
        a.ts(14,34): error TS2310: Type 'A<T>' recursively references itself as a base type.
        a.ts(14,80): error TS2310: Type 'B<T>' recursively references itself as a base type.
        a.ts(16,32): error TS2339: Property 'b' does not exist on type 'A<string>'.
        a.ts(17,56): error TS2339: Property 'e' does not exist on type 'F'.
        a.ts(17,76): error TS2310: Type 'E' recursively references itself as a base type.
        a.ts(17,114): error TS2310: Type 'F' recursively references itself as a base type.
        a.ts(19,40): error TS2339: Property 'e' does not exist on type 'F'.
        a.ts(20,72): error TS2310: Type 'A' recursively references itself as a base type.
        a.ts(20,110): error TS2310: Type 'B' recursively references itself as a base type.
        a.ts(22,39): error TS2339: Property 'b' does not exist on type 'Z'.
        a.ts(23,38): error TS2506: 'A' is referenced directly or indirectly in its own base expression.
        a.ts(23,80): error TS2506: 'B' is referenced directly or indirectly in its own base expression.
        a.ts(23,122): error TS2506: 'C' is referenced directly or indirectly in its own base expression.
        a.ts(25,32): error TS2339: Property 'b' does not exist on type 'A'.
        a.ts(25,39): error TS2339: Property 'c' does not exist on type 'A'.
        a.ts(25,46): error TS2339: Property 'a' does not exist on type 'B'.
        a.ts(25,60): error TS2339: Property 'c' does not exist on type 'B'.
        a.ts(25,67): error TS2339: Property 'a' does not exist on type 'C'.
        a.ts(25,74): error TS2339: Property 'b' does not exist on type 'C'.
        a.ts(26,38): error TS2310: Type 'A' recursively references itself as a base type.
        a.ts(26,66): error TS2310: Type 'A' recursively references itself as a base type.
        a.ts(26,98): error TS2310: Type 'I' recursively references itself as a base type.
        a.ts(28,32): error TS2339: Property 'i' does not exist on type 'A'.
        a.ts(29,34): error TS2310: Type 'A' recursively references itself as a base type.
        a.ts(29,86): error TS2310: Type 'B' recursively references itself as a base type.
        a.ts(32,34): error TS2310: Type 'A' recursively references itself as a base type.
        a.ts(32,89): error TS2310: Type 'B' recursively references itself as a base type.
        a.ts(32,89): error TS2430: Interface 'B' incorrectly extends interface 'A'.
          Types of property 'b' are incompatible.
            Type '2' is not assignable to type '1'."
      `);
      expect(exitCode).toBe(1);
    });

    test("the first use of an interface that extends itself through another", async () => {
      using dir = project({
        "a.ts": `declare const v: F;
v.e;
v.f;
v.e;
interface E extends F { e: 1 }
interface F extends E { f: 2 }
v.e;
export {};
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,3): error TS2339: Property 'e' does not exist on type 'F'.
        a.ts(4,3): error TS2339: Property 'e' does not exist on type 'F'.
        a.ts(5,11): error TS2310: Type 'E' recursively references itself as a base type.
        a.ts(6,11): error TS2310: Type 'F' recursively references itself as a base type.
        a.ts(7,3): error TS2339: Property 'e' does not exist on type 'F'."
      `);
      expect(exitCode).toBe(1);
    });

    test("interfaces and classes in several files that extend each other", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": false}, "files": ["a.d.ts", "b.d.ts", "c.d.ts", "d.ts", "e.ts", "u.ts"]}`,
        "a.d.ts": `interface A2 extends B2 { a: 1; m?: 1 }
interface A3 extends B3 { a: 1 }
declare class KA extends KB { a: 1 }
interface R1 extends R2 { r1: 1 }
`,
        "b.d.ts": `interface B2 extends A2 { b: 2; m: 1 | 2 }
interface B3 extends C3 { b: 2 }
declare class KB extends KC { b: 2 }
interface R3 extends R1 { r3: 3 }
`,
        "c.d.ts": `interface C3 extends A3 { c: 3 }
declare class KC extends KA { c: 3 }
interface R2 extends R3 { r2: 2 }
`,
        "d.ts": `interface S1 extends S2 { s1: 1; n?: 1 }
declare const s2first: S2;
const d1: never = s2first.s1;
`,
        "e.ts": `interface S2 extends S1 { s2: 2; n: 1 | 2 }
declare const s1late: S1;
const e1: never = s1late.s2;
`,
        "u.ts": `declare const a2: A2, b2: B2, a3: A3, b3: B3, c3: C3, ka: KA, kb: KB, kc: KC, r1: R1, r2: R2, r3: R3, s1: S1, s2: S2;
const u2 = [b2.a, b2.b, a2.a, a2.b];
const u3 = [c3.a, c3.b, c3.c, b3.a, b3.b, b3.c, a3.a, a3.b, a3.c];
const uk = [kc.a, kc.b, kc.c, kb.a, kb.b, kb.c, ka.a, ka.b, ka.c];
const ur = [r3.r1, r3.r2, r3.r3, r2.r1, r2.r2, r2.r3, r1.r1, r1.r2, r1.r3];
const us = [s2.s1, s2.s2, s1.s1, s1.s2];
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.d.ts(1,11): error TS2310: Type 'A2' recursively references itself as a base type.
        a.d.ts(2,11): error TS2310: Type 'A3' recursively references itself as a base type.
        a.d.ts(3,15): error TS2506: 'KA' is referenced directly or indirectly in its own base expression.
        a.d.ts(4,11): error TS2310: Type 'R1' recursively references itself as a base type.
        b.d.ts(1,11): error TS2310: Type 'B2' recursively references itself as a base type.
        b.d.ts(1,11): error TS2430: Interface 'B2' incorrectly extends interface 'A2'.
          Types of property 'm' are incompatible.
            Type '1 | 2' is not assignable to type '1 | undefined'.
              Type '2' is not assignable to type '1'.
        b.d.ts(2,11): error TS2310: Type 'B3' recursively references itself as a base type.
        b.d.ts(3,15): error TS2506: 'KB' is referenced directly or indirectly in its own base expression.
        b.d.ts(4,11): error TS2310: Type 'R3' recursively references itself as a base type.
        c.d.ts(1,11): error TS2310: Type 'C3' recursively references itself as a base type.
        c.d.ts(2,15): error TS2506: 'KC' is referenced directly or indirectly in its own base expression.
        c.d.ts(3,11): error TS2310: Type 'R2' recursively references itself as a base type.
        d.ts(1,11): error TS2310: Type 'S1' recursively references itself as a base type.
        d.ts(3,7): error TS2322: Type '1' is not assignable to type 'never'.
        e.ts(1,11): error TS2310: Type 'S2' recursively references itself as a base type.
        e.ts(1,11): error TS2430: Interface 'S2' incorrectly extends interface 'S1'.
          Types of property 'n' are incompatible.
            Type '1 | 2' is not assignable to type '1 | undefined'.
              Type '2' is not assignable to type '1'.
        e.ts(3,7): error TS2322: Type 'any' is not assignable to type 'never'.
        e.ts(3,26): error TS2339: Property 's2' does not exist on type 'S1'.
        u.ts(2,34): error TS2339: Property 'b' does not exist on type 'A2'.
        u.ts(3,22): error TS2339: Property 'b' does not exist on type 'C3'.
        u.ts(3,58): error TS2339: Property 'b' does not exist on type 'A3'.
        u.ts(3,64): error TS2339: Property 'c' does not exist on type 'A3'.
        u.ts(4,16): error TS2339: Property 'a' does not exist on type 'KC'.
        u.ts(4,22): error TS2339: Property 'b' does not exist on type 'KC'.
        u.ts(4,34): error TS2339: Property 'a' does not exist on type 'KB'.
        u.ts(4,46): error TS2339: Property 'c' does not exist on type 'KB'.
        u.ts(4,58): error TS2339: Property 'b' does not exist on type 'KA'.
        u.ts(4,64): error TS2339: Property 'c' does not exist on type 'KA'.
        u.ts(5,23): error TS2339: Property 'r2' does not exist on type 'R3'.
        u.ts(5,65): error TS2339: Property 'r2' does not exist on type 'R1'.
        u.ts(5,72): error TS2339: Property 'r3' does not exist on type 'R1'.
        u.ts(6,37): error TS2339: Property 's2' does not exist on type 'S1'."
      `);
      expect(exitCode).toBe(1);
    });

    test("interfaces and classes in declaration files that extend each other, with skipLibCheck", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true}, "files": ["a.d.ts", "b.d.ts", "c.d.ts", "d.ts", "e.ts", "u.ts"]}`,
        "a.d.ts": `interface A2 extends B2 { a: 1; m?: 1 }
interface A3 extends B3 { a: 1 }
declare class KA extends KB { a: 1 }
interface R1 extends R2 { r1: 1 }
`,
        "b.d.ts": `interface B2 extends A2 { b: 2; m: 1 | 2 }
interface B3 extends C3 { b: 2 }
declare class KB extends KC { b: 2 }
interface R3 extends R1 { r3: 3 }
`,
        "c.d.ts": `interface C3 extends A3 { c: 3 }
declare class KC extends KA { c: 3 }
interface R2 extends R3 { r2: 2 }
`,
        "d.ts": `interface S1 extends S2 { s1: 1; n?: 1 }
declare const s2first: S2;
const d1: never = s2first.s1;
`,
        "e.ts": `interface S2 extends S1 { s2: 2; n: 1 | 2 }
declare const s1late: S1;
const e1: never = s1late.s2;
`,
        "u.ts": `declare const a2: A2, b2: B2, a3: A3, b3: B3, c3: C3, ka: KA, kb: KB, kc: KC, r1: R1, r2: R2, r3: R3, s1: S1, s2: S2;
const u2 = [b2.a, b2.b, a2.a, a2.b];
const u3 = [c3.a, c3.b, c3.c, b3.a, b3.b, b3.c, a3.a, a3.b, a3.c];
const uk = [kc.a, kc.b, kc.c, kb.a, kb.b, kb.c, ka.a, ka.b, ka.c];
const ur = [r3.r1, r3.r2, r3.r3, r2.r1, r2.r2, r2.r3, r1.r1, r1.r2, r1.r3];
const us = [s2.s1, s2.s2, s1.s1, s1.s2];
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "d.ts(1,11): error TS2310: Type 'S1' recursively references itself as a base type.
        d.ts(3,7): error TS2322: Type '1' is not assignable to type 'never'.
        e.ts(1,11): error TS2310: Type 'S2' recursively references itself as a base type.
        e.ts(1,11): error TS2430: Interface 'S2' incorrectly extends interface 'S1'.
          Types of property 'n' are incompatible.
            Type '1 | 2' is not assignable to type '1 | undefined'.
              Type '2' is not assignable to type '1'.
        e.ts(3,7): error TS2322: Type 'any' is not assignable to type 'never'.
        e.ts(3,26): error TS2339: Property 's2' does not exist on type 'S1'.
        u.ts(2,16): error TS2339: Property 'a' does not exist on type 'B2'.
        u.ts(3,16): error TS2339: Property 'a' does not exist on type 'C3'.
        u.ts(3,22): error TS2339: Property 'b' does not exist on type 'C3'.
        u.ts(3,34): error TS2339: Property 'a' does not exist on type 'B3'.
        u.ts(4,16): error TS2339: Property 'a' does not exist on type 'KC'.
        u.ts(4,22): error TS2339: Property 'b' does not exist on type 'KC'.
        u.ts(4,34): error TS2339: Property 'a' does not exist on type 'KB'.
        u.ts(4,46): error TS2339: Property 'c' does not exist on type 'KB'.
        u.ts(4,58): error TS2339: Property 'b' does not exist on type 'KA'.
        u.ts(4,64): error TS2339: Property 'c' does not exist on type 'KA'.
        u.ts(5,16): error TS2339: Property 'r1' does not exist on type 'R3'.
        u.ts(5,23): error TS2339: Property 'r2' does not exist on type 'R3'.
        u.ts(5,37): error TS2339: Property 'r1' does not exist on type 'R2'.
        u.ts(6,37): error TS2339: Property 's2' does not exist on type 'S1'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a property that is lost because two interfaces in a declaration file extend each other", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true}, "files": ["a.d.ts", "u.ts"]}`,
        "a.d.ts": `interface A2 extends B2 { a: 1 }
interface B2 extends A2 { b: 2 }
`,
        "u.ts": `declare const b2: B2;
export const u = b2.a;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`"u.ts(2,21): error TS2339: Property 'a' does not exist on type 'B2'."`);
      expect(exitCode).toBe(1);
    });

    test("an interface and a base of it that extend each other through namespaces in three files", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": false}, "files": ["a.d.ts", "b.d.ts", "c.d.ts", "u.ts"]}`,
        "a.d.ts": `interface D { [k: string]: string | undefined }
declare namespace N { interface PE extends D { TZ?: string } }
`,
        "b.d.ts": `declare namespace B { interface Env extends D, N.PE { NODE_ENV?: string } }
`,
        "c.d.ts": `interface X { NODE_ENV: string }
declare namespace N { interface PE extends B.Env, X {} }
`,
        "u.ts": `declare const pe: N.PE; declare const env: B.Env;
export const p1: never = pe.NODE_ENV;
export const p2: never = env.TZ;
export const p3: N.PE = {};
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.d.ts(2,33): error TS2310: Type 'PE' recursively references itself as a base type.
        b.d.ts(1,33): error TS2310: Type 'Env' recursively references itself as a base type.
        b.d.ts(1,33): error TS2430: Interface 'Env' incorrectly extends interface 'PE'.
          Types of property 'NODE_ENV' are incompatible.
            Type 'string | undefined' is not assignable to type 'string'.
              Type 'undefined' is not assignable to type 'string'.
        c.d.ts(2,33): error TS2310: Type 'PE' recursively references itself as a base type.
        u.ts(2,14): error TS2322: Type 'string' is not assignable to type 'never'.
        u.ts(3,14): error TS2322: Type 'string | undefined' is not assignable to type 'never'.
          Type 'undefined' is not assignable to type 'never'.
        u.ts(4,14): error TS2741: Property 'NODE_ENV' is missing in type '{}' but required in type 'PE'."
      `);
      expect(exitCode).toBe(1);
    });

    test("errors about the base types of a merged interface are at its first declaration in the program", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": false}, "files": ["a.d.ts", "b.d.ts", "c.ts", "d.ts"]}`,
        "a.d.ts": `export {};
interface Base { x: string }
interface P1 { k: string } interface P2 { k: number }
interface HasProp { s: string } interface HasIndex { [k: string]: number }
declare global {
  interface R extends Base {}
  interface Q extends P1, P2 {}
  interface F extends HasProp {}
  interface Twice extends Base {}
  interface Twice { y: 1 }
  interface InTs extends Base {}
  interface Late { x: number }
  interface G2 extends HasIndex {}
}
`,
        "b.d.ts": `interface R { x: number }
interface Q { z: 1 }
interface HasIndexB { [k: string]: number }
interface F extends HasIndexB {}
interface Twice { x: number }
interface Twice { w: 2 }
interface BaseB { x: string }
interface Late extends BaseB {}
interface HasPropB { s: string }
interface G2 { a: 1 }
interface G2 extends HasPropB {}
`,
        "c.ts": `interface InTs { x: number }
interface R { r: 1 }
interface F { f: 1 }
`,
        "d.ts": `export {};
declare global {
  interface R { d: 1 }
  interface InTs { d: 1 }
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.d.ts(6,13): error TS2430: Interface 'R' incorrectly extends interface 'Base'.
          Types of property 'x' are incompatible.
            Type 'number' is not assignable to type 'string'.
        a.d.ts(7,13): error TS2320: Interface 'Q' cannot simultaneously extend types 'P1' and 'P2'.
          Named property 'k' of types 'P1' and 'P2' are not identical.
        a.d.ts(9,13): error TS2430: Interface 'Twice' incorrectly extends interface 'Base'.
          Types of property 'x' are incompatible.
            Type 'number' is not assignable to type 'string'.
        a.d.ts(11,13): error TS2430: Interface 'InTs' incorrectly extends interface 'Base'.
          Types of property 'x' are incompatible.
            Type 'number' is not assignable to type 'string'.
        a.d.ts(12,13): error TS2430: Interface 'Late' incorrectly extends interface 'BaseB'.
          Types of property 'x' are incompatible.
            Type 'number' is not assignable to type 'string'.
        b.d.ts(4,11): error TS2411: Property 's' of type 'string' is not assignable to 'string' index type 'number'.
        b.d.ts(10,11): error TS2411: Property 's' of type 'string' is not assignable to 'string' index type 'number'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an interface merged from a script and from declare global extends incorrectly", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": false}, "files": ["a.d.ts", "b.d.ts", "c.ts"]}`,
        "a.d.ts": `export {};
interface Base { x: string }
interface P1 { k: string } interface P2 { k: number }
declare global {
  interface R extends Base {}
  interface Q extends P1, P2 {}
  interface I { [k: string]: number }
}
`,
        "b.d.ts": `interface R { x: number }
interface Q { z: 1 }
interface I { s: string }
`,
        "c.ts": `export const r: R = null!;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.d.ts(5,13): error TS2430: Interface 'R' incorrectly extends interface 'Base'.
          Types of property 'x' are incompatible.
            Type 'number' is not assignable to type 'string'.
        a.d.ts(6,13): error TS2320: Interface 'Q' cannot simultaneously extend types 'P1' and 'P2'.
          Named property 'k' of types 'P1' and 'P2' are not identical.
        b.d.ts(3,15): error TS2411: Property 's' of type 'string' is not assignable to 'string' index type 'number'."
      `);
      expect(exitCode).toBe(1);
    });

    test("two declarations of a property need identical types, not types assignable to each other", async () => {
      using dir = project({
        "a.ts": `export interface A { x?: object | undefined; y: object; z: object[]; w: object | null }
export interface A { x?: {} | undefined; y: {}; z: {}[]; w: {} | null }
export interface B { x: {}; y: {} | undefined }
export interface B { x: object; y: object | undefined }
export interface C { x: {}; y: { a: 1 } }
export interface C { x: {}; y: { a: 1 } }
export interface D { x: unknown; y: {} | null | undefined }
export interface D { x: {} | null | undefined; y: unknown }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,22): error TS2717: Subsequent property declarations must have the same type.  Property 'x' must be of type 'object | undefined', but here has type '{} | undefined'.
        a.ts(2,42): error TS2717: Subsequent property declarations must have the same type.  Property 'y' must be of type 'object', but here has type '{}'.
        a.ts(2,49): error TS2717: Subsequent property declarations must have the same type.  Property 'z' must be of type 'object[]', but here has type '{}[]'.
        a.ts(2,58): error TS2717: Subsequent property declarations must have the same type.  Property 'w' must be of type 'object | null', but here has type '{} | null'.
        a.ts(4,22): error TS2717: Subsequent property declarations must have the same type.  Property 'x' must be of type '{}', but here has type 'object'.
        a.ts(4,33): error TS2717: Subsequent property declarations must have the same type.  Property 'y' must be of type '{} | undefined', but here has type 'object | undefined'.
        a.ts(8,22): error TS2717: Subsequent property declarations must have the same type.  Property 'x' must be of type 'unknown', but here has type '{} | null | undefined'.
        a.ts(8,48): error TS2717: Subsequent property declarations must have the same type.  Property 'y' must be of type '{} | null | undefined', but here has type 'unknown'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a symbol that is the result of a merge is visible in the scope of its module", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": false}, "files": ["a.d.ts", "b.d.ts", "c.ts"]}`,
        "a.d.ts": `declare module "m" {
  type F = (t: C, u: D, v: typeof E) => void;
  export interface C { a: 1 }
  export interface D { a: 1 }
  export const E: 1;
  export { F };
}
`,
        "b.d.ts": `declare module "m" {
  type G = (t: C, u: D) => void;
  interface L { l: 1 }
  export { C, G };
  export { L as D };
  export { L as E };
}
`,
        "c.ts": `import type { C, D, E, F, G } from "m";
export declare const c: C, d: D, e: E, f: F, g: G;
export const r: [never, never, never] = [c, d, e];
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "b.d.ts(4,12): error TS2484: Export declaration conflicts with exported declaration of 'C'.
        b.d.ts(5,12): error TS2484: Export declaration conflicts with exported declaration of 'D'.
        c.ts(3,42): error TS2322: Type 'C' is not assignable to type 'never'.
        c.ts(3,45): error TS2322: Type 'D' is not assignable to type 'never'.
        c.ts(3,48): error TS2322: Type 'L' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an exported name that also has an interface declaration in another file", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": false}, "files": ["a.d.ts", "b.d.ts"]}`,
        "a.d.ts": `declare module "m" {
  type F = (t: C) => void;
  export interface C { a: 1 }
  export { F };
}
`,
        "b.d.ts": `declare module "m" {
  class C { b: 1 }
  type G = (t: C) => void;
  export { C, G };
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"b.d.ts(4,12): error TS2484: Export declaration conflicts with exported declaration of 'C'."`,
      );
      expect(exitCode).toBe(1);
    });

    test("declarations augmented through a chain of two re-exports", async () => {
      using dir = project({
        "aug1.ts": `export {};
declare module "./types" { interface K { one: 1 } interface C { one: 1 } }
`,
        "aug2.ts": `export {};
declare module "./main" { interface K { two: 2 } interface C { two: 2 } enum E { b = 1 } namespace N { interface I { two: 2 } interface J { j: 1 } } }
`,
        "index.ts": `export type { K } from "./types";
export { C, E, N } from "./types";
`,
        "index2.ts": `export { K, C, E, N } from "./index";
`,
        "main.ts": `export * from "./index2";
`,
        "types.ts": `export interface K { k: 1 }
export class C { c = 1 }
export enum E { a }
export namespace N { export interface I { i: 1 } }
`,
        "use.ts": `import type { K as A, C as CA, N as NA } from "./main";
import type { K as B, C as CB, N as NB } from "./index2";
import type { K as D, C as CD, N as ND } from "./index";
import type { K as F, C as CF, N as NF } from "./types";
import { E as E1 } from "./main";
import { E as E2 } from "./index2";
import { E as E3 } from "./index";
import { E as E4 } from "./types";
export const a: A = { k: 1 };
export const b: B = { k: 1 };
export const d: D = { k: 1 };
export const f: F = { k: 1 };
export const ca: CA = { c: 1 };
export const cb: CB = { c: 1 };
export const cd: CD = { c: 1 };
export const cf: CF = { c: 1 };
export const na: NA.I = { i: 1 }, ja: NA.J = {};
export const nb: NB.I = { i: 1 }, jb: NB.J = {};
export const nd: ND.I = { i: 1 }, jd: ND.J = {};
export const nf: NF.I = { i: 1 };
export const e: never[] = [E1.b, E2.b, E3.b, E4.b];
export const t: [E1, E2, E3] = [0 as never as E3, 0 as never as E1, 0 as never as E2];
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "use.ts(9,14): error TS2739: Type '{ k: 1; }' is missing the following properties from type 'K': one, two
        use.ts(10,14): error TS2739: Type '{ k: 1; }' is missing the following properties from type 'K': one, two
        use.ts(11,14): error TS2739: Type '{ k: 1; }' is missing the following properties from type 'K': one, two
        use.ts(12,14): error TS2739: Type '{ k: 1; }' is missing the following properties from type 'K': one, two
        use.ts(13,14): error TS2739: Type '{ c: number; }' is missing the following properties from type 'C': one, two
        use.ts(14,14): error TS2739: Type '{ c: number; }' is missing the following properties from type 'C': one, two
        use.ts(15,14): error TS2739: Type '{ c: number; }' is missing the following properties from type 'C': one, two
        use.ts(16,14): error TS2739: Type '{ c: number; }' is missing the following properties from type 'C': one, two
        use.ts(17,14): error TS2741: Property 'two' is missing in type '{ i: 1; }' but required in type 'I'.
        use.ts(17,35): error TS2741: Property 'j' is missing in type '{}' but required in type 'J'.
        use.ts(18,14): error TS2741: Property 'two' is missing in type '{ i: 1; }' but required in type 'I'.
        use.ts(18,35): error TS2741: Property 'j' is missing in type '{}' but required in type 'J'.
        use.ts(19,14): error TS2741: Property 'two' is missing in type '{ i: 1; }' but required in type 'I'.
        use.ts(19,35): error TS2741: Property 'j' is missing in type '{}' but required in type 'J'.
        use.ts(20,14): error TS2741: Property 'two' is missing in type '{ i: 1; }' but required in type 'I'.
        use.ts(21,28): error TS2322: Type 'E.b' is not assignable to type 'never'.
        use.ts(21,34): error TS2322: Type 'E.b' is not assignable to type 'never'.
        use.ts(21,40): error TS2322: Type 'E.b' is not assignable to type 'never'.
        use.ts(21,46): error TS2322: Type 'E.b' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an interface augmented through export * of a named re-export, by three import paths", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": false}, "files": ["use.ts", "aug.ts"]}`,
        "aug.ts": `export {};
declare module "./main" { interface K { more: 2 } }
`,
        "index.ts": `export type { K } from "./types";
`,
        "main.ts": `export * from "./index";
`,
        "types.ts": `export interface K { k: 1 }
`,
        "use.ts": `import type { K as A } from "./main";
import type { K as B } from "./index";
import type { K as C } from "./types";
export const a: A = { k: 1 };
export const b: B = { k: 1 };
export const c: C = { k: 1 };
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "use.ts(4,14): error TS2741: Property 'more' is missing in type '{ k: 1; }' but required in type 'K'.
        use.ts(5,14): error TS2741: Property 'more' is missing in type '{ k: 1; }' but required in type 'K'.
        use.ts(6,14): error TS2741: Property 'more' is missing in type '{ k: 1; }' but required in type 'K'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a merge that is refused reports what the two symbols were at that moment", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": false}, "files": ["a.d.ts", "b.d.ts", "c.d.ts"]}`,
        "a.d.ts": `declare module "con" {
  global {
    namespace con { interface Options { o: 1 } }
    namespace fn { interface Options { o: 1 } }
    namespace en { interface Options { o: 1 } }
    interface late { l: 1 }
  }
}
`,
        "b.d.ts": `declare var con: number;
declare function fn(): void;
declare enum en { a }
declare namespace first { interface I { i: 1 } }
declare var late: number;
`,
        "c.d.ts": `declare class con {}
declare const fn: number;
declare var en: number;
declare const first: number;
declare class late {}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "b.d.ts(1,13): error TS2300: Duplicate identifier 'con'.
        b.d.ts(2,18): error TS2451: Cannot redeclare block-scoped variable 'fn'.
        b.d.ts(3,14): error TS2567: Enum declarations can only merge with namespace or other enum declarations.
        b.d.ts(5,13): error TS2300: Duplicate identifier 'late'.
        c.d.ts(1,15): error TS2300: Duplicate identifier 'con'.
        c.d.ts(2,15): error TS2451: Cannot redeclare block-scoped variable 'fn'.
        c.d.ts(3,13): error TS2567: Enum declarations can only merge with namespace or other enum declarations.
        c.d.ts(5,15): error TS2300: Duplicate identifier 'late'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a variable, a namespace and another variable of one name in three files", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": false}, "files": ["a.d.ts", "b.d.ts", "c.d.ts"]}`,
        "a.d.ts": `declare module "con" {
  global {
    namespace con { interface Options { o: 1 } }
    var con: number;
  }
  export = globalThis.con;
}
`,
        "b.d.ts": `declare var con: number;
`,
        "c.d.ts": `declare const con: number;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "b.d.ts(1,13): error TS2451: Cannot redeclare block-scoped variable 'con'.
        c.d.ts(1,15): error TS2451: Cannot redeclare block-scoped variable 'con'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an instantiation that ended at the depth limit is not reported again", async () => {
      using dir = project({
        "a.ts": `type Ser<T> = T extends Function ? never : T extends Promise<infer U> ? Ser<U> : T extends string & {} ? T : T extends Record<string, any> ? { [K in keyof T]: Ser<T[K]> } : T;
type DeepPartial<T> = T extends Function ? T : T extends Record<string, any> ? { [P in keyof T]?: DeepPartial<T[P]> } : T;
type Nest = (string | Nest)[];
interface Node1 { kids: Node1[]; v: string }
type Tup = [string, Tup?];
export type A1 = Ser<Nest>;
export type A2 = Ser<Node1>;
export type A3 = Ser<Tup>;
export type A4 = DeepPartial<{ h: Ser<Nest> }>;
export type A5 = DeepPartial<Nest>;
export declare const a1: A1; export const n1: never = a1;
export declare const a3: A3; export const n3: never = a3;
export declare const a4: A4; export const n4: never = a4;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(6,18): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(8,18): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(10,18): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(11,43): error TS2322: Type 'any' is not assignable to type 'never'.
        a.ts(12,43): error TS2322: Type 'any' is not assignable to type 'never'.
        a.ts(13,43): error TS2322: Type '{ h?: any; }' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("the value type of a decorated member keeps this", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": false, "noEmit": true, "target": "es2022", "module": "esnext", "moduleResolution": "bundler", "lib": ["es5", "esnext.decorators", "decorators"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "a.ts": `declare function Dec(target: object, key: string): void;
class Coll<T, O> { t: T; o: O }
export class Book {
  @Dec notes = new Coll<number, this>();
  @Dec typed: Coll<number, this>;
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(4,4): error TS1240: Unable to resolve signature of property decorator when called as an expression.
          Argument of type 'ClassFieldDecoratorContext<Book, Coll<number, this>> & { name: "notes"; private: false; static: false; }' is not assignable to parameter of type 'string'.
        a.ts(5,4): error TS1240: Unable to resolve signature of property decorator when called as an expression.
          Argument of type 'ClassFieldDecoratorContext<Book, Coll<number, this>> & { name: "typed"; private: false; static: false; }' is not assignable to parameter of type 'string'."
      `);
      expect(exitCode).toBe(1);
    });

    test("the members that a class declares are in place while its base types are instantiated", async () => {
      using dir = project({
        "a.ts": `declare abstract class Schema<Output = any> { readonly _output: Output; parse(): Output; }
declare class RecordSchema<Value extends Schema> extends Schema<Record<string, Value["_output"]>> {}
declare class OptionalSchema<Inner extends Schema> extends Schema<Inner["_output"] | undefined> {}
declare function optional<Inner extends Schema>(inner: Inner): OptionalSchema<Inner>;
interface Text { kind: "text"; optional: boolean }
interface Dictionary<Value extends Validator> { kind: "dictionary"; optional: boolean; value: Value }
type Validator = Text | Dictionary<Validator>;
type Base<V extends Validator> = V extends Dictionary<infer Value> ? RecordSchema<From<Value>> : Schema<string>;
type From<V extends Validator> = V extends { optional: true } ? OptionalSchema<Base<V>> : Base<V>;
export function convert<V extends Validator>(schema: Schema) {
  return optional(schema) as From<V>;
}
declare const dictionary: From<Dictionary<Validator>>;
export const output: never = dictionary._output;
export const parsed: never = dictionary.parse();

interface Rows<Value extends Schema> extends Schema<Value["_output"][]> {}
type Nested<V> = V extends string ? Schema<V> : Rows<Nested<V>>;
export const rows: never = (null! as Nested<unknown>)._output;

declare class Keys<Value extends Schema> extends Schema<keyof Value> { own: 1; }
type NestedKeys<V> = V extends string ? Schema<V> : Keys<NestedKeys<V>>;
export const keys: never = (null! as NestedKeys<unknown>)._output;
export const allKeys: never = null! as keyof NestedKeys<unknown>;

declare class Own<Value extends Schema & { own: unknown }> extends Schema<[Value["own"], Value["_output"]]> { own: 1; }
type NestedOwn<V> = V extends string ? never : Own<NestedOwn<V>>;
export const own: never = (null! as NestedOwn<unknown>)._output;

declare class A<Value extends Schema> extends Schema<["a", Value["_output"]]> {}
declare class B<Value extends Schema> extends Schema<["b", Value["_output"]]> {}
type FromA<V> = V extends string ? Schema<V> : A<FromB<V>>;
type FromB<V> = V extends string ? Schema<V> : B<FromA<V>>;
export const mutual: never = (null! as FromA<unknown>)._output;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(14,14): error TS2322: Type 'Record<string, unknown>' is not assignable to type 'never'.
        a.ts(15,14): error TS2322: Type 'Record<string, unknown>' is not assignable to type 'never'.
        a.ts(19,14): error TS2322: Type 'unknown[]' is not assignable to type 'never'.
        a.ts(23,14): error TS2322: Type '"own"' is not assignable to type 'never'.
        a.ts(24,14): error TS2322: Type 'keyof Keys<Keys<Keys<Keys<Keys<Keys<Keys<Keys<Keys<Keys<Keys<...>>>>>>>>>>>' is not assignable to type 'never'.
          Type '"_output"' is not assignable to type 'never'.
        a.ts(28,14): error TS2322: Type '[1, unknown]' is not assignable to type 'never'.
        a.ts(34,14): error TS2322: Type '["a", ["b", unknown]]' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("+readonly and +? of a mapped type are printed as written", async () => {
      using dir = project({
        "a.ts": `export function f1<T>(m: { +readonly [P in keyof T]+?: T[P] }) { const r: never = m; }
export function f2<T>(m: { readonly [P in keyof T]?: T[P] }) { const r: never = m; }
export function f3<T>(m: { -readonly [P in keyof T]-?: T[P] }) { const r: never = m; }
export function f4<T>(m: { +readonly [P in keyof T]: T[P] }) { const r: never = m; }
export function f5<T>(m: { [P in keyof T]+?: T[P] }) { const r: never = m; }
export function f6<T>(m: { +readonly [P in keyof T as \`x\${P & string}\`]+?: T[P] }) { const r: never = m; }
type M<T> = { +readonly [P in keyof T]+?: T[P] };
export function f7<T>(m: M<T>[]) { const r: never = m[0]; const s: never = { ...m }; }
export const g = <T,>(m: { +readonly [P in keyof T]+?: T[P] }) => m;
const h: never = g;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,72): error TS2322: Type '{ +readonly [P in keyof T]+?: T[P] | undefined; }' is not assignable to type 'never'.
        a.ts(2,70): error TS2322: Type '{ readonly [P in keyof T]?: T[P] | undefined; }' is not assignable to type 'never'.
        a.ts(3,72): error TS2322: Type '{ -readonly [P in keyof T]-?: T[P]; }' is not assignable to type 'never'.
        a.ts(4,70): error TS2322: Type '{ +readonly [P in keyof T]: T[P]; }' is not assignable to type 'never'.
        a.ts(5,62): error TS2322: Type '{ [P in keyof T]+?: T[P] | undefined; }' is not assignable to type 'never'.
        a.ts(6,92): error TS2322: Type '{ +readonly [P in keyof T as \`x\${P & string}\`]+?: T[P] | undefined; }' is not assignable to type 'never'.
        a.ts(8,42): error TS2322: Type 'M<T>' is not assignable to type 'never'.
        a.ts(8,65): error TS2322: Type '{ [n: number]: M<T>; length: number; toString(): string; toLocaleString(): string; toLocaleString(locales: string | string[], options?: Intl.NumberFormatOptions & Intl.DateTimeFormatOptions): string; ... 37 more ...; with(index: number, value: M<...>): M<...>[]; }' is not assignable to type 'never'.
        a.ts(10,7): error TS2322: Type '<T>(m: { +readonly [P in keyof T]+?: T[P]; }) => { +readonly [P in keyof T]+?: T[P] | undefined; }' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("the hint to install @types needs a package id, which some ways of resolution do not give", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "paths": {"zlib": ["./node_modules/browserify-zlib"], "zfile": ["./node_modules/browserify-zlib/lib/index.js"], "zstem": ["./node_modules/browserify-zlib/lib/index"]}}, "files": ["a.ts"]}`,
        "a.ts": `import * as asDirectory from "zlib";
import * as asFile from "zfile";
import * as asStem from "zstem";
import * as fromNodeModules from "plain";
import * as relative from "./node_modules/plain";
export { asDirectory, asFile, asStem, fromNodeModules, relative };
`,
        "node_modules/browserify-zlib/lib/index.js": `exports.a = 1;
`,
        "node_modules/browserify-zlib/package.json": `{ "name": "browserify-zlib", "version": "0.2.0", "main": "lib/index.js" }
`,
        "node_modules/plain/lib/index.js": `exports.a = 1;
`,
        "node_modules/plain/package.json": `{ "name": "plain", "version": "1.0.0", "main": "lib/index.js" }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,30): error TS7016: Could not find a declaration file for module 'zlib'. '<dir>/node_modules/browserify-zlib/lib/index.js' implicitly has an 'any' type.
        a.ts(2,25): error TS7016: Could not find a declaration file for module 'zfile'. '<dir>/node_modules/browserify-zlib/lib/index.js' implicitly has an 'any' type.
        a.ts(3,25): error TS7016: Could not find a declaration file for module 'zstem'. '<dir>/node_modules/browserify-zlib/lib/index.js' implicitly has an 'any' type.
          Try \`bun add -d @types/browserify-zlib\` if it exists or add a new declaration (.d.ts) file containing \`declare module 'zstem';\`
        a.ts(4,34): error TS7016: Could not find a declaration file for module 'plain'. '<dir>/node_modules/plain/lib/index.js' implicitly has an 'any' type.
          Try \`bun add -d @types/plain\` if it exists or add a new declaration (.d.ts) file containing \`declare module 'plain';\`
        a.ts(5,27): error TS7016: Could not find a declaration file for module './node_modules/plain'. '<dir>/node_modules/plain/lib/index.js' implicitly has an 'any' type."
      `);
      expect(exitCode).toBe(1);
    });

    test("a unique symbol type is qualified where both sides of an error would print the same", async () => {
      using dir = project({
        "a.ts": `import { K, C, o } from "./m";
declare const H: unique symbol;
export function f1<T>(x: Omit<T, typeof K>) { return function <T>(y: Omit<T, typeof K>) { y = x; }; }
export function f2<T>(x: Omit<T, typeof C.S>) { return function <T>(y: Omit<T, typeof C.S>) { y = x; }; }
export function f3<T>(x: Omit<T, typeof o.L>) { return function <T>(y: Omit<T, typeof o.L>) { y = x; }; }
export function f4<T>(x: Omit<T, typeof H>) { return function <T>(y: Omit<T, typeof H>) { y = x; }; }
export function f5<T>(x: Omit<T, typeof Symbol.iterator>) { return function <T>(y: Omit<T, typeof Symbol.iterator>) { y = x; }; }
export function f6<T>(x: T & { [K]: 1 }) { return function <T>(y: T & { [K]: 1 }) { y = x; }; }
`,
        "m.ts": `export declare const K: unique symbol;
export declare class C { static readonly S: unique symbol; }
export declare const o: { readonly L: unique symbol };
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,91): error TS2719: Type 'Omit<T, typeof import("<dir>/m").K>' is not assignable to type 'Omit<T, typeof import("<dir>/m").K>'. Two different types with this name exist, but they are unrelated.
          Type 'Exclude<keyof T, typeof import("<dir>/m").K>' is not assignable to type 'Exclude<keyof T, typeof import("<dir>/m").K>'. Two different types with this name exist, but they are unrelated.
            Type 'keyof T' is not assignable to type 'Exclude<keyof T, unique symbol>'.
              Type 'string | number | symbol' is not assignable to type 'Exclude<keyof T, unique symbol>'.
                Type 'string' is not assignable to type 'Exclude<keyof T, unique symbol>'.
        a.ts(4,95): error TS2719: Type 'Omit<T, typeof import("<dir>/m").C.S>' is not assignable to type 'Omit<T, typeof import("<dir>/m").C.S>'. Two different types with this name exist, but they are unrelated.
          Type 'Exclude<keyof T, typeof import("<dir>/m").C.S>' is not assignable to type 'Exclude<keyof T, typeof import("<dir>/m").C.S>'. Two different types with this name exist, but they are unrelated.
            Type 'keyof T' is not assignable to type 'Exclude<keyof T, unique symbol>'.
              Type 'string | number | symbol' is not assignable to type 'Exclude<keyof T, unique symbol>'.
                Type 'string' is not assignable to type 'Exclude<keyof T, unique symbol>'.
        a.ts(5,95): error TS2719: Type 'Omit<T, typeof import("<dir>/m").o.L>' is not assignable to type 'Omit<T, typeof import("<dir>/m").o.L>'. Two different types with this name exist, but they are unrelated.
          Type 'Exclude<keyof T, typeof import("<dir>/m").o.L>' is not assignable to type 'Exclude<keyof T, typeof import("<dir>/m").o.L>'. Two different types with this name exist, but they are unrelated.
            Type 'keyof T' is not assignable to type 'Exclude<keyof T, unique symbol>'.
              Type 'string | number | symbol' is not assignable to type 'Exclude<keyof T, unique symbol>'.
                Type 'string' is not assignable to type 'Exclude<keyof T, unique symbol>'.
        a.ts(6,91): error TS2719: Type 'Omit<T, typeof H>' is not assignable to type 'Omit<T, typeof H>'. Two different types with this name exist, but they are unrelated.
          Type 'Exclude<keyof T, typeof H>' is not assignable to type 'Exclude<keyof T, typeof H>'. Two different types with this name exist, but they are unrelated.
            Type 'keyof T' is not assignable to type 'Exclude<keyof T, unique symbol>'.
              Type 'string | number | symbol' is not assignable to type 'Exclude<keyof T, unique symbol>'.
                Type 'string' is not assignable to type 'Exclude<keyof T, unique symbol>'.
        a.ts(7,119): error TS2719: Type 'Omit<T, typeof Symbol.iterator>' is not assignable to type 'Omit<T, typeof Symbol.iterator>'. Two different types with this name exist, but they are unrelated.
          Type 'Exclude<keyof T, typeof Symbol.iterator>' is not assignable to type 'Exclude<keyof T, typeof Symbol.iterator>'. Two different types with this name exist, but they are unrelated.
            Type 'keyof T' is not assignable to type 'Exclude<keyof T, unique symbol>'.
              Type 'string | number | symbol' is not assignable to type 'Exclude<keyof T, unique symbol>'.
                Type 'string' is not assignable to type 'Exclude<keyof T, unique symbol>'.
        a.ts(8,85): error TS2719: Type 'T & { [K]: 1; }' is not assignable to type 'T & { [K]: 1; }'. Two different types with this name exist, but they are unrelated.
          Type 'T & { [K]: 1; }' is not assignable to type 'T'.
            'T' could be instantiated with an arbitrary type which could be unrelated to 'T & { [K]: 1; }'."
      `);
      expect(exitCode).toBe(1);
    });

    // 200 comparisons deep. The stack frames of a debug build are several times larger, and it runs out of stack first.
    test.skipIf(isDebug || isASAN)(
      "a comparison that exceeds the depth limit while its error is elaborated",
      async () => {
        using dir = project({
          "a.ts": `interface T0<A> { a: A; next: T1<A[]> | null; take(x: T1<A>): void }
interface T1<A> { a: A; next: T2<A[]> | null; take(x: T2<A>): void }
interface T2<A> { a: A; next: T3<A[]> | null; take(x: T3<A>): void }
interface T3<A> { a: A; next: T4<A[]> | null; take(x: T4<A>): void }
interface T4<A> { a: A; next: T5<A[]> | null; take(x: T5<A>): void }
interface T5<A> { a: A; next: T6<A[]> | null; take(x: T6<A>): void }
interface T6<A> { a: A; next: T7<A[]> | null; take(x: T7<A>): void }
interface T7<A> { a: A; next: T8<A[]> | null; take(x: T8<A>): void }
interface T8<A> { a: A; next: T9<A[]> | null; take(x: T9<A>): void }
interface T9<A> { a: A; next: T10<A[]> | null; take(x: T10<A>): void }
interface T10<A> { a: A; next: T11<A[]> | null; take(x: T11<A>): void }
interface T11<A> { a: A; next: T12<A[]> | null; take(x: T12<A>): void }
interface T12<A> { a: A; next: T13<A[]> | null; take(x: T13<A>): void }
interface T13<A> { a: A; next: T14<A[]> | null; take(x: T14<A>): void }
interface T14<A> { a: A; next: T15<A[]> | null; take(x: T15<A>): void }
interface T15<A> { a: A; next: T16<A[]> | null; take(x: T16<A>): void }
interface T16<A> { a: A; next: T17<A[]> | null; take(x: T17<A>): void }
interface T17<A> { a: A; next: T18<A[]> | null; take(x: T18<A>): void }
interface T18<A> { a: A; next: T19<A[]> | null; take(x: T19<A>): void }
interface T19<A> { a: A; next: T20<A[]> | null; take(x: T20<A>): void }
interface T20<A> { a: A; next: T21<A[]> | null; take(x: T21<A>): void }
interface T21<A> { a: A; next: T22<A[]> | null; take(x: T22<A>): void }
interface T22<A> { a: A; next: T23<A[]> | null; take(x: T23<A>): void }
interface T23<A> { a: A; next: T24<A[]> | null; take(x: T24<A>): void }
interface T24<A> { a: A; next: T25<A[]> | null; take(x: T25<A>): void }
interface T25<A> { a: A; next: T26<A[]> | null; take(x: T26<A>): void }
interface T26<A> { a: A; next: T27<A[]> | null; take(x: T27<A>): void }
interface T27<A> { a: A; next: T28<A[]> | null; take(x: T28<A>): void }
interface T28<A> { a: A; next: T29<A[]> | null; take(x: T29<A>): void }
interface T29<A> { a: A; next: T30<A[]> | null; take(x: T30<A>): void }
interface T30<A> { a: A; next: T31<A[]> | null; take(x: T31<A>): void }
interface T31<A> { a: A; next: T32<A[]> | null; take(x: T32<A>): void }
interface T32<A> { a: A; next: T33<A[]> | null; take(x: T33<A>): void }
interface T33<A> { a: A; next: T34<A[]> | null; take(x: T34<A>): void }
interface T34<A> { a: A; next: T35<A[]> | null; take(x: T35<A>): void }
interface T35<A> { a: A; next: T36<A[]> | null; take(x: T36<A>): void }
interface T36<A> { a: A; next: T37<A[]> | null; take(x: T37<A>): void }
interface T37<A> { a: A; next: T38<A[]> | null; take(x: T38<A>): void }
interface T38<A> { a: A; next: T39<A[]> | null; take(x: T39<A>): void }
interface T39<A> { a: A; next: T40<A[]> | null; take(x: T40<A>): void }
interface T40<A> { a: A; next: T41<A[]> | null; take(x: T41<A>): void }
interface T41<A> { a: A; next: T42<A[]> | null; take(x: T42<A>): void }
interface T42<A> { a: A; next: T43<A[]> | null; take(x: T43<A>): void }
interface T43<A> { a: A; next: T44<A[]> | null; take(x: T44<A>): void }
interface T44<A> { a: A; next: T45<A[]> | null; take(x: T45<A>): void }
interface T45<A> { a: A; next: T46<A[]> | null; take(x: T46<A>): void }
interface T46<A> { a: A; next: T47<A[]> | null; take(x: T47<A>): void }
interface T47<A> { a: A; next: T48<A[]> | null; take(x: T48<A>): void }
interface T48<A> { a: A; next: T49<A[]> | null; take(x: T49<A>): void }
interface T49<A> { a: A; next: T0<A[]> | null; take(x: T0<A>): void }
export const u: T0<unknown> = null! as T0<string>;
export const v: T0<string> = null! as T0<unknown>;
`,
        });
        const { stdout, exitCode } = await check(dir);
        expect(stdout).toMatchInlineSnapshot(`
        "a.ts(51,14): error TS2321: Excessive stack depth comparing types 'T0<string>' and 'T0<unknown>'.
        a.ts(51,14): error TS2321: Excessive stack depth comparing types 'T49<?>' and 'T49<?>'.
        a.ts(52,14): error TS2322: Type 'T0<unknown>' is not assignable to type 'T0<string>'.
          Types of property 'a' are incompatible.
            Type 'unknown' is not assignable to type 'string'."
      `);
        expect(exitCode).toBe(1);
      },
    );

    test("a constant in a nested loop whose initializer calls a method of the loop variable", async () => {
      using dir = project({
        "a.ts": `interface S { nxt: S | null; get(): S | null }
declare function mk(): S; declare const c: boolean;
export function n1() { let s: S | null = mk(); while (s) { while (c) { const cur = s.get(); s = cur || null; if (!s) return; } } }
export function n2() { let s: S | null = mk(); while (s) { while (c) { const cur = s.get(); s = cur; if (!s) return; } } }
export function n3() { let s: S | null = mk(); while (s) { const cur = s.get(); s = cur || null; } }
export function n4() { let s: S | null = mk(); while (c) { while (s) { const cur = s.get(); s = cur; } } }
export function n5() { let s: S | null = mk(); while (s) { for (const i of [1]) { const cur = s.get(); s = cur; if (!s) return; } } }
export function n6() { let s: S | null = mk(); while (s) { if (c) { const cur = s.get(); s = cur; } } }
export function n7() { let s: S | null = mk(); while (s) { while (c) { while (c) { const cur = s.get(); s = cur; if (!s) return; } } } }
export function n8() { let s: S | null = mk(); while (s) { do { const cur = s.get(); s = cur; if (!s) return; } while (c); } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(10,71): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."`,
      );
      expect(exitCode).toBe(1);
    });

    test("an aliased intersection with a class is named by its members where its properties are compared", async () => {
      using dir = project({
        "a.ts": `declare class Base {
  href: string;
}
interface Plain {
  href: string;
}
type WithThisType = Base & { brand: "x" };
type Without = Plain & { brand: "x" };
interface Target {
  a: 1;
  b: 1;
}
declare const one: WithThisType;
declare const two: Without;
export const first: Target = one;
export const second: Target = two;
`,
      });
      const { stdout, exitCode } = await check(dir);
      // The head message is left out if the next one names the same two types.
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(15,14): error TS2322: Type 'WithThisType' is not assignable to type 'Target'.
          Type 'Base & { brand: "x"; }' is missing the following properties from type 'Target': a, b
        a.ts(16,14): error TS2739: Type 'Without' is missing the following properties from type 'Target': a, b"
      `);
      expect(exitCode).toBe(1);
    });

    test("a property copied from `export { a as b }` by a spread is not narrowed", async () => {
      using dir = project({
        "utils.ts": `declare const _n: string | undefined;
export { _n as n };
`,
        "a.ts": `import * as utils from "./utils";
const copy = { ...utils };
export const t = copy.n && copy.n.length;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`"a.ts(3,28): error TS18048: 'copy.n' is possibly 'undefined'."`);
      expect(exitCode).toBe(1);
    });

    test("`this[key] = value` in a JavaScript class declares a static property", async () => {
      using dir = project({
        "a.js": `const key = Symbol();
export class A {
  static s() {
    const made = (this[key] = this[key] = { n: 1 });
    return made.n + this[key].n;
  }
}
export const a = A[key].n;
export class B {
  m() {
    this[key] = 1;
  }
}
`,
      });
      const { stdout, exitCode } = await check(dir, ["--allowJs", "true", "--checkJs", "true"]);
      expect(stdout).toMatchInlineSnapshot(`
        "a.js(11,5): error TS7053: Element implicitly has an 'any' type because expression of type 'unique symbol' can't be used to index type 'B'.
          Property '[key]' does not exist on type 'B'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an import shadowed by a variable counts as used where `a.b` is resolved as an entity name", async () => {
      const file = (returned: string, type: string) => `import { policy, used } from "./a";
export function f(s: { data: ${type} }) {
  const policy = s.data;
  return ${returned};
}
export const u = used;
`;
      using dir = project({
        "a.ts": `export const policy = { name: "x" };\nexport const used = 1;\n`,
        // To see whether this is a member of an enum, `policy.in` is resolved as an entity name, and `policy` as a namespace.
        "b.ts": file("policy.in.x", "{ in: { x: number } }"),
        "c.ts": file("policy.name", "{ name: string }"),
        // Control flow analysis resolves the key of `k[policy.name]` where it compares references: at the assignment in d.ts.
        "d.ts": `import { policy, used } from "./a";
export function f(s: { data: { name: string } }, k: Record<string, number>) {
  const policy = s.data;
  return k[policy.name];
}
export const u = used;
`,
        "e.ts": `import { policy, used } from "./a";
export function f(policy: { name: string }, k: Record<string, number>) {
  return k[policy.name];
}
export const u = used;
`,
      });
      const { stdout, exitCode } = await check(dir, ["--noUnusedLocals", "true"]);
      expect(stdout).toMatchInlineSnapshot(`
        "c.ts(1,10): error TS6133: 'policy' is declared but its value is never read.
        e.ts(1,10): error TS6133: 'policy' is declared but its value is never read."
      `);
      expect(exitCode).toBe(1);
    });

    test("exactOptionalPropertyTypes only restricts writes to optional properties", async () => {
      using dir = project({
        "a.ts": `interface Box<T> {
  current: T;
}
declare function box<T>(x: T): Box<T>;
declare const p: { id?: string };
const b = box(p.id);
b.current = undefined;
const o = { x: p.id };
o.x = undefined;
p.id = undefined;
class A {
  #s?: string;
  t?: string;
  m() {
    this.#s = undefined;
    this.t = undefined;
  }
}
declare function shot(options?: { mask?: A[] }): void;
declare const mask: string[] | undefined;
shot({ mask });
`,
      });
      const { stdout, exitCode } = await check(dir, ["--exactOptionalPropertyTypes", "true"]);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(10,1): error TS2412: Type 'undefined' is not assignable to type 'string' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the type of the target.
        a.ts(15,5): error TS2322: Type 'undefined' is not assignable to type 'string'.
        a.ts(16,5): error TS2412: Type 'undefined' is not assignable to type 'string' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the type of the target.
        a.ts(21,8): error TS2412: Type 'string[] | undefined' is not assignable to type 'A[] | undefined' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the type of the target."
      `);
      expect(exitCode).toBe(1);
    });

    test("without strictNullChecks, [] and [undefined] are assignable to never[]", async () => {
      using dir = project({
        "a.ts": `const a: never[] = [];
const b: never[] = [undefined];
const c: never[] = [null];
`,
      });
      const { stdout, exitCode } = await check(dir, ["--strict", "false"]);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(3,21): error TS2322: Type 'null' is not assignable to type 'never'."`,
      );
      expect(exitCode).toBe(1);
    });

    test("without strictNullChecks, the undefined target of a field decorator is not widened to any", async () => {
      using dir = project({
        "a.ts": `declare function Formula<T extends object>(
  formula: (columns: Record<keyof T, string>) => string,
): (target: T, context: unknown) => void;
class Book {
  price = 1;
  @Formula(columns => columns.price) taxed = 2;
}
`,
      });
      const { stdout, exitCode } = await check(dir, ["--strict", "false"]);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(6,31): error TS2339: Property 'price' does not exist on type 'Record<never, string>'."`,
      );
      expect(exitCode).toBe(1);
    });

    test("an export that cannot merge is still the value its own block refers to", async () => {
      const declarations = `declare module "m" {
  const key: unique symbol;
  interface Options {
    mode?: typeof key;
  }
}
`;
      using dir = project({ "a.d.ts": declarations, "b.d.ts": declarations });
      const { stdout, exitCode } = await check(dir, ["--skipLibCheck", "false"]);
      expect(stdout).toMatchInlineSnapshot(`
        "a.d.ts(2,9): error TS2451: Cannot redeclare block-scoped variable 'key'.
        b.d.ts(2,9): error TS2451: Cannot redeclare block-scoped variable 'key'.
        b.d.ts(4,5): error TS2717: Subsequent property declarations must have the same type.  Property 'mode' must be of type 'unique symbol | undefined', but here has type 'unique symbol | undefined'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a property picked from a union of intersections with a conditional type keeps its modifiers", async () => {
      using dir = project({
        "a.ts": `
type Cond<T> = T extends string ? { a?: never } : { a: T };
type Either = { x?: 1; y?: never } | { x?: never; y?: 1 };
type Settings<T> = { readonly model?: string } & Cond<T> & Either;
export function f<T>(rest: T) {
  const empty: Pick<Settings<T>, "model"> = {};
  const cast = { model: empty.model, ...rest } as Pick<Settings<T>, "model">;
  empty.model = "";
  return [empty, cast];
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toBe(`a.ts(8,9): error TS2540: Cannot assign to 'model' because it is a read-only property.`);
      expect(exitCode).toBe(1);
    });
  });

  describe("compiler options as flags", () => {
    const files = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: false, noEmit: true, target: "esnext", lib: ["esnext"], types: [] },
      }),
      "a.ts": `export function f(x) {\n  return x;\n}\nexport const first = [1][0].toFixed();\n`,
    };

    test("override tsconfig.json", async () => {
      using dir = project(files);
      const [plain, strict, off, indexed] = await Promise.all([
        check(dir),
        check(dir, ["--strict"]),
        check(dir, ["--strict", "--noImplicitAny", "false"]),
        // Flag names are case-insensitive and accept `=`.
        check(dir, ["--STRICT=true", "--nouncheckedindexedaccess", "--noImplicitAny=false"]),
      ]);
      expect(plain.stdout).toBe("");
      expect(strict.stdout).toMatchInlineSnapshot(
        `"a.ts(1,19): error TS7006: Parameter 'x' implicitly has an 'any' type."`,
      );
      expect(off.stdout).toBe("");
      expect(indexed.stdout).toMatchInlineSnapshot(`"a.ts(4,22): error TS2532: Object is possibly 'undefined'."`);
    });

    test("a boolean flag does not consume the next argument", async () => {
      using dir = project(files);
      const { stdout } = await check(dir, ["--strict", "a.ts"]);
      expect(stdout).toMatchInlineSnapshot(`"a.ts(1,19): error TS7006: Parameter 'x' implicitly has an 'any' type."`);
    });

    test("--noEmit accepts a value and no files are emitted either way", async () => {
      using dir = project(files);
      const results = await Promise.all([
        check(dir, ["--noEmit"]),
        check(dir, ["--noEmit", "true"]),
        check(dir, ["--noEmit", "false", "--outDir", "out"]),
        check(dir, ["--noEmit=false", "--outDir", "out", "a.ts"]),
      ]);
      expect(results.map(({ stdout, exitCode }) => ({ stdout, exitCode }))).toEqual(
        Array.from({ length: 4 }, () => ({ stdout: "", exitCode: 0 })),
      );
      expect(existsSync(join(String(dir), "out"))).toBe(false);
    });

    test("list options and invalid values", async () => {
      using dir = project({ ...files, "a.ts": `export const p = new Promise<void>(r => r());\n` });
      const [es5, bad, missing, unknown] = await Promise.all([
        check(dir, ["--lib", "es5"]),
        check(dir, ["--target", "es3000"]),
        check(dir, ["--target"]),
        check(dir, ["--nonsense"]),
      ]);
      expect(es5.stdout).toMatchInlineSnapshot(
        `"a.ts(1,22): error TS2585: 'Promise' only refers to a type, but is being used as a value here. Do you need to change your target library? Try changing the 'lib' compiler option to es2015 or later."`,
      );
      expect(bad.stderr).toMatchInlineSnapshot(`
        "error: --target must be one of: es6, es2015, es2016, es2017, es2018, es2019, es2020, es2021, es2022, es2023, es2024, es2025, esnext
        note: run 'bun check --help' for more information"
      `);
      expect(missing.stderr).toMatchInlineSnapshot(`
        "error: --target needs a value
        note: run 'bun check --help' for more information"
      `);
      expect(unknown.stderr).toMatchInlineSnapshot(`
        "error: Unknown flag "--nonsense"
        note: run 'bun check --help' for more information"
      `);
      expect([bad.exitCode, missing.exitCode, unknown.exitCode]).toEqual([1, 1, 1]);
    });

    test("apply to referenced projects, and -b selects a project", async () => {
      using dir = project({
        "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "lib" }] }),
        "console.d.ts": "",
        "lib/tsconfig.json": JSON.stringify({
          compilerOptions: { composite: true, strict: false, lib: ["esnext"], types: [] },
          include: ["*.ts"],
        }),
        "lib/a.ts": `export function f(x) {\n  return x;\n}\n`,
      });
      const [loose, strict, build] = await Promise.all([
        check(dir),
        check(dir, ["--strict"]),
        check(dir, ["-b", "lib", "--strict"]),
      ]);
      expect(loose.stdout).toBe("");
      expect(strict.stdout).toMatchInlineSnapshot(
        `"lib/a.ts(1,19): error TS7006: Parameter 'x' implicitly has an 'any' type."`,
      );
      expect(build.stdout).toBe(strict.stdout);
    });
  });

  describe("startup errors", () => {
    test("TypeScript's lib files are not installed", async () => {
      using dir = project({ "a.ts": `export const a = 1;\n` }, { withTypeScript: false });
      const { stdout, stderr, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"error: Cannot find TypeScript's standard library (lib.es5.d.ts and the rest), which declares Array, Promise and everything else that is built in. It comes with the typescript package: bun add -d typescript"`,
      );
      expect(stderr).toMatchInlineSnapshot(`"Found 1 error, checked 0 files [time]"`);
      expect(exitCode).toBe(1);
    });

    test("invalid tsconfig.json", async () => {
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

    test("compiler options that TypeScript 7 removed are unknown options", async () => {
      using dir = project({
        "tsconfig.json": `{ "compilerOptions": { "lib": ["esnext"], "types": [], "suppressImplicitAnyIndexErrors": true, "out": "x.js" } }`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "tsconfig.json(1,56): error TS5023: Unknown compiler option 'suppressImplicitAnyIndexErrors'.
        tsconfig.json(1,96): error TS5023: Unknown compiler option 'out'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an empty input set is an error", async () => {
      using dir = tempDir("bun-check", { "README.md": "", "empty/README.md": "" });
      for (const args of [[], ["empty"]]) {
        const { stdout, stderr, exitCode } = await check(dir, args);
        expect(stdout).toBe(`error: Nothing to check: no TypeScript files in '${["<dir>", ...args].join("/")}'`);
        expect(stderr).toMatchInlineSnapshot(`"Found 1 error, checked 0 files [time]"`);
        expect(exitCode).toBe(1);
      }
      // As for tsc, a tsconfig.json that extends another one may select no files.
      using empty = project({
        "base.json": tsconfig,
        "tsconfig.json": `{ "extends": "./base.json", "files": [], "include": [] }`,
      });
      const selectsNothing = await check(empty);
      expect(selectsNothing.stdout).toBe("");
      expect(selectsNothing.exitCode).toBe(0);
    });

    test("missing path arguments are reported before the project is loaded", async () => {
      // The invalid tsconfig.json and the missing lib files are never read.
      using dir = project(
        { "tsconfig.json": `{ "compilerOptions": { "nonsense": true } }` },
        { withTypeScript: false },
      );
      const { stdout, stderr, exitCode } = await check(dir, ["nope.ts", "src/nope"]);
      expect(stdout).toMatchInlineSnapshot(`
        "error TS6053: File '<dir>/nope.ts' not found.
        error TS6053: File '<dir>/src/nope' not found."
      `);
      expect(stderr).toMatchInlineSnapshot(`"Found 2 errors, checked 0 files [time]"`);
      expect(exitCode).toBe(1);
    });

    // The superuser can read every file.
    const canReadEverything = process.platform === "win32" || process.getuid?.() === 0;
    test.skipIf(canReadEverything)("a source file that cannot be read is reported", async () => {
      using dir = project({ "a.ts": `import "./secret";\n`, "secret.ts": `export {};\n` });
      chmodSync(join(String(dir), "secret.ts"), 0o000);
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`"error TS5083: Cannot read file '<dir>/secret.ts'."`);
      expect(exitCode).toBe(1);
    });

    test("-p with a path that does not exist", async () => {
      using dir = project({});
      const { stdout, stderr, exitCode } = await check(dir, ["-p", "nowhere"]);
      expect(stdout + stderr).toMatchInlineSnapshot(
        `"error TS5058: The specified path does not exist: '<dir>/nowhere'.Found 1 error, checked 0 files [time]"`,
      );
      expect(exitCode).toBe(1);
    });

    test("unknown flag", async () => {
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

// A minimal replacement for `@types/bun`, which would pull in all of `@types/node`.
const bunTypes = {
  "node_modules/@types/bun/package.json": `{ "name": "@types/bun", "version": "1.0.0", "types": "index.d.ts" }`,
  "node_modules/@types/bun/index.d.ts": `declare var Bun: { version: string };\ndeclare module "bun:test" {\n  export function test(name: string, fn: () => void): void;\n}\n`,
  "index.ts": `import { test } from "bun:test";\ntest(Bun.version, () => {});\n`,
};
const withoutTypes = JSON.stringify({
  compilerOptions: { strict: true, lib: ["esnext"], moduleResolution: "bundler", skipLibCheck: true },
});

describe.concurrent("@types/bun", () => {
  test("is included when there is no tsconfig.json", async () => {
    using dir = project(bunTypes);
    rmSync(join(String(dir), "tsconfig.json"));
    const { stdout, exitCode } = await check(dir, ["index.ts"]);
    expect(stdout).toBe("");
    expect(exitCode).toBe(0);
  });

  // Matches `tsc` since TypeScript 6.0 and the editor.
  test.each([
    ["has no `types`", withoutTypes],
    ['has `types` without "bun"', tsconfig],
  ])("is not included when tsconfig.json %s, and the hint explains the fix", async (_, config) => {
    using dir = project({ ...bunTypes, "tsconfig.json": config });
    const { stdout, stderr, exitCode } = await check(dir);
    expect(stdout).toContain("error TS2307: Cannot find module 'bun:test' or its corresponding type declarations.");
    expect(stderr).toMatchInlineSnapshot(`
      "hint: Bun's type definitions (console, fetch, Bun, bun:test) are installed, but tsconfig.json does not include them. Add to compilerOptions: "types": ["bun"]
      Found 2 errors in 1 file, checked 1 file [time]"
    `);
    expect(exitCode).toBe(1);
  });
});

test("TypeScript 7 with the isolated linker: finds the lib files next to the real package directory", async () => {
  using dir = project({ "index.ts": `export const first: string = [1].at(0);\n` }, { withTypeScript: false });
  const store = join(String(dir), "node_modules", ".bun", "typescript@7.0.0", "node_modules");
  mkdirSync(join(store, "typescript"), { recursive: true });
  mkdirSync(join(store, "@typescript", "typescript-any-platform"), { recursive: true });
  await Bun.write(join(store, "typescript", "package.json"), `{ "name": "typescript", "version": "7.0.0" }`);
  symlinkSync(join(typescript, "lib"), join(store, "@typescript", "typescript-any-platform", "lib"), "junction");
  symlinkSync(join(store, "typescript"), join(String(dir), "node_modules", "typescript"), "junction");
  const { stdout, exitCode } = await check(dir);
  expect(stdout).toMatchInlineSnapshot(`
    "index.ts(1,14): error TS2322: Type 'number | undefined' is not assignable to type 'string'.
      Type 'undefined' is not assignable to type 'string'."
  `);
  expect(exitCode).toBe(1);
});

describe.concurrent("--check", () => {
  // These draw the same progress line as `bun check`, on a thread of its own, and the process goes on afterwards.
  describe.skipIf(isWindows || !hasTerminal)("in a terminal", () => {
    const files = (n: string) => ({
      "package.json": JSON.stringify({ scripts: { hello: "echo ran 1" } }),
      "bun-test.d.ts": `declare module "bun:test" {\n  export function test(name: string, fn: () => void): void;\n}\n`,
      "a.ts": `const n: number = ${n};\nconsole.log("ran", n);\n`,
      "a.test.ts": `import { test } from "bun:test";\nconst n: number = ${n};\ntest("a", () => void n);\n`,
    });
    const commands: [string[], string][] = [
      [["--check", "a.ts"], "ran 1"],
      [["run", "--check", "hello"], "ran 1"],
      [["build", "--check", "a.ts", "--outdir", "out"], "a.js"],
      [["test", "--check", "a.test.ts"], "1 pass"],
    ];

    test.each(commands)("bun %j does its job after the check", async (cmd, expected) => {
      using dir = project(files("1"));
      const { output, exitCode, signalCode } = await inTerminal(String(dir), cmd);
      expect(output).toContain("Loading");
      expect(output).toContain(expected);
      expect(signalCode).toBeNull();
      expect(exitCode).toBe(0);
    });

    test("errors are shown with the source and in color", async () => {
      using dir = project(files(`"1"`));
      const { output, hasColors, exitCode, signalCode } = await inTerminal(String(dir), ["--check", "a.ts"]);
      expect(output).toContain(`1 | const n: number = "1";`);
      expect(output).toContain("error: TS2322: Type 'string' is not assignable to type 'number'.");
      expect(output).not.toContain("ran 1");
      expect(hasColors).toBe(true);
      expect(signalCode).toBeNull();
      expect(exitCode).toBe(1);
    });
  });

  test("a JavaScript entry point is loaded for its imports regardless of allowJs", async () => {
    using dir = project({
      "good.js": `import { n } from "./n";\nconsole.log("ran", n);\n`,
      "n.ts": `export const n: number = 1;\n`,
      "bad.js": `import "./s";\nconsole.log("ran");\n`,
      "s.ts": `export const s: string = 1;\n`,
    });
    const [good, bad] = await Promise.all([
      run(String(dir), ["--check", "good.js"]),
      run(String(dir), ["--check", "bad.js"]),
    ]);
    expect(good.stderr).toBe("");
    expect(good.stdout).toBe("ran 1");
    expect(good.exitCode).toBe(0);
    expect(bad.stdout).toBe("");
    expect(bad.stderr).toContain("s.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.");
    expect(bad.exitCode).toBe(1);
  });

  test("bun run --check <script> type checks the project before the script runs", async () => {
    const scripts = JSON.stringify({ scripts: { hello: "echo ran" } });
    using good = project({ "package.json": scripts, "a.ts": `export const a: number = 1;\n` });
    using bad = project({ "package.json": scripts, "a.ts": `export const a: number = "1";\n` });
    const [ran, stopped] = await Promise.all([
      run(String(good), ["run", "--check", "hello"]),
      run(String(bad), ["run", "--check", "hello"]),
    ]);
    expect(ran.stdout).toBe("ran");
    expect(ran.exitCode).toBe(0);
    expect(stopped.stdout).toBe("");
    expect(stopped.stderr).toMatchInlineSnapshot(`
      "a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.
      Found 1 error in 1 file, checked 1 file [time]"
    `);
    expect(stopped.exitCode).toBe(1);
  });

  test("bun test --help lists --check", async () => {
    using dir = project({});
    const { stdout, stderr } = await run(String(dir), ["test", "--help"]);
    expect(stdout + stderr).toContain("bun test --check");
  });

  test("bun --check runs a file that type checks", async () => {
    using dir = project({ "a.ts": `const n: number = 1;\nconsole.log("ran", n);\n` });
    const { stdout, stderr, exitCode } = await run(String(dir), ["--check", "a.ts"]);
    expect(stdout).toBe("ran 1");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  test("bun run --check does not run a file with type errors, or one that imports such a file", async () => {
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

  test("bun build --check checks the scripts of an HTML entry point", async () => {
    const page = (script: string) =>
      `<!doctype html>\n<script src="https://example.com/cdn.js"></script>\n<script type="module" src="${script}"></script>\n`;
    using dir = project({
      "good/index.html": page("./main.ts"),
      "good/main.ts": `const good: number = 1;\nconsole.log(good);\n`,
      "bad/index.html": page("./src/main.ts"),
      "bad/src/main.ts": `import { imported } from "./imported";\nconsole.log(imported);\n`,
      "bad/src/imported.ts": `export const imported: number = "1";\n`,
    });
    const [good, bad] = await Promise.all([
      run(String(dir), ["build", "--check", "good/index.html", "--outdir", "out-good"]),
      run(String(dir), ["build", "--check", "bad/index.html", "--outdir", "out-bad"]),
    ]);
    expect(good.stderr).toBe("");
    expect(good.exitCode).toBe(0);
    expect(await Bun.file(join(String(dir), "out-good", "index.html")).exists()).toBe(true);
    expect(bad.stderr).toMatchInlineSnapshot(`
      "bad/src/imported.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.
      Found 1 error in 1 file, checked 2 files [time]"
    `);
    expect(await Bun.file(join(String(dir), "out-bad", "index.html")).exists()).toBe(false);
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

  // A file that the parser gives up on must not disappear from the result. Each file here ends with a type error, so
  // each has to report something: a syntax error, or that type error.
  test("half-written code is never reported as clean", async () => {
    // What once made a file disappear.
    const cases = [
      "type T = { (x: number, : string): void };",
      "<T extends(T,",
      "var c: { new?(: any; }",
      "const x = [[[[[[[[[[[[[[[[[[",
      "declare function f(a: any): any;\nconst x = f(f(f(f(f(f(f(f(f(f(f(f(f(f(f(f(f(f(",
      "declare function f(a: any): any;\nconst x = (f([(f([(f([(f([(f([(f([",
      `const x = ${"{ a: ".repeat(18)}`,
      "const x = ((((((((((((((((((",
      "interface I { m(export= x: string): any; }",
      "interface I { n(,): any; }",
      "interface I { m(: string): any; }",
      "interface Base{(",
      "<TOwnProps>(mapStateToProps:<(",
      "var o:(boolean,",
      "():{(",
      "declare function f<T>(): void; f<{ a b: any }>();",
      "type T = { m(: string): any };",
    ];
    const files: Record<string, string> = {};
    const add = (name: string, text: string) => (files[`${name}.ts`] = `${text}\nconst canary_${name}: string = 1;\n`);
    cases.forEach((text, index) => add(`c${index}`, text));

    // Valid programs from TypeScript's tests, each damaged in one place. The damage is the same in every run.
    const bundle = readFileSync(join(import.meta.dir, "typescript-go", "bundle.txt"));
    const entries: [path: string, start: number, length: number][] = [];
    for (let at = 0; at < bundle.length; ) {
      const end = bundle.indexOf(10, at);
      const [, path, length] = /^=== (.*) (\d+)$/.exec(bundle.toString("latin1", at, end))!;
      entries.push([path, end + 1, +length]);
      at = end + 1 + +length + 1;
    }
    const withErrors = new Set(entries.map(([path]) => /\/([^/(]+)(\(.*\))?\.errors\.txt$/.exec(path)?.[1]));
    const valid = entries.filter(
      ([path, , length]) =>
        /\/tests\/cases\/.*(?<!\.d)\.ts$/.test(path) &&
        length >= 200 &&
        length <= 8000 &&
        !withErrors.has(path.slice(path.lastIndexOf("/") + 1, -3)),
    );
    const token =
      /\s+|\/\/[^\n]*|\/\*[^]*?\*\/|`(?:\\[^]|[^`\\])*`|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|[A-Za-z_$][\w$]*|\d[\w.]*|>>>=|\.\.\.|===|!==|\*\*=|<<=|>>=|>>>|&&=|\|\|=|\?\?=|=>|==|!=|<=|>=|&&|\|\||\?\?|\?\.|\+\+|--|[-+*\/%&|^]=|\*\*|<<|>>|[^]/g;
    const stray =
      "< > { } ( ) [ ] => : ? . ... , ; = | & @ # ` \" ' /* // / * ! ~ async await class function extends implements import export from type interface enum namespace module declare abstract static get set new typeof keyof infer in of is as satisfies return yield case default if else for while do try catch finally throw this super null void const let var using accessor override readonly unique asserts out <T </ /> ${ ?. ?? ** 0x 1e 1n \\u \\ import( import. new. <> </> {{ }} (( )) [[ ]] <<< >>> =>=> ::: ??? @@ ## export= export* import* default: case: function* async* get# set#".split(
        " ",
      );
    // mulberry32
    let state = 1;
    const below = (n: number) => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n);
    };
    const count = isDebug || isASAN ? 50 : 400;
    for (let seed = 0; seed < count; seed++) {
      const [, start, length] = valid[seed * Math.floor(valid.length / count)];
      const text = bundle.toString("utf8", start, start + length);
      // Several files in one, or comments that silence errors.
      if (/@filename|@ts-|@nocheck|@jsx|@checkjs|@allowjs/i.test(text)) continue;
      const tokens = text.match(token)!;
      const free = tokens.flatMap((t, i) => (/^\s|^\/\/ ?@/.test(t) ? [] : [i]));
      if (free.length < 8) continue;
      for (const kind of ["truncate", "delete", "insert", "swap", "replace", "cut", "line"]) {
        const at = below(free.length);
        const i = free[at];
        const edited = [...tokens];
        if (kind === "truncate") edited.length = i;
        else if (kind === "delete") edited.splice(i, 1);
        else if (kind === "insert") edited.splice(i, 0, stray[below(stray.length)], " ");
        else if (kind === "replace") edited[i] = tokens[free[below(free.length)]];
        else if (kind === "swap") {
          const j = free[Math.min(at + 1, free.length - 1)];
          [edited[i], edited[j]] = [edited[j], edited[i]];
        }
        let damaged = edited.join("");
        if (kind === "cut") damaged = text.slice(0, 1 + below(text.length - 1));
        else if (kind === "line")
          damaged = text
            .split("\n")
            .toSpliced(below(text.split("\n").length), 1)
            .join("\n");
        add(`m${seed}_${kind}`, damaged);
      }
    }

    using dir = project(files);
    const names = Object.keys(files);
    const withoutErrors = async (among: string[]) => {
      const { stdout, exitCode } = await check(dir);
      expect(exitCode).toBe(1);
      const reported = new Set([...stdout.matchAll(/^(\w+\.ts)\(\d+,\d+\): error TS/gm)].map(match => match[1]));
      return among.filter(name => !reported.has(name));
    };
    // Syntax errors end the run before anything is checked, as in tsc. What has none is checked on its own.
    const parsed = await withoutErrors(names);
    expect(parsed.length).toBeGreaterThan(names.length / 8);
    expect(parsed.length).toBeLessThan(names.length / 2);
    writeFileSync(join(String(dir), "tsconfig.json"), JSON.stringify({ ...JSON.parse(tsconfig), files: parsed }));
    expect(await withoutErrors(parsed)).toEqual([]);
  });

  // Nothing here is slow or deep unless the cost of a construct grows faster than its size. An exponential walk does not
  // finish at these sizes, and one that gives up at a limit loses a narrowing and reports a false error, as happened
  // after a `finally` block in vscode.
  describe("programs of growing size", () => {
    const range = (n: number) => Array.from({ length: n }, (_, i) => i);
    // The stack frames of a debug build are several times larger.
    const size = isDebug || isASAN ? 50 : 400;
    const templates: [name: string, n: number, source: (n: number) => string][] = [
      [
        "a sequence of `if` statements in a `finally` block",
        size,
        n =>
          `declare const c: boolean; declare function f(): string | undefined;\nexport function g() { const d = f(); if (!d) return; try { c; } finally { ${range(
            n,
          )
            .map(() => "if (c) { c; }")
            .join(" ")} } return d.length; }`,
      ],
      [
        "a sequence of `if` statements that assign in a loop",
        size,
        n =>
          `declare const c: boolean;\nexport function g() { let x: string | number | null = null; while (c) { ${range(n)
            .map(i => `if (c) { x = ${i % 2 ? '"a"' : "1"}; }`)
            .join(" ")} } return x; }`,
      ],
      [
        "nested loops that assign the same variable",
        size,
        n =>
          `declare const c: boolean; declare function h(v: unknown): string | number;\nexport function g() { let x: string | number = 1; ${range(
            n,
          )
            .map(() => "while (c) { x = h(x);")
            .join(" ")} ${"}".repeat(n)} return x; }`,
      ],
      [
        "a chain of `&&`",
        size,
        n =>
          `declare const a: { p?: number };\nexport const r = ${range(n)
            .map(() => "a.p")
            .join(" && ")};`,
      ],
      [
        "a chain of `+`",
        size,
        n =>
          `declare const a: number;\nexport const r = ${range(n)
            .map(() => "a")
            .join(" + ")};`,
      ],
      [
        "a chain of method calls",
        size,
        n => `declare const a: { m(): typeof a };\nexport const r = a${".m()".repeat(n)};`,
      ],
      [
        // TypeScript needs seconds for 400 members too.
        "a discriminated union narrowed member by member",
        size / 4,
        n =>
          `type U = ${range(n)
            .map(i => `{ k: "k${i}"; v${i}: number }`)
            .join(" | ")};\nexport function g(u: U) { ${range(n)
            .map(i => `if (u.k === "k${i}") return u.v${i};`)
            .join(" ")} return u; }`,
      ],
      [
        "a `switch` over a union of literals",
        size,
        n =>
          `type U = ${range(n)
            .map(i => `"k${i}"`)
            .join(" | ")};\nexport function g(u: U) { switch (u) { ${range(n)
            .map(i => `case "k${i}": return ${i};`)
            .join(" ")} } }`,
      ],
      [
        "constants that each refer to the one before",
        size,
        n =>
          `export const v0 = 1;\n${range(n)
            .map(i => `export const v${i + 1} = v${i} + 1;`)
            .join("\n")}`,
      ],
      [
        "functions that each return what the next returns",
        size / 2,
        n =>
          `${range(n)
            .map(i => `export function f${i}() { return f${i + 1}(); }`)
            .join("\n")}\nexport function f${n}() { return 1; }`,
      ],
      ["nested object literals", size, n => `export const r = ${"{ a: ".repeat(n)}1${" }".repeat(n)};`],
      [
        "nested array types",
        size,
        n => `export type T = ${"Array<".repeat(n)}number${">".repeat(n)};\nexport declare const t: T;`,
      ],
      [
        "a recursive conditional type",
        size,
        n =>
          `type Build<N extends number, A extends unknown[] = []> = A["length"] extends N ? A : Build<N, [...A, 1]>;\nexport type R = Build<${n}>["length"];\nexport const r: R = ${n};`,
      ],
      [
        "overloads",
        size,
        n =>
          `${range(n)
            .map(i => `declare function f(a: "k${i}"): ${i};`)
            .join("\n")}\nexport const r = [${range(n)
            .map(i => `f("k${i}")`)
            .join(", ")}];`,
      ],
      [
        "an interface with many members compared with another",
        size,
        n =>
          `interface A { ${range(n)
            .map(i => `p${i}: { q: A };`)
            .join(" ")} }\ninterface B { ${range(n)
            .map(i => `p${i}: { q: B };`)
            .join(" ")} }\ndeclare const a: A;\nexport const b: B = a;`,
      ],
    ];
    test.each(templates)("%s", async (_, n, source) => {
      using dir = project({ "index.ts": source(n) + "\n" });
      const { stdout, stderr, exitCode } = await check(dir);
      expect(stdout).toBe("");
      // `console.d.ts` is not checked: `skipLibCheck`.
      expect(stderr).toBe("✓ No type errors in 1 file [time]");
      expect(exitCode).toBe(0);
    });

    test("variables in a loop that each need the one before", async () => {
      const n = size / 2;
      using dir = project({
        "index.ts": `interface S { nxt: S | null }\ndeclare function mk(): S;\nexport function g() { let s: S | null = mk(); while (s) { const c0 = s.nxt; ${range(
          n,
        )
          .map(i => `const c${i + 1} = c${i};`)
          .join(" ")} s = c${n}; } }\n`,
      });
      const { stdout, exitCode } = await check(dir);
      // Each of them is circular through the back edge of the loop.
      expect(
        stdout.split("\n").map(line => /error TS7022: '(c\d+)' implicitly has type 'any'/.exec(line)?.[1]),
      ).toEqual(range(n + 1).map(i => `c${i}`));
      expect(exitCode).toBe(1);
    });
  });
});

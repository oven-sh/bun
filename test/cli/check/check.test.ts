import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, existsSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
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
  return { output: Bun.stripANSI(output), hasColors: output.includes("\x1b[3"), exitCode, signalCode: child.signalCode };
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
        "packages/strict/index.ts": `import { f as loose } from "../loose/index";\nexport const a: string = loose(1);\n` + implicitAny,
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
        expect(stdout.split("\n").filter(line => line.includes("TS6307")).map(line => line.slice(0, 40))).toEqual([
          "one/index.js(1,26): error TS6307: File '",
          "two/index.js(1,26): error TS6307: File '",
        ]);
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
      expect(stdout).toMatchInlineSnapshot(`"a.ts(9,7): error TS2322: Type '{ k: "a"; }' is not assignable to type '1'."`);
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
      using dir = project({ "tsconfig.json": `{ "compilerOptions": { "nonsense": true } }` }, { withTypeScript: false });
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
    ["has `types` without \"bun\"", tsconfig],
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
    const page = (script: string) => `<!doctype html>\n<script src="https://example.com/cdn.js"></script>\n<script type="module" src="${script}"></script>\n`;
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
});

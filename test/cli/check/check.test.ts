import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";

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

// Whether the file system takes `A` for `a`, where the projects of these tests are.
const foldsCase = (() => {
  using dir = tempDir("bun-check", { "probe": "" });
  return existsSync(join(String(dir), "PROBE"));
})();

// Disable AI agent and CI detection regardless of the environment the tests run in.
const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  GITHUB_WORKSPACE: undefined,
  // Of the script that runs the tests.
  npm_lifecycle_event: undefined,
  npm_package_json: undefined,
  BUN_INTERNAL_CHECK_SCRIPTS: undefined,
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

  test("a global install is looked for where `bun add -g` installs", async () => {
    const files = { "index.ts": `const wrong: string = 1;\n` };
    using cacheHome = tempDir("bun-check-cache-home", {});
    using globalDir = tempDir("bun-check-global-dir", {});
    const install = (nodeModules: string) => {
      mkdirSync(nodeModules, { recursive: true });
      symlinkSync(typescript, join(nodeModules, "typescript"), "junction");
    };
    install(join(String(cacheHome), ".bun", "install", "global", "node_modules"));
    install(join(String(globalDir), "node_modules"));
    using plain = project(files, { withTypeScript: false });
    using withBunfig = project(
      { ...files, "bunfig.toml": `[install]\nglobalDir = ${JSON.stringify(String(globalDir))}\n` },
      { withTypeScript: false },
    );
    const unset = { BUN_INSTALL_GLOBAL_DIR: undefined, BUN_INSTALL: undefined };
    const results = await Promise.all([
      check(plain, [], { ...unset, XDG_CACHE_HOME: String(cacheHome) }),
      check(withBunfig, [], { ...unset, XDG_CACHE_HOME: "/nowhere" }),
    ]);
    for (const { stdout, exitCode } of results) {
      expect(stdout).toBe("index.ts(1,7): error TS2322: Type 'number' is not assignable to type 'string'.");
      expect(exitCode).toBe(1);
    }
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

  // GitHub takes `file` from the root of the repository, wherever the step runs.
  test("annotations on GitHub Actions are relative to GITHUB_WORKSPACE", async () => {
    using dir = project({
      "packages/app/tsconfig.json": tsconfig,
      "packages/app/src/a.ts": `export const a: string = 1;\n`,
    });
    const { stdout } = await check(join(String(dir), "packages", "app"), [], {
      GITHUB_ACTIONS: "true",
      GITHUB_WORKSPACE: String(dir),
    });
    expect(stdout).toMatchInlineSnapshot(`
      "src/a.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.
      ::error file=packages/app/src/a.ts,line=1,col=14,endLine=1,endColumn=15,title=TS2322::Type 'number' is not assignable to type 'string'."
    `);
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
      "note: Bun's type definitions (console, fetch, Bun, bun:test) are not installed. Run: bun add -d @types/bun
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

    test("every spelling of a flag", async () => {
      using dir = project({
        "a.ts": `export const a: string = 1;\n`,
        "other/tsconfig.json": tsconfig,
        "other/b.ts": `export const b: string = 1;\n`,
      });
      const error = (file: string) => `${file}(1,14): error TS2322: Type 'number' is not assignable to type 'string'.`;
      const whole = `${error("a.ts")}\n${error("other/b.ts")}`;
      const cases: [string[], string][] = [
        [[], whole],
        // One line per error, whatever else is said.
        [["--no-pretty"], whole],
        [["--pretty", "--no-pretty"], whole],
        [["--no-pretty", "--pretty"], whole],
        // It never emits.
        [["--no-emit"], whole],
        [["--noEmit"], whole],
        [["-p", "other"], error("other/b.ts")],
        [["--project", "other"], error("other/b.ts")],
        [["--project=other"], error("other/b.ts")],
        [["--tsconfig-override", "other/tsconfig.json"], error("other/b.ts")],
        [["-b", "other"], error("other/b.ts")],
        [["--build", "other"], error("other/b.ts")],
        [["--build", "-p", "other"], error("other/b.ts")],
        [["-b"], whole],
        [["--cwd", "other"], error("b.ts")],
        [["--cwd=other"], error("b.ts")],
        [["--threads", "1"], whole],
        [["--threads=2"], whole],
      ];
      const results = await Promise.all(cases.map(([args]) => check(dir, args)));
      expect(results.map((it, i) => [cases[i][0], it.stdout, it.exitCode])).toEqual(
        cases.map(([args, stdout]) => [args, stdout, 1]),
      );
    });

    test("a flag with a value that it does not take", async () => {
      using dir = project({ "a.ts": `export const a = 1;\n` });
      const cases: [string[], string][] = [
        [["--pretty", "maybe", "a.ts"], ""],
        [["--pretty=maybe"], `--pretty does not take "maybe"`],
        [["--threads", "0"], `--threads takes a number above zero, not "0"`],
        [["--threads", "many"], `--threads takes a number above zero, not "many"`],
        [["-b", "a", "b"], `--build takes one project`],
        [["-b", "-p", "a", "b"], `--build takes one project`],
        [["--cwd", "nowhere"], `Could not change directory to "nowhere"`],
      ];
      const results = await Promise.all(cases.map(([args]) => check(dir, args)));
      // `maybe` is not a value of `--pretty`, so it is a path.
      expect(results[0].stdout).toContain("TS6053");
      expect(results.slice(1).map((it, i) => [it.stderr.includes(cases[i + 1][1]), it.stdout, it.exitCode])).toEqual(
        cases.slice(1).map(() => [true, "", 1]),
      );
    });

    test("--timing", async () => {
      using dir = project({ "a.ts": `export const a = 1;\n` });
      const [timed, plain] = await Promise.all([check(dir, ["--timing"]), check(dir)]);
      expect(timed.stderr).toMatch(/\d+ files loaded in [\d.]+ms, \d+ checked in [\d.]+ms/);
      expect(plain.stderr).not.toContain("files loaded in");
      expect([timed.stdout, timed.exitCode]).toEqual(["", 0]);
    });

    test("two directories", async () => {
      using dir = project({
        "a/a.ts": `export const a: string = 1;\n`,
        "b/b.ts": `export const b: string = 1;\n`,
        "c/c.ts": `export const c: string = 1;\n`,
      });
      const error = (file: string) => `${file}(1,14): error TS2322: Type 'number' is not assignable to type 'string'.`;
      const { stdout } = await check(dir, ["a", "b"]);
      expect(stdout).toBe(`${error("a/a.ts")}\n${error("b/b.ts")}`);
    });

    test("a flag before `--pretty false` keeps its own value", async () => {
      using dir = project({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, strict: false },
        }),
        "a.ts": `export function f(x) {\n  return x;\n}\n`,
      });
      const error = `a.ts(1,19): error TS7006: Parameter 'x' implicitly has an 'any' type.`;
      const results = await Promise.all([
        check(dir, ["--strict", "--pretty", "false"]),
        check(dir, ["--pretty", "false", "--strict"]),
        check(dir, ["--strict", "--pretty=false"]),
        check(dir, ["--strict", "false", "--pretty", "false"]),
      ]);
      expect(results.map(it => it.stdout)).toEqual([error, error, error, ""]);
    });

    // `subst` gives the directory a drive letter.
    test.skipIf(!isWindows)("a project at the root of a drive", async () => {
      using dir = project({
        "a.ts": `export const a: string = 1;\n`,
        "sub/b.ts": `export const b: string = 1;\n`,
      });
      const subst = (...args: string[]) => Bun.spawnSync({ cmd: ["subst", ...args] }).exitCode === 0;
      const drive = [..."ZYXWVUTSRQ"]
        .map(letter => `${letter}:`)
        .find(drive => !existsSync(`${drive}\\`) && subst(drive, realpathSync(String(dir))));
      expect(drive).toBeDefined();
      try {
        const [from, byProject, directory, file] = await Promise.all([
          run(`${drive}\\`, ["check"]),
          check(dir, ["-p", `${drive}\\`]),
          check(dir, [`${drive}\\sub`]),
          check(dir, [`${drive}\\a.ts`]),
        ]);
        const error = (file: string) =>
          `${file}(1,14): error TS2322: Type 'number' is not assignable to type 'string'.`;
        expect(from.stdout).toBe(`${error("a.ts")}\n${error("sub/b.ts")}`);
        // In one assertion, so that a failure shows all of them.
        const named = [byProject, directory, file];
        expect(named.map(it => [it.stdout, it.exitCode])).toEqual([
          [expect.stringContaining(error("a.ts")), 1],
          [expect.stringContaining(error("sub/b.ts")), 1],
          [expect.stringContaining(error("a.ts")), 1],
        ]);
        expect(named.map(it => it.stdout).join("\n")).not.toContain("TS6053");
      } finally {
        subst(drive!, "/D");
      }
    });

    test("without a tsconfig.json, a file that is named is loaded with what it imports and nothing else", async () => {
      using dir = tempDir("bun-check", {
        "a.ts": `import "./imported";\nexport const a = elsewhere;\n`,
        "imported.ts": `export {};\n`,
        "other/globals.d.ts": `declare const elsewhere: number;\n`,
      });
      mkdirSync(join(String(dir), "node_modules"));
      symlinkSync(typescript, join(String(dir), "node_modules", "typescript"), "junction");
      const [all, named, listed] = await Promise.all([
        check(dir),
        check(dir, ["a.ts"]),
        check(dir, ["a.ts", "--listFilesOnly"]),
      ]);
      expect(all.stdout).toBe("");
      expect(named.stdout).toBe(`a.ts(2,18): error TS2304: Cannot find name 'elsewhere'.`);
      const own = listed.stdout.split("\n").filter(line => !line.includes("/typescript/lib/lib."));
      expect(own.map(line => line.replace(/^\S*\//, ""))).toEqual(["imported.ts", "a.ts"]);
    });

    // Not that of the file system that has `bun`.
    test("the case of a file name matters if it does to the file system of the project", async () => {
      using dir = project({
        "button.ts": `export const button = 1;\n`,
        "a.ts": `import { button } from "./Button";\nexport const a: number = button;\n`,
      });
      const { stdout } = await check(dir, ["a.ts"]);
      const isFound = existsSync(join(String(dir), "BUTTON.TS"));
      expect(stdout.includes("TS2307")).toBe(!isFound);
    });

    test("a directory outside the project, without a tsconfig.json of its own", async () => {
      using dir = tempDir("bun-check", {
        "packages/my-application/tsconfig.json": tsconfig,
        "packages/my-application/a.ts": `export const a: string = 1;\n`,
        "packages/lib/b.ts": `export const b: string = 1;\n`,
      });
      mkdirSync(join(String(dir), "node_modules"));
      symlinkSync(typescript, join(String(dir), "node_modules", "typescript"), "junction");
      const { stdout } = await check(join(String(dir), "packages", "my-application"), ["../lib"]);
      expect(stdout).toBe(`../lib/b.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.`);
    });

    test("a directory with a link that leads back up", async () => {
      // Without a tsconfig.json at the root, so that those below are looked for.
      using dir = tempDir("bun-check", {
        "pkg/tsconfig.json": tsconfig,
        "pkg/a.ts": `export const a: string = 1;\n`,
      });
      mkdirSync(join(String(dir), "node_modules"));
      symlinkSync(typescript, join(String(dir), "node_modules", "typescript"), "junction");
      symlinkSync(String(dir), join(String(dir), "pkg", "up"), "junction");
      const { stdout } = await check(dir, ["."]);
      expect(stdout).toBe(`pkg/a.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.`);
    });

    test("a path on the command line is relative to the working directory, as in tsc", async () => {
      using dir = project({
        "packages/server/tsconfig.json": JSON.stringify({ ...JSON.parse(tsconfig), include: ["src"] }),
        "packages/server/src/a.ts": `export const a: number = 1;\n`,
      });
      const [fromHere, fromTheConfig] = await Promise.all([
        check(dir, ["-p", "packages/server", "--rootDir", "packages/server/src"]),
        check(dir, ["-p", "packages/server", "--rootDir", "src"]),
      ]);
      expect(fromHere.stdout).toBe("");
      expect(fromHere.exitCode).toBe(0);
      expect(fromTheConfig.stdout).toStartWith(
        `error TS6059: File '<dir>/packages/server/src/a.ts' is not under 'rootDir' '<dir>/src'.`,
      );
      expect(fromTheConfig.exitCode).toBe(1);
    });

    // The administrative share of the drive, as in test/js/node/fs/cp.test.ts.
    test.skipIf(!isWindows)("a project on a network share", async () => {
      using dir = project({ "a.ts": `export const a: string = 1;\n` });
      const real = realpathSync(String(dir));
      const share = `\\\\localhost\\${real[0]}$\\${real.slice(3)}`;
      const [from, named] = await Promise.all([run(share, ["check"]), check(dir, ["-p", share])]);
      expect(from.stdout).toBe(`a.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.`);
      expect(named.stdout).toEndWith(`/a.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.`);
      expect(named.stdout).toStartWith("//localhost/");
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

    test("a directory that is named has the files that the project does not exclude", async () => {
      using dir = project({
        "tsconfig.json": JSON.stringify({
          compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, outDir: "src/written" },
          include: ["src/**/*"],
        }),
        "excluding/tsconfig.json": JSON.stringify({
          ...JSON.parse(tsconfig),
          include: ["src/**/*"],
          exclude: ["src/generated"],
        }),
        "excluding/src/a.ts": `export const a: string = 1;\n`,
        "excluding/src/generated/g.ts": `export const g: string = 1;\n`,
        "excluding/scripts/s.ts": `export const s: string = 1;\n`,
        "src/a.ts": `export const a: string = 1;\n`,
        "src/written/w.ts": `export const w: string = 1;\n`,
      });
      const error = (file: string) => `${file}(1,14): error TS2322: Type 'number' is not assignable to type 'string'.`;
      const excluding = join(String(dir), "excluding");
      const [excluded, notIncluded, named, written] = await Promise.all([
        check(excluding, ["src"]),
        check(excluding, ["scripts"]),
        check(excluding, ["src/generated/g.ts"]),
        check(dir, ["src"]),
      ]);
      expect(excluded.stdout).toBe(error("src/a.ts"));
      expect(notIncluded.stdout).toBe(error("scripts/s.ts"));
      expect(named.stdout).toBe(error("src/generated/g.ts"));
      expect(written.stdout).toBe(error("src/a.ts"));
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

    test("--traceResolution", async () => {
      using dir = project({
        "a.ts": `import { b } from "./b";\nimport { c } from "pkg";\nexport const a: string = b + c;\n`,
        "b.ts": `export const b = 1;\n`,
        "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "types": "./index.d.ts" }`,
        "node_modules/pkg/index.d.ts": `export declare const c: number;\n`,
      });
      const { stdout, exitCode } = await check(dir, ["--traceResolution"]);
      const lines = stdout.replaceAll(realpathSync(String(dir)).replaceAll("\\", "/"), "<dir>").split("\n");
      // What is above the project depends on the machine.
      const inProject = lines.filter(line => !/^(File|Found 'package\.json' at|Directory) '(?!<dir>)/.test(line));
      expect(inProject.map(line => line.replaceAll("<dir>", ""))).toEqual([
        "======== Resolving module './b' from '/a.ts'. ========",
        "Explicitly specified module resolution kind: 'Bundler'.",
        "Resolving in CJS mode with conditions 'import', 'types'.",
        "Loading module as file / folder, candidate module location '/b', target file types: TypeScript, JavaScript, Declaration, JSON.",
        "File '/b.ts' exists - use it as a name resolution result.",
        "======== Module name './b' was successfully resolved to '/b.ts'. ========",
        "======== Resolving module 'pkg' from '/a.ts'. ========",
        "Explicitly specified module resolution kind: 'Bundler'.",
        "Resolving in CJS mode with conditions 'import', 'types'.",
        "File '/package.json' does not exist according to earlier cached lookups.",
        "Loading module 'pkg' from 'node_modules' folder, target file types: TypeScript, JavaScript, Declaration, JSON.",
        "Searching all ancestor node_modules directories for preferred extensions: TypeScript, Declaration.",
        "Found 'package.json' at '/node_modules/pkg/package.json'.",
        "File '/node_modules/pkg.ts' does not exist.",
        "File '/node_modules/pkg.tsx' does not exist.",
        "File '/node_modules/pkg.d.ts' does not exist.",
        "'package.json' does not have a 'typesVersions' field.",
        "'package.json' does not have a 'typings' field.",
        "'package.json' has 'types' field './index.d.ts' that references '/node_modules/pkg/index.d.ts'.",
        "File '/node_modules/pkg/index.d.ts' exists - use it as a name resolution result.",
        "'package.json' does not have a 'peerDependencies' field.",
        "Resolving real path for '/node_modules/pkg/index.d.ts', result '/node_modules/pkg/index.d.ts'.",
        "======== Module name 'pkg' was successfully resolved to '/node_modules/pkg/index.d.ts' with Package ID 'pkg/index.d.ts@1.0.0'. ========",
        "a.ts(3,14): error TS2322: Type 'number' is not assignable to type 'string'.",
      ]);
      expect(exitCode).toBe(1);
    });

    test("--traceResolution: an `import()` is resolved once more for each `import` or `require` in it", async () => {
      // typescript-go finds them by searching the text for those words.
      using dir = project({
        "a.ts": `export const a = [import("./plain"), import("./require-me"), import(/* import */ "./import-import")];\n`,
        "plain.ts": `export {};\n`,
        "require-me.ts": `export {};\n`,
        "import-import.ts": `export {};\n`,
      });
      const { stdout, exitCode } = await check(dir, ["--traceResolution"]);
      expect(stdout.split("\n").flatMap(line => line.match(/^======== Resolving module '(.*?)'/)?.[1] ?? [])).toEqual([
        "./plain",
        "./require-me",
        "./require-me",
        "./import-import",
        "./import-import",
        "./import-import",
        "./import-import",
      ]);
      expect(exitCode).toBe(0);
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

    test("without a tsconfig.json at the root: each file has the options nearest to it, or else the default ones", async () => {
      const implicitAny = `export function f(x) {\n  return x;\n}\n`;
      const loose = JSON.stringify({ compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, strict: false } });
      using dir = tempDir("bun-check", {
        // It has no say in this.
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
      const [{ stdout, stderr, exitCode }, here, packages] = await Promise.all([
        check(dir),
        check(dir, ["."]),
        check(dir, ["packages"]),
      ]);
      expect(stdout).toMatchInlineSnapshot(`
        "packages/strict/index.ts(3,19): error TS7006: Parameter 'x' implicitly has an 'any' type.
        scripts/build.ts(1,19): error TS7006: Parameter 'x' implicitly has an 'any' type."
      `);
      expect(stderr).toMatchInlineSnapshot(`
        "Found 2 errors in 2 files, checked 5 files across 5 projects [time]

          1  packages/strict/index.ts:3
          1  scripts/build.ts:1"
      `);
      expect(exitCode).toBe(1);
      expect([here.stdout, here.stderr]).toEqual([stdout, stderr]);
      expect(packages.stdout).toBe(
        `packages/strict/index.ts(3,19): error TS7006: Parameter 'x' implicitly has an 'any' type.`,
      );
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
    test("a type parameter that shadows another keeps its name in the declaration file", async () => {
      const compilerOptions = JSON.parse(tsconfig).compilerOptions;
      using dir = project({
        "tsconfig.json": JSON.stringify({ compilerOptions, files: ["b.ts"], references: [{ path: "./a" }] }),
        "a/tsconfig.json": JSON.stringify({
          compilerOptions: { ...compilerOptions, noEmit: false, composite: true, outDir: "dist", rootDir: "src" },
          include: ["src"],
        }),
        "a/src/x.ts": `export interface Box<A> {\n  readonly map: <A>(value: A) => A;\n}\n`,
        "b.ts": `import type { Box } from "./a/src/x";\nexport const map: Box<1>["map"] = 1;\n`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"b.ts(2,14): error TS2322: Type 'number' is not assignable to type '<A>(value: A) => A'."`,
      );
    });

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

    test("a `this` parameter in the declaration file of a referenced project", async () => {
      const compilerOptions = JSON.parse(tsconfig).compilerOptions;
      using dir = project({
        "tsconfig.json": JSON.stringify({ compilerOptions, files: ["b.ts"], references: [{ path: "./a" }] }),
        "a/tsconfig.json": JSON.stringify({
          compilerOptions: { ...compilerOptions, noEmit: false, composite: true, outDir: "dist", rootDir: "src" },
          include: ["src"],
        }),
        "a/src/x.ts": `export function f(this: { a: 1 }, b: number, c = 1) {\n  return [this.a, b, c];\n}\n`,
        "b.ts": `import { f } from "./a/src/x";\nexport const g: 1 = f;\n`,
      });
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"b.ts(2,14): error TS2322: Type '(this: { a: 1; }, b: number, c?: number | undefined) => number[]' is not assignable to type '1'."`,
      );
    });

    test("a project sees the declaration files of the projects before it, whether it references them or not", async () => {
      const compilerOptions = {
        ...options,
        module: "nodenext",
        moduleResolution: "nodenext",
        outDir: "dist",
        rootDir: ".",
      };
      const config = (references: { path: string }[]) =>
        JSON.stringify({ compilerOptions, include: ["*.ts"], references });
      using dir = project({
        "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./a" }, { path: "./b" }, { path: "./c" }] }),
        "a/tsconfig.json": config([]),
        "a/index.ts": `export const a = 1;\n`,
        "b/tsconfig.json": config([{ path: "../a" }]),
        "b/index.ts": `import { a } from "../a/index.js";\nexport const b: string = a;\n`,
        "c/tsconfig.json": config([]),
        "c/index.ts": `import { a } from "../a/dist/index.js";\nexport const c: string = a;\n`,
      });
      const expected = `b/index.ts(2,14): error TS2322: Type 'number' is not assignable to type 'string'.
c/index.ts(2,14): error TS2322: Type 'number' is not assignable to type 'string'.`;
      // Whichever of them are built at the same time.
      for (const threads of ["1", "8"]) {
        const { stdout } = await check(dir, ["--threads", threads]);
        expect(stdout).toBe(expected);
      }
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
      // A file has the same errors when it is named, which is what `--check` does.
      const [{ stdout }, file, directory] = await Promise.all([
        check(dir),
        check(dir, ["packages/app/src/index.ts"]),
        check(dir, ["packages/app"]),
      ]);
      expect(stdout).toMatchInlineSnapshot(`
        "packages/app/src/index.ts(3,14): error TS2322: Type 'number' is not assignable to type 'string'.
        packages/app/src/index.ts(4,14): error TS2322: Type 'number' is not assignable to type 'string'."
      `);
      expect([file.stdout, directory.stdout]).toEqual([stdout, stdout]);
    });

    // What `create vite` writes: the nearest tsconfig.json has no files and no options of its own.
    test("path arguments: under a solution, a file is checked in the project that has it", async () => {
      using dir = project({
        "console.d.ts": "",
        "tsconfig.json": JSON.stringify({
          files: [],
          references: [
            { path: "./tsconfig.app.json" },
            { path: "./tsconfig.node.json" },
            { path: "./tsconfig.worker.json" },
          ],
        }),
        "tsconfig.app.json": JSON.stringify({
          compilerOptions: { ...options, jsx: "preserve", allowImportingTsExtensions: true, emitDeclarationOnly: true },
          include: ["src", "test"],
        }),
        "test/t.ts": `export const t: number = "1";\n`,
        "tsconfig.node.json": JSON.stringify({ compilerOptions: options, include: ["vite.config.ts"] }),
        "src/jsx.d.ts": `declare namespace JSX {\n  interface Element {}\n  interface IntrinsicElements {\n    div: {};\n  }\n}\n`,
        "src/App.tsx": `export const App: number = 1;\n`,
        "src/main.tsx": `import { App } from "./App.tsx";\nexport const element = <div />;\nexport const a: string = App;\n`,
        "vite.config.ts": `export const port: number = "1";\n`,
        // No project has it.
        "scripts/s.ts": `export const s: number = "1";\n`,
        // Its only file is JavaScript, which the solution itself does not allow.
        "tsconfig.worker.json": JSON.stringify({
          compilerOptions: { ...options, allowJs: true, checkJs: true, emitDeclarationOnly: true },
          files: ["worker.js"],
        }),
        "worker.js": `/** @type {number} */\nexport const w = "1";\n`,
        // A project of its own, which the solution does not reference: `bun check` leaves it alone.
        "examples/x/tsconfig.json": JSON.stringify({ compilerOptions: { ...options, composite: false } }),
        "examples/x/e.ts": `export const e: number = "1";\n`,
      });
      const main = `src/main.tsx(3,14): error TS2322: Type 'number' is not assignable to type 'string'.`;
      const other = (file: string) => `${file}(1,14): error TS2322: Type 'string' is not assignable to type 'number'.`;
      const results = await Promise.all([
        check(dir),
        check(dir, ["."]),
        check(dir, ["src/main.tsx"]),
        check(dir, ["src"]),
        check(dir, ["-p", ".", "src/main.tsx"]),
        check(dir, ["vite.config.ts"]),
        check(dir, ["src/main.tsx", "vite.config.ts"]),
        check(dir, ["scripts"]),
        check(dir, ["examples"]),
        check(dir, ["src", "src/main.tsx"]),
        run(String(dir), ["--check", "src/main.tsx"]),
      ]);
      const some = `${main}\n${other("vite.config.ts")}`;
      const worker = `worker.js(2,14): error TS2322: Type 'string' is not assignable to type 'number'.`;
      const whole = `${main}\n${other("test/t.ts")}\n${other("vite.config.ts")}\n${worker}`;
      expect(results.slice(0, 10).map(it => it.stdout)).toEqual([
        whole,
        whole,
        main,
        main,
        main,
        other("vite.config.ts"),
        some,
        other("scripts/s.ts"),
        other("examples/x/e.ts"),
        main,
      ]);
      // As much work, too.
      expect(results[1].stderr).toBe(results[0].stderr);
      expect(results[9].stderr).toBe(results[3].stderr);
      expect(results[10].stderr).toContain("TS2322");
      expect(results[10].stderr).not.toMatch(/TS17004|TS5097|TS6142/);
    });

    test("path arguments: each is checked with the compiler options of its own project", async () => {
      using dir = project({
        "console.d.ts": "",
        "strict/tsconfig.json": JSON.stringify({ compilerOptions: { ...options, composite: false, strict: true } }),
        "strict/a.ts": `export function f(x) {\n  return x;\n}\n`,
        "loose/tsconfig.json": JSON.stringify({ compilerOptions: { ...options, composite: false, strict: false } }),
        "loose/a.ts": `export function f(x) {\n  return x;\n}\n`,
      });
      const error = `strict/a.ts(1,19): error TS7006: Parameter 'x' implicitly has an 'any' type.`;
      const [strictFirst, looseFirst] = await Promise.all([
        check(dir, ["strict/a.ts", "loose/a.ts"]),
        check(dir, ["loose/a.ts", "strict/a.ts"]),
      ]);
      expect([strictFirst.stdout, looseFirst.stdout]).toEqual([error, error]);
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

    test("an untyped module of a workspace package that has declaration files", async () => {
      using dir = project({
        "packages/pkg/package.json": JSON.stringify({
          name: "@scope/pkg",
          version: "1.0.0",
          exports: { ".": { types: "./index.d.ts", default: "./index.js" }, "./untyped": "./untyped.js" },
        }),
        "packages/pkg/index.d.ts": `export declare const typed: number;\n`,
        "packages/pkg/index.js": `export const typed = 1;\n`,
        "packages/pkg/untyped.js": `export const untyped = 1;\n`,
        "a.ts": `import { typed } from "@scope/pkg";\nimport { untyped } from "@scope/pkg/untyped";\nexport const both = [typed, untyped];\n`,
      });
      mkdirSync(join(String(dir), "node_modules/@scope"), { recursive: true });
      symlinkSync(join(String(dir), "packages/pkg"), join(String(dir), "node_modules/@scope/pkg"), "junction");
      const { stdout } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,25): error TS7016: Could not find a declaration file for module '@scope/pkg/untyped'. '<dir>/packages/pkg/untyped.js' implicitly has an 'any' type.
          If the '@scope/pkg' package actually exposes this module, try adding a new declaration (.d.ts) file containing \`declare module '@scope/pkg/untyped';\`"
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

    test("the package id is that of the package.json the resolution went through, not of the real path", async () => {
      using dir = project({
        "package.json": `{ "name": "app", "version": "2.0.0", "exports": { "./x": { "types": "./missing.d.ts", "default": "./x.js" } }, "imports": { "#y": "./y.js" } }\n`,
        "a.ts": `import linked from "pkg";
import inLinked from "pkg/sub";
import ownName from "app/x";
import ownImports from "#y";
import relative from "./x.js";
export { linked, inLinked, ownName, ownImports, relative };
`,
        "x.js": `exports.a = 1;\n`,
        "y.js": `exports.a = 1;\n`,
        "packages/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "main": "index.js" }\n`,
        "packages/pkg/index.js": `exports.a = 1;\n`,
        "packages/pkg/sub.js": `exports.a = 1;\n`,
      });
      symlinkSync(join(String(dir), "packages", "pkg"), join(String(dir), "node_modules", "pkg"), "junction");
      const { stdout, exitCode } = await check(dir);
      expect(stdout.replace(/\. '[^']*' implicitly/g, ". '<file>' implicitly")).toMatchInlineSnapshot(`
        "a.ts(1,20): error TS7016: Could not find a declaration file for module 'pkg'. '<file>' implicitly has an 'any' type.
          Try \`bun add -d @types/pkg\` if it exists or add a new declaration (.d.ts) file containing \`declare module 'pkg';\`
        a.ts(2,22): error TS7016: Could not find a declaration file for module 'pkg/sub'. '<file>' implicitly has an 'any' type.
          Try \`bun add -d @types/pkg\` if it exists or add a new declaration (.d.ts) file containing \`declare module 'pkg/sub';\`
        a.ts(3,21): error TS7016: Could not find a declaration file for module 'app/x'. '<file>' implicitly has an 'any' type.
          Try \`bun add -d @types/app\` if it exists or add a new declaration (.d.ts) file containing \`declare module 'app/x';\`
        a.ts(4,24): error TS7016: Could not find a declaration file for module '#y'. '<file>' implicitly has an 'any' type.
          Try \`bun add -d @types/app\` if it exists or add a new declaration (.d.ts) file containing \`declare module '#y';\`
        a.ts(5,22): error TS7016: Could not find a declaration file for module './x.js'. '<file>' implicitly has an 'any' type."
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

    test("a parameter default that refers to its own function", async () => {
      using dir = project({
        "a.ts": `export const h1 = (a = h1()) => a;
export const h2 = (a = h2) => 1;
export const h3 = function (a = h3()) { return a; };
export const h4 = (a = h4(1)): number => a;
export const h5 = { m(a = h5.m()) { return a; } };
export const h6 = { m(a = h6) { return 1; } };
export const h7 = { m: (a = h7.m()) => a };
export const h8 = (a = h8.length) => 1;
export const h9 = (a = () => h9) => 1;
export function t5(a = 1 as ReturnType<typeof t5>) { return a; }
let h10 = (a = h10) => 1; var h11 = (a = h11) => 1;
export class K { f = (a = this.f) => 1; static g = (a = K.g) => 1; }
export function outer() { const inner = (a = inner) => 1; return inner; }
h10; h11;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,14): error TS7022: 'h1' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(2,14): error TS7022: 'h2' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(3,14): error TS7022: 'h3' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,14): error TS7022: 'h4' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,14): error TS7022: 'h5' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,14): error TS7022: 'h6' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,14): error TS7022: 'h7' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,14): error TS7022: 'h8' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,20): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(11,5): error TS7022: 'h10' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(11,31): error TS7022: 'h11' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,18): error TS7022: 'f' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,48): error TS7022: 'g' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(13,33): error TS7022: 'inner' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("`delete` of a property whose type is generic", async () => {
      using dir = project({
        "a.ts": `export function i1<T>(x: { t: T }) { delete x.t; }
export function i2<T extends string>(x: { t: T }) { delete x.t; }
export function i3<T extends string | undefined>(x: { t: T }) { delete x.t; }
export function i4<T extends {}>(x: { t: T }) { delete x.t; }
export function i5<T extends unknown>(x: { t: T }) { delete x.t; }
export function i6<T, K extends keyof T>(x: { t: T[K] }) { delete x.t; }
export function i7<T>(x: { t: T extends string ? 1 : undefined }) { delete x.t; }
export function i8<T>(x: Partial<{ t: T }>) { delete x.t; }
export function i9<T>(x: { [P in "t"]?: T }) { delete x.t; }
export function j1(x: Partial<{ t: number }>) { delete x.t; }
export function j2(x: { t?: number } & { u: 1 }) { delete x.t; }
export function j3(x: { t?: number } | { t?: string }) { delete x.t; }
export function j4(x: { t?: number } | { t: string }) { delete x.t; }
export function j5(x: { t: number } & { t?: number }) { delete x.t; }
export function j6(x: Required<{ t?: number }>) { delete x.t; }
export function j7(x: { t?: never }) { delete x.t; }
export function j8(x: { t?: void }) { delete x.t; }
export function j9() { const y = { ...({} as { t?: number }) }; delete y.t; }
export function k1() { const y = { t: 1 as number | undefined }; delete y.t; }
export function k2(x: Record<string, number>) { delete x.t; delete x["t"]; }
export function k3(x: { t: null }) { delete x.t; }
export function k4(x: { t: T4 }) { delete x.t; } type T4 = void | undefined;
export class K5 { t?: number; m() { delete this.t; } }
export function k6(x: [number, number?]) { delete x[1]; delete x[0]; }
export function k7(x: { get t(): number | undefined; set t(v) }) { delete x.t; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,45): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(2,60): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(4,56): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(5,61): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(6,67): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(14,64): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(15,58): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(21,45): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(24,64): error TS2790: The operand of a 'delete' operator must be optional."
      `);
      expect(exitCode).toBe(1);
    });

    test("a recursive conditional type that reaches the depth limit in several declarations", async () => {
      using dir = project({
        "a.ts": `type Ser<T> = T extends Function ? never : T extends Promise<infer U> ? Ser<U> : T extends string & {} ? T : T extends Record<string, any> ? { [K in keyof T]: Ser<T[K]> } : T;
type Nest = (string | Nest)[];
export type B1 = Ser<Nest>;
export type B2 = Ser<Nest>;
export type B3 = { a: Ser<Nest>; b: Ser<string | Nest>; c: Ser<Nest[]>; d: Ser<Promise<Nest>> };
export declare function f(x: Ser<Nest>): Ser<Nest>;
export const c1 = f(null!);
type Grow<T> = T extends unknown[] ? { [K in keyof T]: Grow<[T]> } : T;
export type G1 = Grow<[1]>;
export type G2 = { g: Grow<[1]>; h: Grow<[[1]]> };
type Tup = [string, Tup?];
export type T1 = { a: Ser<Tup> };
export type T2 = Ser<Tup>;
interface Box<T> { v: T }
type Wrap<T> = T extends unknown[] ? Box<{ [K in keyof T]: Wrap<T> }> : T;
export type W1 = Wrap<[1]>;
export type W2 = { w: Wrap<[1]> };
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,18): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(8,56): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(12,23): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(16,18): error TS2589: Type instantiation is excessively deep and possibly infinite."
      `);
      expect(exitCode).toBe(1);
    });

    test("a callback in a loop whose receiver depends on the variable of the loop", async () => {
      using dir = project({
        "a.ts": `interface S { nxt: S | null; id: string; n: number; kids: S[]; gen<T>(x: T): T; over(a: string): S; over(a: number): S | null; p: Promise<S | null>; get(): S | null }
declare function mk(id?: string): S; declare function mkN(s: S | null): S | null; declare function idf<T>(x: T): T; declare const c: boolean; declare class G<T> { constructor(x: T); v: T } declare class H { constructor(x: S | null); v: S | null } declare function tg<T>(s: TemplateStringsArray, x: T): T; declare function ov(a: S): S | null; declare function ov(a: null): null; declare function pr(s: S | null): Promise<S | null>;
export function m1() { let s: S | null = mk(); while (s) { const cur = idf(s.nxt); s = cur?.kids.find(k => k.id) ?? null; } }
export function m2() { let s: S | null = mk(); while (s) { const cur = ov(s); s = cur?.kids.find(k => k.id) ?? null; } }
export function m3() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = cur?.kids.find(k => k.id) ?? null; } }
export function m4() { let s: S | null = mk(); while (s) { const cur = idf(s.nxt); s = cur?.kids.filter(k => k.id)[0] ?? null; } }
export function m5() { let s: S | null = mk(); while (s) { const cur = idf(s.nxt); s = cur?.kids.map(k => k)[0] ?? null; } }
export function f1() { let s: S | null = mk(); while (s) { const cur = !s.nxt; const nx = [(cur ? null : s.nxt)].find(k => k) ?? null; s = nx; } }
export function f2() { let s: S | null = mk(); while (s) { const cur = s.nxt; const nx = [cur].find(k => k) ?? null; s = nx; } }
export function f3() { let s: S | null = mk(); while (s) { const cur = s.nxt; const nx = cur?.kids.find(k => k.id) ?? null; s = nx; } }
export function f4() { let s: S | null = mk(); while (s) { const cur = s.nxt; const nx = [cur].map(k => k)[0]; s = nx; } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(3,103): error TS7006: Parameter 'k' implicitly has an 'any' type.
        a.ts(4,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,98): error TS7006: Parameter 'k' implicitly has an 'any' type.
        a.ts(5,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,98): error TS7006: Parameter 'k' implicitly has an 'any' type.
        a.ts(6,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,105): error TS7006: Parameter 'k' implicitly has an 'any' type.
        a.ts(7,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,102): error TS7006: Parameter 'k' implicitly has an 'any' type.
        a.ts(8,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,86): error TS7022: 'nx' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(9,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(9,85): error TS7022: 'nx' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,85): error TS7022: 'nx' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,105): error TS7006: Parameter 'k' implicitly has an 'any' type.
        a.ts(11,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(11,85): error TS7022: 'nx' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("a parameter default asserted to the return type of its own function", async () => {
      using dir = project({
        "a.ts": `export function t5(a = 1 as ReturnType<typeof t5>) { return a; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(1,20): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."`,
      );
      expect(exitCode).toBe(1);
    });

    test("the parameter of a callback in a loop has its contextual type", async () => {
      using dir = project({
        "a.ts": `interface S { nxt: S | null; id: string; n: number; kids: S[]; gen<T>(x: T): T; over(a: string): S; over(a: number): S | null; p: Promise<S | null>; get(): S | null }
declare function mk(id?: string): S; declare function mkN(s: S | null): S | null; declare function idf<T>(x: T): T; declare const c: boolean; declare class G<T> { constructor(x: T); v: T } declare class H { constructor(x: S | null); v: S | null } declare function tg<T>(s: TemplateStringsArray, x: T): T; declare function ov(a: S): S | null; declare function ov(a: null): null; declare function pr(s: S | null): Promise<S | null>;
export function k1() { let s: S | null = mk(); while (s) { const cur = s.kids.find(k => { const p: never = k; return true; }); s = cur ?? null; } }
export function k2() { let s: S | null = mk(); while (s) { const cur = s.kids.map(k => { const p: never = k; return k; })[0]; s = cur; } }
export function m1() { let s: S | null = mk(); while (s) { const cur = idf(s.nxt); s = cur?.kids.find(k => { const p: never = k; return true; }) ?? null; } }
export function m3() { let s: S | null = mk(); while (s) { const cur = s.nxt; s = cur?.kids.find(k => { const p: never = k; return true; }) ?? null; } }
export function f2() { let s: S | null = mk(); while (s) { const cur = s.nxt; const nx = [cur].find(k => { const p: never = k; return true; }) ?? null; s = nx; } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(3,97): error TS2322: Type 'S' is not assignable to type 'never'.
        a.ts(4,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,96): error TS2322: Type 'S' is not assignable to type 'never'.
        a.ts(5,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,103): error TS7006: Parameter 'k' implicitly has an 'any' type.
        a.ts(5,116): error TS2322: Type 'any' is not assignable to type 'never'.
        a.ts(6,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,98): error TS7006: Parameter 'k' implicitly has an 'any' type.
        a.ts(6,111): error TS2322: Type 'any' is not assignable to type 'never'.
        a.ts(7,66): error TS7022: 'cur' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,85): error TS7022: 'nx' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,114): error TS2322: Type 'any' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("functions that return a variable whose initializer calls them", async () => {
      using dir = project({
        "a.ts": `export function p1() { const b = a; const a = [g(), h()]; function g() { return a; } function h() { return a; } return b; }
export function p2() { const a = [g(), h()]; function g() { return a; } function h() { return a; } }
export function p3() { const b = () => a; const a = [g(), h()]; function g() { return a; } function h() { return a; } return b; }
export function p4() { function k() { return a; } const a = [g(), h()]; function g() { return a; } function h() { return a; } return k; }
export function p5(a = 1 as ReturnType<typeof p5>) { return a; }
export function p6(a = [1 as ReturnType<typeof p6>]) { return a; }
export function p7(a = 1 as Parameters<typeof p7>[0]) { return a; }
export function p8() { const f = function (a = 1 as ReturnType<typeof f>) { return a; }; return f; }
export function p9() { const f = (a = 1 as ReturnType<typeof f>) => a; return f; }
export class C1 { m(a = 1 as ReturnType<C1["m"]>) { return a; } }
export function q2(a = 1 as ReturnType<typeof q2>, b = a) { return b; }
export function q3() { let a = 1 as ReturnType<typeof g>; function g(x = a) { return x; } return a; }
export function q4() { const o = { p: 1 as ReturnType<typeof g> }; function g(x = o) { return x.p; } return o; }
export function q5() { const b = a; var a = [g(), h()]; function g() { return a; } function h() { return a; } return b; }
export function q6() { const b = typeof a; const a = { x: g(), y: h() }; function g() { return a; } function h() { return a; } return b; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,34): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(1,43): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(1,68): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(2,30): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(2,55): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(3,49): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(3,74): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(4,57): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,82): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(5,20): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,20): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,20): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,30): error TS7022: 'f' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(9,30): error TS7022: 'f' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,21): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(11,20): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,28): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,70): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(13,30): error TS7022: 'o' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(13,79): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(14,41): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(14,66): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(15,41): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(15,50): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(15,83): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions."
      `);
      expect(exitCode).toBe(1);
    });

    test("an interface augmented through two levels of `export *`", async () => {
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
        "use.ts": `import type { N as NA } from "./main";
import type { N as NF } from "./types";
import { E as E1 } from "./main";
import { E as E4 } from "./types";
export const ja: NA.J = { j: 1 };
export const jf: NF.J = { j: 1 };
export const t: [E1, E4] = [0 as never as E4, 0 as never as E1];
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "use.ts(6,21): error TS2694: Namespace '"<dir>/types".N' has no exported member 'J'.
        use.ts(7,47): error TS2322: Type 'E' is not assignable to type 'E.a'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an interface augmented through a module that re-exports it by name", async () => {
      using dir = project({
        "a.ts": `export {};
declare module "./m" { interface X { two: 2 } }
`,
        "i.ts": `export { X } from "./t";
`,
        "m.ts": `export * from "./i";
`,
        "t.ts": `export class X { k = 1 }
`,
        "u.ts": `import { X as XT } from "./t";
import { X as XI } from "./i";
import { X as XM } from "./m";
export const a1: never = new XT();
export const a2: never = new XI();
export const a3: never = new XM();
export const b1: never = XT;
export const b2: never = XI;
export const b3: never = XM;
export const c1: never = new XT().two;
export const c2: never = new XI().two;
export const c3: never = new XM().two;
export const d1: never = null! as XT["two"];
export const d2: never = null! as XI["two"];
export const d3: never = null! as XM["two"];
export const e: [XT, XI, XM] = [null! as XI, null! as XM, null! as XT];
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "u.ts(4,14): error TS2322: Type 'X' is not assignable to type 'never'.
        u.ts(5,14): error TS2322: Type 'X' is not assignable to type 'never'.
        u.ts(6,14): error TS2322: Type 'X' is not assignable to type 'never'.
        u.ts(7,14): error TS2322: Type 'typeof X' is not assignable to type 'never'.
        u.ts(8,14): error TS2322: Type 'typeof X' is not assignable to type 'never'.
        u.ts(9,14): error TS2322: Type 'typeof X' is not assignable to type 'never'.
        u.ts(10,14): error TS2322: Type '2' is not assignable to type 'never'.
        u.ts(11,14): error TS2322: Type '2' is not assignable to type 'never'.
        u.ts(12,14): error TS2322: Type '2' is not assignable to type 'never'.
        u.ts(13,14): error TS2322: Type '2' is not assignable to type 'never'.
        u.ts(14,14): error TS2322: Type '2' is not assignable to type 'never'.
        u.ts(15,14): error TS2322: Type '2' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("two augmentations of an interface through a module that re-exports it", async () => {
      using dir = project({
        "a.ts": `export {};
declare module "./m" { interface X { two: 2 } }
`,
        "b.ts": `export {};
declare module "./t" { interface New { n: 1 } }
`,
        "i.ts": `export * from "./t";
`,
        "m.ts": `export { X } from "./i";
`,
        "t.ts": `export interface X { k: 1 }
`,
        "u.ts": `import type { New as NI } from "./i";
import type { New as NT } from "./t";
export const a: never = null! as NI;
export const b: never = null! as NT;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "u.ts(1,15): error TS2305: Module '"./i"' has no exported member 'New'.
        u.ts(3,14): error TS2322: Type 'NI' is not assignable to type 'never'.
        u.ts(4,14): error TS2322: Type 'New' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("augmentations of re-exported names through several modules", async () => {
      using dir = project({
        "a.ts": `export {};
declare module "./i" { interface A1 { a: 1 } }
`,
        "b.ts": `export {};
declare module "./m" { interface X { two: 2 } }
`,
        "c.ts": `export {};
declare module "./i" { interface B1 { b: 1 } }
`,
        "i.ts": `export { X } from "./t";
`,
        "m.ts": `export { X } from "./i";
`,
        "t.ts": `export interface X { k: 1 }
`,
        "u.ts": `import type { A1, B1 } from "./i";
import * as ns from "./i";
export const a: never = null! as A1;
export const b: never = null! as B1;
export const c: never = null! as ns.B1;
export const d: never = null! as import("./i").B1;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "u.ts(1,19): error TS2305: Module '"./i"' has no exported member 'B1'.
        u.ts(3,14): error TS2322: Type 'A1' is not assignable to type 'never'.
        u.ts(4,14): error TS2322: Type 'B1' is not assignable to type 'never'.
        u.ts(5,14): error TS2322: Type 'ns.B1' is not assignable to type 'never'.
        u.ts(5,37): error TS2694: Namespace '"<dir>/i"' has no exported member 'B1'.
        u.ts(6,14): error TS2322: Type 'any' is not assignable to type 'never'.
        u.ts(6,48): error TS2694: Namespace '"<dir>/i"' has no exported member 'B1'."
      `);
      expect(exitCode).toBe(1);
    });

    test("type references that each need a member of all the others for their base type", async () => {
      using dir = project({
        "a.ts": `// Ten type references that each need a member of all the others to instantiate their base type.
declare abstract class Schema<Out = any> { readonly _output: Out; }
declare class SStr extends Schema<string> { s: 1; }
declare class SRec<E extends Schema> extends Schema<Record<string, E["_output"]>> { e: E; }
type T0 = SRec<All>;
type T1 = SRec<All>;
type T2 = SRec<All>;
type T3 = SRec<All>;
type T4 = SRec<All>;
type T5 = SRec<All>;
type T6 = SRec<All>;
type T7 = SRec<All>;
type T8 = SRec<All>;
type T9 = SRec<All>;
type All = T0 | T1 | T2 | T3 | T4 | T5 | T6 | T7 | T8 | T9 | SStr;
export const x: never = null! as All["_output"];
declare const t: T0;
export const y: never = t._output;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(16,14): error TS2322: Type 'string | Record<string, unknown>' is not assignable to type 'never'.
          Type 'string' is not assignable to type 'never'.
        a.ts(18,14): error TS2322: Type 'Record<string, unknown>' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an instantiation that reaches the depth limit from two places is reported at the first", async () => {
      using dir = project({
        "a.ts": `// Each family: the same instantiation reaches the depth limit from two places. It is reported at the first.
type S0<T> = T extends Function ? never : T extends Record<string, any> ? { [K in keyof T]: S0<T[K]> } : T; type U0 = [string, U0?];
export type A0 = { a: S0<U0> };
export type B0 = S0<U0>;
type S1<T> = T extends Function ? never : T extends Record<string, any> ? { [K in keyof T]: S1<T[K]> } : T; type U1 = [string, U1?];
export type A1 = [S1<U1>];
export type B1 = S1<U1>;
type S2<T> = T extends Function ? never : T extends Record<string, any> ? { [K in keyof T]: S2<T[K]> } : T; type U2 = [string, U2?];
export type A2 = S2<U2> | 1;
export type B2 = S2<U2>;
type S3<T> = T extends Function ? never : T extends Record<string, any> ? { [K in keyof T]: S3<T[K]> } : T; type U3 = [string, U3?];
export type A3 = S3<U3>;
export type B3 = { a: S3<U3> };
type S4<T> = T extends Function ? never : T extends Record<string, any> ? { [K in keyof T]: S4<T[K]> } : T; type U4 = [string, U4?];
export type A4 = S4<U4>;
export type B4 = S4<U4>;
type S5<T> = T extends Function ? never : T extends Record<string, any> ? { [K in keyof T]: S5<T[K]> } : T; type U5 = [string, U5?];
export type A5 = { a: S5<U5> };
export type B5 = { b: S5<U5> };
type S6<T> = T extends Function ? never : T extends Record<string, any> ? { [K in keyof T]: S6<T[K]> } : T; type U6 = [string, U6?];
export type A6 = () => S6<U6>;
export type B6 = S6<U6>;
type S7<T> = T extends Function ? never : T extends Record<string, any> ? { [K in keyof T]: S7<T[K]> } : T; type U7 = [string, U7?];
export type A7 = S7<U7>[];
export type B7 = S7<[U7]>;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,23): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(6,19): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(9,18): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(12,18): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(15,18): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(18,23): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(21,24): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(24,18): error TS2589: Type instantiation is excessively deep and possibly infinite."
      `);
      expect(exitCode).toBe(1);
    });

    test("a recursive conversion between two families of generic classes", async () => {
      using dir = project({
        "a.ts": `// A conversion from validators to schemas, both recursive. The key of a record is a union of ten, so each level has ten \`SRec\` references.
type Opt = "o" | "r";
declare abstract class VBase<T, O extends Opt = "r"> { readonly type: T; readonly isOptional: O; }
declare class VK0<T, O extends Opt = "r"> extends VBase<T, O> { readonly kind: "k0"; } declare class VK1<T, O extends Opt = "r"> extends VBase<T, O> { readonly kind: "k1"; } declare class VK2<T, O extends Opt = "r"> extends VBase<T, O> { readonly kind: "k2"; } declare class VK3<T, O extends Opt = "r"> extends VBase<T, O> { readonly kind: "k3"; } declare class VK4<T, O extends Opt = "r"> extends VBase<T, O> { readonly kind: "k4"; } declare class VK5<T, O extends Opt = "r"> extends VBase<T, O> { readonly kind: "k5"; } declare class VK6<T, O extends Opt = "r"> extends VBase<T, O> { readonly kind: "k6"; } declare class VK7<T, O extends Opt = "r"> extends VBase<T, O> { readonly kind: "k7"; } declare class VK8<T, O extends Opt = "r"> extends VBase<T, O> { readonly kind: "k8"; }
declare class VRec<T, K extends V<string, "r">, E extends V<any, "r">, O extends Opt = "r"> extends VBase<T, O> { readonly key: K; readonly value: E; readonly kind: "rec"; }
declare class VUni<T, M extends V<any, "r">[], O extends Opt = "r"> extends VBase<T, O> { readonly members: M; readonly kind: "u"; }
type V<T, O extends Opt = "r"> = VK0<T, O> | VK1<T, O> | VK2<T, O> | VK3<T, O> | VK4<T, O> | VK5<T, O> | VK6<T, O> | VK7<T, O> | VK8<T, O> | VRec<T, V<string, "r">, V<any, "r">, O> | VUni<T, V<any, "r">[], O>;
type GV = V<any, any>;
declare abstract class Schema<Out = any> { readonly _output: Out; }
declare class SStr extends Schema<string> { s: 1; }
declare class SId<N extends string> extends Schema<N> { n: N; }
declare class SRec<K extends Schema<string | number | symbol>, E extends Schema> extends Schema<Record<K["_output"], E["_output"]>> { k: K; e: E; }
declare class SOpt<T extends Schema> extends Schema<T["_output"] | undefined> { t: T; }
declare class SUni<T extends readonly [Schema, ...Schema[]]> extends Schema<T[number]["_output"]> { o: T; }
type Base<X extends GV> =
  X extends VRec<any, infer K, infer E, any> ? K extends VK0<infer N extends string> ? SRec<SId<N>, From<E>> : SRec<SStr, From<E>>
  : X extends VUni<any, [infer A extends GV, infer B extends GV, ...infer Rest extends GV[]], any> ? SUni<[From<A>, From<B>, ...{ [I in keyof Rest]: From<Rest[I]> }]>
  : Schema;
export type From<X extends GV> = X extends V<any, "o"> ? SOpt<Base<X>> : Base<X>;
export function convert<X extends GV>(schema: Schema): From<X> { return schema as From<X>; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    });

    test("a class field whose initializer compares `this` with a type", async () => {
      using dir = project({
        "a.ts": `export class T1 { x = \`\${this}\`; }
export class T2 { get g() { return \`\${this}\`; } }
export class T3 { m() { return \`\${this}\`; } }
export class T4 { x = \`\${this}\` as string; }
export class T5 { x: string = \`\${this}\`; }
export class T6 { x = \`a\${this.y}\`; y = 1; }
export class T7 { static x = \`\${this}\`; }
export class T8 { x = () => \`\${this}\`; }
export class T9 { x = "" + this; }
export class I1 { x = this instanceof I1; }
export class I2 { get g() { return this instanceof I2; } }
export class I3 { m() { return this instanceof I3; } }
export class I4 { x = this instanceof Object; }
export class I5 { x = {} instanceof I5; }
export class I6 { static x = this instanceof I6; }
export class I7 { x = [this instanceof I7]; }
export class I8 { x = () => this instanceof I8; }
export class I9 { x = this instanceof I9 ? 1 : 2; }
declare const o: object;
export class J1 { x = o instanceof J1; }
export class J2 { x = o instanceof J2 ? o : null; }
export const v1 = { a: 1, b: \`\${v1}\` };
export const v2 = () => \`\${v2}\`;
export function f3() { return \`\${f3}\`; }
export function f4() { return f4 instanceof Function; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(2,23): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(6,32): error TS2729: Property 'y' is used before its initialization.
        a.ts(10,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(11,23): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(13,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(16,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(18,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(21,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(22,14): error TS7022: 'v1' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(22,33): error TS2448: Block-scoped variable 'v1' used before its declaration."
      `);
      expect(exitCode).toBe(1);
    });

    test("a class field initialized with a spread of an instance of its class", async () => {
      using dir = project({
        "a.ts": `declare function fe(v: {}): 1; declare function fy(v: { y: number }): 1;
export class D1 { x = { a: fe({ ...new D1() }) }; y = 1; }
export class D2 { x = [fe({ ...new D2() })]; y = 1; }
export class D3 { x = { a: typeof { ...new D3() } }; y = 1; }
export class D4 { x = { a: ({ ...new D4() }).y }; y = 1; }
export class D5 { x = { a: fy({ ...(null! as D5) }) }; y = 1; }
export class D6 { static x = { a: fe({ ...D6 }) }; static y = 1; }
export class D7 { x = { a: fe({ ...new D7(), x: 2 }) }; y = 1; }
export class D8 { x = fe({ ...new D8() }); y = 1; }
export class D9 { x = { a: { ...new D9() } }; y = 1; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(5,46): error TS2729: Property 'y' is used before its initialization.
        a.ts(10,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("inference from an instance of the class whose field is being resolved", async () => {
      using dir = project({
        "a.ts": `declare function obj(v: object): 1; declare function ovl(v: object): 1; declare function ovl(v: {}): 2;
export class A1<T = any> { x = new A1() satisfies object; y!: T; }
export class A2<T> { x = new A2() satisfies {}; y!: T; }
export class A3<T = any> { x = ovl(new A3()); y!: T; }
export class A4<T = any> { get x() { return obj(new A4()); } y!: T; }
export class A5<T = any> { x = Object.keys(new A5()); y!: T; }
export class A6<T = any> { x = new A6() satisfies { y: unknown }; y!: T; }
export class A7<T = any> { x = new A7<number>() satisfies object; y!: T; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    });

    test("an index signature of a class and the members of the interface it merges with", async () => {
      using dir = project({
        "a.ts": `export class C1 { [k: string]: number; } export interface C1 { m: string; }
export class C2 { [k: string]: number; } export interface C2 { [k: number]: string; }
export class C3 { m = ""; } export interface C3 { [k: string]: number; }
export interface I4 { [k: string]: number; } export interface I4 { m: string; }
export class C5 { [k: string]: number; m = ""; }
class B6 { m = ""; } export class C6 extends B6 { [k: string]: number; }
class B7 { m = ""; } export class C7 extends B7 {} export interface C7 { [k: string]: number; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,64): error TS2411: Property 'm' of type 'string' is not assignable to 'string' index type 'number'.
        a.ts(2,64): error TS2413: 'number' index type 'string' is not assignable to 'string' index type 'number'.
        a.ts(3,19): error TS2411: Property 'm' of type 'string' is not assignable to 'string' index type 'number'.
        a.ts(4,68): error TS2411: Property 'm' of type 'string' is not assignable to 'string' index type 'number'.
        a.ts(5,40): error TS2411: Property 'm' of type 'string' is not assignable to 'string' index type 'number'.
        a.ts(6,51): error TS2411: Property 'm' of type 'string' is not assignable to 'string' index type 'number'.
        a.ts(7,74): error TS2411: Property 'm' of type 'string' is not assignable to 'string' index type 'number'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an element access on `super` for a name that the base class lacks", async () => {
      using dir = project({
        "a.ts": `class K { k = 1; static s = 1; m() { return 1; } static sm() { return 1; } }
export class C1 extends K { static m1() { return super["k"]; } }
export class C2 extends K { static m1() { return super["s"]; } }
export class C3 extends K { static m1() { return super["nope"]; } }
export class C4 extends K { m1() { return super["nope"]; } }
export class C5 extends K { m1() { return super["s"]; } }
export class C6 extends K { m1() { return super["k"]; } }
export class C7 extends K { m1() { return super["m"](); } }
export class C8 extends K { static m1() { return super.k; } }
export class C9 extends K { static m1() { return super["sm"](); } }
export class D1 extends K { static x = super["k"]; }
export class D2 extends K { static m1(key: "k" | "s") { return super[key]; } }
export class D3 extends K { m1(key: string) { return super[key]; } }
export class D4 extends K { static m1() { super["k"] = 2; } }
export class D5 extends K { m1() { super["nope"] = 2; } }
export class D6 extends K { static m1() { const r: never = super["k"]; } }
export class D7 extends K { m1() { const r: never = super["nope"]; } }
export const o = { __proto__: new K(), m1() { return super["nope"]; } };
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,50): error TS7053: Element implicitly has an 'any' type because expression of type '"k"' can't be used to index type 'typeof K'.
          Property 'k' does not exist on type 'typeof K'.
        a.ts(4,50): error TS7053: Element implicitly has an 'any' type because expression of type '"nope"' can't be used to index type 'typeof K'.
          Property 'nope' does not exist on type 'typeof K'.
        a.ts(5,43): error TS7053: Element implicitly has an 'any' type because expression of type '"nope"' can't be used to index type 'K'.
          Property 'nope' does not exist on type 'K'.
        a.ts(6,43): error TS2576: Property 's' does not exist on type 'K'. Did you mean to access the static member 'K["s"]' instead?
        a.ts(9,56): error TS2339: Property 'k' does not exist on type 'typeof K'.
        a.ts(11,40): error TS7053: Element implicitly has an 'any' type because expression of type '"k"' can't be used to index type 'typeof K'.
          Property 'k' does not exist on type 'typeof K'.
        a.ts(12,64): error TS7053: Element implicitly has an 'any' type because expression of type '"k" | "s"' can't be used to index type 'typeof K'.
          Property 'k' does not exist on type 'typeof K'.
        a.ts(13,54): error TS7053: Element implicitly has an 'any' type because expression of type 'string' can't be used to index type 'K'.
          No index signature with a parameter of type 'string' was found on type 'K'.
        a.ts(14,43): error TS7053: Element implicitly has an 'any' type because expression of type '"k"' can't be used to index type 'typeof K'.
          Property 'k' does not exist on type 'typeof K'.
        a.ts(15,36): error TS7053: Element implicitly has an 'any' type because expression of type '"nope"' can't be used to index type 'K'.
          Property 'nope' does not exist on type 'K'.
        a.ts(16,49): error TS2322: Type 'any' is not assignable to type 'never'.
        a.ts(16,60): error TS7053: Element implicitly has an 'any' type because expression of type '"k"' can't be used to index type 'typeof K'.
          Property 'k' does not exist on type 'typeof K'.
        a.ts(17,42): error TS2322: Type 'any' is not assignable to type 'never'.
        a.ts(17,53): error TS7053: Element implicitly has an 'any' type because expression of type '"nope"' can't be used to index type 'K'.
          Property 'nope' does not exist on type 'K'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a rest element in a destructuring assignment whose value is an object literal", async () => {
      using dir = project({
        "a.ts": `declare let n: number, u: unknown, a: any, o: object, s: string, nu: number | undefined, v: void, nl: null, nv: never, arr: number[], fn: () => void, e: {};
declare const w: { n: number; u: unknown; o: object };
export function r1() { ({ ...n } = {}); }
export function r2() { ({ ...u } = {}); }
export function r3() { ({ ...a } = {}); }
export function r4() { ({ ...o } = {}); }
export function r5() { ({ ...s } = {}); }
export function r6() { ({ ...nu } = {}); }
export function r7() { ({ ...v } = {}); }
export function r8() { ({ ...nl } = {}); }
export function r9() { ({ ...nv } = {}); }
export function s1() { ({ ...arr } = {}); }
export function s2() { ({ ...fn } = {}); }
export function s3() { ({ ...e } = {}); }
export function s4() { ({ ...w.n } = {}); }
export function s5() { ({ ...w.u } = {}); }
export function s6() { ({ ...w.o } = {}); }
export function s7<T>(t: T) { ({ ...t } = {} as T); }
export function s8() { ({ x: { ...n } } = { x: {} }); }
export function s9() { [{ ...n }] = [{}]; }
export function t1() { for ({ ...n } of [{}]) {} }
export function t2() { let x: number; ({ ...x } = {}); }
export function t3() { ({ k: n, ...u } = { k: 1, z: 2 }); }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,27): error TS2698: Spread types may only be created from object types.
        a.ts(3,30): error TS2322: Type '{}' is not assignable to type 'number'.
        a.ts(4,27): error TS2698: Spread types may only be created from object types.
        a.ts(7,27): error TS2698: Spread types may only be created from object types.
        a.ts(7,30): error TS2322: Type '{}' is not assignable to type 'string'.
        a.ts(8,27): error TS2698: Spread types may only be created from object types.
        a.ts(8,30): error TS2322: Type '{}' is not assignable to type 'number'.
        a.ts(9,27): error TS2698: Spread types may only be created from object types.
        a.ts(9,30): error TS2322: Type '{}' is not assignable to type 'void'.
        a.ts(10,27): error TS2698: Spread types may only be created from object types.
        a.ts(10,30): error TS2322: Type '{}' is not assignable to type 'null'.
        a.ts(11,27): error TS2698: Spread types may only be created from object types.
        a.ts(11,30): error TS2322: Type '{}' is not assignable to type 'never'.
        a.ts(12,30): error TS2740: Type '{}' is missing the following properties from type 'number[]': length, pop, push, concat, and 35 more.
        a.ts(13,30): error TS2322: Type '{}' is not assignable to type '() => void'.
          Type '{}' provides no match for the signature '(): void'.
        a.ts(15,27): error TS2698: Spread types may only be created from object types.
        a.ts(15,30): error TS2322: Type '{}' is not assignable to type 'number'.
        a.ts(16,27): error TS2698: Spread types may only be created from object types.
        a.ts(19,32): error TS2698: Spread types may only be created from object types.
        a.ts(19,35): error TS2322: Type '{}' is not assignable to type 'number'.
        a.ts(20,27): error TS2698: Spread types may only be created from object types.
        a.ts(20,30): error TS2322: Type '{}' is not assignable to type 'number'.
        a.ts(21,34): error TS2322: Type '{}' is not assignable to type 'number'.
        a.ts(22,42): error TS2698: Spread types may only be created from object types.
        a.ts(22,45): error TS2322: Type '{}' is not assignable to type 'number'.
        a.ts(23,33): error TS2698: Spread types may only be created from object types."
      `);
      expect(exitCode).toBe(1);
    });

    test("`delete` of a property of type void", async () => {
      using dir = project({
        "a.ts": `declare const o: { n: number; v: void; u: undefined; nu: number | undefined; vu: void | number; a: any; k: unknown; nv: never; nl: null; op?: number; opv?: void; };
delete o.n;
delete o.v;
delete o.u;
delete o.nu;
delete o.vu;
delete o.a;
delete o.k;
delete o.nv;
delete o.nl;
delete o.op;
delete o.opv;
export class C { v: void; constructor() { delete this.v; } }
export function f<T extends void>(x: { t: T }) { delete x.t; }
export function g<T extends undefined>(x: { t: T }) { delete x.t; }
export function h<T>(x: { t: T | undefined }) { delete x.t; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,8): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(3,8): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(6,8): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(10,8): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(13,50): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(13,55): error TS2565: Property 'v' is used before being assigned.
        a.ts(14,57): error TS2790: The operand of a 'delete' operator must be optional."
      `);
      expect(exitCode).toBe(1);
    });

    test("the static side of a class that extends an intersection or a mixin", async () => {
      using dir = project({
        "a.ts": `class K { k = 1; static s = 1; }
declare const inter: typeof K & (new () => { z: 1 });
declare const inter2: typeof K & { t: number };
function Mix<X extends new (...a: any[]) => {}>(b: X) { return class extends b { mixed = 1; static ms = 1; }; }
export class C1 extends inter { static s = "x"; }
export class C2 extends Mix(K) { static s = "x"; }
export class C3 extends Mix(Mix(K)) { static s = "x"; }
export class C4 extends Mix(K) { static ms = "x"; }
export class C5 extends inter2 { static t = "x"; }
export class C6 extends K { static s = "x"; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(5,14): error TS2417: Class static side 'typeof C1' incorrectly extends base class static side 'typeof K'.
          Types of property 's' are incompatible.
            Type 'string' is not assignable to type 'number'.
        a.ts(5,25): error TS2510: Base constructors must all have the same return type.
        a.ts(6,14): error TS2417: Class static side 'typeof C2' incorrectly extends base class static side '{ ms: number; prototype: Mix.(Anonymous class); } & typeof K'.
          Type 'typeof C2' is not assignable to type 'typeof K'.
            Types of property 's' are incompatible.
              Type 'string' is not assignable to type 'number'.
        a.ts(7,14): error TS2417: Class static side 'typeof C3' incorrectly extends base class static side '{ ms: number; prototype: Mix.(Anonymous class); } & { ms: number; prototype: Mix.(Anonymous class); } & typeof K'.
          Type 'typeof C3' is not assignable to type 'typeof K'.
            Types of property 's' are incompatible.
              Type 'string' is not assignable to type 'number'.
        a.ts(8,14): error TS2417: Class static side 'typeof C4' incorrectly extends base class static side '{ ms: number; prototype: Mix.(Anonymous class); } & typeof K'.
          Type 'typeof C4' is not assignable to type '{ ms: number; prototype: Mix.(Anonymous class); }'.
            Types of property 'ms' are incompatible.
              Type 'string' is not assignable to type 'number'.
        a.ts(9,14): error TS2417: Class static side 'typeof C5' incorrectly extends base class static side 'typeof K & { t: number; }'.
          Type 'typeof C5' is not assignable to type '{ t: number; }'.
            Types of property 't' are incompatible.
              Type 'string' is not assignable to type 'number'.
        a.ts(10,14): error TS2417: Class static side 'typeof C6' incorrectly extends base class static side 'typeof K'.
          Types of property 's' are incompatible.
            Type 'string' is not assignable to type 'number'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a static member named prototype", async () => {
      using dir = project({
        "a.ts": `class K { k = 1; }
export class C1 { static prototype = 1; }
export class C2 extends K { static prototype = 1; }
export class C3 extends K { static prototype: number; }
export class C4 extends K { static prototype: C4 = null!; }
export class C5 extends K { static prototype() {} }
export class C6 extends K { static get prototype() { return 1; } }
export class C7 extends Object { static prototype = 1; }
export abstract class C8 extends K { static prototype = ""; }
export class C9<T> extends K { static prototype = 1; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,26): error TS2699: Static property 'prototype' conflicts with built-in property 'Function.prototype' of constructor function 'C1'.
        a.ts(3,36): error TS2322: Type 'number' is not assignable to type 'C2'.
        a.ts(3,36): error TS2699: Static property 'prototype' conflicts with built-in property 'Function.prototype' of constructor function 'C2'.
        a.ts(4,36): error TS2699: Static property 'prototype' conflicts with built-in property 'Function.prototype' of constructor function 'C3'.
        a.ts(5,36): error TS2699: Static property 'prototype' conflicts with built-in property 'Function.prototype' of constructor function 'C4'.
        a.ts(6,36): error TS2300: Duplicate identifier 'prototype'.
        a.ts(6,36): error TS2699: Static property 'prototype' conflicts with built-in property 'Function.prototype' of constructor function 'C5'.
        a.ts(7,40): error TS2699: Static property 'prototype' conflicts with built-in property 'Function.prototype' of constructor function 'C6'.
        a.ts(8,41): error TS2699: Static property 'prototype' conflicts with built-in property 'Function.prototype' of constructor function 'C7'.
        a.ts(9,45): error TS2322: Type 'string' is not assignable to type 'C8'.
        a.ts(9,45): error TS2699: Static property 'prototype' conflicts with built-in property 'Function.prototype' of constructor function 'C8'.
        a.ts(10,39): error TS2322: Type 'number' is not assignable to type 'C9<any>'.
        a.ts(10,39): error TS2699: Static property 'prototype' conflicts with built-in property 'Function.prototype' of constructor function 'C9'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a private name after `typeof this.` in a type", async () => {
      using dir = project({
        "a.ts": `export class C1 { #m = 1; a!: typeof this.#m; }
export class C2 { #m = 1; u(x: C2) { let a: typeof x.#m; } }
export class C3 { #m = 1; u(x: C3): typeof x.#m { return 1; } }
export class C4 { static #m = 1; a!: typeof C4.#m; }
export class C5 { #m = 1; a!: C5["#m"]; }
export type Q = typeof globalThis.#m;
export class C6 { #m = { n: 1 }; a!: typeof this.#m.n; }
export class C7 { m = { n: 1 }; a!: typeof this.m.#n; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,45): error TS1003: Identifier expected.
        a.ts(2,56): error TS1003: Identifier expected.
        a.ts(3,48): error TS1003: Identifier expected.
        a.ts(4,50): error TS1003: Identifier expected.
        a.ts(6,37): error TS1003: Identifier expected.
        a.ts(7,52): error TS1003: Identifier expected.
        a.ts(8,53): error TS1003: Identifier expected."
      `);
      expect(exitCode).toBe(1);
    });

    test("a call of an auto-accessor", async () => {
      using dir = project({
        "a.ts": `export class C1 { accessor m = 1; u() { this.m(); } }
export class C2 { get m() { return 1; } u() { this.m(); } }
export class C3 { static accessor m = 1; static u() { C3.m(); } }
export class C4 { accessor m = 1; } new C4().m();
export class C5 { accessor #m = 1; u() { this.#m(); } }
export class C6 { get m() { return 1; } set m(v) {} u() { this.m(); } }
export class C7 { set m(v: number) {} u() { this.m(); } }
export class C8 { accessor m = 1; u() { new this.m(); } }
export class C9 { accessor m = 1; u() { this.m\`\`; } }
export const o = { get m() { return 1; } }; o.m();
export class D1 extends C1 { v() { this.m(); super.m(); } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,46): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(2,52): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(3,58): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(4,46): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(5,47): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(6,64): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(7,50): error TS2349: This expression is not callable.
          Type 'Number' has no call signatures.
        a.ts(8,45): error TS2351: This expression is not constructable.
          Type 'Number' has no construct signatures.
        a.ts(9,41): error TS2349: This expression is not callable.
          Type 'Number' has no call signatures.
        a.ts(10,47): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(11,41): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(11,52): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures."
      `);
      expect(exitCode).toBe(1);
    });

    test("`abstract` and `static` on a parameter property", async () => {
      using dir = project({
        "a.ts": `// Each class has a grammar error that both report. What follows from the modifier differs.
export abstract class A1 { constructor(protected abstract m: number) {} }
export class A2 extends A1 { constructor() { super(1); this.m; } }
export class A3 extends A1 { get m() { return 1; } }
export class S1 { constructor(protected static m: number) {} }
export class S2 extends S1 { u(x: S1) { return x.m; } }
export function g(this: S1) { return this.m; }
export class R1 { readonly m() { return 1; } u() { this.m = 2; this.m++; delete this.m; } }
export class R2 { readonly get m() { return 1; } readonly set m(v: number) {} u() { this.m = 2; } }
export class R3 { readonly accessor m = 1; u() { this.m = 2; } }
export class R4 { readonly set m(v: number) {} u() { this.m = 2; } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,50): error TS1242: 'abstract' modifier can only appear on a class, method, or property declaration.
        a.ts(3,14): error TS2515: Non-abstract class 'A2' does not implement inherited abstract member m from class 'A1'.
        a.ts(3,61): error TS2715: Abstract property 'm' in class 'A1' cannot be accessed in the constructor.
        a.ts(5,41): error TS1090: 'static' modifier cannot appear on a parameter.
        a.ts(7,43): error TS2445: Property 'm' is protected and only accessible within class 'S1' and its subclasses.
        a.ts(8,19): error TS1024: 'readonly' modifier can only appear on a property declaration or index signature.
        a.ts(8,52): error TS2322: Type 'number' is not assignable to type '() => number'.
        a.ts(8,64): error TS2356: An arithmetic operand must be of type 'any', 'number', 'bigint' or an enum type.
        a.ts(8,81): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(9,19): error TS1024: 'readonly' modifier can only appear on a property declaration or index signature.
        a.ts(9,50): error TS1024: 'readonly' modifier can only appear on a property declaration or index signature.
        a.ts(10,28): error TS1243: 'accessor' modifier cannot be used with 'readonly' modifier.
        a.ts(10,50): error TS2322: Type '2' is not assignable to type '1'.
        a.ts(11,19): error TS1024: 'readonly' modifier can only appear on a property declaration or index signature."
      `);
      expect(exitCode).toBe(1);
    });

    test("`typeof` followed by a type assertion in a type", async () => {
      using dir = project({
        "a.ts": `export class C1 { m = 1; u() { let a: typeof (<C1>this).m; } }
`,
        "b.ts": `export class C2 { m = 1; u() { let a: typeof <C2>this.m; } }
`,
        "c.ts": `export class C3 { m = 1; a!: typeof <C3>this; }
`,
        "d.ts": `export class C4 { m = 1; u(): typeof <C4>this.m { return 1; } }
`,
        "e.ts": `export class C5 { m = 1; u() { return typeof <C5>this.m; } }
`,
        "f.ts": `export class C6 { m = 1; u(x: typeof (this as C6).m) {} }
`,
        "g.ts": `export type T7 = typeof <number>x;
export type T8 = typeof (x);
export type T9 = typeof 1;
export type T10 = typeof [x];
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,46): error TS1003: Identifier expected.
        b.ts(1,46): error TS1003: Identifier expected.
        b.ts(1,50): error TS1005: ',' expected.
        c.ts(1,37): error TS1003: Identifier expected.
        c.ts(1,41): error TS1442: Expected '=' for property initializer.
        d.ts(1,38): error TS1003: Identifier expected.
        d.ts(1,42): error TS1144: '{' or ';' expected.
        d.ts(1,49): error TS1005: ';' expected.
        d.ts(1,63): error TS1128: Declaration or statement expected.
        f.ts(1,38): error TS1003: Identifier expected.
        f.ts(1,52): error TS1005: ';' expected.
        f.ts(1,57): error TS1128: Declaration or statement expected.
        g.ts(1,25): error TS1003: Identifier expected.
        g.ts(1,33): error TS1005: ';' expected.
        g.ts(2,25): error TS1003: Identifier expected.
        g.ts(3,25): error TS1003: Identifier expected.
        g.ts(4,26): error TS1003: Identifier expected."
      `);
      expect(exitCode).toBe(1);
    });

    test("the static side of a class whose base is an interface with a construct signature", async () => {
      using dir = project({
        "a.ts": `interface BCtor { new (): { x: number }; s: number; }
declare const B: BCtor;
export class C1 extends B { static s = "x"; }
interface GCtor<T> { new (): { x: T }; s: T; }
declare const G: GCtor<number>;
export class C2 extends G { static s = "x"; }
declare const L: { new (): { x: number }; s: number; t: string };
export class C3 extends L { static s = "x"; }
const M = class { static s = 1; };
export class C4 extends M { static s = "x"; }
class K { static s = 1; private static p = 1; }
declare const KB: typeof K & BCtor;
export class C5 extends KB { static s = "x"; }
declare const F: { new (): { x: number }; (): void; s: number };
export class C6 extends F { static s = "x"; }
export class C7 extends K { static p = 1; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,14): error TS2417: Class static side 'typeof C1' incorrectly extends base class static side '{ s: number; }'.
          Types of property 's' are incompatible.
            Type 'string' is not assignable to type 'number'.
        a.ts(6,14): error TS2417: Class static side 'typeof C2' incorrectly extends base class static side '{ s: number; }'.
          Types of property 's' are incompatible.
            Type 'string' is not assignable to type 'number'.
        a.ts(8,14): error TS2417: Class static side 'typeof C3' incorrectly extends base class static side '{ s: number; t: string; }'.
          Types of property 's' are incompatible.
            Type 'string' is not assignable to type 'number'.
        a.ts(10,14): error TS2417: Class static side 'typeof C4' incorrectly extends base class static side 'typeof M'.
          Types of property 's' are incompatible.
            Type 'string' is not assignable to type 'number'.
        a.ts(13,14): error TS2417: Class static side 'typeof C5' incorrectly extends base class static side 'typeof K & { s: number; }'.
          Type 'typeof C5' is not assignable to type 'typeof K'.
            Types of property 's' are incompatible.
              Type 'string' is not assignable to type 'number'.
        a.ts(13,25): error TS2510: Base constructors must all have the same return type.
        a.ts(15,14): error TS2417: Class static side 'typeof C6' incorrectly extends base class static side '{ s: number; }'.
          Types of property 's' are incompatible.
            Type 'string' is not assignable to type 'number'.
        a.ts(16,14): error TS2417: Class static side 'typeof C7' incorrectly extends base class static side 'typeof K'.
          Property 'p' is private in type 'typeof K' but not in type 'typeof C7'."
      `);
      expect(exitCode).toBe(1);
    });

    test("messages that print a spread of an instance whose field is being resolved", async () => {
      using dir = project({
        "a.ts": `declare function fz(v: { z?: 1 }): 1; declare function fn(v: { y: string }): 1; declare function idf<T>(v: T): T;
export class D1 { x = { a: fz({ ...new D1() }) }; y = 1; }
export class D2 { x = { a: fn({ ...new D2() }) }; y = 1; }
export class D3 { x = [fz({ ...new D3() })]; y?: number; }
export class D4<T> { x = { a: fz({ ...new D4<T>() }) }; y!: T; }
export class D5<T> { x = { a: fn({ ...new D5<T>() }) }; y!: T; }
export class D6<T> { x = { a: idf({ ...new D6<T>() }.y) }; y!: T; m(v: D6<number>) { const r: string = v.x.a; return { ...v }.y; } }
export function g<T>(v: { a: T; b: number }) { const s = { ...v }; const t: string = s.a; return s; }
export const r1: string = g({ a: 1, b: 2 }).a;
export function h<T>(v: D6<T>) { const { x, ...rest } = v; return rest; }
export const r2: string = h(new D6<number>()).y;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,31): error TS2559: Type '{ x: { a: 1; }; y: number; }' has no properties in common with type '{ z?: 1 | undefined; }'.
        a.ts(3,31): error TS2345: Argument of type '{ x: { a: 1; }; y: number; }' is not assignable to parameter of type '{ y: string; }'.
          Types of property 'y' are incompatible.
            Type 'number' is not assignable to type 'string'.
        a.ts(4,27): error TS2559: Type '{ x: 1[]; y?: number | undefined; }' has no properties in common with type '{ z?: 1 | undefined; }'.
        a.ts(5,34): error TS2559: Type '{ x: { a: 1; }; y: T; }' has no properties in common with type '{ z?: 1 | undefined; }'.
        a.ts(6,34): error TS2345: Argument of type '{ x: { a: 1; }; y: T; }' is not assignable to parameter of type '{ y: string; }'.
          Types of property 'y' are incompatible.
            Type 'T' is not assignable to type 'string'.
        a.ts(7,54): error TS2729: Property 'y' is used before its initialization.
        a.ts(7,92): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(8,74): error TS2322: Type 'T' is not assignable to type 'string'.
        a.ts(9,14): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(11,14): error TS2322: Type 'number' is not assignable to type 'string'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a class expression that refers to what holds it", async () => {
      using dir = project({
        "a.ts": `declare const any0: any;
// a property of a class expression, without an initializer, whose type refers to the variable
export const B1 = class { p?: typeof B1; };
export const B2 = class { p: typeof B2 = any0; };
export const B3 = class { static sk = 1; p: typeof B3.sk | undefined; };
export const B4 = class { p!: typeof B4; };
export const B5 = class { declare p: typeof B5; };
export const B6 = class { static p?: typeof B6; };
export const B7 = class { m(): typeof B7 { return any0; } };
export const B8 = class { readonly p?: InstanceType<typeof B8>; };
export const B9 = class { p?: () => typeof B9; };
// the other checks that checkClassLikeDeclaration makes at once
declare class Base { p: unknown; m(): unknown; static s: unknown }
interface I { p: unknown }
export const E1 = class extends Base { p: typeof E1 = any0; };
export const E2 = class implements I { p: typeof E2 = any0; };
export const E3 = class { [k: string]: unknown; p: typeof E3 = any0; };
export const E4 = class<T extends typeof E4> { t!: T; };
export const E5 = class extends Base { m(): typeof E5 { return any0; } };
export const E6 = class extends Base { static s: typeof E6 = any0; };
export const E7 = class extends Base { p = E7; };
export const E8 = class extends Base { override p: typeof E8 = any0; };
export const E9 = class { get p(): typeof E9 { return any0; } set p(v: typeof E9) {} };
export const F1 = class { constructor(public p: typeof F1) {} };
export const F2 = class { p: typeof F2; constructor() { this.p = any0; } };
export const F3 = class { static [k: string]: unknown; static p: typeof F3 = any0; };
export const F4 = class implements I { p = F4; };
export function f() { return class { p?: ReturnType<typeof f>; }; }
export const o = { C: class { p?: typeof o; } };
export const a = [class { p?: typeof a; }];
export const g = (() => class { p?: typeof g; })();
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,14): error TS7022: 'B1' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(3,27): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(5,14): error TS7022: 'B3' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,42): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(10,14): error TS7022: 'B8' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,36): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(17,14): error TS7022: 'E3' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(17,49): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(18,14): error TS7022: 'E4' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(19,14): error TS7022: 'E5' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(19,45): error TS2577: Return type annotation circularly references itself.
        a.ts(21,44): error TS2448: Block-scoped variable 'E7' used before its declaration.
        a.ts(25,14): error TS7022: 'F2' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(25,27): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(26,14): error TS7022: 'F3' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(26,63): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(27,44): error TS2448: Block-scoped variable 'F4' used before its declaration.
        a.ts(28,17): error TS7023: 'f' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(28,38): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(29,14): error TS7022: 'o' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(29,31): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(30,14): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(30,27): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(31,14): error TS7022: 'g' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(31,19): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(31,33): error TS2502: 'p' is referenced directly or indirectly in its own type annotation."
      `);
      expect(exitCode).toBe(1);
    });

    test("a class expression whose optional member has the type of its variable", async () => {
      using dir = project({
        "a.ts": `declare const any0: any;
export class C extends (any0 as InstanceType<typeof C>) {}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,14): error TS2310: Type 'C' recursively references itself as a base type.
        a.ts(2,14): error TS2506: 'C' is referenced directly or indirectly in its own base expression."
      `);
      expect(exitCode).toBe(1);
    });

    test("a class expression in a call whose index signature has the type of its variable", async () => {
      using dir = project({
        "a.ts": `export class A { k = 1; p(this: typeof this) { return this; } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(1,27): error TS2502: 'this' is referenced directly or indirectly in its own type annotation."`,
      );
      expect(exitCode).toBe(1);
    });

    test("a class whose base expression refers to the class", async () => {
      using dir = project({
        "a.ts": `declare const any0: any;
export class C1 extends (any0 as C1) {}
export class C2 extends (any0 as InstanceType<typeof C2>) {}
export class C3 extends (any0 as (typeof C3)["prototype"]) {}
export class C4 extends (any0 as { new (): C4 }) {}
export class C5 extends (any0 as typeof C5) {}
export class C6 extends (any0 as C6 & { new (): {} }) {}
type Inst<T> = T extends new () => infer R ? R : never;
export class C7 extends (any0 as Inst<typeof C7>) {}
export class C8 extends (any0 as Inst<new () => C8>) {}
export class C9 extends (any0 as ReturnType<() => C9>) {}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,14): error TS2310: Type 'C1' recursively references itself as a base type.
        a.ts(2,14): error TS2506: 'C1' is referenced directly or indirectly in its own base expression.
        a.ts(3,14): error TS2310: Type 'C2' recursively references itself as a base type.
        a.ts(3,14): error TS2506: 'C2' is referenced directly or indirectly in its own base expression.
        a.ts(4,14): error TS2310: Type 'C3' recursively references itself as a base type.
        a.ts(4,14): error TS2506: 'C3' is referenced directly or indirectly in its own base expression.
        a.ts(5,14): error TS2310: Type 'C4' recursively references itself as a base type.
        a.ts(6,14): error TS2506: 'C5' is referenced directly or indirectly in its own base expression.
        a.ts(7,14): error TS2310: Type 'C6' recursively references itself as a base type.
        a.ts(7,14): error TS2506: 'C6' is referenced directly or indirectly in its own base expression.
        a.ts(9,14): error TS2310: Type 'C7' recursively references itself as a base type.
        a.ts(9,14): error TS2506: 'C7' is referenced directly or indirectly in its own base expression.
        a.ts(10,14): error TS2310: Type 'C8' recursively references itself as a base type.
        a.ts(10,14): error TS2506: 'C8' is referenced directly or indirectly in its own base expression.
        a.ts(11,14): error TS2310: Type 'C9' recursively references itself as a base type.
        a.ts(11,14): error TS2506: 'C9' is referenced directly or indirectly in its own base expression."
      `);
      expect(exitCode).toBe(1);
    });

    test("JSX attributes: a later spread, a spread child, a repeated name, type arguments", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "jsx": "preserve"}}`,
        "a.tsx": `// an explicit attribute that a later spread overwrites still makes the attributes fresh
export const s1 = <a req="b" {...sp}>text</a>;
export const s2 = <a req="b" {...{ req: "c" }}>text</a>;
export const s3 = <b req="b" {...sp}>text</b>;
export const s4 = <a req="b" {...sp} />;
export const s5 = <a {...sp}>text</a>;
export const s6 = <a {...sp} req="b">text</a>;
// the first of two attributes of one name
export const d1 = <a req="a" req="b" />;
export const d2 = <a id="a" req={1} req={2} />;
// a spread child under a contextual tuple type
export const t1 = <KTup>{...[1]}</KTup>;
export const t2 = <KTup>{...[<a />, "s"]}</KTup>;
// type arguments for a function that is not generic
export const g1 = <Fn<string> req="a" children="x">text</Fn>;
export const g2 = <Fn<string> {...1} />;
export const g3 = <Fn<string> req="a" cb={e => e} />;
export const g4 = <Fn<string> req="b" {...sp} />;
export const g5 = <Fn<string> {...1}>text</Fn>;
export const g6 = <Fn<string> req="a" cb={e => e}>text</Fn>;
// \`children\` twice under overloads
export const o1 = <Ov req="a" children="x">{1}</Ov>;
`,
        "g.d.ts": `declare namespace JSX { interface Element { __e: 1 } interface ElementChildrenAttribute { children: {} } interface IntrinsicElements { a: { id?: string }; b: { value: string } } }
declare const sp: { req: string; opt?: number };
declare function KTup(p: { children: [JSX.Element, string] }): JSX.Element;
declare function Fn(p: { req: string; children?: string }): JSX.Element;
declare function Ov(p: { req: string; children?: string }): JSX.Element; declare function Ov(p: { req: number; other: string }): JSX.Element;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.tsx(2,20): error TS2322: Type '{ req: string; opt?: number | undefined; children: string; }' is not assignable to type '{ id?: string | undefined; }'.
          Property 'children' does not exist on type '{ id?: string | undefined; }'.
        a.tsx(2,22): error TS2783: 'req' is specified more than once, so this usage will be overwritten.
        a.tsx(3,20): error TS2322: Type '{ req: string; children: string; }' is not assignable to type '{ id?: string | undefined; }'.
          Property 'children' does not exist on type '{ id?: string | undefined; }'.
        a.tsx(3,22): error TS2783: 'req' is specified more than once, so this usage will be overwritten.
        a.tsx(4,20): error TS2322: Type '{ req: string; opt?: number | undefined; children: string; }' is not assignable to type '{ value: string; }'.
          Property 'children' does not exist on type '{ value: string; }'.
        a.tsx(4,22): error TS2783: 'req' is specified more than once, so this usage will be overwritten.
        a.tsx(5,20): error TS2559: Type '{ req: string; opt?: number | undefined; }' has no properties in common with type '{ id?: string | undefined; }'.
        a.tsx(5,22): error TS2783: 'req' is specified more than once, so this usage will be overwritten.
        a.tsx(6,20): error TS2559: Type '{ req: string; opt?: number | undefined; children: string; }' has no properties in common with type '{ id?: string | undefined; }'.
        a.tsx(7,30): error TS2322: Type '{ req: string; opt?: number | undefined; children: string; }' is not assignable to type '{ id?: string | undefined; }'.
          Property 'req' does not exist on type '{ id?: string | undefined; }'.
        a.tsx(9,22): error TS2322: Type '{ req: string; }' is not assignable to type '{ id?: string | undefined; }'.
          Property 'req' does not exist on type '{ id?: string | undefined; }'.
        a.tsx(9,30): error TS17001: JSX elements cannot have multiple attributes with the same name.
        a.tsx(10,29): error TS2322: Type '{ id: string; req: number; }' is not assignable to type '{ id?: string | undefined; }'.
          Property 'req' does not exist on type '{ id?: string | undefined; }'.
        a.tsx(10,37): error TS17001: JSX elements cannot have multiple attributes with the same name.
        a.tsx(12,20): error TS2745: This JSX tag's 'children' prop expects type '[Element, string]' which requires multiple children, but only a single child was provided.
        a.tsx(12,25): error TS2609: JSX spread child must be an array type.
        a.tsx(13,25): error TS2609: JSX spread child must be an array type.
        a.tsx(15,23): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(15,31): error TS2710: 'children' are specified twice. The attribute named 'children' will be overwritten.
        a.tsx(16,23): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(17,23): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(18,23): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(19,23): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(19,35): error TS2698: Spread types may only be created from object types.
        a.tsx(20,23): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(20,43): error TS7006: Parameter 'e' implicitly has an 'any' type.
        a.tsx(22,23): error TS2769: No overload matches this call.
          The last overload gave the following error.
            Type 'string' is not assignable to type 'number'.
        a.tsx(22,23): error TS2710: 'children' are specified twice. The attribute named 'children' will be overwritten."
      `);
      expect(exitCode).toBe(1);
    });

    test("a name that is repeated in an object literal or in JSX attributes", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "jsx": "preserve"}}`,
        "a.tsx": `// the first of several declarations of one name is the ValueDeclaration
export const l1: { b?: number } = { a: 1, a: 2 };
export const l2: { b?: number } = { b: 1, a: 1, b: 2, a: 2 };
export const d1 = <a req="a" req="b" />;
export const d2 = <a id="a" req={1} req={2} />;
export const d3 = <a req="a" {...sp} req="b" />;
export const d4 = <a req="a" id="x" req="b" req="c">text</a>;
export const d5 = <b req="a" req="b" value="v" />;
export const d6 = <a id={1} id={2} />;
export const d7 = <a id="a" id={2} />;
export const d8 = <a id={1} id="b" />;
export const d9 = <Fn req={1} req="b" />;
export const d10 = <Fn req="a" req={2} />;
export const d11 = <Fn x="a" req="r" x="b" />;
export const l3: { b?: number } = { x: 1, y: 1, x: 2 };
export const l4: { b?: number } = { x() {}, x: 1 };
export const l5: { b?: number } = { x: 1, x() {} };
export const l6: { b?: number } = { ["x"]: 1, x: 2 };
export const d12 = <a x="1" y="1" x="2" />;
export const d13 = <a x="1" {...sp} y="1" x="2" />;
`,
        "g.d.ts": `declare namespace JSX { interface Element { __e: 1 } interface ElementChildrenAttribute { children: {} } interface IntrinsicElements { a: { id?: string }; b: { value: string } } }
declare const sp: { req: string; opt?: number };
declare function KTup(p: { children: [JSX.Element, string] }): JSX.Element;
declare function Fn(p: { req: string; children?: string }): JSX.Element;
declare function Ov(p: { req: string; children?: string }): JSX.Element; declare function Ov(p: { req: number; other: string }): JSX.Element;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.tsx(2,37): error TS2353: Object literal may only specify known properties, and 'a' does not exist in type '{ b?: number | undefined; }'.
        a.tsx(2,43): error TS1117: An object literal cannot have multiple properties with the same name.
        a.tsx(3,43): error TS2353: Object literal may only specify known properties, and 'a' does not exist in type '{ b?: number | undefined; }'.
        a.tsx(3,49): error TS1117: An object literal cannot have multiple properties with the same name.
        a.tsx(3,55): error TS1117: An object literal cannot have multiple properties with the same name.
        a.tsx(4,22): error TS2322: Type '{ req: string; }' is not assignable to type '{ id?: string | undefined; }'.
          Property 'req' does not exist on type '{ id?: string | undefined; }'.
        a.tsx(4,30): error TS17001: JSX elements cannot have multiple attributes with the same name.
        a.tsx(5,29): error TS2322: Type '{ id: string; req: number; }' is not assignable to type '{ id?: string | undefined; }'.
          Property 'req' does not exist on type '{ id?: string | undefined; }'.
        a.tsx(5,37): error TS17001: JSX elements cannot have multiple attributes with the same name.
        a.tsx(6,22): error TS2322: Type '{ req: string; opt?: number | undefined; }' is not assignable to type '{ id?: string | undefined; }'.
          Property 'req' does not exist on type '{ id?: string | undefined; }'.
        a.tsx(6,22): error TS2783: 'req' is specified more than once, so this usage will be overwritten.
        a.tsx(6,38): error TS17001: JSX elements cannot have multiple attributes with the same name.
        a.tsx(7,22): error TS2322: Type '{ req: string; id: string; children: string; }' is not assignable to type '{ id?: string | undefined; }'.
          Property 'req' does not exist on type '{ id?: string | undefined; }'.
        a.tsx(7,37): error TS17001: JSX elements cannot have multiple attributes with the same name.
        a.tsx(8,22): error TS2322: Type '{ req: string; value: string; }' is not assignable to type '{ value: string; }'.
          Property 'req' does not exist on type '{ value: string; }'.
        a.tsx(8,30): error TS17001: JSX elements cannot have multiple attributes with the same name.
        a.tsx(9,22): error TS2322: Type 'number' is not assignable to type 'string'.
        a.tsx(9,29): error TS2322: Type 'number' is not assignable to type 'string'.
        a.tsx(9,29): error TS17001: JSX elements cannot have multiple attributes with the same name.
        a.tsx(10,22): error TS2322: Type 'number' is not assignable to type 'string'.
        a.tsx(10,29): error TS2322: Type 'number' is not assignable to type 'string'.
        a.tsx(10,29): error TS17001: JSX elements cannot have multiple attributes with the same name.
        a.tsx(11,29): error TS17001: JSX elements cannot have multiple attributes with the same name.
        a.tsx(12,31): error TS17001: JSX elements cannot have multiple attributes with the same name.
        a.tsx(13,24): error TS2322: Type 'number' is not assignable to type 'string'.
        a.tsx(13,32): error TS2322: Type 'number' is not assignable to type 'string'.
        a.tsx(13,32): error TS17001: JSX elements cannot have multiple attributes with the same name.
        a.tsx(14,24): error TS2322: Type '{ x: string; req: string; }' is not assignable to type '{ req: string; children?: string | undefined; }'.
          Property 'x' does not exist on type '{ req: string; children?: string | undefined; }'.
        a.tsx(14,38): error TS17001: JSX elements cannot have multiple attributes with the same name.
        a.tsx(15,37): error TS2353: Object literal may only specify known properties, and 'x' does not exist in type '{ b?: number | undefined; }'.
        a.tsx(15,49): error TS1117: An object literal cannot have multiple properties with the same name.
        a.tsx(16,37): error TS2300: Duplicate identifier 'x'.
        a.tsx(16,45): error TS1119: An object literal cannot have property and accessor with the same name.
        a.tsx(16,45): error TS2300: Duplicate identifier 'x'.
        a.tsx(16,45): error TS2353: Object literal may only specify known properties, and 'x' does not exist in type '{ b?: number | undefined; }'.
        a.tsx(17,37): error TS2300: Duplicate identifier 'x'.
        a.tsx(17,43): error TS1119: An object literal cannot have property and accessor with the same name.
        a.tsx(17,43): error TS2300: Duplicate identifier 'x'.
        a.tsx(17,43): error TS2353: Object literal may only specify known properties, and 'x' does not exist in type '{ b?: number | undefined; }'.
        a.tsx(18,37): error TS2353: Object literal may only specify known properties, and '["x"]' does not exist in type '{ b?: number | undefined; }'.
        a.tsx(18,47): error TS1117: An object literal cannot have multiple properties with the same name.
        a.tsx(19,23): error TS2322: Type '{ x: string; y: string; }' is not assignable to type '{ id?: string | undefined; }'.
          Property 'x' does not exist on type '{ id?: string | undefined; }'.
        a.tsx(19,35): error TS17001: JSX elements cannot have multiple attributes with the same name.
        a.tsx(20,23): error TS2322: Type '{ x: string; y: string; req: string; opt?: number | undefined; }' is not assignable to type '{ id?: string | undefined; }'.
          Property 'x' does not exist on type '{ id?: string | undefined; }'.
        a.tsx(20,43): error TS17001: JSX elements cannot have multiple attributes with the same name."
      `);
      expect(exitCode).toBe(1);
    });

    test("the attributes of a self-closing element whose type arguments no signature takes", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "jsx": "preserve", "noUnusedLocals": true}}`,
        "a.tsx": `// nothing in the attributes of a self-closing element is checked if no signature takes the type arguments
export const u1 = <Fn<string> req={missing} />;
export const u2 = <Fn<string> req={1 + {}} />;
export const u3 = <Fn<string> req={<b />} />;
export const u4 = <Fn<string> req={sp.nope} />;
export const u5 = <Fn<string> req={Fn(1)} />;
export const u6 = <Fn<string> req={(() => { const x: string = 1; return x; })()} />;
export function u7() { const only = 1; return <Fn<string> req={only} />; }
export const u8 = <Fn<string> req={1, 2} />;
export const u9 = <Fn<string> req="a" req="b" />;
export const u10 = <Fn<string> req={<Fn<string> req={missing}>{missing}</Fn>} />;
export const u11 = <Fn<string> req={function (this: string, a) { return a; }} />;
export const u12 = <Fn<string> req={class { x: string = 1 }} />;
export const u13 = <Fn<Missing> req={missing} />;
export const u14 = <G1<string, number> v={missing} />;
export const u15 = <G1<string, number> v={missing}></G1>;
export const u16 = <Ov<string> req={missing} />;
export const u17 = <a<string> id={missing} />;
export const u18 = <Any1<string> id={missing} />;
export const u19 = <Nope<string> id={missing} />;
// a spread child is not a spread element
export const c1 = <a>{...1}</a>;
export const c2 = <a>{...sp}</a>;
export const c3 = <a>{..."s"}</a>;
export const c4 = <a>{...new Set([1])}</a>;
export const c5 = <a>{...any1}</a>;
export const c6 = <a>{...missing}</a>;
export const c7 = <>{...1}</>;
export const c8 = <KTup>{...[<a />, "s"] as [JSX.Element, string]}</KTup>;
declare function G1<T>(p: { v: T }): JSX.Element; declare const Any1: any; declare const any1: any;
declare function G2<T extends number>(p: { v: T }): JSX.Element;
declare function O2<T>(p: { v: T }): JSX.Element; declare function O2(p: { w: string }): JSX.Element;
export const u20 = <G2<string> v={missing} />;
export const u21 = <O2<string> v={missing} />;
export const u22 = <O2<string, number> v={missing} />;
export const u23 = <G2<string> v={missing}></G2>;
export const u24 = <O2<string> v={1} w={missing} />;
export function u25() { type Only = 1; return <Fn<string> req={1 as Only} />; }
`,
        "g.d.ts": `declare namespace JSX { interface Element { __e: 1 } interface ElementChildrenAttribute { children: {} } interface IntrinsicElements { a: { id?: string }; b: { value: string } } }
declare const sp: { req: string; opt?: number };
declare function KTup(p: { children: [JSX.Element, string] }): JSX.Element;
declare function Fn(p: { req: string; children?: string }): JSX.Element;
declare function Ov(p: { req: string; children?: string }): JSX.Element; declare function Ov(p: { req: number; other: string }): JSX.Element;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.tsx(2,23): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(3,23): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(4,23): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(5,23): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(6,23): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(7,23): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(8,30): error TS6133: 'only' is declared but its value is never read.
        a.tsx(8,51): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(9,23): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(10,23): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(10,39): error TS17001: JSX elements cannot have multiple attributes with the same name.
        a.tsx(11,24): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(12,24): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(13,24): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(14,24): error TS2304: Cannot find name 'Missing'.
        a.tsx(14,24): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(15,24): error TS2558: Expected 1 type arguments, but got 2.
        a.tsx(16,24): error TS2558: Expected 1 type arguments, but got 2.
        a.tsx(16,43): error TS2304: Cannot find name 'missing'.
        a.tsx(17,24): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(18,23): error TS2558: Expected 0 type arguments, but got 1.
        a.tsx(18,35): error TS2304: Cannot find name 'missing'.
        a.tsx(19,38): error TS2304: Cannot find name 'missing'.
        a.tsx(20,21): error TS2304: Cannot find name 'Nope'.
        a.tsx(20,38): error TS2304: Cannot find name 'missing'.
        a.tsx(22,20): error TS2559: Type '{ children: number; }' has no properties in common with type '{ id?: string | undefined; }'.
        a.tsx(22,22): error TS2609: JSX spread child must be an array type.
        a.tsx(23,20): error TS2559: Type '{ children: { req: string; opt?: number | undefined; }; }' has no properties in common with type '{ id?: string | undefined; }'.
        a.tsx(23,22): error TS2609: JSX spread child must be an array type.
        a.tsx(24,20): error TS2559: Type '{ children: string; }' has no properties in common with type '{ id?: string | undefined; }'.
        a.tsx(24,22): error TS2609: JSX spread child must be an array type.
        a.tsx(25,20): error TS2559: Type '{ children: Set<number>; }' has no properties in common with type '{ id?: string | undefined; }'.
        a.tsx(25,22): error TS2609: JSX spread child must be an array type.
        a.tsx(26,20): error TS2559: Type '{ children: any; }' has no properties in common with type '{ id?: string | undefined; }'.
        a.tsx(27,20): error TS2559: Type '{ children: any; }' has no properties in common with type '{ id?: string | undefined; }'.
        a.tsx(27,22): error TS2609: JSX spread child must be an array type.
        a.tsx(27,26): error TS2304: Cannot find name 'missing'.
        a.tsx(28,21): error TS2609: JSX spread child must be an array type.
        a.tsx(29,25): error TS2609: JSX spread child must be an array type.
        a.tsx(33,24): error TS2344: Type 'string' does not satisfy the constraint 'number'.
        a.tsx(34,35): error TS2304: Cannot find name 'missing'.
        a.tsx(35,24): error TS2558: Expected 1 type arguments, but got 2.
        a.tsx(36,24): error TS2344: Type 'string' does not satisfy the constraint 'number'.
        a.tsx(36,35): error TS2304: Cannot find name 'missing'.
        a.tsx(37,32): error TS2322: Type 'number' is not assignable to type 'string'.
        a.tsx(37,41): error TS2304: Cannot find name 'missing'.
        a.tsx(38,30): error TS6196: 'Only' is declared but never used.
        a.tsx(38,51): error TS2558: Expected 0 type arguments, but got 1."
      `);
      expect(exitCode).toBe(1);
    });

    test("a name that is used only in a node that is never checked", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "jsx": "preserve", "noUnusedLocals": true}}`,
        "a.ts": `// a reference in a node that is never checked is no reference
export namespace N { const x = 1; export = x; }
export function f() { const only = 1; const g = function* () {}; g(); class C { static { return only; } } return C; }
export function h(this: any) { const w = 1; with (this) { w; } }
export function k() { const y = 1; for (var of y) {} }
export function m(a = () => { const z = 1; yield z; }) { return a; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,28): error TS6133: 'x' is declared but its value is never read.
        a.ts(2,35): error TS1063: An export assignment cannot be used in a namespace.
        a.ts(3,29): error TS6133: 'only' is declared but its value is never read.
        a.ts(3,90): error TS18041: A 'return' statement cannot be used inside a class static block.
        a.ts(4,38): error TS6133: 'w' is declared but its value is never read.
        a.ts(4,45): error TS1101: 'with' statements are not allowed in strict mode.
        a.ts(4,45): error TS2410: The 'with' statement is not supported. All symbols in a 'with' block will have type 'any'.
        a.ts(5,29): error TS6133: 'y' is declared but its value is never read.
        a.ts(5,44): error TS1123: Variable declaration list cannot be empty.
        a.ts(6,37): error TS6133: 'z' is declared but its value is never read.
        a.ts(6,44): error TS1163: A 'yield' expression is only allowed in a generator body."
      `);
      expect(exitCode).toBe(1);
    });

    test("an assertion function that CommonJS exports", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "c1.js": `/** @param {unknown} a @returns {asserts a is string} */
module.exports = function (a) {};
`,
        "c2.js": `/** @param {unknown} a @returns {asserts a is string} */
exports.f = function (a) {};
/** @param {unknown} a @returns {asserts a is string} */
module.exports.g = (a) => {};
`,
        "c3.js": `module.exports = {
  /** @param {unknown} a @returns {asserts a is string} */
  f(a) {},
  /** @param {unknown} a @returns {asserts a is string} */
  g: function (a) {},
};
`,
        "c4.js": `/** @param {unknown} a @returns {asserts a is string} */
export default function (a) {}
/** @param {unknown} a @returns {asserts a is string} */
export const h = (a) => {};
`,
        "u.js": `// tsgo: TS2775 for c3.f, c3.g, g3 and h. Ours: also for c1, c2.f, c2.g, f, g, f3 and c1i, seven false errors
const c1 = require("./c1");
const c2 = require("./c2");
const { f, g } = require("./c2");
const c3 = require("./c3");
const { f: f3, g: g3 } = require("./c3");
import c1i from "./c1";
import d, { h } from "./c4";
/** @param {unknown} x */
export function use(x) {
  c1(x); c2.f(x); c2.g(x); f(x); g(x); c3.f(x); c3.g(x); f3(x); g3(x); c1i(x); d(x);
  h(x);
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "u.js(11,40): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation.
        u.js(11,49): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation.
        u.js(11,65): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation.
        u.js(12,3): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation."
      `);
      expect(exitCode).toBe(1);
    });

    test("which references have an explicit type for an assertion call", async () => {
      using dir = project({
        "a.ts": `interface A<T> {
  f: (x: unknown) => asserts x is T;
  m(x: unknown): asserts x is T;
  g;
}
declare const u: A<string> | A<number>;
declare const i: A<string> & { f: (x: unknown) => asserts x is string; m(x: unknown): asserts x is string };
declare const same: A<string> & A<string>;
export function t(x: unknown) {
  u.f(x);
  u.m(x);
  i.f(x);
  i.m(x);
  same.f(x);
  same.m(x);
}
const lit = {
  m(x: unknown): asserts x is string {},
  p: (x: unknown): asserts x is string => {},
};
const typed: { lit: typeof lit } = { lit };
export function t2(x: unknown) {
  lit.m(x);
  typed.lit.m(x);
  typed.lit.p(x);
}
class C {
  accessor a: (x: unknown) => asserts x is string = null!;
  get b(): (x: unknown) => asserts x is string { return null!; }
  c?: (x: unknown) => asserts x is string;
  d = (x: unknown): asserts x is string => {};
  constructor(public e: (x: unknown) => asserts x is string, public f = (x: unknown): asserts x is string => {}) {}
  t(x: unknown) {
    this.a(x);
    this.b(x);
    this.c!(x);
    this.d(x);
    this.e(x);
    this.f(x);
  }
}
type M = { [K in keyof C]: C[K] };
type P = Pick<A<string>, "f" | "m">;
declare const mm: M;
declare const pp: P;
declare const sp: { s: { readonly f: (x: unknown) => asserts x is string } };
export function t3(x: unknown) {
  mm.e(x);
  mm.d(x);
  mm.t(x);
  pp.f(x);
  pp.m(x);
}
function fx() {}
fx.g = function (a: unknown): asserts a is string {};
fx.h = (a: unknown): asserts a is string => {};
fx.i = (function (a: unknown): asserts a is string {});
export function t4(x: unknown) {
  fx.g(x);
  fx.h(x);
  fx.i(x);
}
`,
        "b.ts": `interface B<T> {
  f: (x: unknown) => asserts x is string;
  m(x: unknown): asserts x is string;
  n: (x: unknown, y?: T) => asserts x is string;
  o(x: unknown, y?: T): asserts x is string;
  v: T;
}
declare const ub: B<string> | B<number>;
declare const ib: B<string> & B<number>;
declare const uz: B<string> | (B<string> & { z: 1 });
export function t(x: unknown) {
  ub.f(x);
  ub.m(x);
  ub.n(x);
  ub.o(x);
  ib.f(x);
  ib.m(x);
  ib.n(x);
  ib.o(x);
  uz.f(x);
  uz.m(x);
}
namespace N {
  export const a = (x: unknown): asserts x is string => {};
  export const b: (x: unknown) => asserts x is string = a;
  export function c(x: unknown): asserts x is string {}
  export import d = N.c;
  export import e = N.a;
}
export function t2(x: unknown, fs: ((x: unknown) => asserts x is string)[], { g }: { g: (x: unknown) => asserts x is string }) {
  N.a(x);
  N.b(x);
  N.c(x);
  N.d(x);
  N.e(x);
  for (const f of fs) f(x);
  for (const f of [N.b]) f(x);
  g(x);
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(4,3): error TS7008: Member 'g' implicitly has an 'any' type.
        a.ts(12,3): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation.
        a.ts(13,3): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation.
        a.ts(23,3): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation.
        a.ts(25,3): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation.
        a.ts(34,5): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation.
        a.ts(35,5): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation.
        a.ts(36,5): error TS2776: Assertions require the call target to be an identifier or qualified name.
        a.ts(37,5): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation.
        a.ts(39,5): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation.
        a.ts(49,3): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation.
        a.ts(61,3): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation.
        b.ts(19,3): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation.
        b.ts(31,3): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation.
        b.ts(35,3): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation.
        b.ts(37,26): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation.
        b.ts(38,3): error TS2775: Assertions require every name in the call target to be declared with an explicit type annotation."
      `);
      expect(exitCode).toBe(1);
    });

    test("a read-only property through a spread, a rest element, `Pick` and an intersection", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "d.js": `const v = 1;
Object.defineProperty(exports, "v", { value: v });
Object.defineProperty(exports, "w", { value: v, writable: true });
`,
        "e.js": `function f() {}
Object.defineProperty(f, "ro", { value: 1 });
Object.defineProperty(f, "rw", { value: 1, writable: true });
Object.defineProperty(f, "get", { get() { return 1; } });
Object.defineProperty(f, "both", { get() { return 1; }, set(v) {} });
f.ro = 2;
f.rw = 2;
f.get = 2;
f.both = 2;
const sp = { ...f };
sp.ro = 2;
sp.rw = 2;
sp.get = 2;
sp.both = 2;
const sp2 = { ...sp, z: 1 };
sp2.ro = 2;
const sp3 = { ro: 1, ...sp };
sp3.ro = 2;
const sp4 = { ...sp, ro: 1 };
sp4.ro = 2;
/** @type {Pick<typeof f, "ro" | "rw">} */
const pk = f;
pk.ro = 2;
pk.rw = 2;
/** @type {{ -readonly [K in "ro" | "rw"]: (typeof f)[K] }} */
const mw = f;
mw.ro = 2;
/** @type {typeof f | typeof f & { z: 1 }} */
const un = f;
un.ro = 2;
/** @type {typeof f & { ro: number }} */
const it = f;
it.ro = 2;
/** @type {never} */
const show = [sp, sp2, pk, mw];
export {};
`,
        "m.js": `import * as ns from "./d";
import def from "./d";
const d = require("./d");
ns.v = 2;
def.v = 2;
d.v = 2;
d.w = 2;
const { ...rest } = d;
rest.v = 2;
/** @type {Pick<typeof d, "v" | "w">} */
const pk = d;
pk.v = 2;
pk.w = 2;
const c = /** @type {const} */ ({ ...d });
c.v = 2;
c.w = 2;
/** @type {never} */
const show = [rest, pk, c];
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "e.js(6,3): error TS2540: Cannot assign to 'ro' because it is a read-only property.
        e.js(8,3): error TS2540: Cannot assign to 'get' because it is a read-only property.
        e.js(11,4): error TS2540: Cannot assign to 'ro' because it is a read-only property.
        e.js(13,4): error TS2540: Cannot assign to 'get' because it is a read-only property.
        e.js(16,5): error TS2540: Cannot assign to 'ro' because it is a read-only property.
        e.js(17,15): error TS2783: 'ro' is specified more than once, so this usage will be overwritten.
        e.js(18,5): error TS2540: Cannot assign to 'ro' because it is a read-only property.
        e.js(23,4): error TS2540: Cannot assign to 'ro' because it is a read-only property.
        e.js(30,4): error TS2540: Cannot assign to 'ro' because it is a read-only property.
        e.js(33,4): error TS2540: Cannot assign to 'ro' because it is a read-only property.
        e.js(35,7): error TS2322: Type 'Pick<{ (): void; readonly ro: number; rw: number; readonly get: number; both: number; }, "ro" | "rw">[]' is not assignable to type 'never'.
        m.js(4,4): error TS2540: Cannot assign to 'v' because it is a read-only property.
        m.js(5,5): error TS2540: Cannot assign to 'v' because it is a read-only property.
        m.js(6,3): error TS2540: Cannot assign to 'v' because it is a read-only property.
        m.js(9,6): error TS2540: Cannot assign to 'v' because it is a read-only property.
        m.js(12,4): error TS2540: Cannot assign to 'v' because it is a read-only property.
        m.js(15,3): error TS2540: Cannot assign to 'v' because it is a read-only property.
        m.js(16,3): error TS2540: Cannot assign to 'w' because it is a read-only property.
        m.js(18,7): error TS2322: Type '{ readonly v: number; readonly w: number; }[]' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an optional member whose initializer compares `this`", async () => {
      using dir = project({
        "a.ts": `export class C1 { x? = \`\${this}\` as const; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(1,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."`,
      );
      expect(exitCode).toBe(1);
    });

    test("a call of an accessor of a union or an intersection", async () => {
      using dir = project({
        "a.ts": `export class G<T> { get m(): T { return null!; } }
export class GS<T> { get m(): T { return null!; } set m(v: T) {} }
export class S<T> { set m(v: T) {} }
export class A<T> { accessor m!: T; }
export class F<T> { m!: T; }
declare const u1: G<number> | G<string>; u1.m();
declare const u2: G<number> | GS<string>; u2.m();
declare const u3: GS<number> | GS<string>; u3.m();
declare const u4: GS<number> | A<string>; u4.m();
declare const u5: G<number> | F<string>; u5.m();
declare const u6: F<number> | G<string>; u6.m();
declare const u7: S<number> | S<string>; u7.m();
declare const u8: G<number> | S<string>; u8.m();
declare const u9: G<number> | G<number> & { z: 1 }; u9.m();
declare const i1: G<number> & G<string>; i1.m();
declare const i2: G<number> & GS<string>; i2.m();
declare const i3: GS<number> & GS<string>; i3.m();
declare const i4: GS<number> & A<string>; i4.m();
declare const i5: G<number> & F<string>; i5.m();
declare const i6: F<number> & G<string>; i6.m();
declare const i7: G<number> & G<number>; i7.m();
declare const i8: G<{ a: 1 }> & G<{ b: 1 }>; i8.m();
declare const i9: G<number> & { z: 1 }; i9.m();
declare const m1: Pick<G<number>, "m">; m1.m();
declare const m2: Readonly<GS<number>>; m2.m();
const s1 = { ...new G<number>() }; 
const l1 = { get m() { return 1; } }; l1.m();
const l2 = { get m() { return 1; }, set m(v) {} }; l2.m();
const l3 = { set m(v: number) {}, get m() { return 1; } }; l3.m();
const l4 = { ...l1 }; l4.m();
declare const l5: typeof l1 | typeof l2; l5.m();
declare const l6: typeof l1 | { get m(): string }; l6.m();
u1["m"]();
i3["m"]();
const l7 = { ...l2 }; l7.m();
const l8 = { ...new GS<number>() }; l8.m();
const l9 = { ...new A<number>() }; l9.m();
const { ...r1 } = l2; r1.m();
declare const t1: { get m(): number; set m(v: number) }; const l10 = { ...t1 }; l10.m();
declare const t2: { get m(): number }; const l11 = { ...t2 }; l11.m();
declare const n1: G<number> | undefined; n1.m();
n1?.m();
n1!.m();
function tp<T extends G<number>>(t: T, u: T | undefined) { t.m(); u!.m(); }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(6,45): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          No constituent of type 'string | number' is callable.
        a.ts(7,46): error TS2349: This expression is not callable.
          No constituent of type 'string | number' is callable.
        a.ts(8,47): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          No constituent of type 'string | number' is callable.
        a.ts(9,46): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          No constituent of type 'string | number' is callable.
        a.ts(10,45): error TS2349: This expression is not callable.
          No constituent of type 'string | number' is callable.
        a.ts(11,45): error TS2349: This expression is not callable.
          No constituent of type 'string | number' is callable.
        a.ts(12,45): error TS2349: This expression is not callable.
          No constituent of type 'string | number' is callable.
        a.ts(13,45): error TS2349: This expression is not callable.
          No constituent of type 'string | number' is callable.
        a.ts(14,56): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(15,45): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'never' has no call signatures.
        a.ts(16,46): error TS2349: This expression is not callable.
          Type 'never' has no call signatures.
        a.ts(17,47): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'never' has no call signatures.
        a.ts(18,46): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'never' has no call signatures.
        a.ts(19,45): error TS2349: This expression is not callable.
          Type 'never' has no call signatures.
        a.ts(20,45): error TS2349: This expression is not callable.
          Type 'never' has no call signatures.
        a.ts(21,45): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(22,49): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type '{ a: 1; } & { b: 1; }' has no call signatures.
        a.ts(23,44): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(24,44): error TS2349: This expression is not callable.
          Type 'Number' has no call signatures.
        a.ts(25,44): error TS2349: This expression is not callable.
          Type 'Number' has no call signatures.
        a.ts(27,42): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(28,55): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(29,63): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(30,26): error TS2349: This expression is not callable.
          Type 'Number' has no call signatures.
        a.ts(31,45): error TS2349: This expression is not callable.
          Type 'Number' has no call signatures.
        a.ts(32,55): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          No constituent of type 'string | number' is callable.
        a.ts(33,1): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          No constituent of type 'string | number' is callable.
        a.ts(34,1): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'never' has no call signatures.
        a.ts(35,26): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(36,40): error TS2339: Property 'm' does not exist on type '{}'.
        a.ts(37,39): error TS2339: Property 'm' does not exist on type '{}'.
        a.ts(38,26): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(39,85): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(40,67): error TS2349: This expression is not callable.
          Type 'Number' has no call signatures.
        a.ts(41,42): error TS18048: 'n1' is possibly 'undefined'.
        a.ts(41,45): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(42,5): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(43,5): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(44,62): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(44,70): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures."
      `);
      expect(exitCode).toBe(1);
    });

    test("a call of a getter, with and without a setter", async () => {
      using dir = project({
        "a.ts": `export class P1 { get #m() { return 1; } u() { this.#m(); } }
export class P2 { static get #m() { return 1; } static u() { P2.#m(); } }
const k = Symbol();
export class P3 { get [k]() { return 1; } u() { this[k](); } }
export class P4 { accessor [k] = 1; u() { this[k](); } }
export interface I5 { get m(): number } declare const i5: I5; i5.m();
export class P6 { declare m: number; u() { this.m(); } }
export class P7<T> { accessor m!: T; } new P7<number>().m();
declare const u8: P7<number> | P7<string>; u8.m();
declare const i9: P7<number> & { z: 1 }; i9.m();
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,53): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(2,65): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(4,49): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(5,43): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(6,66): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(7,49): error TS2349: This expression is not callable.
          Type 'Number' has no call signatures.
        a.ts(8,57): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures.
        a.ts(9,47): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          No constituent of type 'string | number' is callable.
        a.ts(10,45): error TS6234: This expression is not callable because it is a 'get' accessor. Did you mean to use it without '()'?
          Type 'Number' has no call signatures."
      `);
      expect(exitCode).toBe(1);
    });

    test("a template literal with `this` in a class that has optional members", async () => {
      using dir = project({
        "a.ts": `export class A1 { x = \`\${this}\` as const; }
export class A2 { get p() { return \`\${this}\` as const; } }
export class A3 { m() { return \`\${this}\` as const; } }
export class A4 { x = \`\${this}\${this}\` as const; z = 1; }
export class A5 { x = \`\${1}\${this}\` as const; }
export class A6 { x = \`\${this.m()}\` as const; m() { return this; } }
export class A7 { x = \`\${null! as this | string}\` as const; }
export class A8 { x = \`\${null! as this & { a: 1 }}\` as const; }
export class A9 { x = \`\${new A9()}\` as const; }
export class B1 { x = \`\${[this]}\` as const; }
export class B2 { static x = \`\${this}\` as const; }
export class B3 { x = () => \`\${this}\` as const; }
export class B4<Q extends B4<Q>> { x = \`\${null! as Q}\` as const; }
export class B5 { x = \`\${this.y}\` as const; y = 1; }
export class B6 { x = { a: \`\${this}\` as const }; }
export class B7 { x = [\`\${this}\` as const]; }
export class C1 { x? = \`\${this}\` as const; }
export class C2 { private x = \`\${this}\` as const; }
export class C3 { readonly x = \`\${this}\` as const; }
export class C4 { x? = \`\${this}\` as const; y? = 1; }
export class C5 { protected x? = \`\${this}\` as const; }
export class C6 { #x = \`\${this}\` as const; }
export class C7 { y = 1; x = \`\${this}\` as const; }
export class C8 { get x() { return \`\${this}\` as const; } set x(v) {} }
export class C9 { accessor x = \`\${this}\` as const; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(2,23): error TS7023: 'p' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(4,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(13,36): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(14,31): error TS2729: Property 'y' is used before its initialization.
        a.ts(15,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(16,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(17,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(18,27): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(19,28): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(20,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(21,29): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(22,19): error TS7022: '#x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(23,26): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(24,23): error TS7023: 'x' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions."
      `);
      expect(exitCode).toBe(1);
    });

    test("a spread of a union in a class field", async () => {
      using dir = project({
        "a.ts": `declare function fe(v: {}): 1; declare const c: boolean;
export class D1 { x = { a: fe({ ...(null! as D1 | { x: 1; y: 2 }) }) }; y = 1; }
export class D2 { x = [fe({ ...(c ? new D2() : { x: 1, y: 2 }) })]; y = 1; }
export class D3 { x = { a: fe({ ...(null! as D3 | { y: 2 }) }) }; y = 1; }
export class D4 { x = { a: fe({ ...(null! as { y: 2 } | D4) }) }; y = 1; }
export class D5 { static x = { a: fe({ ...(null! as typeof D5 | { x: 1; y: 2 }) }) }; static y = 1; }
export class D6 { x = { a: fe({ ...(null! as D6 | D6B) }) }; y = 1; }
export class D6B { x = 1; y = 1; }
export class D7 { x = { a: fe({ z: 1, ...(null! as D7 | { x: 1; z: 2 }) }) }; y = 1; }
export function g<T extends D8 | { x: 1 }>(v: T) { return fe({ ...v }); }
export class D8 { x = { a: g(null! as D8) }; y = 1; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(3,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,26): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(9,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,17): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(11,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("functions that return a member of a class whose initializer calls them", async () => {
      using dir = project({
        "a.ts": `export function r1() { class K { static p = [g(), h()]; } function g() { return K.p; } function h() { return K.p; } return K; }
export function r2() { class K { p = [g(), h()]; } function g() { return new K().p; } function h() { return new K().p; } return K; }
export function r3() { const o = { p: [g(), h()] }; function g() { return o.p; } function h() { return o.p; } return o; }
export function r4() { const o = { get p() { return [g(), h()]; } }; function g() { return o.p; } function h() { return o.p; } return o; }
export function r5() { class K { static get p() { return [g(), h()]; } } function g() { return K.p; } function h() { return K.p; } return K; }
export function r6() { function f() { return [g(), h()]; } function g() { return f(); } function h() { return f(); } return f; }
export function r9() { const b = a; const { a } = { a: [g(), h()] }; function g() { return a; } function h() { return a; } return b; }
export function s1() { const a = [g(), h()] as const; function g() { return a; } function h() { return a; } return a; }
export function s2() { const b = a; let a = g() || h(); function g() { return a; } function h() { return a; } return b; }
export function s3() { const b = a; const a = (x = [g(), h()]) => x; function g() { return a(); } function h() { return a(); } return b; }
export function s4() { const b = a; const a = [() => g(), () => h()]; function g() { return a; } function h() { return a; } return b; }
export function s5() { const b = a; const a = [g(), a]; function g() { return a; } return b; }
export function s6(this: any) { const b = a; const a = [g(), new H().v]; function g() { return a; } class H { v = a; } return b; }
export function s7() { const b = a; const a = [g(), o.p]; function g() { return a; } const o = { p: a }; return b; }
export function u1() { const b = a; const a = [g(), k()]; function g() { return a; } function k() { return b; } return b; }
export function u2() { const a = [g(), k()]; const b = a; function g() { return a; } function k() { return b; } return b; }
export function u3() { class K { static p = [g(), K.q]; static q = K.p; } function g() { return K.p; } return K; }
export function u4() { var a = [g(), a]; function g() { return a; } return a; }
export function u5(x = [g(), h()]) { function g() { return x; } function h() { return x; } return x; }
export function u6() { for (const a of [[g(), h()]]) { function g() { return a; } function h() { return a; } } }
export function u7() { const o = { a: [g(), h()] }; const { a } = o; function g() { return a; } function h() { return a; } return a; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,41): error TS7022: 'p' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(1,68): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(2,34): error TS7022: 'p' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(2,61): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(3,30): error TS7022: 'o' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(3,62): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(4,40): error TS7023: 'p' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(4,79): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(4,108): error TS7023: 'h' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(5,45): error TS7023: 'p' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(5,83): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(5,112): error TS7023: 'h' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(6,33): error TS7023: 'f' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(6,69): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(6,98): error TS7023: 'h' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(7,34): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(7,45): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,79): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(8,30): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,64): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(9,34): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(9,41): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(9,66): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(10,34): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(10,43): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,79): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(11,34): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(11,43): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(11,48): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(11,80): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(12,34): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(12,43): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,53): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(12,66): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(13,43): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(13,52): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(13,66): error TS2449: Class 'H' used before its declaration.
        a.ts(13,83): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(14,34): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(14,43): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(14,53): error TS2448: Block-scoped variable 'o' used before its declaration.
        a.ts(14,53): error TS2454: Variable 'o' is used before being assigned.
        a.ts(14,68): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(15,34): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(15,43): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(15,68): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(16,30): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(16,68): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(17,41): error TS7022: 'p' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(17,53): error TS2729: Property 'q' is used before its initialization.
        a.ts(17,84): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(18,28): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(18,51): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(19,20): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(19,25): error TS2373: Parameter 'x' cannot reference identifier 'g' declared after it.
        a.ts(19,30): error TS2373: Parameter 'x' cannot reference identifier 'h' declared after it.
        a.ts(19,47): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(20,42): error TS2304: Cannot find name 'g'.
        a.ts(20,47): error TS2304: Cannot find name 'h'.
        a.ts(21,30): error TS7022: 'o' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(21,61): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(21,79): error TS7023: 'g' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions."
      `);
      expect(exitCode).toBe(1);
    });

    test("a conditional type as the type argument of a base class that refers to its own members", async () => {
      using dir = project({
        "a.ts": `declare abstract class Schema<Output = any> { readonly _output: Output; }
declare class C0<Value extends Schema> extends Schema<Value extends { _output: "yes" } ? "yes" : "no"> {}
type F0<V> = V extends string ? Schema<V> : C0<F0<V>>;
export const e0: never = (null! as F0<unknown>)._output;
declare class C1<Value extends Schema> extends Schema<Value extends { _output: "no" } ? "yes" : "no"> {}
type F1<V> = V extends string ? Schema<V> : C1<F1<V>>;
export const e1: never = (null! as F1<unknown>)._output;
declare class C2<Value extends Schema> extends Schema<Value extends { _output: "yes" | "no" } ? 1 : 2> {}
type F2<V> = V extends string ? Schema<V> : C2<F2<V>>;
export const e2: never = (null! as F2<unknown>)._output;
declare class C3<Value extends Schema> extends Schema<Value extends { _output: 2 } ? 1 : 2> {}
type F3<V> = V extends string ? Schema<V> : C3<F3<V>>;
export const e3: never = (null! as F3<unknown>)._output;
declare class C4<Value extends Schema> extends Schema<Value extends { _output: 1 } ? 1 : 2> {}
type F4<V> = V extends string ? Schema<V> : C4<F4<V>>;
export const e4: never = (null! as F4<unknown>)._output;
declare class C5<Value extends Schema> extends Schema<Value extends { nope: unknown } ? "yes" : "no"> {}
type F5<V> = V extends string ? Schema<V> : C5<F5<V>>;
export const e5: never = (null! as F5<unknown>)._output;
declare class C6<Value extends Schema> extends Schema<Value extends { _output: string } ? "yes" : "no"> {}
type F6<V> = V extends string ? Schema<V> : C6<F6<V>>;
export const e6: never = (null! as F6<unknown>)._output;
declare class C7<Value extends Schema> extends Schema<Value extends { _output: number } ? "yes" : "no"> {}
type F7<V> = V extends string ? Schema<V> : C7<F7<V>>;
export const e7: never = (null! as F7<unknown>)._output;
declare class C8<Value extends Schema> extends Schema<[Value] extends [{ _output: number }] ? "yes" : "no"> {}
type F8<V> = V extends string ? Schema<V> : C8<F8<V>>;
export const e8: never = (null! as F8<unknown>)._output;
declare class C9<Value extends Schema> extends Schema<Value extends { _output: infer O } ? [O, Value["_output"]] : "no"> {}
type F9<V> = V extends string ? Schema<V> : C9<F9<V>>;
export const e9: never = (null! as F9<unknown>)._output;
declare class C10<Value extends Schema> extends Schema<Value extends Schema<infer O> ? [O] : "no"> {}
type F10<V> = V extends string ? Schema<V> : C10<F10<V>>;
export const e10: never = (null! as F10<unknown>)._output;
declare class C11<Value extends Schema> extends Schema<"_output" extends keyof Value ? "yes" : "no"> {}
type F11<V> = V extends string ? Schema<V> : C11<F11<V>>;
export const e11: never = (null! as F11<unknown>)._output;
declare class C12<Value extends Schema> extends Schema<{ [K in keyof Value]: 1 }> {}
type F12<V> = V extends string ? Schema<V> : C12<F12<V>>;
export const e12: never = (null! as F12<unknown>)._output;
declare class A<Value extends Schema> extends Schema<["a", Value["_output"]]> {}
declare class B<Value extends Schema> extends Schema<["b", Value["_output"]]> {}
type FromA<V> = V extends string ? Schema<V> : A<FromB<V>>;
type FromB<V> = V extends string ? Schema<V> : B<FromA<V>>;
export const first: never = (null! as FromA<unknown>)._output;
export const second: never = (null! as FromB<unknown>)._output;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(4,14): error TS2322: Type '"no"' is not assignable to type 'never'.
        a.ts(7,14): error TS2322: Type '"yes"' is not assignable to type 'never'.
        a.ts(10,14): error TS2322: Type '2' is not assignable to type 'never'.
        a.ts(13,14): error TS2322: Type '1' is not assignable to type 'never'.
        a.ts(16,14): error TS2322: Type '2' is not assignable to type 'never'.
        a.ts(19,14): error TS2322: Type '"no"' is not assignable to type 'never'.
        a.ts(22,14): error TS2322: Type '"yes"' is not assignable to type 'never'.
        a.ts(25,14): error TS2322: Type '"no"' is not assignable to type 'never'.
        a.ts(28,14): error TS2322: Type '"no"' is not assignable to type 'never'.
        a.ts(31,14): error TS2322: Type '[unknown, unknown]' is not assignable to type 'never'.
        a.ts(34,14): error TS2322: Type '[unknown]' is not assignable to type 'never'.
        a.ts(37,14): error TS2322: Type '"no"' is not assignable to type 'never'.
        a.ts(40,14): error TS2322: Type '{ readonly _output: 1; }' is not assignable to type 'never'.
        a.ts(45,14): error TS2322: Type '["a", ["b", unknown]]' is not assignable to type 'never'.
        a.ts(46,14): error TS2322: Type '["b", unknown]' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("variance annotations of interfaces that refer to each other", async () => {
      using dir = project({
        "a.ts": `export interface A0<in T> { f: (x: A<T>) => void }
export interface A<in T> extends A0<T> {}
export interface B0<out T> { f: (x: B<T>) => void }
export interface B<out T> extends B0<T> {}
export interface C<in T> extends C0<T> {}
export interface C0<in T> { f: (x: C<T>) => void }
export interface D0<in T> { f: (x: D<T>) => void }
export interface D<T> extends D0<T> {}
export interface E0<in T> { f: (x: E<T>) => void }
export interface E<in T> { g: E0<T> }
export interface F0<in T> { f: (x: F<T>) => void }
export type F<in T> = F0<T> & { z: 1 };
export abstract class H0<in T> { abstract f: (x: H<T>) => void }
export abstract class H<in T> extends H0<T> {}
export interface I0<in T> { f: () => I<T> }
export interface I<out T> extends I0<T> {}
export interface R<in T> { f: (x: S<T>) => void }
export interface S<in T> { h: R<T> }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,21): error TS2636: Type 'A0<super-T>' is not assignable to type 'A0<sub-T>' as implied by variance annotation.
          Types of property 'f' are incompatible.
            Type '(x: A<super-T>) => void' is not assignable to type '(x: A<sub-T>) => void'.
              Types of parameters 'x' and 'x' are incompatible.
                Type 'A<sub-T>' is not assignable to type 'A<super-T>'.
                  Type 'super-T' is not assignable to type 'sub-T'.
        a.ts(3,21): error TS2636: Type 'B0<sub-T>' is not assignable to type 'B0<super-T>' as implied by variance annotation.
          Types of property 'f' are incompatible.
            Type '(x: B<sub-T>) => void' is not assignable to type '(x: B<super-T>) => void'.
              Types of parameters 'x' and 'x' are incompatible.
                Type 'B<super-T>' is not assignable to type 'B<sub-T>'.
                  Type 'super-T' is not assignable to type 'sub-T'.
        a.ts(9,21): error TS2636: Type 'E0<super-T>' is not assignable to type 'E0<sub-T>' as implied by variance annotation.
          Types of property 'f' are incompatible.
            Type '(x: E<super-T>) => void' is not assignable to type '(x: E<sub-T>) => void'.
              Types of parameters 'x' and 'x' are incompatible.
                Type 'E<sub-T>' is not assignable to type 'E<super-T>'.
                  Type 'super-T' is not assignable to type 'sub-T'.
        a.ts(12,15): error TS2637: Variance annotations are only supported in type aliases for object, function, constructor, and mapped types.
        a.ts(13,26): error TS2636: Type 'H0<super-T>' is not assignable to type 'H0<sub-T>' as implied by variance annotation.
          Types of property 'f' are incompatible.
            Type '(x: H<super-T>) => void' is not assignable to type '(x: H<sub-T>) => void'.
              Types of parameters 'x' and 'x' are incompatible.
                Type 'H<sub-T>' is not assignable to type 'H<super-T>'.
                  Type 'super-T' is not assignable to type 'sub-T'.
        a.ts(15,21): error TS2636: Type 'I0<super-T>' is not assignable to type 'I0<sub-T>' as implied by variance annotation.
          The types returned by 'f()' are incompatible between these types.
            Type 'I<super-T>' is not assignable to type 'I<sub-T>'.
              Type 'super-T' is not assignable to type 'sub-T'.
        a.ts(17,20): error TS2636: Type 'R<super-T>' is not assignable to type 'R<sub-T>' as implied by variance annotation.
          Types of property 'f' are incompatible.
            Type '(x: S<super-T>) => void' is not assignable to type '(x: S<sub-T>) => void'.
              Types of parameters 'x' and 'x' are incompatible.
                Type 'S<sub-T>' is not assignable to type 'S<super-T>'.
                  Type 'super-T' is not assignable to type 'sub-T'."
      `);
      expect(exitCode).toBe(1);
    });

    test("variance annotations of interfaces that refer to each other across files", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true}, "files": ["a.ts", "b.ts", "c.ts", "e.ts"]}`,
        "a.ts": `import type { Sb } from "./b";
export interface Ra<in T> { f: (x: Sb<T>) => void }
export interface Sa<in T> {}
`,
        "b.ts": `import type { Sa } from "./a";
export interface Sb<in T> {}
export interface Rb<in T> { f: (x: Sa<T>) => void }
`,
        "c.ts": `import type { Sd } from "./d";
import type { Se } from "./e";
export interface Rc<in T> { f: (x: Sd<T>) => void }
export interface Rc2<in T> { f: (x: Se<T>) => void }
export interface Rc3<in T> { f: (x: G<T>) => void }
declare global { interface G<T> {} }
`,
        "d.d.ts": `export interface Sd<in T> {}
`,
        "e.ts": `export interface Se<in T> {}
export interface Re<in T> { f: (x: G<T>) => void }
declare global { interface G<in T> {} }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "b.ts(3,21): error TS2636: Type 'Rb<super-T>' is not assignable to type 'Rb<sub-T>' as implied by variance annotation.
          Types of property 'f' are incompatible.
            Type '(x: Sa<super-T>) => void' is not assignable to type '(x: Sa<sub-T>) => void'.
              Types of parameters 'x' and 'x' are incompatible.
                Type 'Sa<sub-T>' is not assignable to type 'Sa<super-T>'.
                  Type 'super-T' is not assignable to type 'sub-T'.
        c.ts(3,21): error TS2636: Type 'Rc<super-T>' is not assignable to type 'Rc<sub-T>' as implied by variance annotation.
          Types of property 'f' are incompatible.
            Type '(x: Sd<super-T>) => void' is not assignable to type '(x: Sd<sub-T>) => void'.
              Types of parameters 'x' and 'x' are incompatible.
                Type 'Sd<sub-T>' is not assignable to type 'Sd<super-T>'.
                  Type 'super-T' is not assignable to type 'sub-T'.
        e.ts(2,21): error TS2636: Type 'Re<super-T>' is not assignable to type 'Re<sub-T>' as implied by variance annotation.
          Types of property 'f' are incompatible.
            Type '(x: G<super-T>) => void' is not assignable to type '(x: G<sub-T>) => void'.
              Types of parameters 'x' and 'x' are incompatible.
                Type 'G<sub-T>' is not assignable to type 'G<super-T>'.
                  Type 'super-T' is not assignable to type 'sub-T'."
      `);
      expect(exitCode).toBe(1);
    });

    test("the order in which variance annotations are checked", async () => {
      using dir = project({
        "a.ts": `export interface R1<in T> { f: (x: S1<T>) => void }
export interface S1<in T> {}
export interface Q1<in T> { f: (x: S1<T>) => void }
export interface S2<in T> {}
export interface Q2<in T> { f: (x: S2<T>) => void }
export interface R3<out T> { f: () => S3<T> }
export interface S3<out T> {}
export interface Q3<out T> { f: () => S3<T> }
export interface R4<out T> { f: (x: S4<T>) => void }
export interface S4<in T> {}
export interface Q4<out T> { f: (x: S4<T>) => void }
export interface R5<in T> { f: () => S5<T> }
export interface S5<out T> {}
export interface Q5<in T> { f: () => S5<T> }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,21): error TS2636: Type 'R1<super-T>' is not assignable to type 'R1<sub-T>' as implied by variance annotation.
          Types of property 'f' are incompatible.
            Type '(x: S1<super-T>) => void' is not assignable to type '(x: S1<sub-T>) => void'.
              Types of parameters 'x' and 'x' are incompatible.
                Type 'S1<sub-T>' is not assignable to type 'S1<super-T>'.
                  Type 'super-T' is not assignable to type 'sub-T'.
        a.ts(12,21): error TS2636: Type 'R5<super-T>' is not assignable to type 'R5<sub-T>' as implied by variance annotation.
          The types returned by 'f()' are incompatible between these types.
            Type 'S5<super-T>' is not assignable to type 'S5<sub-T>'.
              Type 'super-T' is not assignable to type 'sub-T'."
      `);
      expect(exitCode).toBe(1);
    });

    test("inference to `keyof T` from string literals and enum members", async () => {
      using dir = project({
        "a.ts": `enum SE { A = "a", B = "b" }
declare function k<T>(a: keyof T): T;
export const r1: never = k(SE.A);
export const r2: never = k("1");
export const r3: never = k("1.5");
export const r4: never = k("-1");
export const r5: never = k("a");
export const r6: never = k("a-b");
export const r7: never = k("01");
export const r8: never = k("1e3");
export const r9: never = k("");
type U<T> = T extends keyof infer X ? X : "no";
export const u1: never = null! as U<SE.A>;
export const u2: never = null! as U<"1">;
export const u3: never = null! as U<"-1">;
export const u4: never = null! as U<"a" | "1">;
export const u5: never = null! as U<SE>;
export const u6: never = null! as keyof U<SE.A>;
export const u7: never = null! as keyof U<"1">;
// tsgo reports TS2345, we report nothing
declare function kk<T>(a: keyof T): T; enum SE2 { A = "a" }
kk(SE2.A);
export const q1 = [kk(SE2.A)];
kk("a");
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(13,14): error TS2322: Type '"no"' is not assignable to type 'never'.
        a.ts(14,14): error TS2322: Type '{ 1: any; }' is not assignable to type 'never'.
        a.ts(15,14): error TS2322: Type '{ "-1": any; }' is not assignable to type 'never'.
        a.ts(16,14): error TS2322: Type '{ 1: any; } | { a: any; }' is not assignable to type 'never'.
          Type '{ 1: any; }' is not assignable to type 'never'.
        a.ts(17,14): error TS2322: Type '"no"' is not assignable to type 'never'.
        a.ts(18,14): error TS2322: Type 'number | "anchor" | "at" | "big" | "blink" | "bold" | "charAt" | "charCodeAt" | "codePointAt" | "concat" | "endsWith" | "fixed" | "fontcolor" | "fontsize" | "includes" | "indexOf" | ... 36 more ... | unique symbol' is not assignable to type 'never'.
          Type 'number' is not assignable to type 'never'.
        a.ts(19,14): error TS2322: Type '"1"' is not assignable to type 'never'.
        a.ts(22,4): error TS2345: Argument of type 'SE2' is not assignable to parameter of type '"A"'.
        a.ts(23,23): error TS2345: Argument of type 'SE2' is not assignable to parameter of type '"A"'."
      `);
      expect(exitCode).toBe(1);
    });

    test("inference to `keyof T` from names that look like numbers", async () => {
      using dir = project({
        "a.ts": `enum SE { A = "a", B = "b", "x-y" = "c", D = "a" }
declare function k<T>(a: keyof T): T;
export const a1 = k("1"); export const b1: never = a1;
export const a2 = k("1.5"); export const b2: never = a2;
export const a3 = k("-1"); export const b3: never = a3;
export const a4 = k("01"); export const b4: never = a4;
export const a5 = k("1e3"); export const b5: never = a5;
export const a6 = k(""); export const b6: never = a6;
export const a7 = k("a-b"); export const b7: never = a7;
export const a8 = k(SE.A); export const b8: never = a8;
export const a9 = k(SE["x-y"]); export const b9: never = a9;
declare const u1: SE.A | "a"; export const c1 = k(u1); export const d1: never = c1;
declare const u2: SE.A | SE.D; export const c2 = k(u2); export const d2: never = c2;
declare const u3: SE.A | "A"; export const c3 = k(u3); export const d3: never = c3;
declare const u4: SE; export const c4 = k(u4); export const d4: never = c4;
declare const u5: "a" | "b"; export const c5 = k(u5); export const d5: never = c5;
type U<T> = T extends keyof infer X ? X : "no";
export const e1: never = null! as keyof U<"A" | SE.A>;
export const e2: never = null! as U<SE.A | "a">;
declare function kv<T>(a: keyof T, v: T): T;
export const f1 = kv(SE.A, { A: 1 }); export const f2 = kv(SE.A, { a: 1 }); export const f3 = kv("1", { 1: 1 }); export const f4 = kv("1", { "1": 1 });
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,40): error TS2322: Type '{ 1: any; }' is not assignable to type 'never'.
        a.ts(4,42): error TS2322: Type '{ 1.5: any; }' is not assignable to type 'never'.
        a.ts(5,41): error TS2322: Type '{ "-1": any; }' is not assignable to type 'never'.
        a.ts(6,41): error TS2322: Type '{ "01": any; }' is not assignable to type 'never'.
        a.ts(7,42): error TS2322: Type '{ "1e3": any; }' is not assignable to type 'never'.
        a.ts(8,39): error TS2322: Type '{ "": any; }' is not assignable to type 'never'.
        a.ts(9,42): error TS2322: Type '{ "a-b": any; }' is not assignable to type 'never'.
        a.ts(10,21): error TS2345: Argument of type 'SE.A' is not assignable to parameter of type '"A"'.
        a.ts(10,41): error TS2322: Type '{ a: any; }' is not assignable to type 'never'.
        a.ts(11,21): error TS2345: Argument of type '(typeof SE)["x-y"]' is not assignable to parameter of type '"x-y"'.
        a.ts(11,46): error TS2322: Type '{ c: any; }' is not assignable to type 'never'.
        a.ts(12,51): error TS2345: Argument of type '"a" | SE.A' is not assignable to parameter of type '"A"'.
          Type '"a"' is not assignable to type '"A"'.
        a.ts(12,69): error TS2322: Type '{ a: any; }' is not assignable to type 'never'.
        a.ts(13,52): error TS2345: Argument of type 'SE.A' is not assignable to parameter of type '"A"'.
        a.ts(13,70): error TS2322: Type '{ a: any; }' is not assignable to type 'never'.
        a.ts(14,51): error TS2345: Argument of type '"A" | SE.A' is not assignable to parameter of type '"A"'.
          Type 'SE.A' is not assignable to type '"A"'.
        a.ts(14,69): error TS2322: Type '{ a: any; A: any; }' is not assignable to type 'never'.
        a.ts(15,43): error TS2345: Argument of type 'SE' is not assignable to parameter of type '"A" | "B" | "x-y"'.
        a.ts(15,61): error TS2322: Type '{ a: any; b: any; c: any; }' is not assignable to type 'never'.
        a.ts(16,68): error TS2322: Type '{ a: any; b: any; }' is not assignable to type 'never'.
        a.ts(19,14): error TS2322: Type '"no" | { a: any; }' is not assignable to type 'never'.
          Type '"no"' is not assignable to type 'never'.
        a.ts(21,22): error TS2345: Argument of type 'SE.A' is not assignable to parameter of type '"A"'.
        a.ts(21,98): error TS2345: Argument of type '"1"' is not assignable to parameter of type '1'."
      `);
      expect(exitCode).toBe(1);
    });

    test("array literals as inference candidates", async () => {
      using dir = project({
        "a.ts": `declare function two<B>(a: () => B, b: () => B): B;
declare function three<B>(a: B, b: B, c: B): B;
declare function fns<A, B>(fs: ((a: A) => B)[]): [A, B];
declare const ar: number[]; declare const ob: { x: number };
// tsgo reports, we report nothing: getReturnTypeFromBody widens, which drops ObjectFlagsArrayLiteral
export const s1 = two(() => [1], () => ["a"]);
export const s2 = two(() => [[1]], () => [["a"]]);
export const s3 = two(() => { return [1]; }, () => { return ["a"]; });
export const s4 = two(function () { return [1]; }, function () { return ["a"]; });
export const s5 = two(() => [1] as number[], () => ["a"] as string[]);
// another candidate is chosen
export const c1 = two(() => [1], () => "a");
export const c2 = two(() => [1], () => ob);
export const c3 = two(() => [1], () => [{ x: 1 }]);
export const c4 = fns([(x: number) => [x], (x: number) => ({ x })]);
// a candidate that is not the type of a literal, but has the type of one
export const i1 = three(ar, "a", [1]);
export const i2 = three(ar, ob, [1]);
declare function pair<B>(a: B, b: B): B;
export const i3 = pair(ar, [[1]]);          // tsgo reports, we report nothing: the inner \`[1]\` has the type of \`ar\`
export const i4 = pair([[1]], ar);
declare function orArray<B>(a: B | B[], b: B | B[]): B;
export const i5 = orArray([ar], [1]);       // ONLY WE REPORT
export const i6 = (() => [1])(); export const i7 = pair((() => [1])(), (() => ["a"])());
// controls: literals as arguments are united
export const k1 = three([1], ["a"], [true]);
export const k2 = three({ f: [1] }, { f: ["a"] }, { f: [] });
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(6,41): error TS2322: Type 'string' is not assignable to type 'number'.
        a.ts(7,44): error TS2322: Type 'string' is not assignable to type 'number'.
        a.ts(8,46): error TS2345: Argument of type '() => string[]' is not assignable to parameter of type '() => number[]'.
          Type 'string[]' is not assignable to type 'number[]'.
            Type 'string' is not assignable to type 'number'.
        a.ts(9,52): error TS2345: Argument of type '() => string[]' is not assignable to parameter of type '() => number[]'.
          Type 'string[]' is not assignable to type 'number[]'.
            Type 'string' is not assignable to type 'number'.
        a.ts(10,52): error TS2322: Type 'string[]' is not assignable to type 'number[]'.
          Type 'string' is not assignable to type 'number'.
        a.ts(12,40): error TS2322: Type 'string' is not assignable to type 'number[]'.
        a.ts(13,40): error TS2740: Type '{ x: number; }' is missing the following properties from type 'number[]': length, pop, push, concat, and 35 more.
        a.ts(14,41): error TS2322: Type '{ x: number; }' is not assignable to type 'number'.
        a.ts(15,44): error TS2322: Type '(x: number) => { x: number; }' is not assignable to type '(a: number) => number[]'.
          Type '{ x: number; }' is missing the following properties from type 'number[]': length, pop, push, concat, and 35 more.
        a.ts(17,29): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number[]'.
        a.ts(18,29): error TS2740: Type '{ x: number; }' is missing the following properties from type 'number[]': length, pop, push, concat, and 35 more.
        a.ts(20,29): error TS2322: Type '[number]' is not assignable to type 'number'.
        a.ts(21,25): error TS2322: Type '[number]' is not assignable to type 'number'.
        a.ts(24,72): error TS2345: Argument of type 'string[]' is not assignable to parameter of type 'number[]'.
          Type 'string' is not assignable to type 'number'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a function argument against an overload that has an index signature", async () => {
      using dir = project({
        "a.ts": `declare function m<T>(a: T, b: keyof T): T;
declare const un: string | number; declare const st: string; declare const nu: number; declare const ul: "a" | "b";
export const r1 = m(x => x, un);
export const r2 = m(x => x, st);
export const r3 = m(x => x, nu);
export const r4 = m(x => x, ul);
export const r5 = m(() => 1, un);
export const r6 = m(1, un);
export const r7 = m({ p: (x: number) => x }, un);
export const r8 = m({ p: x => x }, un);
export const r9 = m({ p: x => x }, st);
export const r10 = m([x => x], st);
declare function n<T>(a: { [k: string]: T }, b: T): T;
export const t1 = n(x => x, x => x);
export const t2 = n(x => x, 1);
export const t3 = n(x => x, (x: number) => x);
export const t4 = n({ a: x => x }, x => x);
// valid code, ONLY WE REPORT (TS7006): the first overload has to fail while \`x => {}\` is still anyFunctionType
declare function o1(a: { [k: string]: number }): 0; declare function o1(a: (x: number) => void): 1;
declare function o2(a: ArrayLike<number>): 0; declare function o2(a: (x: number) => void): 1;
declare function o3(a: { [k: string]: unknown }): 0; declare function o3(a: (x: number, y: string) => void): 1;
export const v1 = o1(x => {});
export const v2 = o2(x => {});
export const v3 = o3(x => {});
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,21): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(3,21): error TS2345: Argument of type '(x: any) => any' is not assignable to parameter of type '{ [x: string]: {}; }'.
          Index signature for type 'string' is missing in type '(x: any) => any'.
        a.ts(4,21): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(4,21): error TS2345: Argument of type '(x: any) => any' is not assignable to parameter of type '{ [x: string]: {}; }'.
          Index signature for type 'string' is missing in type '(x: any) => any'.
        a.ts(5,21): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(5,29): error TS2345: Argument of type 'number' is not assignable to parameter of type 'never'.
        a.ts(6,21): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(6,21): error TS2345: Argument of type '(x: any) => any' is not assignable to parameter of type '{ a: any; b: any; }'.
        a.ts(7,30): error TS2345: Argument of type 'string | number' is not assignable to parameter of type 'never'.
          Type 'string' is not assignable to type 'never'.
        a.ts(8,24): error TS2345: Argument of type 'string | number' is not assignable to parameter of type '"toExponential" | "toFixed" | "toLocaleString" | "toPrecision" | "toString" | "valueOf"'.
          Type 'string' is not assignable to type '"toExponential" | "toFixed" | "toLocaleString" | "toPrecision" | "toString" | "valueOf"'.
        a.ts(9,46): error TS2345: Argument of type 'string | number' is not assignable to parameter of type '"p"'.
          Type 'string' is not assignable to type '"p"'.
        a.ts(10,26): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(10,36): error TS2345: Argument of type 'string | number' is not assignable to parameter of type '"p"'.
          Type 'string' is not assignable to type '"p"'.
        a.ts(11,26): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(11,36): error TS2345: Argument of type 'string' is not assignable to parameter of type '"p"'.
        a.ts(12,22): error TS2345: Argument of type '((x: any) => any)[]' is not assignable to parameter of type '{ [x: string]: {}; }'.
          Index signature for type 'string' is missing in type '((x: any) => any)[]'.
        a.ts(12,23): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(14,21): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(14,21): error TS2345: Argument of type '(x: any) => any' is not assignable to parameter of type '{ [k: string]: unknown; }'.
          Index signature for type 'string' is missing in type '(x: any) => any'.
        a.ts(14,29): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(15,21): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(15,21): error TS2345: Argument of type '(x: any) => any' is not assignable to parameter of type '{ [k: string]: 1; }'.
          Index signature for type 'string' is missing in type '(x: any) => any'.
        a.ts(16,21): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(16,21): error TS2345: Argument of type '(x: any) => any' is not assignable to parameter of type '{ [k: string]: (x: number) => number; }'.
          Index signature for type 'string' is missing in type '(x: any) => any'.
        a.ts(17,26): error TS7006: Parameter 'x' implicitly has an 'any' type."
      `);
      expect(exitCode).toBe(1);
    });

    test("an argument beyond the elements of a rest tuple", async () => {
      using dir = project({
        "a.ts": `declare function f0(): void;
declare function f1(a: number): void;
declare function f2(cb: (x: number) => void): void;
declare function f3(cb: (x: number, y: string) => void): void;
declare function f4(a: string): void; declare function f4(cb: (x: number) => void): void;
declare function f5(a: () => void): void;
declare function f6(a: { p: (x: number) => void }): void;
f0.call(undefined, 1, x => x);
f1.call(undefined, 1, x => x);
f2.call(undefined, 1, x => x);
f3.call(undefined, 1, x => x);
f4.call(undefined, 1, x => x);
f5.call(undefined, 1, x => x);
f6.call(undefined, 1, x => x);
f2.call(undefined, x => x, x => x);
f2.call(undefined, x => x, 1, y => y);
f2.bind(undefined, 1, x => x);
f2.apply(undefined, [1, x => x]);
f2(1, x => x);
f1(1, x => x);
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(8,20): error TS2554: Expected 1 arguments, but got 3.
        a.ts(8,23): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(9,23): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(9,23): error TS2554: Expected 2 arguments, but got 3.
        a.ts(10,23): error TS2554: Expected 2 arguments, but got 3.
        a.ts(11,23): error TS2554: Expected 2 arguments, but got 3.
        a.ts(12,23): error TS2554: Expected 2 arguments, but got 3.
        a.ts(13,23): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(13,23): error TS2554: Expected 2 arguments, but got 3.
        a.ts(14,23): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(14,23): error TS2554: Expected 2 arguments, but got 3.
        a.ts(15,28): error TS2554: Expected 2 arguments, but got 3.
        a.ts(16,28): error TS2554: Expected 2 arguments, but got 4.
        a.ts(17,23): error TS2554: Expected 2 arguments, but got 3.
        a.ts(18,22): error TS2322: Type 'number' is not assignable to type '(x: number) => void'.
        a.ts(18,25): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(19,7): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(19,7): error TS2554: Expected 1 arguments, but got 2.
        a.ts(20,7): error TS7006: Parameter 'x' implicitly has an 'any' type.
        a.ts(20,7): error TS2554: Expected 1 arguments, but got 2."
      `);
      expect(exitCode).toBe(1);
    });

    test("an enum against a weak type", async () => {
      using dir = project({
        "a.ts": `enum E { A, B } enum SE { A = "a", B = "b" } enum One { A }
declare const e: E; declare const se: SE; declare const b: boolean; declare const one: One; declare const u: 1 | 2; declare const eb: E | boolean;
export const w1: { p?: number } = e;
export const w2: { p?: number } = se;
export const w3: { p?: number } = b;
export const w4: { p?: number } = one;
export const w5: { p?: number } = u;
export const w6: { p?: number } = eb;
export const w7: { p?: number } = E.A;
export const w8: { toFixed?: number } = e;
export const w9: Partial<{ p: number }> = e;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,14): error TS2559: Type 'E' has no properties in common with type '{ p?: number | undefined; }'.
        a.ts(4,14): error TS2559: Type 'SE' has no properties in common with type '{ p?: number | undefined; }'.
        a.ts(5,14): error TS2559: Type 'boolean' has no properties in common with type '{ p?: number | undefined; }'.
        a.ts(6,14): error TS2559: Type 'One' has no properties in common with type '{ p?: number | undefined; }'.
        a.ts(7,14): error TS2322: Type 'number' is not assignable to type '{ p?: number | undefined; }'.
          Type '1' has no properties in common with type '{ p?: number | undefined; }'.
        a.ts(8,14): error TS2322: Type 'boolean | E' is not assignable to type '{ p?: number | undefined; }'.
          Type 'false' has no properties in common with type '{ p?: number | undefined; }'.
        a.ts(9,14): error TS2559: Type 'E.A' has no properties in common with type '{ p?: number | undefined; }'.
        a.ts(10,14): error TS2322: Type 'E' is not assignable to type '{ toFixed?: number | undefined; }'.
        a.ts(11,14): error TS2559: Type 'E' has no properties in common with type 'Partial<{ p: number; }>'."
      `);
      expect(exitCode).toBe(1);
    });

    test("the minimum argument count of a union of signatures", async () => {
      using dir = project({
        "a.ts": `declare const ar: number[];
declare const g1: ((...a: number[]) => 5) | ((a: string) => 2);
declare const g2: ((a: string) => 2) | ((...a: number[]) => 5);
declare const g3: ((a: number, ...r: string[]) => 16) | (<T, U>(a: T, b: U) => [T, U]);
declare const g4: ((...a: number[]) => 5) | ((a: number, b: number) => 2);
declare const g5: ((...a: number[]) => 5) | ((a?: number) => 2);
declare const g6: ((...a: number[]) => 5) | ((a: number) => 2) | ((a: number, b: number) => 3);
g1();
g2();
g3(1);
g4();
g4(1);
g5();
g6();
g6(1);
g1(...ar);
g2(...ar);
g4(...ar);
export const t1: never = g1; export const p1: Parameters<typeof g1> = null!; export const q1: never = p1;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(8,1): error TS2555: Expected at least 1 arguments, but got 0.
        a.ts(9,1): error TS2555: Expected at least 1 arguments, but got 0.
        a.ts(10,1): error TS2555: Expected at least 2 arguments, but got 1.
        a.ts(11,1): error TS2554: Expected 2 arguments, but got 0.
        a.ts(12,1): error TS2554: Expected 2 arguments, but got 1.
        a.ts(14,1): error TS2554: Expected 2 arguments, but got 0.
        a.ts(15,1): error TS2554: Expected 2 arguments, but got 1.
        a.ts(16,4): error TS2556: A spread argument must either have a tuple type or be passed to a rest parameter.
        a.ts(17,4): error TS2556: A spread argument must either have a tuple type or be passed to a rest parameter.
        a.ts(18,4): error TS2556: A spread argument must either have a tuple type or be passed to a rest parameter.
        a.ts(19,14): error TS2322: Type '((...a: number[]) => 5) | ((a: string) => 2)' is not assignable to type 'never'.
          Type '(...a: number[]) => 5' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("the minimum argument count of a union of three signatures", async () => {
      using dir = project({
        "a.ts": `declare const ar: number[]; declare const nv: never[];
declare const h1: ((...a: number[]) => 1) | ((a: string) => 2);
declare const h2: ((...a: number[]) => 1) | ((a: string) => 2) | ((...b: boolean[]) => 3);
declare const h3: ((x: number, ...a: number[]) => 1) | ((x: number, y: string) => 2);
declare const h4: ((...a: number[]) => 1) | ((a?: string) => 2);
declare const h5: ((...a: number[]) => 1) | ((a: string | void) => 2);
declare const h6: (new (...a: number[]) => { p: 1 }) | (new (a: string) => { q: 2 });
declare const h7: { m(...a: number[]): 1 } | { m(a: string): 2 };
declare const h8: ((...a: number[]) => 1) | ((a: string) => 2) | ((a: boolean, b: boolean) => 3);
declare const h9: ((...a: { p: 1 }[]) => 1) | ((a: { q: 2 }) => 2);
h1(); h1(...nv); h1(...ar);
h2(); h2(...nv);
h3(1); h3(1, ...nv);
h4(); h4(...nv);
h5(); h5(...nv);
new h6(); new h6(...nv);
h7.m(); h7.m(...nv);
h8(); h8(null!); h8(null!, null!);
h9(); h9({ p: 1, q: 2 }); h9({ p: 1, q: 2 }, { p: 1, q: 2 }); h9({ p: 1, q: 2 }, { p: 1 });
export const t1: () => void = h1; export const t2: (a: never) => void = h1; export const t3: (...a: never[]) => void = h1;
export const n1: never = h1; export const p1: Parameters<typeof h1> = null!; export const q1: never = p1;
export const u1: typeof h9 extends (...a: infer P) => unknown ? P : 0 = null!; export const v1: never = u1;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(11,1): error TS2555: Expected at least 1 arguments, but got 0.
        a.ts(11,10): error TS2556: A spread argument must either have a tuple type or be passed to a rest parameter.
        a.ts(11,21): error TS2556: A spread argument must either have a tuple type or be passed to a rest parameter.
        a.ts(12,1): error TS2555: Expected at least 1 arguments, but got 0.
        a.ts(12,10): error TS2556: A spread argument must either have a tuple type or be passed to a rest parameter.
        a.ts(13,1): error TS2555: Expected at least 2 arguments, but got 1.
        a.ts(13,14): error TS2556: A spread argument must either have a tuple type or be passed to a rest parameter.
        a.ts(15,1): error TS2555: Expected at least 1 arguments, but got 0.
        a.ts(15,10): error TS2556: A spread argument must either have a tuple type or be passed to a rest parameter.
        a.ts(16,1): error TS2555: Expected at least 1 arguments, but got 0.
        a.ts(16,18): error TS2556: A spread argument must either have a tuple type or be passed to a rest parameter.
        a.ts(17,4): error TS2555: Expected at least 1 arguments, but got 0.
        a.ts(17,14): error TS2556: A spread argument must either have a tuple type or be passed to a rest parameter.
        a.ts(18,1): error TS2555: Expected at least 2 arguments, but got 0.
        a.ts(18,7): error TS2555: Expected at least 2 arguments, but got 1.
        a.ts(19,1): error TS2555: Expected at least 1 arguments, but got 0.
        a.ts(19,82): error TS2345: Argument of type '{ p: 1; }' is not assignable to parameter of type '{ p: 1; } & { q: 2; }'.
          Property 'q' is missing in type '{ p: 1; }' but required in type '{ q: 2; }'.
        a.ts(20,14): error TS2322: Type '((...a: number[]) => 1) | ((a: string) => 2)' is not assignable to type '() => void'.
          Type '(a: string) => 2' is not assignable to type '() => void'.
            Target signature provides too few arguments. Expected 1 or more, but got 0.
        a.ts(21,14): error TS2322: Type '((...a: number[]) => 1) | ((a: string) => 2)' is not assignable to type 'never'.
          Type '(...a: number[]) => 1' is not assignable to type 'never'.
        a.ts(22,93): error TS2322: Type '{ p: 1; }[] & [a: { q: 2; }]' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an error at a parenthesized argument that could be called", async () => {
      using dir = project({
        "a.ts": `enum E { A, B } enum SE { A = "a" } declare class C { c: 1 }
declare function two<B>(a: B, b: B): B;
two(E.A, (() => 1));
two(E.A, () => 1);
two(1, (() => 1));
two(SE.A, (() => 1));
two("a", (() => 1));
two(E.A, ((x: number) => x));
two(E.A, (function () { return 1; }));
two(E.A, (new C()));
two((() => 1), E.A);
two(E.A, (() => 1)!);
two(E.A, (() => 1) satisfies unknown);
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,11): error TS2345: Argument of type '() => number' is not assignable to parameter of type 'E.A'.
        a.ts(4,10): error TS2345: Argument of type '() => number' is not assignable to parameter of type 'E.A'.
        a.ts(5,9): error TS2345: Argument of type '() => number' is not assignable to parameter of type '1'.
        a.ts(6,12): error TS2345: Argument of type '() => number' is not assignable to parameter of type 'SE.A'.
        a.ts(7,11): error TS2345: Argument of type '() => number' is not assignable to parameter of type '"a"'.
        a.ts(8,11): error TS2345: Argument of type '(x: number) => number' is not assignable to parameter of type 'E.A'.
        a.ts(9,11): error TS2345: Argument of type '() => number' is not assignable to parameter of type 'E.A'.
        a.ts(10,11): error TS2345: Argument of type 'C' is not assignable to parameter of type 'E.A'.
        a.ts(11,16): error TS2345: Argument of type 'E' is not assignable to parameter of type '() => 1'.
        a.ts(12,10): error TS2345: Argument of type '() => number' is not assignable to parameter of type 'E.A'.
        a.ts(13,11): error TS2345: Argument of type '() => number' is not assignable to parameter of type 'E.A'."
      `);
      expect(exitCode).toBe(1);
    });

    test("the order of instantiated generic functions in a union", async () => {
      using dir = project({
        "a.ts": `declare function box<T>(v: T): { v: T };
declare function wrap<T>(x: T): { w: T };
declare function len<T extends { length: number }>(x: T): number;
declare function fns<A, B>(fs: ((a: A) => B)[]): [A, B];
export const r1 = fns([wrap, box]);
export const r2 = fns([box, wrap]);
export const r3 = fns([box, async x => x]);
export const r4 = fns([async x => x, box]);
export const r5 = fns([len, x => wrap(x)]);
export const r6 = fns([x => ({ x }), box]);
export const u1 = [wrap, box]; export const s1: never = u1;
declare function pick<F>(a: F, b: F): F;
export const p1: ((a: number) => unknown)[] = [wrap, box]; 
export const c1 = (c: boolean) => { const f: (a: number) => unknown = c ? wrap : box; return f; };
declare function un<B>(f: ((a: number) => B)): B;
declare const cond: boolean;
export const r7 = un(cond ? wrap : box); export const s7: never = r7;
export const r8 = un(cond ? box : wrap); export const s8: never = r8;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(5,24): error TS2322: Type '<T>(x: T) => { w: T; }' is not assignable to type '(a: unknown) => { v: unknown; }'.
          Property 'v' is missing in type '{ w: unknown; }' but required in type '{ v: unknown; }'.
        a.ts(6,29): error TS2322: Type '<T>(x: T) => { w: T; }' is not assignable to type '(a: unknown) => { v: unknown; }'.
          Property 'v' is missing in type '{ w: unknown; }' but required in type '{ v: unknown; }'.
        a.ts(7,40): error TS2741: Property 'v' is missing in type 'Promise<unknown>' but required in type '{ v: unknown; }'.
        a.ts(8,35): error TS2741: Property 'v' is missing in type 'Promise<unknown>' but required in type '{ v: unknown; }'.
        a.ts(9,24): error TS2322: Type '<T extends { length: number; }>(x: T) => number' is not assignable to type '(a: unknown) => number'.
          Types of parameters 'x' and 'a' are incompatible.
            Type 'unknown' is not assignable to type '{ length: number; }'.
        a.ts(9,34): error TS2322: Type '{ w: unknown; }' is not assignable to type 'number'.
        a.ts(10,29): error TS2741: Property 'v' is missing in type '{ x: unknown; }' but required in type '{ v: unknown; }'.
        a.ts(11,45): error TS2322: Type '((<T>(v: T) => { v: T; }) | (<T>(x: T) => { w: T; }))[]' is not assignable to type 'never'.
        a.ts(17,22): error TS2345: Argument of type '(<T>(v: T) => { v: T; }) | (<T>(x: T) => { w: T; })' is not assignable to parameter of type '(a: number) => { v: number; }'.
          Type '<T>(x: T) => { w: T; }' is not assignable to type '(a: number) => { v: number; }'.
            Property 'v' is missing in type '{ w: number; }' but required in type '{ v: number; }'.
        a.ts(17,55): error TS2322: Type 'unknown' is not assignable to type 'never'.
        a.ts(18,22): error TS2345: Argument of type '(<T>(v: T) => { v: T; }) | (<T>(x: T) => { w: T; })' is not assignable to parameter of type '(a: number) => { v: number; }'.
          Type '<T>(x: T) => { w: T; }' is not assignable to type '(a: number) => { v: number; }'.
            Property 'v' is missing in type '{ w: number; }' but required in type '{ v: number; }'.
        a.ts(18,55): error TS2322: Type 'unknown' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a class that extends a union of constructors", async () => {
      using dir = project({
        "a.ts": `declare class C { p: number } declare class E { q: string }
declare const k1: (new () => C) | (new () => E);
declare const k2: typeof C | typeof E;
declare const k3: (new () => C) | (new () => C);
declare const k4: (new () => C) | null;
export class Q1 extends k1 {}
export class Q2 extends k2 {}
export class Q3 extends k3 {}
export class Q4 extends k4 {}
export const r1: never = new Q1(); export const p1: never = new Q1().p;
export class Q5 extends k1 { constructor() { super(); const t: never = this; } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(9,25): error TS2507: Type '(new () => C) | null' is not a constructor function type.
        a.ts(10,14): error TS2322: Type 'Q1' is not assignable to type 'never'.
        a.ts(10,49): error TS2322: Type 'any' is not assignable to type 'never'.
        a.ts(10,70): error TS2339: Property 'p' does not exist on type 'Q1'.
        a.ts(11,61): error TS2322: Type 'this' is not assignable to type 'never'.
          Type 'Q5' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("`call` and `apply` of an intersection of a function and a constructor", async () => {
      using dir = project({
        "a.ts": `declare class C { p: number }
interface IC { new (a: number): C } interface IF { (a: number): number }
declare const k1: IC & IF; declare const k2: IF & IC; declare const k3: { new (a: number): C; (a: number): number };
export const r1: never = k1.call(null, 1);
export const r2: never = k2.call(null, 1);
export const r3: never = k3.call(null, 1);
export const r4: never = k1.call;
export const r5: never = k1.bind(null);
export const r6: never = k1.apply(null, [1]);
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(4,14): error TS2322: Type 'void' is not assignable to type 'never'.
        a.ts(5,14): error TS2322: Type 'number' is not assignable to type 'never'.
        a.ts(6,14): error TS2322: Type 'number' is not assignable to type 'never'.
        a.ts(7,14): error TS2322: Type '(<T, A extends any[]>(this: new (...args: A) => T, thisArg: T, ...args: A) => void) & (<T, A extends any[], R>(this: (this: T, ...args: A) => R, thisArg: T, ...args: A) => R)' is not assignable to type 'never'.
        a.ts(8,14): error TS2322: Type 'IC & IF' is not assignable to type 'never'.
        a.ts(9,14): error TS2322: Type 'void' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a member of `Function` or `Object` on an intersection", async () => {
      using dir = project({
        "a.ts": `interface IF { (a: number): number } interface IC { new (a: number): {} }
declare const k4: { a: 1 } & IF;
export const r1: never = k4.toString;
export const r2: never = k4.call;
export const r3: never = k4.hasOwnProperty;
declare const k5: IC & IF;
export const r4: never = k5.toString;
export const r5: never = k5.length;
export const r6: never = k5.hasOwnProperty;
declare const k6: { a: 1 } & { b: 2 };
export const r7: never = k6.toString;
declare const k7: IF & { a: 1 };
export const r8: never = k7.toString;
export const r9: never = k5.apply;
export const r10: never = k5.bind;
export const r11: { call: 1 } = k5;
export const r12: { toString: 1 } = k4;
export function g<T extends IC & IF>(t: T) { const r13: never = t.call(null, 1); const r14: never = t.call; }
export const r15: never = (null! as (IC | IF) & { a: 1 }).call;
export const r16: keyof typeof k5 = null!; export const r17: never = r16;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,14): error TS2322: Type '(() => string) & (() => string)' is not assignable to type 'never'.
        a.ts(4,14): error TS2322: Type '<T, A extends any[], R>(this: (this: T, ...args: A) => R, thisArg: T, ...args: A) => R' is not assignable to type 'never'.
        a.ts(5,14): error TS2322: Type '(v: PropertyKey) => boolean' is not assignable to type 'never'.
        a.ts(7,14): error TS2322: Type '() => string' is not assignable to type 'never'.
        a.ts(8,14): error TS2322: Type 'number' is not assignable to type 'never'.
        a.ts(9,14): error TS2322: Type '(v: PropertyKey) => boolean' is not assignable to type 'never'.
        a.ts(11,14): error TS2322: Type '() => string' is not assignable to type 'never'.
        a.ts(13,14): error TS2322: Type '(() => string) & (() => string)' is not assignable to type 'never'.
        a.ts(14,14): error TS2322: Type '{ <T>(this: new () => T, thisArg: T): void; <T, A extends any[]>(this: new (...args: A) => T, thisArg: T, args: A): void; } & { <T, R>(this: (this: T) => R, thisArg: T): R; <T, A extends any[], R>(this: (this: T, ...args: A) => R, thisArg: T, args: A): R; }' is not assignable to type 'never'.
        a.ts(15,14): error TS2322: Type '{ <T>(this: T, thisArg: any): T; <A extends any[], B extends any[], R>(this: new (...args: [...A, ...B]) => R, thisArg: any, ...args: A): new (...args: B) => R; } & { <T>(this: T, thisArg: ThisParameterType<T>): OmitThisParameter<...>; <T, A extends any[], B extends any[], R>(this: (this: T, ...args: [......]) => R,...' is not assignable to type 'never'.
        a.ts(16,14): error TS2322: Type 'IC & IF' is not assignable to type '{ call: 1; }'.
          Types of property 'call' are incompatible.
            Type '(<T, A extends any[]>(this: new (...args: A) => T, thisArg: T, ...args: A) => void) & (<T, A extends any[], R>(this: (this: T, ...args: A) => R, thisArg: T, ...args: A) => R)' is not assignable to type '1'.
        a.ts(17,14): error TS2322: Type '{ a: 1; } & IF' is not assignable to type '{ toString: 1; }'.
          Types of property 'toString' are incompatible.
            Type '(() => string) & (() => string)' is not assignable to type '1'.
        a.ts(18,52): error TS2322: Type 'void' is not assignable to type 'never'.
        a.ts(18,88): error TS2322: Type '(<T, A extends any[]>(this: new (...args: A) => T, thisArg: T, ...args: A) => void) & (<T, A extends any[], R>(this: (this: T, ...args: A) => R, thisArg: T, ...args: A) => R)' is not assignable to type 'never'.
        a.ts(19,14): error TS2322: Type '(<T, A extends any[], R>(this: (this: T, ...args: A) => R, thisArg: T, ...args: A) => R) | (<T, A extends any[]>(this: new (...args: A) => T, thisArg: T, ...args: A) => void)' is not assignable to type 'never'.
          Type '<T, A extends any[], R>(this: (this: T, ...args: A) => R, thisArg: T, ...args: A) => R' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("the elaboration of a callback parameter of an instantiated signature", async () => {
      using dir = project({
        "a.ts": `declare const s1: <T>(a: T, b: T) => T;
export const t1: <A, B, C>(f: (a: A) => B, g: (b: B) => C) => (a: A) => C = s1;
declare const s2: <T>(b: T) => void;
export const t2: <A, B>(g: (b: B) => A) => void = s2;
declare const s3: <T>(a: T, b: T) => void;
export const t3: (f: (a: number) => void, g: (b: string) => void) => void = s3;
declare function s4<T>(a: T, b: T): void;
export const t4: (f: (a: number) => void, g: (b: string) => void) => void = s4;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,14): error TS2322: Type '<T>(a: T, b: T) => T' is not assignable to type '<A, B, C>(f: (a: A) => B, g: (b: B) => C) => (a: A) => C'.
          Types of parameters 'b' and 'g' are incompatible.
            Type '(b: B) => C' is not assignable to type '(a: A) => B'.
              Types of parameters 'b' and 'a' are incompatible.
                Type 'A' is not assignable to type 'B'.
                  'B' could be instantiated with an arbitrary type which could be unrelated to 'A'.
        a.ts(6,14): error TS2322: Type '<T>(a: T, b: T) => void' is not assignable to type '(f: (a: number) => void, g: (b: string) => void) => void'.
          Types of parameters 'b' and 'g' are incompatible.
            Type '(b: string) => void' is not assignable to type '(a: number) => void'.
              Types of parameters 'b' and 'a' are incompatible.
                Type 'number' is not assignable to type 'string'.
        a.ts(8,14): error TS2322: Type '<T>(a: T, b: T) => void' is not assignable to type '(f: (a: number) => void, g: (b: string) => void) => void'.
          Types of parameters 'b' and 'g' are incompatible.
            Type '(b: string) => void' is not assignable to type '(a: number) => void'.
              Types of parameters 'b' and 'a' are incompatible.
                Type 'number' is not assignable to type 'string'."
      `);
      expect(exitCode).toBe(1);
    });

    test("the instantiation depth limit in an assignment, a declaration and a `return`", async () => {
      using dir = project({
        "a.ts": `// The DEPTH limit, reached by a comparison that no expression check encloses on our side. One module for each position: tsgo reports the limit once for each type.
type W<T, N extends 0[] = []> = T extends string ? (N["length"] extends 120 ? T : W<T, [...N, 0]> | N["length"]) : never;
interface A<T> { x: W<T> }
interface B<T> { x: W<T>; y: 1 }
export function f(a: A<string>, b: B<string>) { a = b; }
`,
        "b.ts": `// The DEPTH limit, reached by a comparison that no expression check encloses on our side. One module for each position: tsgo reports the limit once for each type.
type W<T, N extends 0[] = []> = T extends string ? (N["length"] extends 120 ? T : W<T, [...N, 0]> | N["length"]) : never;
interface A<T> { x: W<T> }
interface B<T> { x: W<T>; y: 1 }
export function f(b: B<string>) { const a: A<string> = b; return a; }
`,
        "c.ts": `// The DEPTH limit, reached by a comparison that no expression check encloses on our side. One module for each position: tsgo reports the limit once for each type.
type W<T, N extends 0[] = []> = T extends string ? (N["length"] extends 120 ? T : W<T, [...N, 0]> | N["length"]) : never;
interface A<T> { x: W<T> }
interface B<T> { x: W<T>; y: 1 }
export function f(b: B<string>): A<string> { return b; }
`,
        "d.ts": `// The DEPTH limit, reached by a comparison that no expression check encloses on our side. One module for each position: tsgo reports the limit once for each type.
type W<T, N extends 0[] = []> = T extends string ? (N["length"] extends 120 ? T : W<T, [...N, 0]> | N["length"]) : never;
interface A<T> { x: W<T> }
interface B<T> { x: W<T>; y: 1 }
export function f(b: B<string>) { function g(a: A<string>) {} g(b); }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(5,49): error TS2589: Type instantiation is excessively deep and possibly infinite.
        b.ts(5,41): error TS2589: Type instantiation is excessively deep and possibly infinite.
        c.ts(5,46): error TS2589: Type instantiation is excessively deep and possibly infinite.
        d.ts(5,63): error TS2589: Type instantiation is excessively deep and possibly infinite."
      `);
      expect(exitCode).toBe(1);
    });

    test("default type arguments that need a member of a union that is being resolved", async () => {
      using dir = project({
        "a.ts": `// A conversion from validators to schemas, both recursive. The key of a record is a union of ten, so each level has ten \`SRec\` references.
type Opt = "o" | "r";
declare abstract class VBase<T, O extends Opt = "r"> { readonly type: T; readonly isOptional: O; }
declare class VK0<T, O extends Opt = "r"> extends VBase<T, O> { readonly kind: "k0"; } declare class VK1<T, O extends Opt = "r"> extends VBase<T, O> { readonly kind: "k1"; } declare class VK2<T, O extends Opt = "r"> extends VBase<T, O> { readonly kind: "k2"; } declare class VK3<T, O extends Opt = "r"> extends VBase<T, O> { readonly kind: "k3"; } declare class VK4<T, O extends Opt = "r"> extends VBase<T, O> { readonly kind: "k4"; } declare class VK5<T, O extends Opt = "r"> extends VBase<T, O> { readonly kind: "k5"; } declare class VK6<T, O extends Opt = "r"> extends VBase<T, O> { readonly kind: "k6"; } declare class VK7<T, O extends Opt = "r"> extends VBase<T, O> { readonly kind: "k7"; } declare class VK8<T, O extends Opt = "r"> extends VBase<T, O> { readonly kind: "k8"; }
declare class VRec<T, K extends V<string, "r">, E extends V<any, "r">, O extends Opt = "r"> extends VBase<T, O> { readonly key: K; readonly value: E; readonly kind: "rec"; }
declare class VObj<T, F extends Record<string, GV>, O extends Opt = "r"> extends VBase<T, O> { readonly fields: F; readonly kind: "obj"; }
declare class VUni<T, M extends V<any, "r">[], O extends Opt = "r"> extends VBase<T, O> { readonly members: M; readonly kind: "u"; }
type V<T, O extends Opt = "r"> = VK0<T, O> | VK1<T, O> | VK2<T, O> | VK3<T, O> | VK4<T, O> | VK5<T, O> | VK6<T, O> | VK7<T, O> | VK8<T, O> | VObj<T, Record<string, V<any, Opt>>, O> | VRec<T, V<string, "r">, V<any, "r">, O> | VUni<T, V<any, "r">[], O>;
type GV = V<any, any>;
declare abstract class Schema<Out = any> { readonly _output: Out; }
declare class SStr extends Schema<string> { s: 1; }
declare class SId<N extends string> extends Schema<N> { n: N; }
declare class SRec<K extends Schema<string | number | symbol>, E extends Schema> extends Schema<Record<K["_output"], E["_output"]>> { k: K; e: E; }
type ReqKeys<T extends object> = { [k in keyof T]: undefined extends T[k] ? never : k }[keyof T];
type OptKeys<T extends object> = { [k in keyof T]: undefined extends T[k] ? k : never }[keyof T];
type AddQ<T extends object> = { [K in ReqKeys<T>]: T[K] } & { [K in OptKeys<T>]?: T[K] } & { [k in keyof T]?: unknown };
type Flatten<T> = { [k in keyof T]: T[k] };
type ObjOut<S extends Record<string, Schema>> = Flatten<AddQ<{ [k in keyof S]: S[k]["_output"] }>>;
declare class SObj<T extends Record<string, Schema>, Out = ObjOut<T>> extends Schema<Out> { shape: T; }
declare class SOpt<T extends Schema> extends Schema<T["_output"] | undefined> { t: T; }
declare class SUni<T extends readonly [Schema, ...Schema[]]> extends Schema<T[number]["_output"]> { o: T; }
type Base<X extends GV> =
  X extends VObj<any, infer F, any> ? SObj<{ [K in keyof F]: From<F[K]> }> :
  X extends VRec<any, infer K, infer E, any> ? K extends VK0<infer N extends string> ? SRec<SId<N>, From<E>> : SRec<SStr, From<E>>
  : X extends VUni<any, [infer A extends GV, infer B extends GV, ...infer Rest extends GV[]], any> ? SUni<[From<A>, From<B>, ...{ [I in keyof Rest]: From<Rest[I]> }]>
  : Schema;
export type From<X extends GV> = X extends V<any, "o"> ? SOpt<Base<X>> : Base<X>;
export function convert<X extends GV>(schema: Schema): From<X> { return schema as From<X>; }
declare function conv<X extends GV>(validator: X): From<X>;
declare function arr<T extends Schema>(schema: T): T[];
declare const element: any;
export const converted = arr(conv(element));
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    });

    test("`this` types in the JSDoc comments of a class", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "a.js": `// VALID: tsgo reports nothing in this file but the three lines marked
export class A {
  /** @type {this | undefined} */
  first = undefined;
  m() {}
  /** @type {() => this} */
  afterMethod = () => this;
  static s = 1;
  /** @type {this[]} */
  afterStatic = [];
  /** @returns {this} */
  arrow = () => this;
  /** @type {this | undefined} */
  #hidden = undefined;
  /** @satisfies {this | undefined} */
  satisfied = undefined;
  constructor() {
    /** @type {this | undefined} */
    this.inConstructor = undefined;
    /** @returns {this} */
    this.arrowInConstructor = () => this;
  }
}
export class B {
  p = 1;
  /** @type {this | undefined} */
  static afterProperty = undefined; // TS2526
  /** @type {this | undefined} */
  static afterStatic = undefined; // TS2526
  /** @param {this} a */
  constructor(a) {} // TS2526
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.js(26,14): error TS2526: A 'this' type is available only in a non-static member of a class or interface.
        a.js(28,14): error TS2526: A 'this' type is available only in a non-static member of a class or interface.
        a.js(30,15): error TS2526: A 'this' type is available only in a non-static member of a class or interface."
      `);
      expect(exitCode).toBe(1);
    });

    test("two `@type` tags on one assignment", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "a.js": `export {};
// V2: of two @type tags on an assignment the LAST one counts (SetType without a test), on a declaration the first
class V2 {
  constructor() {
    /** @type {string} @type {number} */
    this.p = 1;
  }
  /** @type {string} @type {number} */
  q = 1;
}
function v2() {}
/** @type {string} @type {number} */
v2.p = 1;
/** @type {string} @type {number} */
const v2c = 1;
const v2o = {
  /** @type {string} @type {number} */
  p: 1,
};
// V3: @readonly on a getter does not make the property read-only
class V3 {
  /** @readonly */
  get p() { return 1; }
  set p(v) {}
  /** @readonly */
  get q() { return 1; }
}
new V3().p = 2;
new V3().q = 2;
const v3 = {
  /** @readonly */
  get p() { return 1; },
  set p(v) {},
};
v3.p = 2;
// V4: \`typeof missing1\` in a type that nothing asks for, where a similar name exists
const missing = 1;
function V4() {
  /** @type {typeof missing1} */
  this.p = 1;
  /** @type {Missing2} */
  this.q = 1;
}
/** @type {typeof missing3} */
V4.prototype.p = 1;
class V4c {
  get p() { return 1; }
  /** @type {typeof missing4} */
  set p(v) {}
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.js(5,25): error TS1223: 'type' tag already specified.
        a.js(8,23): error TS1223: 'type' tag already specified.
        a.js(9,3): error TS2322: Type 'number' is not assignable to type 'string'.
        a.js(12,21): error TS1223: 'type' tag already specified.
        a.js(14,21): error TS1223: 'type' tag already specified.
        a.js(15,7): error TS2322: Type 'number' is not assignable to type 'string'.
        a.js(17,23): error TS1223: 'type' tag already specified.
        a.js(18,3): error TS2322: Type 'number' is not assignable to type 'string'.
        a.js(22,7): error TS1024: 'readonly' modifier can only appear on a property declaration or index signature.
        a.js(25,7): error TS1024: 'readonly' modifier can only appear on a property declaration or index signature.
        a.js(29,10): error TS2540: Cannot assign to 'q' because it is a read-only property.
        a.js(40,3): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.
        a.js(42,3): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation."
      `);
      expect(exitCode).toBe(1);
    });

    test("`@extends`, `@this` and `@typedef` tags in unusual places", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "a.js": `export {};
/** @template T */ class G0 { /** @param {T} v */ constructor(v) { this.v = v; } }
class B0 {}
// C1: \`new\` on a function with @this
/** @this {{ k: string }} */
function C1(v) { this.v = v; }
new C1();
new C1(1);
// C2: TS8023 for the first @extends only
/** @extends {G0<string>} @extends {G0<number>} */
class C2 extends B0 {}
// T1: a dotted typedef name in a class body
class T1 {
  /** @typedef {string} Ns.T */
  m() {}
}
// T2: \`string=\` and \`...string\` as the type of a typedef do not name the alias
/** @typedef {string=} T2a */
/** @typedef {...string} T2b */
/** @typedef {?string} T2c */
const /** @type {T2a} */ t2a = { a: 1 };
const /** @type {T2b} */ t2b = { a: 1 };
const /** @type {T2c} */ t2c = { a: 1 };
// K2: \`satisfies const\` under \`as const\`
const k2a = /** @type {const} */ (/** @satisfies {const} */ (1));
const k2b = /** @satisfies {const} @type {const} */ (1);
const k2c = /** @satisfies {const} */ (1);
const k2d = /** @type {const} */ (/** @satisfies {Missing} */ (1));
`,
        "k1.js": `// K1: \`await\` in an arrow function that is not async, in an async function
export async function w() { const f = () => (await { a: 1 }); }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "k1.js(2,52): error TS1005: ')' expected.
        k1.js(2,57): error TS1003: Identifier expected.
        k1.js(2,59): error TS1005: ':' expected.
        k1.js(2,60): error TS1005: ',' expected."
      `);
      expect(exitCode).toBe(1);
    });

    test("a `this` parameter of type `typeof this`", async () => {
      using dir = project({
        "a.ts": `declare const any0: any;
// a \`this\` parameter whose type refers to \`this\`
export class A { k = 1; p(this: typeof this) { return this; } q(this: typeof this.k) { return this; } }
// a base expression whose type refers to the class
export class C extends (any0 as InstanceType<typeof C>) {}
// both accessibility modifiers on a constructor: both errors at \`new\`
export class D2 { private protected constructor() {} }
new D2();
// \`readonly\` on a getter that has a setter
export class V3 { readonly get p() { return 1; } set p(v) {} }
new V3().p = 2;
// a type predicate about a name that is no parameter is printed as written
export function d6(a: string): x is string { return true; }
export const d6r: never = d6;
// \`typeof a\` as the return type of an arrow function in a property is printed as written
export class D7 { m = (a: string): typeof a => a; }
export const d7s: never = new D7().m;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,27): error TS2502: 'this' is referenced directly or indirectly in its own type annotation.
        a.ts(3,65): error TS2502: 'this' is referenced directly or indirectly in its own type annotation.
        a.ts(5,14): error TS2310: Type 'C' recursively references itself as a base type.
        a.ts(5,14): error TS2506: 'C' is referenced directly or indirectly in its own base expression.
        a.ts(7,27): error TS1028: Accessibility modifier already seen.
        a.ts(8,1): error TS2673: Constructor of class 'D2' is private and only accessible within the class declaration.
        a.ts(8,1): error TS2674: Constructor of class 'D2' is protected and only accessible within the class declaration.
        a.ts(10,19): error TS1024: 'readonly' modifier can only appear on a property declaration or index signature.
        a.ts(13,32): error TS1225: Cannot find parameter 'x'.
        a.ts(14,14): error TS2322: Type '(a: string) => x is string' is not assignable to type 'never'.
        a.ts(17,14): error TS2322: Type '(a: string) => typeof a' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an export that `Object.defineProperty` defines stays read-only", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "d.js": `const v = 1;
Object.defineProperty(exports, "v", { value: v });
Object.defineProperty(exports, "w", { value: v, writable: true });
`,
        "f.js": `function f() {}
module.exports = f;
module.exports.v = 1;
`,
        "u.js": `/** @import * as mf from "./f" */
const md = await import("./d");
const /** @type {never} */ r1 = md;
const md2 = require("./d");
const /** @type {never} */ r2 = md2;
/** @type {typeof mf.missing} */
const r3 = 1;
const mf2 = await import("./f");
const /** @type {never} */ r4 = mf2;
export {};
`,
        "w.js": `const md = await import("./d");
md.v = 2;
md.w = 2;
const sp = { ...require("./d") };
sp.v = 2;
require("./d").v = 2;
export {};
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "f.js(2,1): error TS2309: An export assignment cannot be used in a module with other exported elements.
        f.js(3,16): error TS2339: Property 'v' does not exist on type '() => void'.
        u.js(3,28): error TS2322: Type '{ readonly v: number; w: number; default: typeof import("<dir>/d"); }' is not assignable to type 'never'.
        u.js(5,28): error TS2322: Type 'typeof import("<dir>/d")' is not assignable to type 'never'.
        u.js(6,22): error TS2339: Property 'missing' does not exist on type '() => void'.
        u.js(9,28): error TS2322: Type '{ default: () => void; }' is not assignable to type 'never'.
        w.js(2,4): error TS2540: Cannot assign to 'v' because it is a read-only property.
        w.js(5,4): error TS2540: Cannot assign to 'v' because it is a read-only property.
        w.js(6,16): error TS2540: Cannot assign to 'v' because it is a read-only property."
      `);
      expect(exitCode).toBe(1);
    });

    test("a dotted `@typedef` name on a member of an object literal", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "a.js": `export {};
const o = {
  /** @typedef {Missing1} No.T */
  m() {},
  /** @typedef {string} No2.T */
  p: 1,
};
/** @type {No.T} */
const a1 = 1;
/** @type {No2.T} */
const a2 = 1;
class C {
  /** @typedef {Missing2} Nc.T */
  m() {}
  /** @typedef {string} Nd.T */
  static s = 1;
  /** @typedef {string} Ng.T */
  get g() { return 1; }
  /** @typedef {string} Nk.T */
  constructor() {}
  /** @typedef {string} Nq.T */
}
new C().Nc;
C.Nd;
function f(/** @typedef {string} Np.T */ a) {}
/** @type {Np.T} */
const a3 = 1;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.js(3,17): error TS2304: Cannot find name 'Missing1'.
        a.js(11,7): error TS2322: Type 'number' is not assignable to type 'string'.
        a.js(13,17): error TS2304: Cannot find name 'Missing2'.
        a.js(13,27): error TS1235: A namespace declaration is only allowed at the top level of a namespace or module.
        a.js(15,25): error TS1235: A namespace declaration is only allowed at the top level of a namespace or module.
        a.js(17,25): error TS1235: A namespace declaration is only allowed at the top level of a namespace or module.
        a.js(19,25): error TS1235: A namespace declaration is only allowed at the top level of a namespace or module.
        a.js(23,9): error TS2339: Property 'Nc' does not exist on type 'C'.
        a.js(24,3): error TS2339: Property 'Nd' does not exist on type 'typeof C'.
        a.js(25,42): error TS7006: Parameter 'a' implicitly has an 'any' type.
        a.js(27,7): error TS2322: Type 'number' is not assignable to type 'string'."
      `);
      expect(exitCode).toBe(1);
    });

    test("the type of a JSDoc `@type` tag on an assignment is not checked, only resolved", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "a.js": `export {};
/** @template {number} T @typedef {{ v: T }} Foo */
/** @param {Foo<string>=} a @param {...Foo<string>} b */
function f(a, ...b) {}
/** @param {Foo<string>} a */
function g(a) {}
/** @typedef {Foo<string>=} O1 */
/** @typedef {...Foo<string>} O2 */
/** @type {Foo<string>=} */
let v1;
/** @type {(Foo<string>|number)=} */
let v2;
/** @type {?Foo<string>} */
let v3;
/** @type {!Foo<string>} */
let v4;
/** @type {function(Foo<string>=): void} */
let v5;
/** @type {[a: string, b: string, a: number]=} */
let v6;
/** @type {{ a: string, a: number }=} */
let v7;
/** @typedef {(string|number)=} U1 */
const /** @type {U1} */ u1 = { a: 1 };
/** @typedef {(string|number)} U2 */
const /** @type {U2} */ u2 = { a: 1 };
/** @typedef {?(string|number)} U3 */
const /** @type {U3} */ u3 = { a: 1 };
/** @typedef {!(string|number)} U4 */
const /** @type {U4} */ u4 = { a: 1 };
/** @typedef {?string} U5 */
const /** @type {U5} */ u5 = { a: 1 };
/** @typedef {U6[]=} U6 */
/** @typedef {...U7} U7 */
/** @typedef {U8[]} U8 */
const /** @type {U6} */ u6 = 1;
const /** @type {U7} */ u7 = 1;
const /** @type {U8} */ u8 = 1;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.js(5,17): error TS2344: Type 'string' does not satisfy the constraint 'number'.
        a.js(13,17): error TS2344: Type 'string' does not satisfy the constraint 'number'.
        a.js(15,17): error TS2344: Type 'string' does not satisfy the constraint 'number'.
        a.js(17,20): error TS1005: '}' expected.
        a.js(24,25): error TS2322: Type '{ a: number; }' is not assignable to type 'string | number | undefined'.
        a.js(26,25): error TS2322: Type '{ a: number; }' is not assignable to type 'U2'.
        a.js(28,25): error TS2322: Type '{ a: number; }' is not assignable to type 'string | number | null'.
        a.js(30,25): error TS2322: Type '{ a: number; }' is not assignable to type 'string | number'.
        a.js(32,25): error TS2322: Type '{ a: number; }' is not assignable to type 'string'.
        a.js(33,22): error TS2456: Type alias 'U6' circularly references itself.
        a.js(34,22): error TS2456: Type alias 'U7' circularly references itself.
        a.js(38,25): error TS2322: Type 'number' is not assignable to type 'U8'."
      `);
      expect(exitCode).toBe(1);
    });

    test("the types of a JSDoc signature on a function are not checked, only resolved", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "a.js": `export {};
/** @template {number} T @typedef {{ v: T }} Foo */
class C {
  constructor() {
    /** @type {Foo<string> | undefined} */
    this.a = undefined;
    /** @type {{ a: string, a: number } | undefined} */
    this.b = undefined;
    /** @type {((a: M1) => M2) | undefined} */
    this.c = undefined;
    /** @type {{ a: M3 } | undefined} */
    this.d = undefined;
    /** @type {[a: string, b?: string, c: number] | undefined} */
    this.e = undefined;
    /** @type {((a, b) => void) | undefined} */
    this.f = undefined;
    /** @type {{ [k: boolean]: string } | undefined} */
    this.g = undefined;
    /** @type {(new () => this) | undefined} */
    this.h = undefined;
    /** @type {{ m(): M4, get x(): M5 } | undefined} */
    this.i = undefined;
    /** @type {keyof M6 | undefined} */
    this.j = undefined;
    /** @type {(<T extends M7>(a: T) => void) | undefined} */
    this.k = undefined;
    /** @type {typeof m8 | undefined} */
    this.l = undefined;
    /** @type {{ [K in M9]: K } | undefined} */
    this.m = undefined;
    /** @type {(string extends M10 ? M11 : M12) | undefined} */
    this.n = undefined;
    /** @type {import("./missing").X | undefined} */
    this.o = undefined;
    /** @type {readonly string | undefined} */
    this.p = undefined;
    /** @type {unique symbol | undefined} */
    this.q = undefined;
  }
}
function F() {}
/** @type {Foo<string> | undefined} */
F.a = undefined;
/** @type {{ a: string, a: number } | undefined} */
F.b = undefined;
/** @type {((a: P1) => P2) | undefined} */
F.c = undefined;
/** @type {{ a: P3 } | undefined} */
F.d = undefined;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.js(23,22): error TS2304: Cannot find name 'M6'.
        a.js(27,23): error TS2304: Cannot find name 'm8'.
        a.js(29,24): error TS2304: Cannot find name 'M9'.
        a.js(31,32): error TS2304: Cannot find name 'M10'.
        a.js(31,38): error TS2304: Cannot find name 'M11'.
        a.js(33,23): error TS2307: Cannot find module './missing' or its corresponding type declarations."
      `);
      expect(exitCode).toBe(1);
    });

    test("a parameter whose name a return type queries, in an instantiated signature", async () => {
      using dir = project({
        "a.ts": `export class D7 {
  m = (a: string): typeof a => a;
  n = function (a: string): typeof a { return a; };
  o(a: string): typeof a { return a; }
  static s = (a: string): typeof a => a;
  p = { q: (a: string): typeof a => a };
  r = (a: string, b: typeof a): void => {};
  t = (a: string) => (b: number): typeof a => a;
  u: (a: string) => typeof a = (a) => a;
}
export const e1: never = new D7().m;
export const e2: never = new D7().n;
export const e3: never = new D7().o;
export const e4: never = D7.s;
export const e5: never = new D7().p;
export const e6: never = new D7().r;
export const e7: never = new D7().t;
export const e8: never = new D7().u;
const f1 = (a: string): typeof a => a;
export const e9: never = f1;
const o1 = { q: (a: string): typeof a => a };
export const e10: never = o1;
function f2(a: string): typeof a { return a; }
export const e11: never = f2;
export const e12: never = new D7();
export const e13: never = D7;
const c2 = class { m = (a: string): typeof a => a; };
export const e14: never = new c2().m;
interface I { m: (a: string) => typeof a; n(a: string): typeof a }
declare const i: I;
export const e15: never = i.m;
export const e16: never = i.n;
type T = (a: string) => typeof a;
declare const t: T;
export const e17: never = t;
declare const t2: (a: string) => typeof a;
export const e18: never = t2;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(11,14): error TS2322: Type '(a: string) => typeof a' is not assignable to type 'never'.
        a.ts(12,14): error TS2322: Type '(a: string) => typeof a' is not assignable to type 'never'.
        a.ts(13,14): error TS2322: Type '(a: string) => string' is not assignable to type 'never'.
        a.ts(14,14): error TS2322: Type '(a: string) => typeof a' is not assignable to type 'never'.
        a.ts(15,14): error TS2322: Type '{ q: (a: string) => typeof a; }' is not assignable to type 'never'.
        a.ts(16,14): error TS2322: Type '(a: string, b: typeof a) => void' is not assignable to type 'never'.
        a.ts(17,14): error TS2322: Type '(a: string) => (b: number) => typeof a' is not assignable to type 'never'.
        a.ts(18,14): error TS2322: Type '(a: string) => string' is not assignable to type 'never'.
        a.ts(20,14): error TS2322: Type '(a: string) => typeof a' is not assignable to type 'never'.
        a.ts(22,14): error TS2322: Type '{ q: (a: string) => typeof a; }' is not assignable to type 'never'.
        a.ts(24,14): error TS2322: Type '(a: string) => string' is not assignable to type 'never'.
        a.ts(25,14): error TS2322: Type 'D7' is not assignable to type 'never'.
        a.ts(26,14): error TS2322: Type 'typeof D7' is not assignable to type 'never'.
        a.ts(28,14): error TS2322: Type '(a: string) => typeof a' is not assignable to type 'never'.
        a.ts(31,14): error TS2322: Type '(a: string) => string' is not assignable to type 'never'.
        a.ts(32,14): error TS2322: Type '(a: string) => string' is not assignable to type 'never'.
        a.ts(35,14): error TS2322: Type 'T' is not assignable to type 'never'.
        a.ts(37,14): error TS2322: Type '(a: string) => string' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a parameter whose name a return type queries, in a message", async () => {
      using dir = project({
        "a.ts": `export class D7 {
  m = (a: string): typeof a => a;
}
declare const d: D7;
const x = d.m;
export const e1: never = x;
export const e2: never = d.m;
export function g<T>(t: T) {
  const f = (a: string, b: T): typeof a => a;
  const e3: never = f;
  return f;
}
export const e4: never = g(1);
export class G<T> {
  m = (a: string, b: T): typeof a => a;
  k = (a: string): typeof a => a;
  n() { const e5: never = this.m; const e6: never = this.k; }
}
export const e7: never = new G<number>().m;
export const e8: never = new G<number>().k;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(6,14): error TS2322: Type '(a: string) => typeof a' is not assignable to type 'never'.
        a.ts(7,14): error TS2322: Type '(a: string) => typeof a' is not assignable to type 'never'.
        a.ts(10,9): error TS2322: Type '(a: string, b: T) => typeof a' is not assignable to type 'never'.
        a.ts(13,14): error TS2322: Type '(a: string, b: number) => typeof a' is not assignable to type 'never'.
        a.ts(17,15): error TS2322: Type '(a: string, b: T) => typeof a' is not assignable to type 'never'.
        a.ts(17,41): error TS2322: Type '(a: string) => typeof a' is not assignable to type 'never'.
        a.ts(19,14): error TS2322: Type '(a: string, b: number) => typeof a' is not assignable to type 'never'.
        a.ts(20,14): error TS2322: Type '(a: string) => typeof a' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("`new` on a function that has a `@this` tag", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "a.js": `export {};
/** @this {{ k: string }} */
function C1(v) { this.v = v; }
new C1();
new C1(1);
new C1(1, 2);
function C2(v) { this.v = v; }
new C2();
new C2(1);
new C2(1, 2);
/** @param {number} v */
function C3(v) { this.v = v; }
new C3();
new C3("a");
/** @this {{ k: string }} @param {number} v */
function C4(v) { this.k = "a"; }
new C4();
new C4("a");
C4(1);
/** @this {void} */
function C5(v) {}
new C5();
const C6 = /** @this {{ k: string }} */ function (v) {};
new C6();
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.js(3,13): error TS7006: Parameter 'v' implicitly has an 'any' type.
        a.js(3,23): error TS2339: Property 'v' does not exist on type '{ k: string; }'.
        a.js(4,1): error TS2554: Expected 1 arguments, but got 0.
        a.js(4,1): error TS7009: 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.
        a.js(5,1): error TS7009: 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.
        a.js(6,1): error TS7009: 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.
        a.js(6,11): error TS2554: Expected 1 arguments, but got 2.
        a.js(7,13): error TS7006: Parameter 'v' implicitly has an 'any' type.
        a.js(7,18): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.
        a.js(8,1): error TS7009: 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.
        a.js(9,1): error TS7009: 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.
        a.js(10,1): error TS7009: 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.
        a.js(10,11): error TS2554: Expected 0-1 arguments, but got 2.
        a.js(12,18): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.
        a.js(13,1): error TS2554: Expected 1 arguments, but got 0.
        a.js(13,1): error TS7009: 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.
        a.js(14,1): error TS7009: 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.
        a.js(14,8): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
        a.js(17,1): error TS2554: Expected 1 arguments, but got 0.
        a.js(17,1): error TS7009: 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.
        a.js(18,1): error TS7009: 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.
        a.js(18,8): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
        a.js(19,1): error TS2684: The 'this' context of type 'void' is not assignable to method's 'this' of type '{ k: string; }'.
        a.js(21,13): error TS7006: Parameter 'v' implicitly has an 'any' type.
        a.js(22,1): error TS2554: Expected 1 arguments, but got 0.
        a.js(22,1): error TS7009: 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type.
        a.js(23,51): error TS7006: Parameter 'v' implicitly has an 'any' type.
        a.js(24,1): error TS2554: Expected 1 arguments, but got 0.
        a.js(24,1): error TS7009: 'new' expression, whose target lacks a construct signature, implicitly has an 'any' type."
      `);
      expect(exitCode).toBe(1);
    });

    test("`satisfies const` under `as const`", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "a.ts": `export const a1 = (1 satisfies const) as const;
export const a2 = 1 satisfies const;
export const a3 = (1 satisfies Missing) as const;
export const a4 = [1 satisfies const] as const;
export const a5 = { a: 1 satisfies const } as const;
export const a6 = <const>(1 satisfies const);
export const a7 = (1 satisfies const) as number;
export const a8 = ((1 as const) satisfies const);
export const a9 = ((1 satisfies const) satisfies const) as const;
export const a10 = (1 satisfies const[]) as const;
export const a11 = (1 as const) as const;
`,
        "b.js": `export const k1 = /** @type {const} */ (/** @satisfies {const} */ (1));
export const k2 = /** @type {number} */ (/** @satisfies {const} */ (1));
export const k3 = /** @satisfies {const} */ (/** @satisfies {const} */ (1));
export const k4 = /** @type {const} */ ([/** @satisfies {const} */ (1)]);
export const k5 = /** @satisfies {const} */ (/** @type {const} */ (1));
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,19): error TS1355: A 'const' assertion can only be applied to references to enum members, or string, number, boolean, array, or object literals.
        a.ts(2,31): error TS2304: Cannot find name 'const'.
        a.ts(3,19): error TS1355: A 'const' assertion can only be applied to references to enum members, or string, number, boolean, array, or object literals.
        a.ts(3,32): error TS2304: Cannot find name 'Missing'.
        a.ts(6,26): error TS1355: A 'const' assertion can only be applied to references to enum members, or string, number, boolean, array, or object literals.
        a.ts(7,32): error TS2304: Cannot find name 'const'.
        a.ts(8,43): error TS2304: Cannot find name 'const'.
        a.ts(9,19): error TS1355: A 'const' assertion can only be applied to references to enum members, or string, number, boolean, array, or object literals.
        a.ts(10,20): error TS1355: A 'const' assertion can only be applied to references to enum members, or string, number, boolean, array, or object literals.
        a.ts(10,23): error TS1360: Type 'number' does not satisfy the expected type 'const[]'.
        a.ts(11,20): error TS1355: A 'const' assertion can only be applied to references to enum members, or string, number, boolean, array, or object literals.
        b.js(1,67): error TS1355: A 'const' assertion can only be applied to references to enum members, or string, number, boolean, array, or object literals.
        b.js(2,58): error TS2304: Cannot find name 'const'.
        b.js(3,35): error TS2304: Cannot find name 'const'.
        b.js(3,62): error TS2304: Cannot find name 'const'.
        b.js(5,35): error TS2304: Cannot find name 'const'."
      `);
      expect(exitCode).toBe(1);
    });

    test("`await` in parentheses in an arrow function that is not async", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "a.ts": `export async function w1() { const f = () => (await { a: 1 }); }
export async function w2() { const f = () => (await 1); }
export async function w3() { const f = () => await { a: 1 }; }
export async function w4() { const f = () => (await x); }
export async function w5() { const f = () => (await [1]); }
export async function w6() { const f = () => (await (1)); }
export async function w7() { const f = function () { return (await { a: 1 }); }; }
export function w8() { const f = () => (await { a: 1 }); }
export async function w9() { const f = () => { (await { a: 1 }); }; }
export async function w10() { const f = () => [await { a: 1 }]; }
export async function w11() { const f = () => (await "s"); }
export async function w12() { const f = () => (await \`s\`); }
export async function w13() { const f = () => (await function () {}); }
export async function w14() { const f = () => (await class {}); }
export async function w15() { const f = () => (await new X()); }
export async function w16() { const f = () => (await -1); }
export async function w17() { const f = () => (await /re/); }
export async function w18() { const f = () => (await this); }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,53): error TS1005: ')' expected.
        a.ts(1,58): error TS1003: Identifier expected.
        a.ts(1,60): error TS1005: ':' expected.
        a.ts(1,61): error TS1005: ',' expected.
        a.ts(3,52): error TS1005: ',' expected.
        a.ts(3,57): error TS1003: Identifier expected.
        a.ts(3,59): error TS1005: ':' expected.
        a.ts(7,68): error TS1005: ')' expected.
        a.ts(7,76): error TS1128: Declaration or statement expected.
        a.ts(8,47): error TS1005: ')' expected.
        a.ts(8,52): error TS1003: Identifier expected.
        a.ts(8,54): error TS1005: ':' expected.
        a.ts(8,55): error TS1005: ',' expected.
        a.ts(9,55): error TS1005: ')' expected.
        a.ts(9,63): error TS1128: Declaration or statement expected.
        a.ts(10,54): error TS1005: ',' expected.
        a.ts(17,58): error TS1109: Expression expected."
      `);
      expect(exitCode).toBe(1);
    });

    test("an intersection with a class whose field is being resolved", async () => {
      using dir = project({
        "a.ts": `declare function fy(v: { y: unknown }): 1; declare function fe(v: {}): 1; declare function fo(v: { y?: unknown }): 1;
export class C1 { x = { a: fy(null! as C1 & { x: unknown }) }; y = 1; }
export class C2 { x = { a: fy(null! as C2 & { x: 1 }) }; y = 1; }
export class C3 { x = { a: (null! as C3 & { x: unknown }).y }; y = 1; }
export class C4 { x = { a: (null! as C4 & { x: 1 }).y }; y = 1; }
export class C5 { x = { a: fo(null! as C5 & { x: unknown }) }; y = 1; }
export class C6 { x = { a: fe(null! as C6 & { x: unknown }) }; y = 1; }
export class C7 { x = { a: null! as Pick<C7 & { x: 1 }, "y"> }; y = 1; }
export class C8 { x = { a: null! as keyof (C8 & { x: 1 }) }; y = 1; }
export class C9 { x = { a: null! as Partial<C9 & { x: 1 }> }; y = 1; }
export class E1 { x = { a: null! as Pick<E1 & { z: 1 }, "y"> }; y = 1; }
export class E2 { x = { a: null! as Array<keyof (E2 & { x: 1 })> }; y = 1; }
export class E3 { x = { a: null! as Record<keyof (E3 & { x: 1 }), 1> }; y = 1; }
export class E4 { x = { a: fy(null! as E4 & { x?: unknown }) }; y = 1; }
export class E5 { x? = { a: fy(null! as E5 & { x?: unknown }) }; y = 1; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(3,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,59): error TS2729: Property 'y' is used before its initialization.
        a.ts(5,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,53): error TS2729: Property 'y' is used before its initialization.
        a.ts(6,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(9,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(13,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(14,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(15,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("a mapped type over a class whose field is being resolved", async () => {
      using dir = project({
        "a.ts": `declare function fe(v: {}): 1;
export class M1 { x = { a: fe({ ...(null! as Readonly<M1>) }) }; y = 1; }
export class M2 { x = { ...(null! as Partial<M2>) }; y = 1; }
export class M3 { x = { a: { ...(null! as Partial<M3>) } }; y = 1; }
export class M4 { readonly x = { a: fe({ ...(null! as Pick<M4, "x" | "y">) }) }; y = 1; }
export class M5 { x = { a: (null! as Partial<M5>).x }; y = 1; }
export class M6 { x = (null! as Readonly<M6>).x; y = 1; }
export class M7 { x = { a: (null! as { [K in keyof M7]: M7[K] }).x }; y = 1; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(2,31): error TS2615: Type of property 'x' circularly references itself in mapped type 'Readonly<M1>'.
        a.ts(3,19): error TS2615: Type of property 'x' circularly references itself in mapped type 'Partial<M2>'.
        a.ts(3,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,19): error TS2615: Type of property 'x' circularly references itself in mapped type 'Partial<M3>'.
        a.ts(4,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,28): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,40): error TS2615: Type of property 'x' circularly references itself in mapped type 'Pick<M4, "x" | "y">'.
        a.ts(6,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,28): error TS2615: Type of property 'x' circularly references itself in mapped type 'Partial<M5>'.
        a.ts(7,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,23): error TS2615: Type of property 'x' circularly references itself in mapped type 'Readonly<M6>'.
        a.ts(8,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,28): error TS2615: Type of property 'x' circularly references itself in mapped type '{ x: any; y: number; }'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a failed `satisfies` in a class field prints both types", async () => {
      using dir = project({
        "a.ts": `export class P1 { x = ((({ ...new P1() }) satisfies { y: unknown }), 1); y?: number }
export class P2 { x = typeof ((({ ...new P2() }) satisfies { y: unknown })); y?: number }
export class P3 { x = ((({ ...new P3() }) satisfies { y: unknown }), 1); y = 1 }
export class P4 { x = { a: (({ ...new P4() }) satisfies { y: unknown }) }; y?: number }
export class P5 { x = [(({ ...new P5() }) satisfies { y: unknown }), 1]; y?: number }
export class P6 { x = ((({ ...new P6() }) satisfies { y: unknown }) ? 1 : 2); y?: number }
export class P7 { x = (() => ((({ ...new P7() }) satisfies { y: unknown }), 1))(); y?: number }
export class P8 { x = !(({ ...new P8() }) satisfies { y: unknown }); y?: number }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(1,43): error TS1360: Type '{ x: any; y?: number; }' does not satisfy the expected type '{ y: unknown; }'.
          Property 'y' is optional in type '{ x: any; y?: number | undefined; }' but required in type '{ y: unknown; }'.
        a.ts(2,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(2,50): error TS1360: Type '{ x: any; y?: number; }' does not satisfy the expected type '{ y: unknown; }'.
          Property 'y' is optional in type '{ x: any; y?: number | undefined; }' but required in type '{ y: unknown; }'.
        a.ts(4,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,47): error TS1360: Type '{ x: any; y?: number; }' does not satisfy the expected type '{ y: unknown; }'.
          Property 'y' is optional in type '{ x: any; y?: number | undefined; }' but required in type '{ y: unknown; }'.
        a.ts(5,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,43): error TS1360: Type '{ x: any; y?: number; }' does not satisfy the expected type '{ y: unknown; }'.
          Property 'y' is optional in type '{ x: any; y?: number | undefined; }' but required in type '{ y: unknown; }'.
        a.ts(6,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,24): error TS2872: This kind of expression is always truthy.
        a.ts(6,43): error TS1360: Type '{ x: any; y?: number; }' does not satisfy the expected type '{ y: unknown; }'.
          Property 'y' is optional in type '{ x: any; y?: number | undefined; }' but required in type '{ y: unknown; }'.
        a.ts(7,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,24): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(7,50): error TS1360: Type '{ x: any; y?: number; }' does not satisfy the expected type '{ y: unknown; }'.
          Property 'y' is optional in type '{ x: any; y?: number | undefined; }' but required in type '{ y: unknown; }'.
        a.ts(8,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,24): error TS2872: This kind of expression is always truthy.
        a.ts(8,43): error TS1360: Type '{ x: any; y?: number; }' does not satisfy the expected type '{ y: unknown; }'.
          Property 'y' is optional in type '{ x: any; y?: number | undefined; }' but required in type '{ y: unknown; }'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a spread that fails `satisfies` in a class field", async () => {
      using dir = project({
        "a.ts": `export class C1 { x = (({ ...new C1() }) satisfies { y: unknown }, 1); y?: number; }
export class C2 { x = typeof (({ ...new C2() }) satisfies { y: unknown }); y?: number; }
export class C3 { x = 1; y?: number; }
export const c3 = ({ ...new C3() }) satisfies { y: unknown };
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(1,42): error TS1360: Type '{ x: any; y?: number; }' does not satisfy the expected type '{ y: unknown; }'.
          Property 'y' is optional in type '{ x: any; y?: number | undefined; }' but required in type '{ y: unknown; }'.
        a.ts(2,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(2,49): error TS1360: Type '{ x: any; y?: number; }' does not satisfy the expected type '{ y: unknown; }'.
          Property 'y' is optional in type '{ x: any; y?: number | undefined; }' but required in type '{ y: unknown; }'.
        a.ts(4,37): error TS1360: Type '{ x: number; y?: number; }' does not satisfy the expected type '{ y: unknown; }'.
          Property 'y' is optional in type '{ x: number; y?: number | undefined; }' but required in type '{ y: unknown; }'."
      `);
      expect(exitCode).toBe(1);
    });

    test("`Object.assign({}, this)` in the initializer of a property", async () => {
      using dir = project({
        "a.ts": `declare function both<A, B>(a: A, b: B): A & B;
export class E1 { x = Object.assign({}, this); y = 1; }
export const e1: never = new E1().x;
export class E2 { x() { return both({}, this); } y = 1; }
export const e2: never = new E2().x();
export function e3<T extends { y: number }>(t: T) { return both({}, t); }
export const e4: never = e3({ y: 1 });
export class E5 { x(): {} & this { return this; } y = 1; }
export const e5: never = new E5().x();
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,14): error TS2322: Type '{} & E1' is not assignable to type 'never'.
        a.ts(5,14): error TS2322: Type '{} & E2' is not assignable to type 'never'.
        a.ts(7,14): error TS2322: Type '{} & { y: number; }' is not assignable to type 'never'.
        a.ts(9,14): error TS2322: Type 'E5' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("JSDoc: the tag that TS1223 names, and two accessibility tags", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "a.js": `export {};
// D1: the argument of TS1223
/** @returns {number} @returns {string} */
function d1() { return 1; }
// D2: two accessibility tags on a constructor
class D2 {
  /** @private @protected */
  constructor() {}
}
new D2();
class D2b {
  /** @protected @private */
  constructor() {}
}
new D2b();
class D2c {
  /** @private @protected */
  m() {}
  /** @protected @private */
  n() {}
  /** @public @private */
  o() {}
}
new D2c().m(); new D2c().n(); new D2c().o();
// D3: \`this\` as the return type of an arrow function in a class
class D3 {
  /** @returns {this} */
  m = () => 1;
  constructor() {
    /** @returns {this} */
    this.n = () => 1;
  }
  /** @type {() => this} */
  o = () => this;
}
// D4: TS1092 comes alone
class D4 {
  /** @template T @returns {T} */
  constructor() {}
}
class D4b {
  /** @returns {number} */
  constructor() {}
}
// D5: @template with @type on an assignment to \`this.m\` in a function, or to a prototype
function D5() {
  /** @template T @type {(a: T) => T} */
  this.m = function (a) { return a; };
}
/** @template T @type {(a: T) => T} */
D5.prototype.n = function (a) { return a; };
/** @template T @type {(a: T) => T} */
D5.o = function (a) { return a; };
/** @template T @type {(a: T) => T} */
const d5 = function (a) { return a; };
// D6: a type predicate about a name that is no parameter
/** @param {string} a @returns {x is string} */
function d6(a) { return true; }
const /** @type {never} */ d6r = d6;
// D7
/** @param {string} a @returns {typeof a} */
const d7 = function (a) { return a; };
const /** @type {never} */ d7r = d7;
class D7 {
  /** @param {string} a @returns {typeof a} */
  m = (a) => a;
}
const /** @type {never} */ d7s = new D7().m;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.js(3,24): error TS1223: 'returns' tag already specified.
        a.js(7,16): error TS1028: Accessibility modifier already seen.
        a.js(10,1): error TS2673: Constructor of class 'D2' is private and only accessible within the class declaration.
        a.js(10,1): error TS2674: Constructor of class 'D2' is protected and only accessible within the class declaration.
        a.js(12,18): error TS1028: Accessibility modifier already seen.
        a.js(15,1): error TS2673: Constructor of class 'D2b' is private and only accessible within the class declaration.
        a.js(15,1): error TS2674: Constructor of class 'D2b' is protected and only accessible within the class declaration.
        a.js(17,16): error TS1028: Accessibility modifier already seen.
        a.js(19,18): error TS1028: Accessibility modifier already seen.
        a.js(21,15): error TS1028: Accessibility modifier already seen.
        a.js(24,11): error TS2341: Property 'm' is private and only accessible within class 'D2c'.
        a.js(24,26): error TS2341: Property 'n' is private and only accessible within class 'D2c'.
        a.js(24,41): error TS2341: Property 'o' is private and only accessible within class 'D2c'.
        a.js(28,13): error TS2322: Type 'number' is not assignable to type 'this'.
          'this' could be instantiated with an arbitrary type which could be unrelated to 'number'.
        a.js(31,20): error TS2322: Type 'number' is not assignable to type 'this'.
          'this' could be instantiated with an arbitrary type which could be unrelated to 'number'.
        a.js(38,7): error TS1092: Type parameters cannot appear on a constructor declaration.
        a.js(42,17): error TS1093: Type annotation cannot appear on a constructor declaration.
        a.js(48,3): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.
        a.js(48,22): error TS7006: Parameter 'a' implicitly has an 'any' type.
        a.js(51,28): error TS7006: Parameter 'a' implicitly has an 'any' type.
        a.js(52,28): error TS2304: Cannot find name 'T'.
        a.js(52,34): error TS2304: Cannot find name 'T'.
        a.js(53,18): error TS7006: Parameter 'a' implicitly has an 'any' type.
        a.js(54,28): error TS2304: Cannot find name 'T'.
        a.js(54,34): error TS2304: Cannot find name 'T'.
        a.js(55,22): error TS7006: Parameter 'a' implicitly has an 'any' type.
        a.js(57,33): error TS1225: Cannot find parameter 'x'.
        a.js(59,28): error TS2322: Type '(a: string) => x is string' is not assignable to type 'never'.
        a.js(63,28): error TS2322: Type '(a: string) => typeof a' is not assignable to type 'never'.
        a.js(68,28): error TS2322: Type '(a: string) => typeof a' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an overload and an implementation whose name is computed", async () => {
      using dir = project({
        "a.ts": `export class A1 { m(): void; ["m"]() {} }
export class A2 { static m(): void; ["m"]() {} }
export class A3 { m(): void; static ["m"]() {} }
export class A4 { ["m"](): void; m() {} }
export class A5 { ["m"](): void; ["m"]() {} }
export class A6 { m(): void; "m"() {} }
export class A7 { static m(): void; m() {} }
export class A8 { m(): void; static m() {} }
export class A9 { static m(): void; "m"() {} }
export abstract class B1 { abstract constructor(); }
export abstract class B2 { abstract constructor() {} }
export abstract class B3 { constructor(); abstract constructor(x?: number) {} }
export abstract class B4 { abstract constructor(); constructor(x?: number) {} }
export class D1 { accessor b?: number; }
export class D2 { accessor b: number; }
export class D3 { accessor b!: number; }
export class D4 { static accessor b?: number; }
export class D5 { b?: number; }
export class D6 { accessor b?: number | undefined; }
export class D7 { accessor b?: number = 1; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "error TS2512: Overload signatures must all be abstract or non-abstract.
        a.ts(2,37): error TS2389: Function implementation name must be 'm'.
        a.ts(3,37): error TS2389: Function implementation name must be 'm'.
        a.ts(7,37): error TS2387: Function overload must be static.
        a.ts(8,37): error TS2388: Function overload must not be static.
        a.ts(9,37): error TS2387: Function overload must be static.
        a.ts(10,28): error TS1242: 'abstract' modifier can only appear on a class, method, or property declaration.
        a.ts(11,28): error TS1242: 'abstract' modifier can only appear on a class, method, or property declaration.
        a.ts(12,43): error TS1242: 'abstract' modifier can only appear on a class, method, or property declaration.
        a.ts(13,28): error TS1242: 'abstract' modifier can only appear on a class, method, or property declaration.
        a.ts(14,28): error TS2564: Property 'b' has no initializer and is not definitely assigned in the constructor.
        a.ts(14,29): error TS1276: An 'accessor' property cannot be declared optional.
        a.ts(15,28): error TS2564: Property 'b' has no initializer and is not definitely assigned in the constructor.
        a.ts(17,36): error TS1276: An 'accessor' property cannot be declared optional.
        a.ts(19,29): error TS1276: An 'accessor' property cannot be declared optional.
        a.ts(20,29): error TS1276: An 'accessor' property cannot be declared optional."
      `);
      expect(exitCode).toBe(1);
    });

    test('`this["z"]` in an optional property, in an intersection with the class whose property is being resolved', async () => {
      using dir = project({
        "a.ts": `declare function fy(v: { y: unknown }): 1;
export class A1 { p?: this["z"]; z = { a: fy(null! as A1 & { p?: unknown }) }; y = 1; }
export class A2 { p: this["z"] = null!; z = { a: fy(null! as A2 & { p: unknown }) }; y = 1; }
export class A3 { p?: this["z"]; z = { a: fy(null! as A3 & { q?: unknown }) }; y = 1; }
export class A4 { p?: [this["z"]]; z = { a: fy(null! as A4 & { p?: unknown }) }; y = 1; }
export class A5 { p?: this["z"] | 1; z = { a: fy(null! as A5 & { p?: unknown }) }; y = 1; }
export class A6 { p?: this["z"]["a"]; z = { a: fy(null! as A6 & { p?: unknown }) }; y = 1; }
export class A7 { p?: A7["z"]; z = { a: fy(null! as A7 & { p?: unknown }) }; y = 1; }
export class A8<T> { p?: this["z"]; z = { a: fy(null! as A8<T> & { p?: unknown }) }; y = 1; }
export class A9 { p?: keyof this; z = { a: fy(null! as A9 & { p?: unknown }) }; y = 1; }
export class B1 { p?: this; z = { a: fy(null! as B1 & { p?: unknown }) }; y = 1; }
export class B2 { p?: Partial<this>; z = { a: fy(null! as B2 & { p?: unknown }) }; y = 1; }
export class B3 { p?: Pick<this, "z">; z = { a: fy(null! as B3 & { p?: unknown }) }; y = 1; }
export class B4 { p?: Pick<this, "z">["z"]; z = { a: fy(null! as B4 & { p?: unknown }) }; y = 1; }
export class B5 { p?: this["z"] extends infer U ? U : never; z = { a: fy(null! as B5 & { p?: unknown }) }; y = 1; }
export class B6 { p?: \`\${this["w"]}\`; w = "a" as const; z = { a: fy(null! as B6 & { p?: unknown }) }; y = 1; }
export class B7 { p?: this["z"]; z = fy(null! as B7 & { p?: unknown }); y = 1; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,34): error TS7022: 'z' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(3,41): error TS7022: 'z' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,36): error TS7022: 'z' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,38): error TS7022: 'z' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,39): error TS7022: 'z' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,19): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(8,32): error TS7022: 'z' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(9,37): error TS7022: 'z' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(14,45): error TS7022: 'z' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(15,62): error TS7022: 'z' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("a class expression in a parameter default that extends the type of a call of the function", async () => {
      using dir = project({
        "a.ts": `export function a(x = class extends (typeof a()) {}) { return x; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,17): error TS7023: 'a' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(1,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(1,23): error TS2506: '(Anonymous class)' is referenced directly or indirectly in its own base expression."
      `);
      expect(exitCode).toBe(1);
    });

    test("`new a()` in a method of the class expression that `a` extends", async () => {
      using dir = project({
        "a.ts": `declare class Base { p: unknown; m(): unknown; static s: unknown } declare function deco(v: unknown): (...a: any[]) => any; declare function one(v: unknown): number;
export function f1() { class a extends (class extends Base { m() { return new (a)(); } }) {} }
export function f2() { class a extends (class extends Base { m() { return new a(); } }) {} }
export function f3() { class a extends (class extends Base { m() { return null! as a; } }) {} }
export function f4() { class a extends (class extends Base { m() { return a.prototype; } }) {} }
export function f5() { class a extends (class extends Base { m() { return [new a()]; } }) {} }
export function f6() { class a extends (class extends Base { m() { return one(new a()); } }) {} }
export function f7() { class a extends (class extends Base { m() { new a(); return 1; } }) {} }
export function f8() { class a extends (class extends Base { m(): unknown { return new a(); } }) {} }
export function f9() { class a extends ((@deco(new a()) class {})) {} }
export function g1() { class a extends ((@deco(a) class {})) {} }
export function g2() { class a extends (class extends Base { m() { return new a().m; } }) {} }
export function g3() { class a extends (class extends Base { m() { return a; } }) {} }
export function g4() { class a extends (class extends Base { m() { return new a; } }) { constructor() { super(); } } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,30): error TS2506: 'a' is referenced directly or indirectly in its own base expression.
        a.ts(2,62): error TS7023: 'm' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(3,30): error TS2506: 'a' is referenced directly or indirectly in its own base expression.
        a.ts(3,62): error TS7023: 'm' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(5,30): error TS2506: 'a' is referenced directly or indirectly in its own base expression.
        a.ts(5,62): error TS7023: 'm' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(6,30): error TS2506: 'a' is referenced directly or indirectly in its own base expression.
        a.ts(6,62): error TS7023: 'm' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(7,30): error TS2506: 'a' is referenced directly or indirectly in its own base expression.
        a.ts(7,62): error TS7023: 'm' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(10,30): error TS2506: 'a' is referenced directly or indirectly in its own base expression.
        a.ts(11,30): error TS2506: 'a' is referenced directly or indirectly in its own base expression.
        a.ts(12,30): error TS2310: Type 'a' recursively references itself as a base type.
        a.ts(12,30): error TS2506: 'a' is referenced directly or indirectly in its own base expression.
        a.ts(12,62): error TS7023: 'm' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(12,83): error TS2339: Property 'm' does not exist on type 'a'.
        a.ts(13,30): error TS2506: 'a' is referenced directly or indirectly in its own base expression.
        a.ts(13,62): error TS7023: 'm' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(14,30): error TS2506: 'a' is referenced directly or indirectly in its own base expression.
        a.ts(14,62): error TS7023: 'm' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions."
      `);
      expect(exitCode).toBe(1);
    });

    test("an overload whose return type is a conditional type over the method", async () => {
      using dir = project({
        "a.ts": `declare const any0: any;
type RT1<T> = T extends (...a: any) => infer R ? R : any;
type RT2<T extends (...a: any) => any> = T extends (...a: any) => infer R ? R : any;
type RT3<T> = [T] extends [(...a: any) => infer R] ? R : any;
type RT4<T extends (...a: any) => any> = [T] extends [(...a: any) => infer R] ? R : any;
type RT5<T extends (...a: any) => any> = T;
type RT6<T extends (...a: any) => unknown> = 1;
type RT7<T extends () => any> = 1;
export class B1 { m(): RT1<B1["m"]>; m(x: number): number; m(): unknown { return any0; } }
export class B2 { m(): RT2<B2["m"]>; m(x: number): number; m(): unknown { return any0; } }
export class B3 { m(): RT3<B3["m"]>; m(x: number): number; m(): unknown { return any0; } }
export class B4 { m(): RT4<B4["m"]>; m(x: number): number; m(): unknown { return any0; } }
export class B5 { m(): RT5<B5["m"]>; m(x: number): number; m(): unknown { return any0; } }
export class B6 { m(): RT6<B6["m"]>; m(x: number): number; m(): unknown { return any0; } }
export class B7 { m(): RT7<B7["m"]>; m(x: number): number; m(): unknown { return any0; } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    });

    test("a class expression in a destructured array that refers to the element", async () => {
      using dir = project({
        "a.ts": `declare const any0: any; declare class Base { p: unknown; m(): unknown; static s: unknown }
export function f1() { const [a] = [class extends Base { m(): typeof a { return any0; } }]; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    });

    test("a class in a function that refers to a variable without an annotation", async () => {
      using dir = project({
        "a.ts": `export function f1() { let a; a = 1; class C { p!: { x: typeof a } } a; }
export function f2() { let a; a = 1; class C { p!: typeof a } a; }
export function f3() { let a; a = 1; type T = { x: typeof a }; a; }
export function f4() { let a; a = 1; type T = typeof a; a; }
export function f5() { let a; a = 1; class C { p!: [typeof a] } a; }
export function f6() { let a; a = 1; class C { p!: () => typeof a } a; }
export function f7() { let a; a = 1; class C { p!: { m(): typeof a } } a; }
export function f8() { let a; a = 1; class C { m(x: { x: typeof a }) {} } a; }
export function f9() { let a; a = 1; const g = (x: { x: typeof a }) => x; a; }
export function g1() { let a; a = 1; let b: { x: typeof a }; a; }
export function g2() { let a; a = 1; interface I { x: typeof a } a; }
export function g3() { let a; a = 1; class C { p!: { x: { y: typeof a } } } a; }
export function g4() { let a; a = 1; class C { p: { x: typeof a } = { x: 1 } } a; }
export function g5() { let a; a = 1; class C { p!: { [k: string]: typeof a } } a; }
export function g6() { let a; a = 1; class C { p!: { (): typeof a } } a; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(6,28): error TS7034: Variable 'a' implicitly has type 'any' in some locations where its type cannot be determined.
        a.ts(6,65): error TS7005: Variable 'a' implicitly has an 'any' type.
        a.ts(7,28): error TS7034: Variable 'a' implicitly has type 'any' in some locations where its type cannot be determined.
        a.ts(7,66): error TS7005: Variable 'a' implicitly has an 'any' type.
        a.ts(8,28): error TS7034: Variable 'a' implicitly has type 'any' in some locations where its type cannot be determined.
        a.ts(8,65): error TS7005: Variable 'a' implicitly has an 'any' type.
        a.ts(13,28): error TS7034: Variable 'a' implicitly has type 'any' in some locations where its type cannot be determined.
        a.ts(13,63): error TS7005: Variable 'a' implicitly has an 'any' type.
        a.ts(15,28): error TS7034: Variable 'a' implicitly has type 'any' in some locations where its type cannot be determined.
        a.ts(15,65): error TS7005: Variable 'a' implicitly has an 'any' type."
      `);
      expect(exitCode).toBe(1);
    });

    test("a conditional type over a method in the return type of its first overload", async () => {
      using dir = project({
        "a.ts": `declare const any0: any;
type X0<T> = T extends (...a: any) => infer R ? 1 : 2; export class B0 { m(): X0<B0["m"]>; m(x: number): number; m(): unknown { return any0; } }
type X1<T> = T extends (...a: any) => any ? 1 : 2; export class B1 { m(): X1<B1["m"]>; m(x: number): number; m(): unknown { return any0; } }
type X2<T> = T extends (...a: any) => number ? 1 : 2; export class B2 { m(): X2<B2["m"]>; m(x: number): number; m(): unknown { return any0; } }
type X3<T> = T extends () => infer R ? R : 2; export class B3 { m(): X3<B3["m"]>; m(x: number): number; m(): unknown { return any0; } }
type X4<T> = [T]; export class B4 { m(): X4<B4["m"]>; m(x: number): number; m(): unknown { return any0; } }
type X5<T> = { x: T }; export class B5 { m(): X5<B5["m"]>; m(x: number): number; m(): unknown { return any0; } }
type X6<T> = T | 1; export class B6 { m(): X6<B6["m"]>; m(x: number): number; m(): unknown { return any0; } }
type X7<T> = T extends unknown ? 1 : 2; export class B7 { m(): X7<B7["m"]>; m(x: number): number; m(): unknown { return any0; } }
type X8<T> = T extends (...a: any) => infer R ? R : any; export class B8 { m(): X8<B8["m"]>; m(x: number): number; m(): unknown { return any0; } }
type X9<T> = T extends (x: number) => infer R ? R : any; export class B9 { m(): X9<B9["m"]>; m(x: number): number; m(): unknown { return any0; } }
type X10<T> = T extends { (): infer A; (x: number): infer R } ? R : any; export class B10 { m(): X10<B10["m"]>; m(x: number): number; m(): unknown { return any0; } }
type X11<T> = [T] extends [(...a: any) => number] ? 1 : 2; export class B11 { m(): X11<B11["m"]>; m(x: number): number; m(): unknown { return any0; } }
type X12<T> = T extends (...a: any) => string ? 1 : 2; export class B12 { m(): X12<B12["m"]>; m(x: number): number; m(): unknown { return any0; } }
type X13<T> = T extends (...a: infer P) => any ? P : 2; export class B13 { m(): X13<B13["m"]>; m(x: number): number; m(): unknown { return any0; } }
type X14<T> = T extends (...a: any) => unknown ? 1 : 2; export class B14 { m(): X14<B14["m"]>; m(x: number): number; m(): unknown { return any0; } }
type X15<T> = T extends Function ? 1 : 2; export class B15 { m(): X15<B15["m"]>; m(x: number): number; m(): unknown { return any0; } }
type X16<T> = T extends object ? 1 : 2; export class B16 { m(): X16<B16["m"]>; m(x: number): number; m(): unknown { return any0; } }
type X17<T> = keyof T; export class B17 { m(): X17<B17["m"]>; m(x: number): number; m(): unknown { return any0; } }
type X18<T> = T extends (...a: any) => void ? 1 : 2; export class B18 { m(): X18<B18["m"]>; m(x: number): number; m(): unknown { return any0; } }
export class I0 { m(): I0["m"] extends (...a: any) => infer R ? 1 : 2; m(x: number): number; m(): unknown { return any0; } }
export class I1 { m(): I1["m"] extends (...a: any) => any ? 1 : 2; m(x: number): number; m(): unknown { return any0; } }
export class I2 { m(): I2["m"] extends (...a: any) => number ? 1 : 2; m(x: number): number; m(): unknown { return any0; } }
export class I3 { m(): I3["m"] extends () => infer R ? R : 2; m(x: number): number; m(): unknown { return any0; } }
export class I4 { m(): [I4["m"]]; m(x: number): number; m(): unknown { return any0; } }
export class I5 { m(): { x: I5["m"] }; m(x: number): number; m(): unknown { return any0; } }
export class I6 { m(): I6["m"] | 1; m(x: number): number; m(): unknown { return any0; } }
export class I7 { m(): I7["m"] extends unknown ? 1 : 2; m(x: number): number; m(): unknown { return any0; } }
export class I8 { m(): I8["m"] extends (...a: any) => infer R ? R : any; m(x: number): number; m(): unknown { return any0; } }
export class I9 { m(): I9["m"] extends (x: number) => infer R ? R : any; m(x: number): number; m(): unknown { return any0; } }
export class I10 { m(): I10["m"] extends { (): infer A; (x: number): infer R } ? R : any; m(x: number): number; m(): unknown { return any0; } }
export class I11 { m(): [I11["m"]] extends [(...a: any) => number] ? 1 : 2; m(x: number): number; m(): unknown { return any0; } }
export class I12 { m(): I12["m"] extends (...a: any) => string ? 1 : 2; m(x: number): number; m(): unknown { return any0; } }
export class I13 { m(): I13["m"] extends (...a: infer P) => any ? P : 2; m(x: number): number; m(): unknown { return any0; } }
export class I14 { m(): I14["m"] extends (...a: any) => unknown ? 1 : 2; m(x: number): number; m(): unknown { return any0; } }
export class I15 { m(): I15["m"] extends Function ? 1 : 2; m(x: number): number; m(): unknown { return any0; } }
export class I16 { m(): I16["m"] extends object ? 1 : 2; m(x: number): number; m(): unknown { return any0; } }
export class I17 { m(): keyof I17["m"]; m(x: number): number; m(): unknown { return any0; } }
export class I18 { m(): I18["m"] extends (...a: any) => void ? 1 : 2; m(x: number): number; m(): unknown { return any0; } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(12,98): error TS2577: Return type annotation circularly references itself.
        a.ts(31,25): error TS2577: Return type annotation circularly references itself."
      `);
      expect(exitCode).toBe(1);
    });

    test("JSDoc: a `@typedef` with a qualified name in a function", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "a.js": `export {};
function f() {
  /** @typedef {string} Nf.T */
  const a = 1;
  /** @type {Nf.T} */
  const b = 1;
}
{
  /** @typedef {string} Nb.T */
  const a = 1;
}
class T1 {
  /** @typedef {string} Ns.T */
  m() {}
  /** @typedef {string} Plain */
  /** @type {Plain} */
  p = 1;
  /** @type {Ns.T} */
  q = 1;
  /** @callback Nc.F
   * @param {string} a */
  r = 1;
}
/** @type {Ns.T} */
const outside = 1;
/** @type {Plain} */
const outside2 = 1;
const o = {
  /** @typedef {string} No.T */
  m() {},
};
const c = class {
  /** @typedef {string} Ne.T */
  m() {}
};
namespaceLike: {
  /** @typedef {string} Nl.T */
  const a = 1;
}
if (o) {
  /** @typedef {string} Ni.T */
  o.m();
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.js(3,25): error TS1235: A namespace declaration is only allowed at the top level of a namespace or module.
        a.js(6,9): error TS2322: Type 'number' is not assignable to type 'string'.
        a.js(9,25): error TS1235: A namespace declaration is only allowed at the top level of a namespace or module.
        a.js(13,25): error TS1235: A namespace declaration is only allowed at the top level of a namespace or module.
        a.js(17,3): error TS2322: Type 'number' is not assignable to type 'string'.
        a.js(18,14): error TS2503: Cannot find namespace 'Ns'.
        a.js(20,17): error TS1235: A namespace declaration is only allowed at the top level of a namespace or module.
        a.js(24,12): error TS2503: Cannot find namespace 'Ns'.
        a.js(27,7): error TS2322: Type 'number' is not assignable to type 'string'.
        a.js(33,25): error TS1235: A namespace declaration is only allowed at the top level of a namespace or module.
        a.js(37,25): error TS1235: A namespace declaration is only allowed at the top level of a namespace or module.
        a.js(41,25): error TS1235: A namespace declaration is only allowed at the top level of a namespace or module."
      `);
      expect(exitCode).toBe(1);
    });

    test("JSDoc: `@template` and `@type` on an assignment to `this.m`", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "a.js": `export {};
function D5() {
  /** @template T @type {(a: T) => T} */
  this.m = function (a) { return a; };
  /** @type {(a: M1) => M2} */
  this.n = 1;
  /** @type {(a: M3) => M4} */
  this.o = function () { return 1; };
  /** @type {(a: M5) => M6} */
  this.p = function (a) { return 1; };
  /** @type {{ a: M7 }} */
  this.q = 1;
  /** @type {M8[]} */
  this.r = 1;
  /** @type {[M9]} */
  this.s = 1;
}
/** @type {(a: N1) => N2} */
D5.prototype.n = 1;
/** @type {(a: N3) => N4} */
D5.prototype.o = function () { return 1; };
/** @type {{ a: N7 }} */
D5.prototype.q = 1;
/** @type {{ a: N8 }} */
D5.prototype.r = { a: 1 };
/** @type {N9} */
D5.prototype.s = { a: 1 };
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.js(4,3): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.
        a.js(4,22): error TS7006: Parameter 'a' implicitly has an 'any' type.
        a.js(6,3): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.
        a.js(7,25): error TS2304: Cannot find name 'M4'.
        a.js(8,3): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.
        a.js(9,18): error TS2304: Cannot find name 'M5'.
        a.js(9,25): error TS2304: Cannot find name 'M6'.
        a.js(10,3): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.
        a.js(12,3): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.
        a.js(14,3): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.
        a.js(16,3): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.
        a.js(20,23): error TS2304: Cannot find name 'N4'.
        a.js(24,17): error TS2304: Cannot find name 'N8'.
        a.js(26,12): error TS2304: Cannot find name 'N9'."
      `);
      expect(exitCode).toBe(1);
    });

    test("JSDoc: a function type with two parameters of one name in a `@type` that is not checked", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true, "noUnusedLocals": true, "noUnusedParameters": true}}`,
        "a.js": `export class C {
  constructor() {
    /** @type {((a: string, a: number) => void) | undefined} */
    this.a = undefined;
    /** @type {((a?: string, b: number) => void) | undefined} */
    this.b = undefined;
    /** @type {((...a: string) => void) | undefined} */
    this.c = undefined;
    /** @type {{ [k: string]: string, [k: string]: number } | undefined} */
    this.d = undefined;
    /** @type {{ [k: string]: string, a: number } | undefined} */
    this.e = undefined;
    /** @type {{ m() } | undefined} */
    this.f = undefined;
    /** @type {((string) => void) | undefined} */
    this.g = undefined;
    /** @type {(<T>(a: string) => void) | undefined} */
    this.h = undefined;
    /** @type {((a: string) => b is string) | undefined} */
    this.i = undefined;
    /** @type {{ get x(): string, set x(v: number) } | undefined} */
    this.j = undefined;
    /** @type {{ (): void, new (): void, readonly a: string, a(): void } | undefined} */
    this.k = undefined;
    /** @type {(infer U) | undefined} */
    this.l = undefined;
    /** @type {{ a: { b: { c: Q1 } } } | undefined} */
    this.m = undefined;
    /** @type {(<T extends T>(a: T) => void) | undefined} */
    this.n = undefined;
    /** @type {{ new (a) } | undefined} */
    this.o = undefined;
    /** @type {((this: string, this: number) => void) | undefined} */
    this.p = undefined;
    /** @type {(({ a, b }) => void) | undefined} */
    this.q = undefined;
    /** @type {((a = 1) => void) | undefined} */
    this.r = undefined;
    /** @type {{ a?: string, a?: string } | undefined} */
    this.s = undefined;
    /** @type {{ "a": string, a: string, 1: string, "1": string } | undefined} */
    this.t = undefined;
    /** @type {(abstract new () => void) | undefined} */
    this.u = undefined;
    /** @type {{ m(): void, m: string } | undefined} */
    this.v = undefined;
    /** @type {{ private a: string, static b: string } | undefined} */
    this.w = undefined;
    /** @type {function(string, Q2): Q3} */
    this.x = undefined;
    /** @type {Object<string, Q4>} */
    this.y = undefined;
    /** @type {{ [K in "a" as Q5]: K } | undefined} */
    this.z = undefined;
  }
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.js(3,18): error TS2300: Duplicate identifier 'a'.
        a.js(3,29): error TS2300: Duplicate identifier 'a'.
        a.js(23,51): error TS2300: Duplicate identifier 'a'.
        a.js(23,62): error TS2300: Duplicate identifier 'a'.
        a.js(33,18): error TS2300: Duplicate identifier 'this'.
        a.js(33,32): error TS2300: Duplicate identifier 'this'.
        a.js(45,18): error TS2300: Duplicate identifier 'm'.
        a.js(45,29): error TS2300: Duplicate identifier 'm'.
        a.js(49,24): error TS1005: '}' expected.
        a.js(50,5): error TS2322: Type 'undefined' is not assignable to type 'Function'.
        a.js(51,31): error TS2304: Cannot find name 'Q4'.
        a.js(52,5): error TS2322: Type 'undefined' is not assignable to type 'Record<string, Q4>'."
      `);
      expect(exitCode).toBe(1);
    });

    test("JSDoc: `typeof` of a name that does not exist in a `@type` that is not checked", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "a.js": `export {};
const missing = 1;
const key = "k";
function V4() {
  /** @type {typeof missing1} */
  this.p = 1;
  /** @type {typeof zzz1} */
  this.q = 1;
  /** @type {{ [key1]: string }} */
  this.r = 1;
  /** @type {{ a: typeof missing2 }} */
  this.s = 1;
  /** @type {typeof missing.a.b} */
  this.t = 1;
}
/** @type {typeof missing3} */
V4.prototype.p = 1;
/** @type {typeof missing4} */
V4.a = 1;
/** @type {{ a: typeof missing5 }} */
V4.b = { a: 1 };
/** @type {{ a: typeof missing6 }} */
V4.c = 1;
/** @type {(a: typeof missing7) => void} */
V4.d = 1;
const o = {
  /** @type {{ a: typeof missing8 }} */
  a: 1,
  /** @type {(a: typeof missing9) => void} */
  b: 1,
};
/** @param {(typeof missing10)=} a @param {...typeof missing11} b */
function f(a, ...b) {}
/** @typedef {(typeof missing12)=} U */
/** @typedef {{ a: typeof missing13 }=} U2 */
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.js(6,3): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.
        a.js(8,3): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.
        a.js(10,3): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.
        a.js(12,3): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.
        a.js(14,3): error TS2683: 'this' implicitly has type 'any' because it does not have a type annotation.
        a.js(18,19): error TS2552: Cannot find name 'missing4'. Did you mean 'missing'?
        a.js(20,24): error TS2552: Cannot find name 'missing5'. Did you mean 'missing'?
        a.js(22,24): error TS2552: Cannot find name 'missing6'. Did you mean 'missing'?
        a.js(23,1): error TS2322: Type 'number' is not assignable to type '{ a: any; }'.
        a.js(24,23): error TS2552: Cannot find name 'missing7'. Did you mean 'missing'?
        a.js(25,1): error TS2322: Type 'number' is not assignable to type '(a: any) => void'.
        a.js(27,26): error TS2552: Cannot find name 'missing8'. Did you mean 'missing'?
        a.js(28,3): error TS2322: Type 'number' is not assignable to type '{ a: any; }'.
        a.js(29,25): error TS2552: Cannot find name 'missing9'. Did you mean 'missing'?
        a.js(30,3): error TS2322: Type 'number' is not assignable to type '(a: any) => void'.
        a.js(32,21): error TS2552: Cannot find name 'missing10'. Did you mean 'missing'?
        a.js(32,54): error TS2552: Cannot find name 'missing11'. Did you mean 'missing'?"
      `);
      expect(exitCode).toBe(1);
    });

    test("JSDoc: modifiers on the members of a type literal in a `@type` that is not checked", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "a.js": `export class C {
  constructor() {
    /** @type {{ private a: string, static b: string } | undefined} */
    this.a = undefined;
    /** @type {((a?: string, b: number) => void) | undefined} */
    this.b = undefined;
    /** @type {((...a: string[], b: number) => void) | undefined} */
    this.c = undefined;
    /** @type {{ [k?: string]: string } | undefined} */
    this.d = undefined;
    /** @type {{ readonly m(): void } | undefined} */
    this.e = undefined;
    /** @type {(<const T, in U>(a: T) => void) | undefined} */
    this.f = undefined;
    /** @type {{ a!: string } | undefined} */
    this.g = undefined;
    /** @type {{ get x(): string, set x(v: number): void } | undefined} */
    this.h = undefined;
    /** @type {[a?: string, ...b: string[], c?: number] | undefined} */
    this.i = undefined;
    /** @type {((a: string = "x") => void) | undefined} */
    this.j = undefined;
    /** @type {{ async m(): void, declare n: string } | undefined} */
    this.k = undefined;
    /** @type {(abstract new () => void) | undefined} */
    this.l = undefined;
    /** @type {\`a\${1n}\` | 1_0 | 08 | undefined} */
    this.m = undefined;
  }
}
/** @param {{ private a: string }=} a @param {...{ static b: string }} b @param {((a?: string, b: number) => void)=} c */
export function f(a, c, ...b) {}
/** @type {{ private a: string }} */
export const v = { a: "" };
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.js(15,18): error TS1131: Property or signature expected.
        a.js(16,5): error TS2322: Type 'undefined' is not assignable to type '{}'.
        a.js(27,33): error TS1489: Decimals with leading zeros are not allowed.
        a.js(33,14): error TS1070: 'private' modifier cannot appear on a type member."
      `);
      expect(exitCode).toBe(1);
    });

    test("JSDoc: a binding pattern in a function type in a `@type` that is not checked", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true, "noUnusedLocals": true, "noUnusedParameters": true}}`,
        "a.js": `export class C {
  constructor() {
    /** @type {(({ a, b }) => void) | undefined} */
    this.q = undefined;
    /** @type {{ private a: string } | undefined} */
    this.w = undefined;
  }
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toBe("");
      expect(exitCode).toBe(0);
    });

    test("an intersection with a class that is reduced before the property is resolved", async () => {
      using dir = project({
        "a.ts": `declare function fy(v: { y: unknown }): 1;
export class E5 { x? = { a: fy(null! as E5 & { x?: unknown }) }; y = 1; }
`,
        "b.ts": `// The intersection is reduced first where nothing is in resolution, and its reduction is stored. The member is resolved later.
declare function fy(v: { y: unknown }): 1;
fy(null! as F1 & { x?: unknown });
export class F1 { x? = { a: fy(null! as F1 & { x?: unknown }) }; y = 1; }
function early(v: F2 & { x?: unknown }) { fy(v); }
export class F2 { x? = { a: fy(null! as F2 & { x?: unknown }) }; y = 1; }
type T3 = F3 & { x?: unknown };
\`\${null! as T3}\`;
export class F3 { x? = { a: fy(null! as T3) }; y = 1; }
\`\${null! as F4 & { x?: unknown }}\`;
export class F4 { x? = \`\${null! as F4 & { x?: unknown }}\` as const; y = 1; }
(null! as F5 & { x?: unknown }).y;
export class F5 { x? = (null! as F5 & { x?: unknown }).y; y = 1; }
(null! as F6 & { x?: unknown }).y;
export class F6 { x? = { a: fy(null! as F6 & { x?: unknown }) }; y = 1; }
early;
`,
        "c.ts": `// The pair has annotations. Instantiating one with \`this\` evaluates a conditional type or an indexed access that needs another member.
declare function fy(v: { y: unknown }): 1;
export class G1 { p?: this extends { z: infer Z } ? Z : never; z = { a: fy(null! as G1 & { p?: unknown }) }; y = 1; }
export class G2 { p?: this["z"]; z = { a: fy(null! as G2 & { p?: unknown }) }; y = 1; }
export class G3 { z = { a: fy(null! as G3 & { p?: unknown }) }; p?: this["z"]; y = 1; }
fy(null! as G4 & { p?: unknown });
export class G4 { p?: this["z"]; z = { a: fy(null! as G4 & { p?: unknown }) }; y = 1; }
fy(null! as G5 & { p?: unknown });
export class G5 { p?: this extends { z: infer Z } ? Z : never; z = { a: fy(null! as G5 & { p?: unknown }) }; y = 1; }
fy(null! as G6 & { p?: unknown });
export class G6 { p?: Array<this["z"]>; z = { a: fy(null! as G6 & { p?: unknown }) }; y = 1; }
fy(null! as G7 & { p?: unknown });
export class G7 { p?: { q: this["z"] }; z = { a: fy(null! as G7 & { p?: unknown }) }; y = 1; }
fy(null! as G8 & { p?: unknown });
export class G8 { p?: () => this["z"]; z = { a: fy(null! as G8 & { p?: unknown }) }; y = 1; }
fy(null! as G9 & { p?: unknown });
export class G9 { p?: typeof this.z; z = { a: fy(null! as G9 & { p?: unknown }) }; y = 1; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        b.ts(4,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        b.ts(6,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        b.ts(11,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        b.ts(13,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        b.ts(13,56): error TS2729: Property 'y' is used before its initialization.
        b.ts(15,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        c.ts(3,64): error TS7022: 'z' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        c.ts(4,34): error TS7022: 'z' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        c.ts(5,19): error TS7022: 'z' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        c.ts(7,34): error TS7022: 'z' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        c.ts(9,64): error TS7022: 'z' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        c.ts(11,41): error TS7022: 'z' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        c.ts(13,28): error TS2526: A 'this' type is available only in a non-static member of a class or interface.
        c.ts(17,19): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        c.ts(17,38): error TS7022: 'z' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("an immediately invoked function whose argument spreads an instance of the class", async () => {
      using dir = project({
        "a.ts": `declare function idf<T>(v: T): T;
export class V1 { x = ((v) => 1)({ ...new V1() }); y = 1 }
export class V2 { x = ((v) => v)({ ...new V2() }); y = 1 }
export class V3 { x = ((v) => v.y)({ ...new V3() }); y = 1 }
export class V5 { x = (({ y }): number => y)({ ...new V5() }); y = 1 }
export class V9 { x = ((v) => { return v.y; })({ ...new V9() }); y = 1 }
export class W3 { x = ((v = { ...new W3() }) => v.y)(); y = 1 }
export class W4 { x = (({ y } = { ...new W4() }) => y)(); y = 1 }
export class W8 { x = (([y]) => y)([{ ...new W8() }]); y = 1 }
export class W9 { x = (({ a: { y } }) => y)({ a: { ...new W9() } }); y = 1 }
export function f1() { const a = { k: ((p) => p)(a) }; return a; }
export function f2() { const a = ((p) => p)(a); return a; }
export function f3() { const a = [((p) => p)(a)]; return a; }
export function f4() { const a = idf(((p) => p)(a)); return a; }
export function f5() { const a = { k: ((p) => 1)(a) }; return a; }
export function f7() { const a = { k: ((p) => p())(() => a) }; return a; }
export function f8() { const a = { k: (({ q }) => q)({ q: a }) }; return a; }
export function f9() { const a = { k: ((p, q) => q)(1, a) }; return a; }
export function g1() { var a = { k: ((p) => p)(a) }; const t: never = a; }
export function g3() { var a = { k: ((p = a) => p)() }; const t: never = a; }
export function g4() { var a = { k: ((...p) => p)(a) }; const t: never = a; }
export class P1 { x = { a: (({ y }) => y)(null! as P1 & { x: 1 }) }; y = 1 }
export class P2 { static x = { a: (({ y }) => y)(null! as typeof P2 & { x: 1 }) }; static y = 1 }
export class P3 { x = (() => ((({ y }) => y)({ ...new P3() })))(); y = 1 }
export class P4 { x = idf((({ y }) => y)(null! as P4 & { x: 1 })); y = 1 }
export class P5 { x = [((v) => v.y)(null! as P5 & { x: 1 })]; y = 1 }
export class P7 { x = [(({ y }) => 1)(null! as P7 & { x: 1 })]; y = 1 }
export class P9 { x = [((w, { y }) => w)(1, { ...new P9() })]; y = 1 }
export class R1 { readonly x = { a: (({ y }) => y)({ ...new R1() }) }; y = 1 }
export class R2 { readonly x = (({ y, ...r }) => y)(new R2()); y = 1 }
export class R3 { readonly x = (({ y, ...r }) => r)(new R3()); y = 1 }
export namespace N1 { export const x = { a: (({ y }) => y)({ ...N1 }) }; export const y = 1; }
// Not fixed by ig1..ig3: getTypeForBindingElementParent takes the type of the parameter NOT widened while assignParameterType is computing it.
export class W5 { x = idf(({ y } = { ...new W5() }) => y)(); y = 1 }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(3,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(9,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(11,50): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(11,50): error TS2454: Variable 'a' is used before being assigned.
        a.ts(12,30): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,45): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(13,46): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(13,46): error TS2454: Variable 'a' is used before being assigned.
        a.ts(14,49): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(15,50): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(15,50): error TS2454: Variable 'a' is used before being assigned.
        a.ts(16,30): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(16,40): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(16,52): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(17,59): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(17,59): error TS2454: Variable 'a' is used before being assigned.
        a.ts(18,56): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(18,56): error TS2454: Variable 'a' is used before being assigned.
        a.ts(19,48): error TS2454: Variable 'a' is used before being assigned.
        a.ts(19,60): error TS2322: Type '{ k: any; }' is not assignable to type 'never'.
        a.ts(20,28): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(20,38): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(20,39): error TS7022: 'p' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(20,63): error TS2322: Type 'any' is not assignable to type 'never'.
        a.ts(21,28): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(21,63): error TS2322: Type 'any' is not assignable to type 'never'.
        a.ts(22,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(22,29): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(22,32): error TS7022: 'y' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(24,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(24,24): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(25,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(25,28): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(25,31): error TS7022: 'y' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(26,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(26,25): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(28,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(30,28): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(31,28): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("a function expression whose parameter type refers to the accessor that returns it", async () => {
      using dir = project({
        "a.ts": `export {};
class A { get x() { return ((v: A["x"]) => 1); } y = 1 }
class B { get x() { return { a: ((v: B["x"]) => 1) }; } y = 1 }
class C { x = ((v: C["x"]) => 1); y = 1 }
class D { x() { return ((v: ReturnType<D["x"]>) => 1); } y = 1 }
class E { get x() { const r = ((v: E["x"]) => 1); return r; } y = 1 }
class F { get x() { return (((v: F["x"]) => 1)); } set x(v) {} y = 1 }
const G = { get x() { return ((v: (typeof G)["x"]) => 1); }, y: 1 };
class H { get x() { return function (v: H["x"]) { return 1; }; } y = 1 }
class I { get x() { return [(v: I["x"]) => 1]; } y = 1 }
class J { get x() { return c ? (v: J["x"]) => 1 : 2; } y = 1 }
declare const c: boolean;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,15): error TS7023: 'x' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(3,15): error TS7023: 'x' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(4,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,11): error TS7023: 'x' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(6,15): error TS7023: 'x' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(6,27): error TS7022: 'r' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,15): error TS7023: 'x' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(8,17): error TS7023: 'x' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(9,15): error TS7023: 'x' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(10,15): error TS7023: 'x' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(11,15): error TS7023: 'x' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions."
      `);
      expect(exitCode).toBe(1);
    });

    test("the type node of an assertion in a parameter default", async () => {
      using dir = project({
        "a.ts": `export {};
type Has<T extends { y: unknown }> = 1;
class A { x = ((v = null! as Pick<A & { x: 1 }, "y">) => 1); y = 1 }
class B { x = ((v = null! as Has<B & { x: 1 }>) => 1); y = 1 }
class C { x = ((v = null! as { p: C["x"] }) => 1); y = 1 }
class D { x = ((v = null! as D["x"]) => 1); y = 1 }
class E { x = ((v = [null! as { p: E["x"] }]) => 1); y = 1 }
class F { x = ((v: unknown = null! as { p: F["x"] }) => 1); y = 1 }
class G { x = (function (v = null! as { p: G["x"] }) { return 1; }); y = 1 }
class H { x = (({ v } = null! as { v: 1, p: H["x"] }) => 1); y = 1 }
class I { x = { m(v = null! as { p: I["x"] }) { return 1; } }; y = 1 }
class J { x = ((v = <{ p: J["x"] }>null!) => 1); y = 1 }
class K { x = ((v = null! satisfies { p: K["x"] }) => 1); y = 1 }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(9,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(11,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(13,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("an immediately invoked function with a binding pattern, called with the variable that is being declared", async () => {
      using dir = project({
        "a.ts": `export {};
declare function idf<T>(v: T): T;
function f1() { const a = { a: (({ x }) => x)(a) }; }
function f2() { const a = (({ x }) => x)(a); }
function f3() { const a = idf((({ x }) => x)(a)); }
function f4() { const a = { a: ((p) => p.y)(a) }; }
function f5() { const a = { a: ((p) => p)(a) }; }
function f6() { const a = [(({ x }) => x)(a)]; }
function f7() { const a = { a: (({ x }) => 1)(a) }; }
function f8() { const a = { a: (({ x }) => x)({ y: a }) }; }
function f9() { const a = { a: (({ x }) => x)([a]) }; }
`,
        "b.ts": `export {};
declare function idf<T>(v: T): T;
class A { x = idf((({ x }) => x)({ ...new A() })); y = 1 }
class B { x = idf(((p) => p)({ ...new B() })); y = 1 }
class C { x = ((p) => p)({ ...new C() }); y = 1 }
class D { x = idf(((p) => p)(new D())); y = 1 }
class E { x = idf(((p) => p)({ q: new E().x })); y = 1 }
class F { x = { a: (({ y } = { ...new F() }) => y)() }; y = 1 }
`,
        "c.ts": `export {};
declare function idf<T>(v: T): T;
class A { x = { a: (({ y }) => y)({ ...new A() }) }; y = 1 }
class B { x = idf((({ y }) => y)({ ...new B() })); y = 1 }
class C { x = (({ y }) => y)({ ...new C() }); y = 1 }
class D { x = [(({ y }) => y)({ ...new D() })]; y = 1 }
class E { x = { a: ((p) => p.y)({ ...new E() }) }; y = 1 }
class F { x = { a: (({ y }) => y)([new F()]) }; y = 1 }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,36): error TS2339: Property 'x' does not exist on type '{ a: any; }'.
        a.ts(3,47): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(3,47): error TS2454: Variable 'a' is used before being assigned.
        a.ts(4,23): error TS7022: 'a' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,42): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(5,46): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(6,42): error TS2339: Property 'y' does not exist on type '{ a: any; }'.
        a.ts(6,45): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(6,45): error TS2454: Variable 'a' is used before being assigned.
        a.ts(7,43): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(7,43): error TS2454: Variable 'a' is used before being assigned.
        a.ts(8,32): error TS2339: Property 'x' does not exist on type 'any[]'.
        a.ts(8,43): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(8,43): error TS2454: Variable 'a' is used before being assigned.
        a.ts(9,36): error TS2339: Property 'x' does not exist on type '{ a: any; }'.
        a.ts(9,47): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(9,47): error TS2454: Variable 'a' is used before being assigned.
        a.ts(10,36): error TS2339: Property 'x' does not exist on type '{ y: { a: any; }; }'.
        a.ts(10,52): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(10,52): error TS2454: Variable 'a' is used before being assigned.
        a.ts(11,36): error TS2339: Property 'x' does not exist on type '{ a: any; }[]'.
        a.ts(11,48): error TS2448: Block-scoped variable 'a' used before its declaration.
        a.ts(11,48): error TS2454: Variable 'a' is used before being assigned.
        b.ts(3,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        b.ts(4,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        b.ts(5,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        b.ts(7,43): error TS2729: Property 'x' is used before its initialization.
        c.ts(3,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        c.ts(4,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        c.ts(5,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        c.ts(6,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        c.ts(7,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        c.ts(8,24): error TS2339: Property 'y' does not exist on type 'F[]'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a generic call whose argument is an assertion to a type that needs the property", async () => {
      using dir = project({
        "a.ts": `export {};
declare function idf<T>(v: T): T;
declare function one(v: unknown): 1;
type Key<T, K extends keyof T> = 1;
class A { x = idf(null! as Pick<A & { x: 1 }, "y">); y = 1 }
class B { x = idf(null! as Readonly<B & { x: 1 }>); y = 1 }
class C { x = idf([null! as Pick<C & { x: 1 }, "y">].length); y = 1 }
class D { x = idf([null! as keyof (D & { x: 1 })].length); y = 1 }
class E { x = idf(null! as Key<E & { x: 1 }, "y">); y = 1 }
class F { x = one(null! as Pick<F & { x: 1 }, "y">); y = 1 }
class G { x = idf(null! as keyof (G & { x: 1 })); y = 1 }
class H { x = idf([null! as Pick<H & { x: 1 }, "y">]); y = 1 }
class I { x = [null! as Pick<I & { x: 1 }, "y">].length; y = 1 }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(5,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(13,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("a type predicate that refers to the variable that holds the function", async () => {
      using dir = project({
        "a.ts": `export {};
var A = { x: ((v: unknown): v is { [K in keyof typeof A]: 1 } => true), y: 1 };
var B = { x: ((v: { [K in keyof typeof B]: 1 }) => true), y: 1 };
var C = { x: ((v: unknown): v is ReturnType<() => (typeof C)["x"]> => true), y: 1 };
var D = { x: ((v: ReturnType<() => (typeof D)["x"]>) => true), y: 1 };
class E { x = ((v: unknown): v is ReturnType<() => E["x"]> => true); y = 1 }
class F { x = ((v: ReturnType<() => F["x"]>) => true); y = 1 }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,5): error TS7022: 'A' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(2,42): error TS2313: Type parameter 'K' has a circular constraint.
        a.ts(3,5): error TS7022: 'B' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,5): error TS7022: 'C' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,51): error TS2577: Return type annotation circularly references itself.
        a.ts(5,5): error TS7022: 'D' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,52): error TS2577: Return type annotation circularly references itself.
        a.ts(7,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("a mapped type whose `as` clause reads the type that is being resolved is TS2589", async () => {
      using dir = project({
        "a.ts": `declare class D { static x: { [K in keyof typeof D as (typeof D)[K] & string]: 1 }; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(1,29): error TS2589: Type instantiation is excessively deep and possibly infinite."`,
      );
      expect(exitCode).toBe(1);
    });

    test("the type node of an assertion in the initializer of a property", async () => {
      using dir = project({
        "a.ts": `declare function one(v: unknown): 1; declare function g0<T>(): 1; declare class G<T> { p: 1 } declare function tag<T>(s: TemplateStringsArray): 1;
type Has<T extends { y: unknown }> = 1;
export class A1 { x = { a: null! as { p: A1["x"] } }; y = 1 }
export class A2 { x = { a: <{ p: A2["x"] }>null! }; y = 1 }
export class A3 { x = { a: null! satisfies { p: A3["x"] } }; y = 1 }
export class A4 { x = { a: g0<{ p: A4["x"] }>() }; y = 1 }
export class A5 { x = { a: new G<{ p: A5["x"] }>() }; y = 1 }
export class A6 { x = { a: g0<{ p: A6["x"] }> }; y = 1 }
export class A7 { x = { a: tag<{ p: A7["x"] }>\`\` }; y = 1 }
export class A8 { x = { a: (v: { p: A8["x"] }) => 1 }; y = 1 }
export class A9 { x = { a: (): { p: A9["x"] } => null! }; y = 1 }
export class B1 { x = { a: <U extends { p: B1["x"] }>() => 1 }; y = 1 }
export class B2 { x = { a: <U = { p: B2["x"] }>() => 1 }; y = 1 }
export class B3 { x = { a: { m(v: { p: B3["x"] }) { return 1; } } }; y = 1 }
export class B4 { x = { a: null! as Pick<B4 & { x: 1 }, "y"> }; y = 1 }
export class B5 { x = { a: null! as Has<B5 & { x: 1 }> }; y = 1 }
export class B6 { x = { a: null! as () => B6["x"] }; y = 1 }
export class B7 { get x() { return null! as { p: B7["x"] }; } y = 1 }
export var V1 = { x: one(null! as { p: typeof V1 }), y: 1 };
// No error in tsgo:
export class C1 { x = null! as { p: C1["x"] }; y = 1 }
export class C2 { x = { a: null! as Pick<C2, "y"> }; y = 1 }
export class C3 { x = { a: () => null! as { p: C3["x"] } }; y = 1 }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(9,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(11,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(13,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(14,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(15,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(16,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(17,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(18,23): error TS7023: 'x' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(19,12): error TS7022: 'V1' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("an immediately invoked function with a binding pattern whose argument spreads an instance", async () => {
      using dir = project({
        "a.ts": `declare function idf<T>(v: T): T;
export class A1 { x = (({ y }) => y)({ ...new A1() }); y = 1 }
export class A2 { x = { a: (({ y }) => y)({ ...new A2() }) }; y = 1 }
export class A3 { x = idf((({ y }) => y)({ ...new A3() })); y = 1 }
export class A4 { static x = (({ y }) => y)({ ...A4 }); static y = 1 }
export class A5 { static x = { a: (({ y }) => y)({ ...A5 }) }; static y = 1 }
export class A6 { x = (({ y }) => y)(null! as A6 & { x: 1 }); y = 1 }
export class A7 { static x = { a: (({ y }) => y)(null! as typeof A7 & { x: 1 }) }; static y = 1 }
export class A8 { x = ((v) => v.y)({ ...new A8() }); y = 1 }
export class A9 { x = { a: ((v) => v.y)({ ...new A9() }) }; y = 1 }
export class B1 { x = { a: (({ y }: { y: number }) => y)({ ...new B1() }) }; y = 1 }
export class B2 { x = { a: (function ({ y }) { return y; })({ ...new B2() }) }; y = 1 }
export namespace N1 { export const x = { a: (({ y }) => y)({ ...N1 }) }; export const y = 1; }
export class B3 { x = null! as keyof (B3 & { x: 1 }); y = 1 }
export class B4 { x = idf(null! as keyof (B4 & { x: 1 })); y = 1 }
export class B5 { readonly x = { a: (({ y, ...r }) => r)(new B5()) }; y = 1 }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(3,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,26): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,26): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(9,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(14,19): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(16,28): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(16,38): error TS7024: Function implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(16,47): error TS7022: 'r' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("a property and an accessor of one name", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true}, "files": ["a.ts"]}`,
        "a.ts": `export function f1() { class C { m: number = 1; get m(): string { return ""; } } }
export function f2() { class C { m: number = 1; set m(v: string) {} } }
export function f3() { class C { m: number = 1; get m() { return ""; } } }
export function f4() { class C { m: string = ""; get m(): number { return 1; } } const r: never = new C().m; }
export function f5() { class C { get m(): number { return 1; } m: string = ""; } const r: never = new C().m; }
export function f6() { class C { m: number; m?: number; } }
export function f7() { class C { m?: number; m: number; } }
export function f8() { class C { m?: number; m?: number; } }
export function f9() { class C { m: string = ""; m?: number; } }
export function f10() { class C { m = 1; m?: number; } }
export function f11() { class C { "m" = 1; m?: number; } }
export function f12() { class C { m?: number; accessor m = 1; } }
export function f13() { class C { m: number = 1; accessor m = 1; } }
export function f14() { class C { constructor(); constructor(a: number); } }
export function f15() { abstract class C { abstract constructor(); constructor(a: number); } }
export function f16() { class C { m(a: any) {} async m() {} } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "error TS2512: Overload signatures must all be abstract or non-abstract.
        a.ts(1,34): error TS2300: Duplicate identifier 'm'.
        a.ts(1,34): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(1,53): error TS2300: Duplicate identifier 'm'.
        a.ts(2,34): error TS2300: Duplicate identifier 'm'.
        a.ts(2,34): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(2,53): error TS2300: Duplicate identifier 'm'.
        a.ts(3,34): error TS2300: Duplicate identifier 'm'.
        a.ts(3,34): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(3,53): error TS2300: Duplicate identifier 'm'.
        a.ts(4,34): error TS2300: Duplicate identifier 'm'.
        a.ts(4,34): error TS2322: Type 'string' is not assignable to type 'number'.
        a.ts(4,54): error TS2300: Duplicate identifier 'm'.
        a.ts(4,88): error TS2322: Type 'number' is not assignable to type 'never'.
        a.ts(5,38): error TS2300: Duplicate identifier 'm'.
        a.ts(5,64): error TS2300: Duplicate identifier 'm'.
        a.ts(5,64): error TS2717: Subsequent property declarations must have the same type.  Property 'm' must be of type 'number', but here has type 'string'.
        a.ts(5,88): error TS2322: Type 'number' is not assignable to type 'never'.
        a.ts(6,34): error TS2300: Duplicate identifier 'm'.
        a.ts(6,34): error TS2564: Property 'm' has no initializer and is not definitely assigned in the constructor.
        a.ts(6,34): error TS2687: All declarations of 'm' must have identical modifiers.
        a.ts(6,45): error TS2300: Duplicate identifier 'm'.
        a.ts(6,45): error TS2564: Property 'm' has no initializer and is not definitely assigned in the constructor.
        a.ts(6,45): error TS2687: All declarations of 'm' must have identical modifiers.
        a.ts(6,45): error TS2717: Subsequent property declarations must have the same type.  Property 'm' must be of type 'number', but here has type 'number | undefined'.
        a.ts(7,34): error TS2300: Duplicate identifier 'm'.
        a.ts(7,34): error TS2687: All declarations of 'm' must have identical modifiers.
        a.ts(7,46): error TS2300: Duplicate identifier 'm'.
        a.ts(7,46): error TS2687: All declarations of 'm' must have identical modifiers.
        a.ts(7,46): error TS2717: Subsequent property declarations must have the same type.  Property 'm' must be of type 'number | undefined', but here has type 'number'.
        a.ts(8,34): error TS2300: Duplicate identifier 'm'.
        a.ts(8,46): error TS2300: Duplicate identifier 'm'.
        a.ts(9,34): error TS2300: Duplicate identifier 'm'.
        a.ts(9,34): error TS2687: All declarations of 'm' must have identical modifiers.
        a.ts(9,50): error TS2300: Duplicate identifier 'm'.
        a.ts(9,50): error TS2564: Property 'm' has no initializer and is not definitely assigned in the constructor.
        a.ts(9,50): error TS2687: All declarations of 'm' must have identical modifiers.
        a.ts(9,50): error TS2717: Subsequent property declarations must have the same type.  Property 'm' must be of type 'string', but here has type 'number | undefined'.
        a.ts(10,35): error TS2300: Duplicate identifier 'm'.
        a.ts(10,35): error TS2687: All declarations of 'm' must have identical modifiers.
        a.ts(10,42): error TS2300: Duplicate identifier 'm'.
        a.ts(10,42): error TS2564: Property 'm' has no initializer and is not definitely assigned in the constructor.
        a.ts(10,42): error TS2687: All declarations of 'm' must have identical modifiers.
        a.ts(10,42): error TS2717: Subsequent property declarations must have the same type.  Property 'm' must be of type 'number', but here has type 'number | undefined'.
        a.ts(11,35): error TS2300: Duplicate identifier '"m"'.
        a.ts(11,35): error TS2687: All declarations of '"m"' must have identical modifiers.
        a.ts(11,44): error TS2300: Duplicate identifier '"m"'.
        a.ts(11,44): error TS2564: Property 'm' has no initializer and is not definitely assigned in the constructor.
        a.ts(11,44): error TS2687: All declarations of 'm' must have identical modifiers.
        a.ts(11,44): error TS2717: Subsequent property declarations must have the same type.  Property 'm' must be of type 'number', but here has type 'number | undefined'.
        a.ts(12,35): error TS2300: Duplicate identifier 'm'.
        a.ts(12,35): error TS2564: Property 'm' has no initializer and is not definitely assigned in the constructor.
        a.ts(12,35): error TS2687: All declarations of 'm' must have identical modifiers.
        a.ts(12,56): error TS2300: Duplicate identifier 'm'.
        a.ts(12,56): error TS2687: All declarations of 'm' must have identical modifiers.
        a.ts(13,35): error TS2300: Duplicate identifier 'm'.
        a.ts(13,59): error TS2300: Duplicate identifier 'm'.
        a.ts(14,50): error TS2390: Constructor implementation is missing.
        a.ts(15,44): error TS1242: 'abstract' modifier can only appear on a class, method, or property declaration.
        a.ts(15,68): error TS2390: Constructor implementation is missing.
        a.ts(16,35): error TS2393: Duplicate function implementation.
        a.ts(16,54): error TS2393: Duplicate function implementation."
      `);
      expect(exitCode).toBe(1);
    });

    test("two members of one name: parameter properties, static members, private names, a merged interface", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true}, "files": ["a.ts"]}`,
        "a.ts": `export function g1() { class C { m: string = ""; accessor m = 1; } const r: never = new C().m; }
export function g2() { class C { accessor m = 1; m: string = ""; } const r: never = new C().m; }
export function g3() { class C { m() {} m?: number; } }
export function g4() { class C { m() {} m: number; } }
export function g5() { class C { m?: number; get m(): number { return 1; } } const r: never = new C().m; }
export function g6() { class C { constructor(public m: string) {} m?: number; } }
export function g7() { class C { m?: number; constructor(public m: string) {} } }
export function g8() { class C { m = 1; set m(v: string) {} } new C().m = 1; new C().m = ""; }
export function g9() { class C { static m: number = 1; static get m(): string { return ""; } } }
export function g10() { class C { #m: number = 1; get #m(): string { return ""; } } }
export function g11() { class C { m: number = 1; } interface C { get m(): string; } }
export function g12() { class C { m: number = ""; get m(): string { return ""; } } }
export function g13() { class C { get m(): string { return ""; } m: number = ""; } }
export function g14() { class C { m?: number; m: number; constructor() { this.m = 1; } } }
export function g15() { class C { accessor m?: number; } const r: never = new C().m; }
export function g16() { class C { m: number; get m(): string | undefined { return ""; } } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,34): error TS2300: Duplicate identifier 'm'.
        a.ts(1,34): error TS2322: Type 'string' is not assignable to type 'number'.
        a.ts(1,59): error TS2300: Duplicate identifier 'm'.
        a.ts(1,74): error TS2322: Type 'number' is not assignable to type 'never'.
        a.ts(2,43): error TS2300: Duplicate identifier 'm'.
        a.ts(2,50): error TS2300: Duplicate identifier 'm'.
        a.ts(2,50): error TS2717: Subsequent property declarations must have the same type.  Property 'm' must be of type 'number', but here has type 'string'.
        a.ts(2,74): error TS2322: Type 'number' is not assignable to type 'never'.
        a.ts(3,34): error TS2300: Duplicate identifier 'm'.
        a.ts(3,41): error TS2300: Duplicate identifier 'm'.
        a.ts(4,34): error TS2300: Duplicate identifier 'm'.
        a.ts(4,41): error TS2300: Duplicate identifier 'm'.
        a.ts(4,41): error TS2564: Property 'm' has no initializer and is not definitely assigned in the constructor.
        a.ts(5,34): error TS2300: Duplicate identifier 'm'.
        a.ts(5,34): error TS2564: Property 'm' has no initializer and is not definitely assigned in the constructor.
        a.ts(5,50): error TS2300: Duplicate identifier 'm'.
        a.ts(5,84): error TS2322: Type 'number' is not assignable to type 'never'.
        a.ts(6,53): error TS2300: Duplicate identifier 'm'.
        a.ts(6,53): error TS2687: All declarations of 'm' must have identical modifiers.
        a.ts(6,67): error TS2300: Duplicate identifier 'm'.
        a.ts(6,67): error TS2564: Property 'm' has no initializer and is not definitely assigned in the constructor.
        a.ts(6,67): error TS2687: All declarations of 'm' must have identical modifiers.
        a.ts(6,67): error TS2717: Subsequent property declarations must have the same type.  Property 'm' must be of type 'string', but here has type 'number | undefined'.
        a.ts(7,34): error TS2300: Duplicate identifier 'm'.
        a.ts(7,34): error TS2687: All declarations of 'm' must have identical modifiers.
        a.ts(7,65): error TS2300: Duplicate identifier 'm'.
        a.ts(7,65): error TS2403: Subsequent variable declarations must have the same type.  Variable 'm' must be of type 'number | undefined', but here has type 'string'.
        a.ts(7,65): error TS2687: All declarations of 'm' must have identical modifiers.
        a.ts(8,34): error TS2300: Duplicate identifier 'm'.
        a.ts(8,34): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(8,45): error TS2300: Duplicate identifier 'm'.
        a.ts(8,63): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(9,41): error TS2300: Duplicate identifier 'm'.
        a.ts(9,41): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(9,67): error TS2300: Duplicate identifier 'm'.
        a.ts(10,35): error TS2300: Duplicate identifier '#m'.
        a.ts(10,35): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(10,55): error TS2300: Duplicate identifier '#m'.
        a.ts(11,35): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(12,35): error TS2300: Duplicate identifier 'm'.
        a.ts(12,55): error TS2300: Duplicate identifier 'm'.
        a.ts(13,39): error TS2300: Duplicate identifier 'm'.
        a.ts(13,66): error TS2300: Duplicate identifier 'm'.
        a.ts(13,66): error TS2322: Type 'string' is not assignable to type 'number'.
        a.ts(13,66): error TS2717: Subsequent property declarations must have the same type.  Property 'm' must be of type 'string', but here has type 'number'.
        a.ts(14,35): error TS2300: Duplicate identifier 'm'.
        a.ts(14,35): error TS2687: All declarations of 'm' must have identical modifiers.
        a.ts(14,47): error TS2300: Duplicate identifier 'm'.
        a.ts(14,47): error TS2687: All declarations of 'm' must have identical modifiers.
        a.ts(14,47): error TS2717: Subsequent property declarations must have the same type.  Property 'm' must be of type 'number | undefined', but here has type 'number'.
        a.ts(15,44): error TS2564: Property 'm' has no initializer and is not definitely assigned in the constructor.
        a.ts(15,45): error TS1276: An 'accessor' property cannot be declared optional.
        a.ts(15,64): error TS2322: Type 'number' is not assignable to type 'never'.
        a.ts(16,35): error TS2300: Duplicate identifier 'm'.
        a.ts(16,50): error TS2300: Duplicate identifier 'm'."
      `);
      expect(exitCode).toBe(1);
    });

    test("TS2417 prints both `prototype` members of a mixin of a mixin", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true}, "files": ["a.ts"]}`,
        "a.ts": `function Mix<X extends new (...a: any[]) => {}>(b: X) { return class extends b { }; }
class K { static s = 1; k = 1; }
export function h1() { const r: never = Mix(Mix(K)); }
export function h2() { class C extends Mix(Mix(K)) { static s = "x"; } }
export function h3() { const a = Mix(K); const b = Mix(a); const r: never = b; const x: { q: 1 } = b; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,30): error TS2322: Type '{ new (...a: any[]): Mix.(Anonymous class); prototype: Mix.(Anonymous class); } & { ...; } & typeof K' is not assignable to type 'never'.
        a.ts(4,30): error TS2417: Class static side 'typeof C' incorrectly extends base class static side '{ prototype: Mix.(Anonymous class); } & { prototype: Mix.(Anonymous class); } & typeof K'.
          Type 'typeof C' is not assignable to type 'typeof K'.
            Types of property 's' are incompatible.
              Type 'string' is not assignable to type 'number'.
        a.ts(5,66): error TS2322: Type '{ new (...a: any[]): Mix.(Anonymous class); prototype: Mix.(Anonymous class); } & { ...; } & typeof K' is not assignable to type 'never'.
        a.ts(5,86): error TS2322: Type '{ new (...a: any[]): Mix.(Anonymous class); prototype: Mix.(Anonymous class); } & { ...; } & typeof K' is not assignable to type '{ q: 1; }'."
      `);
      expect(exitCode).toBe(1);
    });

    test("TS2417 for a private static member of a mixin", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true}, "files": ["a.ts"]}`,
        "a.ts": `export function f2_7_0_10_5() { function Mix<X extends new (...a: any[]) => {}>(b: X) { return class extends b { private static m?: number; }; } class C extends Mix(Object) { static override m: number = 1; } }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,152): error TS2417: Class static side 'typeof C' incorrectly extends base class static side '{ m?: number | undefined; prototype: Mix.(Anonymous class); } & { readonly prototype: Object; getPrototypeOf(o: any): any; getOwnPropertyDescriptor(o: any, p: PropertyKey): PropertyDescriptor | undefined; ... 20 more ...; groupBy<K extends PropertyKey, T>(items: Iterable<...>, keySelector: (item: T, index: number) =...'.
          Type 'typeof C' is not assignable to type '{ m?: number; prototype: Mix.(Anonymous class); }'.
            Property 'm' is private in type '{ m?: number | undefined; prototype: Mix.(Anonymous class); }' but not in type 'typeof C'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an instantiated `{}` in an intersection", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true}, "files": ["a.ts"]}`,
        "a.ts": `declare function both<T extends {}, U>(t: T, u: U): T & U;
export function k1() { class C { x = both({}, this); y = 1; } const r: never = new C().x; }
export function k2() { class C { y = 1; } function f<T>(t: T) { return both({}, t); } const r: never = f(new C()); }
export function k3() { class C { y = 1; } type A<T> = {} & T; const r: never = null! as A<C>; }
export function k4() { class C { x!: {} & this; y = 1; } const r: never = new C().x; }
export function k5() { class C { x() { return both({}, this); } y = 1; } const r: never = new C().x(); }
export function k6() { class C { y = 1; } const e = {}; function f<T>(t: T) { return both(e, t); } const r: never = f(new C()); }
export function k7() { class C { x = both({ a: 1 }, this); y = 1; } const r: never = new C().x; }
export function k8() { class C { y = 1; } const r: never = both({}, new C()); }
export function k9() { class C { y = 1; } function f<T>(t: T) { const q = both({}, t); return q; } const r: never = f(new C()); }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,69): error TS2322: Type '{} & C' is not assignable to type 'never'.
        a.ts(3,93): error TS2322: Type '{} & C' is not assignable to type 'never'.
        a.ts(4,69): error TS2322: Type 'C' is not assignable to type 'never'.
        a.ts(5,64): error TS2322: Type 'C' is not assignable to type 'never'.
        a.ts(6,80): error TS2322: Type '{} & C' is not assignable to type 'never'.
        a.ts(7,106): error TS2322: Type 'C' is not assignable to type 'never'.
        a.ts(8,75): error TS2322: Type '{ a: number; } & C' is not assignable to type 'never'.
        a.ts(9,49): error TS2322: Type 'C' is not assignable to type 'never'.
        a.ts(10,106): error TS2322: Type '{} & C' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("TS2305 names the module as the first import of the file does", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "paths": {"@/*": ["./src/*"]}}, "include": ["src"]}`,
        "node_modules/dep/lib/index.d.ts": `export declare const ok: number;
`,
        "node_modules/dep/lib/other.d.ts": `export declare const ok: number;
`,
        "node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "types": "lib/index.d.ts" }
`,
        "package.json": `{ "name": "app", "version": "1.0.0", "imports": { "#m": "./src/m.ts" }, "exports": { "./m": "./src/m.ts" } }
`,
        "src/deep/alias.ts": `import { d1 } from "@/m";
import { d2 } from "../m";
import { d3 } from "dep";
import { d4 } from "dep/lib/index";
import { d5 } from "dep/lib/other";
import { d6 } from "dep/lib/other.js";
export { d1, d2, d3, d4, d5, d6 };
export type T = typeof import("../m").nope;
`,
        "src/m.ts": `export const ok = 1;
`,
        "src/named.ts": `import { c1 } from "#m";
import { c2 } from "@/m";
import { c3 } from "app/m";
export { c1, c2, c3 };
`,
        "src/second-first.ts": `import { b1 } from "./m.js";
import { b2 } from "./m";
export { b1, b2 };
`,
        "src/two.ts": `import { a1 } from "./m";
import { a2 } from "./m.js";
import { a3 } from "./m.ts";
export { a4 } from "./m.js";
export { a1, a2, a3 };
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "src/deep/alias.ts(1,10): error TS2305: Module '"@/m"' has no exported member 'd1'.
        src/deep/alias.ts(2,10): error TS2305: Module '"@/m"' has no exported member 'd2'.
        src/deep/alias.ts(3,10): error TS2305: Module '"dep"' has no exported member 'd3'.
        src/deep/alias.ts(4,10): error TS2305: Module '"dep"' has no exported member 'd4'.
        src/deep/alias.ts(5,10): error TS2305: Module '"dep/lib/other"' has no exported member 'd5'.
        src/deep/alias.ts(6,10): error TS2305: Module '"dep/lib/other"' has no exported member 'd6'.
        src/deep/alias.ts(8,39): error TS2694: Namespace '"<dir>/src/m"' has no exported member 'nope'.
        src/named.ts(1,10): error TS2305: Module '"#m"' has no exported member 'c1'.
        src/named.ts(2,10): error TS2305: Module '"#m"' has no exported member 'c2'.
        src/named.ts(3,10): error TS2305: Module '"#m"' has no exported member 'c3'.
        src/second-first.ts(1,10): error TS2305: Module '"./m.js"' has no exported member 'b1'.
        src/second-first.ts(2,10): error TS2305: Module '"./m.js"' has no exported member 'b2'.
        src/two.ts(1,10): error TS2305: Module '"./m"' has no exported member 'a1'.
        src/two.ts(2,10): error TS2305: Module '"./m"' has no exported member 'a2'.
        src/two.ts(3,10): error TS2305: Module '"./m"' has no exported member 'a3'.
        src/two.ts(3,20): error TS5097: An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.
        src/two.ts(4,10): error TS2305: Module '"./m"' has no exported member 'a4'."
      `);
      expect(exitCode).toBe(1);
    });

    test("the run that reports an error stores its failures in the relation cache", async () => {
      using dir = project({
        "a.ts": `interface AB { bt(): ABT; z: number }
interface ABT { connect(w: string, o?: number): Promise<AB>; connect(o: { w?: string }): Promise<AB>; launch(): Promise<AB>; other(): AC }
interface AC { pages(): AB[]; q: number }
declare class CB { bt(): CBT; z: number }
declare class CBT { connect(o: { w: string }): Promise<CB>; connect(e: string, o?: number): Promise<CB>; launch(): Promise<CB>; other(): CC }
declare class CC { pages(): CB[]; q: string }
export const x: AB = null! as CB;
export class D implements ABT {
  connect(o: { w: string }): Promise<CB>; connect(e: string, o?: number): Promise<CB>; connect(): any {}
  launch(): Promise<CB> { return null!; }
  other(): CC { return null!; }
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(7,14): error TS2322: Type 'CB' is not assignable to type 'AB'.
          The types returned by 'bt().connect' are incompatible between these types.
            Type '{ (o: { w: string; }): Promise<CB>; (e: string, o?: number | undefined): Promise<CB>; }' is not assignable to type '{ (w: string, o?: number | undefined): Promise<AB>; (o: { w?: string | undefined; }): Promise<AB>; }'.
              Types of parameters 'o' and 'w' are incompatible.
                Type 'string' is not assignable to type '{ w: string; }'.
        a.ts(9,3): error TS2416: Property 'connect' in type 'D' is not assignable to the same property in base type 'ABT'.
          Type '{ (o: { w: string; }): Promise<CB>; (e: string, o?: number | undefined): Promise<CB>; }' is not assignable to type '{ (w: string, o?: number | undefined): Promise<AB>; (o: { w?: string | undefined; }): Promise<AB>; }'.
            Types of parameters 'o' and 'w' are incompatible.
              Type 'string' is not assignable to type '{ w: string; }'.
        a.ts(9,43): error TS2416: Property 'connect' in type 'D' is not assignable to the same property in base type 'ABT'.
          Type '{ (o: { w: string; }): Promise<CB>; (e: string, o?: number | undefined): Promise<CB>; }' is not assignable to type '{ (w: string, o?: number | undefined): Promise<AB>; (o: { w?: string | undefined; }): Promise<AB>; }'.
            Types of parameters 'o' and 'w' are incompatible.
              Type 'string' is not assignable to type '{ w: string; }'.
        a.ts(9,88): error TS2416: Property 'connect' in type 'D' is not assignable to the same property in base type 'ABT'.
          Type '{ (o: { w: string; }): Promise<CB>; (e: string, o?: number | undefined): Promise<CB>; }' is not assignable to type '{ (w: string, o?: number | undefined): Promise<AB>; (o: { w?: string | undefined; }): Promise<AB>; }'.
            Types of parameters 'o' and 'w' are incompatible.
              Type 'string' is not assignable to type '{ w: string; }'.
        a.ts(10,3): error TS2416: Property 'launch' in type 'D' is not assignable to the same property in base type 'ABT'.
          Type '() => Promise<CB>' is not assignable to type '() => Promise<AB>'.
            Type 'Promise<CB>' is not assignable to type 'Promise<AB>'.
              Type 'CB' is not assignable to type 'AB'.
                The types returned by 'bt().connect' are incompatible between these types.
                  Type '{ (o: { w: string; }): Promise<CB>; (e: string, o?: number | undefined): Promise<CB>; }' is not assignable to type '{ (w: string, o?: number | undefined): Promise<AB>; (o: { w?: string | undefined; }): Promise<AB>; }'.
                    Types of parameters 'o' and 'w' are incompatible.
                      Type 'string' is not assignable to type '{ w: string; }'.
        a.ts(11,3): error TS2416: Property 'other' in type 'D' is not assignable to the same property in base type 'ABT'.
          Type '() => CC' is not assignable to type '() => AC'.
            Type 'CC' is not assignable to type 'AC'.
              The types returned by 'pages()' are incompatible between these types.
                Type 'CB[]' is not assignable to type 'AB[]'.
                  Type 'CB' is not assignable to type 'AB'.
                    The types returned by 'bt().connect' are incompatible between these types.
                      Type '{ (o: { w: string; }): Promise<CB>; (e: string, o?: number | undefined): Promise<CB>; }' is not assignable to type '{ (w: string, o?: number | undefined): Promise<AB>; (o: { w?: string | undefined; }): Promise<AB>; }'.
                        Types of parameters 'o' and 'w' are incompatible.
                          Type 'string' is not assignable to type '{ w: string; }'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an optional static member of a mixin", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "noErrorTruncation": true}}`,
        "a.ts": `export function f1() { function Mix<X extends new (...a: any[]) => {}>(b: X) { return class extends b { static m?: number; }; } class C extends Mix(Object) { static m: string = ""; } }
export function f2() { function Mix<X extends new (...a: any[]) => {}>(b: X) { return class extends b { private static m?: number; }; } class C extends Mix(Object) { static m: number = 1; } }
export class P1 { ["m"] = 1; set m(v) {} }
export declare class P2 { "m": any; set m(v); }
export declare class P3 { static ["m"]: any; static get m(); }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,135): error TS2417: Class static side 'typeof C' incorrectly extends base class static side '{ m?: number | undefined; prototype: Mix.(Anonymous class); } & { readonly prototype: Object; getPrototypeOf(o: any): any; getOwnPropertyDescriptor(o: any, p: PropertyKey): PropertyDescriptor | undefined; getOwnPropertyNames(o: any): string[]; create(o: object | null): any; create(o: object | null, properties: PropertyDescriptorMap & ThisType<any>): any; defineProperty<T>(o: T, p: PropertyKey, attributes: PropertyDescriptor & ThisType<any>): T; defineProperties<T>(o: T, properties: PropertyDescriptorMap & ThisType<any>): T; seal<T>(o: T): T; freeze<T extends Function>(f: T): T; freeze<T extends { [idx: string]: U | null | undefined | object; }, U extends string | bigint | number | boolean | symbol>(o: T): Readonly<T>; freeze<T>(o: T): Readonly<T>; preventExtensions<T>(o: T): T; isSealed(o: any): boolean; isFrozen(o: any): boolean; isExtensible(o: any): boolean; keys(o: object): string[]; keys(o: {}): string[]; assign<T extends {}, U>(target: T, source: U): T & U; assign<T extends {}, U, V>(target: T, source1: U, source2: V): T & U & V; assign<T extends {}, U, V, W>(target: T, source1: U, source2: V, source3: W): T & U & V & W; assign(target: object, ...sources: any[]): any; getOwnPropertySymbols(o: any): symbol[]; is(value1: any, value2: any): boolean; setPrototypeOf(o: any, proto: object | null): any; values<T>(o: ArrayLike<T> | { [s: string]: T; }): T[]; values(o: {}): any[]; entries<T>(o: ArrayLike<T> | { [s: string]: T; }): [string, T][]; entries(o: {}): [string, any][]; getOwnPropertyDescriptors<T>(o: T): { [P in keyof T]: TypedPropertyDescriptor<T[P]>; } & { [x: string]: PropertyDescriptor; }; fromEntries<T = any>(entries: Iterable<readonly [PropertyKey, T]>): { [k: string]: T; }; fromEntries(entries: Iterable<readonly any[]>): any; hasOwn(o: object, v: PropertyKey): boolean; groupBy<K extends PropertyKey, T>(items: Iterable<T>, keySelector: (item: T, index: number) => K): Partial<Record<K, T[]>>; }'.
          Type 'typeof C' is not assignable to type '{ m?: number; prototype: Mix.(Anonymous class); }'.
            Types of property 'm' are incompatible.
              Type 'string' is not assignable to type 'number'.
        a.ts(2,143): error TS2417: Class static side 'typeof C' incorrectly extends base class static side '{ m?: number | undefined; prototype: Mix.(Anonymous class); } & { readonly prototype: Object; getPrototypeOf(o: any): any; getOwnPropertyDescriptor(o: any, p: PropertyKey): PropertyDescriptor | undefined; getOwnPropertyNames(o: any): string[]; create(o: object | null): any; create(o: object | null, properties: PropertyDescriptorMap & ThisType<any>): any; defineProperty<T>(o: T, p: PropertyKey, attributes: PropertyDescriptor & ThisType<any>): T; defineProperties<T>(o: T, properties: PropertyDescriptorMap & ThisType<any>): T; seal<T>(o: T): T; freeze<T extends Function>(f: T): T; freeze<T extends { [idx: string]: U | null | undefined | object; }, U extends string | bigint | number | boolean | symbol>(o: T): Readonly<T>; freeze<T>(o: T): Readonly<T>; preventExtensions<T>(o: T): T; isSealed(o: any): boolean; isFrozen(o: any): boolean; isExtensible(o: any): boolean; keys(o: object): string[]; keys(o: {}): string[]; assign<T extends {}, U>(target: T, source: U): T & U; assign<T extends {}, U, V>(target: T, source1: U, source2: V): T & U & V; assign<T extends {}, U, V, W>(target: T, source1: U, source2: V, source3: W): T & U & V & W; assign(target: object, ...sources: any[]): any; getOwnPropertySymbols(o: any): symbol[]; is(value1: any, value2: any): boolean; setPrototypeOf(o: any, proto: object | null): any; values<T>(o: ArrayLike<T> | { [s: string]: T; }): T[]; values(o: {}): any[]; entries<T>(o: ArrayLike<T> | { [s: string]: T; }): [string, T][]; entries(o: {}): [string, any][]; getOwnPropertyDescriptors<T>(o: T): { [P in keyof T]: TypedPropertyDescriptor<T[P]>; } & { [x: string]: PropertyDescriptor; }; fromEntries<T = any>(entries: Iterable<readonly [PropertyKey, T]>): { [k: string]: T; }; fromEntries(entries: Iterable<readonly any[]>): any; hasOwn(o: object, v: PropertyKey): boolean; groupBy<K extends PropertyKey, T>(items: Iterable<T>, keySelector: (item: T, index: number) => K): Partial<Record<K, T[]>>; }'.
          Type 'typeof C' is not assignable to type '{ m?: number; prototype: Mix.(Anonymous class); }'.
            Property 'm' is private in type '{ m?: number | undefined; prototype: Mix.(Anonymous class); }' but not in type 'typeof C'.
        a.ts(3,19): error TS2300: Duplicate identifier '["m"]'.
        a.ts(3,34): error TS2300: Duplicate identifier '["m"]'.
        a.ts(3,34): error TS7032: Property '["m"]' implicitly has type 'any', because its set accessor lacks a parameter type annotation.
        a.ts(3,36): error TS7006: Parameter 'v' implicitly has an 'any' type.
        a.ts(4,27): error TS2300: Duplicate identifier '"m"'.
        a.ts(4,41): error TS2300: Duplicate identifier '"m"'.
        a.ts(4,41): error TS7032: Property '"m"' implicitly has type 'any', because its set accessor lacks a parameter type annotation.
        a.ts(4,43): error TS7006: Parameter 'v' implicitly has an 'any' type.
        a.ts(5,34): error TS2300: Duplicate identifier '["m"]'.
        a.ts(5,57): error TS2300: Duplicate identifier '["m"]'.
        a.ts(5,57): error TS7033: Property '["m"]' implicitly has type 'any', because its get accessor lacks a return type annotation."
      `);
      expect(exitCode).toBe(1);
    });

    test("`super(..)` in a nested position is checked against the base constructor", async () => {
      using dir = project({
        "a.ts": `class B { constructor(x: number) {} }
export class D1 extends B { constructor() { const { a = super("s") } = {} as { a?: any }; } }
export class D2 extends B { constructor() { const [a = super("s")] = [] as any[]; } }
export class D3 extends B { constructor() { const k = { [String(super("s"))]: 1 }; } }
export class D4 extends B { constructor(x = super("s")) { super(1); } }
declare function g(cb: <T>(x: T) => T): void;
g(x => { const { a = x } = {} as { a?: undefined }; return a; });
g(x => { const [a = x] = [] as undefined[]; return a; });
g(x => { const { a = { v: x } } = {} as { a?: undefined }; return a.v; });
declare function m<T>(v: T, cb: (x: T) => void): void;
m(1, x => { const { a = x.toFixed() } = {} as { a?: string }; const n: number = a; });
m(1, x => { const { a = (y = x) => y } = {} as { a?: undefined }; const n: string = a(); });
export function* y1() { const { a = yield 1 } = {} as { a?: number }; return a; }
export async function w1() { const { a = await Promise.resolve(1) } = {} as { a?: undefined }; const s: string = a; }
export function r1<T>(x: T) { const { a = () => x } = {} as { a?: undefined }; return a; } export const q1: number = r1(1)();
export function r2<T>(x: T) { const { a = class { p = x } } = {} as { a?: undefined }; return a; } export const q2: number = new (r2(1))().p;
export function r3<T>(x: T) { const { a = [x] } = {} as { a?: undefined }; return a; } export const q3: number = r3(1)[0];
export function r4<T>(x: T) { enum E { A = ({ v: x }, 1) } return E.A; }
export function r5<T>(x: T) { class K { [String({ v: x }.v)] = { v: x }; } return new K(); }
export function r6<T>(x: T) { const { a = <const>{ v: x } } = {} as { a?: undefined }; return a; } export const q6: number = r6(1).v;
export function r7<T>(x: T) { const { a = { ...{ v: x } } } = {} as { a?: undefined }; return a; } export const q7: number = r7(1).v;
export function r8<T>(x: T) { namespace N { export const o = { v: 1 }; } return N.o; }
export function t1(this: { k: number }) { const { a = this.k } = {} as { a?: undefined }; const s: string = a; }
export function t2(this: { k: number }) { const { a = () => this.k } = {} as { a?: undefined }; const s: string = a(); }
export function n1(v: string | number) { if (typeof v === "string") { const { a = v } = {} as { a?: undefined }; const s: number = a; } }
export function n2(v: string | number) { if (typeof v === "string") { const { a = () => v } = {} as { a?: undefined }; const s: number = a(); } }
export function n3(v: string | number) { if (typeof v === "string") { const [a = { p: v }] = [] as undefined[]; const s: number = a.p; } }
export function a1() { const { a = arguments.length } = {} as { a?: undefined }; const s: string = a; }
export function nt() { const { a = new.target } = {} as { a?: undefined }; const s: string = a; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,63): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
        a.ts(3,62): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
        a.ts(4,71): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.
        a.ts(5,45): error TS2336: 'super' cannot be referenced in constructor arguments.
        a.ts(11,69): error TS2322: Type 'string' is not assignable to type 'number'.
        a.ts(12,73): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(14,102): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(18,45): error TS2695: Left side of comma operator is unused and has no side effects.
        a.ts(19,41): error TS1166: A computed property name in a class property declaration must have a simple literal type or a 'unique symbol' type.
        a.ts(22,31): error TS1235: A namespace declaration is only allowed at the top level of a namespace or module.
        a.ts(23,97): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(24,103): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(25,120): error TS2322: Type 'string' is not assignable to type 'number'.
        a.ts(26,126): error TS2322: Type 'string' is not assignable to type 'number'.
        a.ts(27,119): error TS2322: Type 'string' is not assignable to type 'number'.
        a.ts(28,88): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(29,82): error TS2322: Type '() => void' is not assignable to type 'string'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a spread and a `for..in` of `null` or `undefined`", async () => {
      using dir = project({
        "a.ts": `declare function g(...a: any[]): void; declare function h(a: number, ...b: number[]): void; declare function k<T extends any[]>(...a: T): T;
export function f1(v: null) { return [...v]; }
export function f2(v: undefined) { return [...v]; }
export function f3(v: null | undefined) { return [...v]; }
export function f4(v: null) { g(...v); }
export function f5(v: undefined) { h(1, ...v); }
export function f6(v: null) { return k(...v); }
export function f7() { return [...null]; }
export function f8() { return [...undefined]; }
export function f9() { g(...null); }
export function f10(v: null) { return new Array(...v); }
export function f11(v: number[] | null) { return [...v]; }
export function f12(v: number[] | undefined) { g(...v); }
export function f13(v: void) { return [...v]; }
export function f14(v: never) { return [...v]; }
export function f15(v: null) { const [...r] = v; return r; }
export function f16(v: null) { let r; [...r] = v; return r; }
export function f17(v: null) { for (const x of v) {} }
export function f18(v: null) { return [1, ...v, 2]; }
export function f19(v: null) { return [...(v)]; }
export function f20(v: null) { return [...v!]; }
export function f21(v?: null) { return Math.max(...v); }
export function f22(v: null) { const a: number[] = [...v]; return a; }
export function f23(v: null) { return { a: [...v] }; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,42): error TS2488: Type 'null' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(3,47): error TS2488: Type 'undefined' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(4,54): error TS2488: Type 'null | undefined' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(5,36): error TS2488: Type 'null' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(6,44): error TS2488: Type 'undefined' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(7,43): error TS2488: Type 'null' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(8,35): error TS2488: Type 'null' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(9,35): error TS2488: Type 'undefined' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(10,29): error TS2488: Type 'null' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(11,52): error TS2488: Type 'null' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(12,54): error TS2488: Type 'number[] | null' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(13,53): error TS2488: Type 'number[] | undefined' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(14,43): error TS2488: Type 'void' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(16,38): error TS2488: Type 'null' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(17,39): error TS2488: Type 'null' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(18,48): error TS18047: 'v' is possibly 'null'.
        a.ts(19,46): error TS2488: Type 'null' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(20,43): error TS2488: Type 'null' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(22,52): error TS2488: Type 'null | undefined' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(23,56): error TS2488: Type 'null' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(24,48): error TS2488: Type 'null' must have a '[Symbol.iterator]()' method that returns an iterator."
      `);
      expect(exitCode).toBe(1);
    });

    test("TS2354 where an emit helper is needed in a computed name, an enum initializer or an interface", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "es2015", "module": "esnext", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "importHelpers": true, "experimentalDecorators": true, "skipLibCheck": true}}`,
        "cexpr.ts": `export const C = class { [(async () => "k") as any]() {} };
`,
        "cexprp.ts": `export const C = class { p = async () => 1; };
`,
        "deco.ts": `declare const d: any; export class K { @(d(async () => 1)) m() {} }
`,
        "enum.ts": `export enum E { A = (async () => 1).length }
`,
        "ext.ts": `export class K extends ((async () => 1) as any) {}
`,
        "gkey.ts": `export const o = { get [(async () => "k") as any]() { return 1; } };
`,
        "ikey.ts": `export interface I { [(async () => "k") as any]: 1 }
`,
        "mkey.ts": `export class K { [(async () => "k") as any]() {} }
`,
        "ns.ts": `export namespace N { export const f = async () => 1; }
`,
        "okey.ts": `export const o = { [(async () => "k") as any]: 1 };
`,
        "omkey.ts": `export const o = { [(async () => "k") as any]() {} };
`,
        "patdef.ts": `declare const v: any; export const { a = async () => 1 } = v;
`,
        "patkey.ts": `declare const v: any; export const { [(async () => "k") as any]: a } = v;
`,
        "pdeco.ts": `declare const d: any; export class K { m(@(d(async () => 1)) p: any) {} }
`,
        "pkey.ts": `export class K { [(async () => "k") as any] = 1; }
`,
        "two.ts": `export const C = class { [(async () => "k") as any]() {} }; export const f = async () => 1;
`,
        "two2.ts": `export const o = { m() { return async () => 1; }, [(async () => "k") as any]: 1 };
`,
        "two3.ts": `export enum E { A = (async () => 1).length } export const f = async () => 1;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "cexpr.ts(1,28): error TS2354: This syntax requires an imported helper but module 'tslib' cannot be found.
        cexprp.ts(1,30): error TS2354: This syntax requires an imported helper but module 'tslib' cannot be found.
        deco.ts(1,40): error TS2354: This syntax requires an imported helper but module 'tslib' cannot be found.
        enum.ts(1,22): error TS2354: This syntax requires an imported helper but module 'tslib' cannot be found.
        ext.ts(1,26): error TS2354: This syntax requires an imported helper but module 'tslib' cannot be found.
        gkey.ts(1,26): error TS2354: This syntax requires an imported helper but module 'tslib' cannot be found.
        ikey.ts(1,22): error TS1169: A computed property name in an interface must refer to an expression whose type is a literal type or a 'unique symbol' type.
        ikey.ts(1,24): error TS2354: This syntax requires an imported helper but module 'tslib' cannot be found.
        mkey.ts(1,20): error TS2354: This syntax requires an imported helper but module 'tslib' cannot be found.
        ns.ts(1,39): error TS2354: This syntax requires an imported helper but module 'tslib' cannot be found.
        okey.ts(1,22): error TS2354: This syntax requires an imported helper but module 'tslib' cannot be found.
        omkey.ts(1,22): error TS2354: This syntax requires an imported helper but module 'tslib' cannot be found.
        patdef.ts(1,42): error TS2354: This syntax requires an imported helper but module 'tslib' cannot be found.
        patkey.ts(1,40): error TS2354: This syntax requires an imported helper but module 'tslib' cannot be found.
        pdeco.ts(1,42): error TS2354: This syntax requires an imported helper but module 'tslib' cannot be found.
        pkey.ts(1,18): error TS1166: A computed property name in a class property declaration must have a simple literal type or a 'unique symbol' type.
        pkey.ts(1,20): error TS2354: This syntax requires an imported helper but module 'tslib' cannot be found.
        two.ts(1,78): error TS2354: This syntax requires an imported helper but module 'tslib' cannot be found.
        two2.ts(1,53): error TS2354: This syntax requires an imported helper but module 'tslib' cannot be found.
        two3.ts(1,22): error TS2354: This syntax requires an imported helper but module 'tslib' cannot be found."
      `);
      expect(exitCode).toBe(1);
    });

    test("`delete` of a property of a union with `void`", async () => {
      using dir = project({
        "a.ts": `interface O { p: number; q?: number }
export function d1(v: O | void) { delete v.p; }
export function d2(v: O | void) { delete v.q; }
export function d3(v: O | undefined) { delete v.p; }
export function d4(v: O | null) { delete v.p; }
export function d5(v: O | void | undefined) { delete v.p; }
export function d6(v: void) { delete v.p; }
export function d7(v: O | void) { delete v["p"]; }
export function d8(v: O | string) { delete v.p; }
export function d9<T extends O | void>(v: T) { delete v.p; }
export function d10<T extends O | undefined>(v: T) { delete v.p; }
export function d11(v: O | void) { delete v?.p; }
export function d12(v: O | undefined) { delete v?.p; }
export function d13(v: O | undefined) { delete v!.p; }
export function d14(v: { readonly p: number } | void) { delete v.p; }
export function d15(v: { readonly p: number } | undefined) { delete v.p; }
export function d16(v: unknown) { delete v.p; }
export function d17(v: never) { delete v.p; }
export function d18(v: O & { r: 1 } | void) { delete v.p; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,44): error TS2339: Property 'p' does not exist on type 'void | O'.
          Property 'p' does not exist on type 'void'.
        a.ts(3,44): error TS2339: Property 'q' does not exist on type 'void | O'.
          Property 'q' does not exist on type 'void'.
        a.ts(4,47): error TS18048: 'v' is possibly 'undefined'.
        a.ts(4,47): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(5,42): error TS18047: 'v' is possibly 'null'.
        a.ts(5,42): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(6,54): error TS18048: 'v' is possibly 'undefined'.
        a.ts(6,54): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(7,40): error TS2339: Property 'p' does not exist on type 'void'.
        a.ts(8,42): error TS7053: Element implicitly has an 'any' type because expression of type '"p"' can't be used to index type 'void | O'.
          Property 'p' does not exist on type 'void | O'.
        a.ts(9,46): error TS2339: Property 'p' does not exist on type 'string | O'.
          Property 'p' does not exist on type 'string'.
        a.ts(10,57): error TS2339: Property 'p' does not exist on type 'void | O'.
          Property 'p' does not exist on type 'void'.
        a.ts(11,61): error TS18048: 'v' is possibly 'undefined'.
        a.ts(11,61): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(12,43): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(13,48): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(14,48): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(15,66): error TS2339: Property 'p' does not exist on type 'void | { readonly p: number; }'.
          Property 'p' does not exist on type 'void'.
        a.ts(16,69): error TS18048: 'v' is possibly 'undefined'.
        a.ts(16,69): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(17,42): error TS18046: 'v' is of type 'unknown'.
        a.ts(18,42): error TS2339: Property 'p' does not exist on type 'never'.
        a.ts(19,56): error TS2339: Property 'p' does not exist on type 'void | (O & { r: 1; })'.
          Property 'p' does not exist on type 'void'."
      `);
      expect(exitCode).toBe(1);
    });

    test("two `NoInfer<..>` in one list of type arguments are cut off at half the length", async () => {
      using dir = project({
        "a.ts": `import type { Far, Near } from "./m";
type H<R, S> = { r: R; s: S } | ((c: R, s: S) => void);
type Wrap<T> = { w: T };
// Long: the two \`NoInfer\` arguments are printed twice, and the second time the limit is passed.
declare function long<P extends string>(p: P, h: H<NoInfer<Wrap<Wrap<{ path: P; alpha: {}; beta: {}; gamma: {}; delta: {} }>>>, NoInfer<{ decorator: {}; store: {}; derive: {}; resolve: {} } & { extra: P }>>): void;
long("/", 1);
// Short: nothing is cut off, and the second time names are fully qualified.
declare function short(h: H<NoInfer<Far>, NoInfer<Near>>): void;
short(1);
declare function one(h: H<NoInfer<Far>, Near>): void;
one(1);
declare function same(h: H<NoInfer<Far>, NoInfer<Far>>): void;
same(1);
declare function tuple(h: [NoInfer<Far>, NoInfer<Near>]): void;
tuple(1);
declare function union(h: NoInfer<Far> | NoInfer<Near>): void;
union(1);
declare function inter(h: NoInfer<Far> & NoInfer<Near>): void;
inter(1);
declare function upper<T extends string, U extends string>(t: T, u: U, h: H<Uppercase<T>, Uppercase<U>>): void;
function g<T extends string, U extends string>(t: T, u: U) { upper(t, u, 1); }
`,
        "m.ts": `export interface Far { far: 1 }
export interface Near { near: 1 }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(6,11): error TS2345: Argument of type 'number' is not assignable to parameter of type 'H<NoInfer<Wrap<Wrap<{ ...; }>>>, NoInfer<{ ...; } & { ...; }>>'.
        a.ts(9,7): error TS2345: Argument of type 'number' is not assignable to parameter of type 'H<NoInfer<Far>, NoInfer<Near>>'.
        a.ts(11,5): error TS2345: Argument of type 'number' is not assignable to parameter of type 'H<NoInfer<Far>, Near>'.
        a.ts(13,6): error TS2345: Argument of type 'number' is not assignable to parameter of type 'H<NoInfer<Far>, NoInfer<Far>>'.
        a.ts(15,7): error TS2345: Argument of type 'number' is not assignable to parameter of type '[NoInfer<Far>, NoInfer<Near>]'.
        a.ts(17,7): error TS2345: Argument of type 'number' is not assignable to parameter of type 'NoInfer<Far> | NoInfer<Near>'.
        a.ts(19,7): error TS2345: Argument of type 'number' is not assignable to parameter of type 'NoInfer<Far> & NoInfer<Near>'.
          Type 'number' is not assignable to type 'Far'.
        a.ts(21,74): error TS2345: Argument of type 'number' is not assignable to parameter of type 'H<Uppercase<T>, Uppercase<U>>'."
      `);
      expect(exitCode).toBe(1);
    });

    test("two elided types in one tuple count as identifier references", async () => {
      using dir = project({
        "a.ts": `namespace M100 { declare function f(): { both: [ReturnType<typeof f>, ReturnType<typeof g>]; zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz: 1; t: { a: 1; b: 2 }; u: [1, 2, 3, 4, 5, 6, 7, 8] }; declare function g(): { gg: [ReturnType<typeof f>, ReturnType<typeof g>] }; const v: ReturnType<typeof f> = null; }
namespace M105 { declare function f(): { both: [ReturnType<typeof f>, ReturnType<typeof g>]; zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz: 1; t: { a: 1; b: 2 }; u: [1, 2, 3, 4, 5, 6, 7, 8] }; declare function g(): { gg: [ReturnType<typeof f>, ReturnType<typeof g>] }; const v: ReturnType<typeof f> = null; }
namespace M108 { declare function f(): { both: [ReturnType<typeof f>, ReturnType<typeof g>]; zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz: 1; t: { a: 1; b: 2 }; u: [1, 2, 3, 4, 5, 6, 7, 8] }; declare function g(): { gg: [ReturnType<typeof f>, ReturnType<typeof g>] }; const v: ReturnType<typeof f> = null; }
namespace M111 { declare function f(): { both: [ReturnType<typeof f>, ReturnType<typeof g>]; zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz: 1; t: { a: 1; b: 2 }; u: [1, 2, 3, 4, 5, 6, 7, 8] }; declare function g(): { gg: [ReturnType<typeof f>, ReturnType<typeof g>] }; const v: ReturnType<typeof f> = null; }
namespace M114 { declare function f(): { both: [ReturnType<typeof f>, ReturnType<typeof g>]; zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz: 1; t: { a: 1; b: 2 }; u: [1, 2, 3, 4, 5, 6, 7, 8] }; declare function g(): { gg: [ReturnType<typeof f>, ReturnType<typeof g>] }; const v: ReturnType<typeof f> = null; }
namespace M120 { declare function f(): { both: [ReturnType<typeof f>, ReturnType<typeof g>]; zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz: 1; t: { a: 1; b: 2 }; u: [1, 2, 3, 4, 5, 6, 7, 8] }; declare function g(): { gg: [ReturnType<typeof f>, ReturnType<typeof g>] }; const v: ReturnType<typeof f> = null; }
namespace M125 { declare function f(): { both: [ReturnType<typeof f>, ReturnType<typeof g>]; zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz: 1; t: { a: 1; b: 2 }; u: [1, 2, 3, 4, 5, 6, 7, 8] }; declare function g(): { gg: [ReturnType<typeof f>, ReturnType<typeof g>] }; const v: ReturnType<typeof f> = null; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,331): error TS2322: Type 'null' is not assignable to type '{ both: [..., { gg: [..., ...]; }]; zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz: 1; t: { a: 1; b: 2; }; u: [1, 2, 3, 4, 5, 6, 7, 8]; }'.
        a.ts(2,336): error TS2322: Type 'null' is not assignable to type '{ both: [..., { gg: [..., ...]; }]; zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz: 1; t: { a: 1; b: 2; }; u: [1, 2, 3, ... 4 more ..., 8]; }'.
        a.ts(3,339): error TS2322: Type 'null' is not assignable to type '{ both: [..., { gg: [..., ...]; }]; zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz: 1; t: { a: 1; b: 2; }; u: [1, 2, ... 5 more ..., 8]; }'.
        a.ts(4,342): error TS2322: Type 'null' is not assignable to type '{ both: [..., { gg: [..., ...]; }]; zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz: 1; t: { a: 1; b: 2; }; u: [1, ... 6 more ..., 8]; }'.
        a.ts(5,345): error TS2322: Type 'null' is not assignable to type '{ both: [..., { gg: [..., ...]; }]; zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz: 1; t: { a: 1; b: 2; }; u: [...]; }'.
        a.ts(6,351): error TS2322: Type 'null' is not assignable to type '{ both: [..., { gg: [..., ...]; }]; zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz: 1; t: { a: 1; b: 2; }; u: [...]; }'.
        a.ts(7,356): error TS2322: Type 'null' is not assignable to type '{ both: [..., { gg: [..., ...]; }]; zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz: 1; t: { ...; }; u: [...]; }'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an alias of a lone named union is that union", async () => {
      using dir = project({
        "a.ts": `type U<T> = T | undefined;
type W<T> = U<T> | undefined;
type V = U<{ a: 1 }> | undefined;
type X<T> = U<T> | never;
type Y<T> = U<U<T>>;
type Z<T> = U<T> | U<T>;
type K<T> = keyof T | never;
type Q<T> = W<T> | undefined;
enum E { A, B }
type EE = E | E.A;
type EG<T> = T | E;
type EH<T> = EG<T> | E.A;
let a: W<{ a: 1 }> = null;
let b: V = null;
let c: X<{ a: 1 }> = null;
let d: Y<{ a: 1 }> = null;
let e: Z<{ a: 1 }> = null;
let f: K<{ a: 1; b: 2 }> = null;
let g: Q<{ a: 1 }> = null;
let h: EE = null;
let i: EH<{ a: 1 }> = null;
function gen<P>(p: P, a: W<P>, b: U<U<P>>, c: X<P>, d: Y<P>, e: Z<P>, g: Q<P>, i: EH<P>, j: [W<P>], k: U<W<P>>): void {
    a = null; b = null; c = null; d = null; e = null; g = null; i = null; j = null; k = null;
}
declare function call<P>(p: P, h: { a: W<P>; b: U<U<P>>; c: X<P>; d: Y<P>; e: Z<P>; g: Q<P>; i: EH<P>; k: U<W<P>> }): void;
call("/", null);
declare function c1<P>(p: P, h: W<P>): void; c1({ a: 1 }, null);
declare function c2<P>(p: P, h: U<U<P>>): void; c2({ a: 1 }, null);
declare function c3<P>(p: P, h: X<P>): void; c3({ a: 1 }, null);
declare function c4<P>(p: P, h: Y<P>): void; c4({ a: 1 }, null);
declare function c5<P>(p: P, h: Z<P>): void; c5({ a: 1 }, null);
declare function c6<P>(p: P, h: Q<P>): void; c6({ a: 1 }, null);
declare function c7<P>(p: P, h: EH<P>): void; c7({ a: 1 }, null);
declare function c8<P>(p: P, h: U<W<P>>): void; c8({ a: 1 }, null);
declare function c9<P>(p: P, h: W<U<P>>): void; c9({ a: 1 }, null);
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(13,5): error TS2322: Type 'null' is not assignable to type 'U<{ a: 1; }>'.
        a.ts(14,5): error TS2322: Type 'null' is not assignable to type 'V'.
        a.ts(15,5): error TS2322: Type 'null' is not assignable to type 'U<{ a: 1; }>'.
        a.ts(16,5): error TS2322: Type 'null' is not assignable to type 'U<{ a: 1; }>'.
        a.ts(17,5): error TS2322: Type 'null' is not assignable to type 'U<{ a: 1; }>'.
        a.ts(18,5): error TS2322: Type 'null' is not assignable to type '"a" | "b"'.
        a.ts(19,5): error TS2322: Type 'null' is not assignable to type 'U<{ a: 1; }>'.
        a.ts(20,5): error TS2322: Type 'null' is not assignable to type 'EE'.
        a.ts(21,5): error TS2322: Type 'null' is not assignable to type 'EG<{ a: 1; }>'.
        a.ts(23,5): error TS2322: Type 'null' is not assignable to type 'U<P>'.
        a.ts(23,15): error TS2322: Type 'null' is not assignable to type 'U<U<P>>'.
        a.ts(23,25): error TS2322: Type 'null' is not assignable to type 'U<P>'.
        a.ts(23,35): error TS2322: Type 'null' is not assignable to type 'U<P>'.
        a.ts(23,45): error TS2322: Type 'null' is not assignable to type 'U<P>'.
        a.ts(23,55): error TS2322: Type 'null' is not assignable to type 'U<P>'.
        a.ts(23,65): error TS2322: Type 'null' is not assignable to type 'EG<P>'.
        a.ts(23,75): error TS2322: Type 'null' is not assignable to type '[U<P>]'.
        a.ts(23,85): error TS2322: Type 'null' is not assignable to type 'U<U<P>>'.
        a.ts(26,11): error TS2345: Argument of type 'null' is not assignable to parameter of type '{ a: U<string>; b: U<string>; c: U<string>; d: U<string>; e: U<string>; g: U<string>; i: EG<string>; k: U<string>; }'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an assignment, a comparison or `delete` in the initializer of what its operand refers to", async () => {
      using dir = project({
        "a.ts": `declare let t1: { p: typeof a1 }; export const a1 = (t1 = { p: 1 as any });
declare let t2: { p: typeof a2 }; declare let u2: { p: number }; export const a2 = t2 === u2;
declare let t3: { p: typeof a3 }; declare let u3: { p: number }; export const a3 = t3 < u3;
declare let t4: { p?: typeof a4 }; export const a4 = delete t4.p;
declare let t5: { p: typeof a5 }; declare let u5: { p: number }; export const a5 = t5 !== u5;
declare let t6: { p: typeof a6 }; export const a6 = (t6 ??= { p: 1 as any });
declare let t7: { (): typeof a7 }; export const a7 = t7 ? 1 : 2;
declare let t8: { p: typeof a8 }; export const a8 = [t8 = { p: 1 as any }].length;
declare let t9: { p: typeof a9 }; declare function f9(x: unknown): number; export const a9 = f9(t9 = { p: 1 as any });
declare let t10: { p: typeof a10 }; declare let u10: { p: number }; export const a10 = () => t10 === u10;
declare let t11: { p: typeof a11 }[]; export const a11 = ([t11[0]] = [{ p: 1 as any }]);
declare let t12: { p: typeof a12 }; export const a12 = ({ x: t12 } = { x: { p: 1 as any } });
declare let t13: { [k: string]: typeof a13 }; export const a13 = "k" in t13;
declare let t14: { p: typeof a14 }; declare let u14: { p: number }; export const a14 = (() => { switch (t14) { case u14: return 1; } return 2; })();
declare let t15: PromiseLike<typeof a15>; export const a15 = async () => { await t15; return 1; };
declare let t16: { p: typeof a16 } | undefined; export const a16 = t16! === undefined;
declare let t17: { p: typeof a17 }; export const a17 = typeof t17 === "object";
declare let t18: { valueOf(): typeof a18 }; export const a18 = +t18;
declare let t19: { p: typeof a19 }; declare let u19: { p: number }; export const a19 = t19 == u19 ? 1 : 2;
declare let t20: { p: typeof a20 }; export const a20 = \`\${t20}\`;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,19): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(1,48): error TS7022: 'a1' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(2,19): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(2,79): error TS7022: 'a2' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(3,19): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(3,79): error TS7022: 'a3' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,19): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(4,49): error TS7022: 'a4' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,19): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(5,79): error TS7022: 'a5' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,19): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(6,48): error TS7022: 'a6' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,54): error TS2774: This condition will always return true since this function is always defined. Did you mean to call it instead?
        a.ts(8,19): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(8,48): error TS7022: 'a8' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,82): error TS7023: 'a10' implicitly has return type 'any' because it does not have a return type annotation and is referenced directly or indirectly in one of its return expressions.
        a.ts(10,94): error TS2367: This comparison appears to be unintentional because the types '{ p: () => any; }' and '{ p: number; }' have no overlap.
        a.ts(11,20): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(11,52): error TS7022: 'a11' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(12,20): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(12,50): error TS7022: 'a12' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(19,20): error TS2502: 'p' is referenced directly or indirectly in its own type annotation.
        a.ts(19,82): error TS7022: 'a19' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("a rest element in a destructuring assignment", async () => {
      using dir = project({
        "a.ts": `declare let n: number; declare let z: unknown; declare const s: { a: 1; b: 2 }; declare const v: any; declare const u: unknown; declare let q: { b: string };
export function f1() { ({ ...n } = v); }
export function f2() { ({ a: z, ...n } = s); }
export function f3() { ({ a: z, ...q } = s); }
export function f4() { ({ ...q } = v); }
export function f5() { [...n] = v; }
export function f6() { ({ x: { ...n } } = v); }
export function f7() { for ({ ...n } of v) {} }
export function f8() { ({ ...n } = {}); }
export function f9(w: null) { return [...w]; }
export function f10(w: undefined) { return Math.max(...w); }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,30): error TS2322: Type '{}' is not assignable to type 'number'.
        a.ts(3,36): error TS2322: Type '{ b: 2; }' is not assignable to type 'number'.
        a.ts(4,36): error TS2322: Type '{ b: 2; }' is not assignable to type '{ b: string; }'.
          Types of property 'b' are incompatible.
            Type 'number' is not assignable to type 'string'.
        a.ts(5,30): error TS2741: Property 'b' is missing in type '{}' but required in type '{ b: string; }'.
        a.ts(6,28): error TS2322: Type 'any[]' is not assignable to type 'number'.
        a.ts(7,35): error TS2322: Type '{}' is not assignable to type 'number'.
        a.ts(8,34): error TS2322: Type '{}' is not assignable to type 'number'.
        a.ts(9,27): error TS2698: Spread types may only be created from object types.
        a.ts(9,30): error TS2322: Type '{}' is not assignable to type 'number'.
        a.ts(10,42): error TS2488: Type 'null' must have a '[Symbol.iterator]()' method that returns an iterator.
        a.ts(11,56): error TS2488: Type 'undefined' must have a '[Symbol.iterator]()' method that returns an iterator."
      `);
      expect(exitCode).toBe(1);
    });

    test("read-only members that are optional", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "target": "esnext", "module": "commonjs", "moduleResolution": "bundler", "lib": ["esnext"], "types": [], "skipLibCheck": true, "allowJs": true, "checkJs": true}}`,
        "a.ts": `import * as w from "./w"; import * as m from "./m"; import w2 = require("./w");
declare const o: { readonly r?: 1; get g(): 1 | undefined; get gs(): 1 | undefined; set gs(x); p?: 1 }; declare const ri: { readonly [k: string]: 1 }; declare const rt: readonly [1?]; const ac = { a: 1 } as const;
declare const rm: Readonly<{ a?: 1 }>; declare const un: { readonly a?: 1 } | { readonly a?: 2 }; declare const um: { readonly a?: 1 } | { a?: 2 }; declare const it: { readonly a?: 1 } & { b: 1 }; declare const im: { readonly a?: 1 } & { a?: 1 };
class K { static readonly s?: 1; constructor(readonly pp?: 1) {} readonly f?: 1; }
export function d1() { delete w.v; } export function d2() { delete w.g; } export function d3() { delete w.gs; } export function d4() { delete w.wr; }
export function d5() { delete w2.v; } export function d6() { delete { ...w }.v; }
export function e1() { delete (m as any).c; } export function e2() { delete m.c; } export function e3() { delete m.l; } export function e4() { delete m.E.A; } export function e5() { delete m.N.c; } export function e6() { delete m.N.l; }
export function f1() { delete o.r; } export function f2() { delete o.g; } export function f3() { delete o.gs; } export function f4() { delete o.p; } export function f5() { delete ri.x; } export function f6() { delete rt[0]; } export function f7() { delete ac.a; }
export function g1() { delete rm.a; } export function g2() { delete un.a; } export function g3() { delete um.a; } export function g4() { delete it.a; } export function g5() { delete im.a; } export function g6() { delete K.s; } export function g7(k: K) { delete k.pp; delete k.f; }
export function h1() { w.v = 2; } export function h2() { w.g = 2; } export function h3() { w.gs = 2; } export function h4() { w.wr = 2; } export function h5() { w2.v = 2; } export function h6() { w.v++; } export function h7() { ({ a: w.v } = { a: 1 }); } export function h8() { for (w.v of [1]) {} }
export function i1() { un.a = 1; } export function i2() { um.a = 1; } export function i3() { it.a = 1; } export function i4() { im.a = 1; } export function i5() { rm.a = 1; } export function i6() { ri.x = 1; } export function i7() { rt[0] = 1; } export function i8() { ac.a = 1; }
`,
        "m.ts": `export const c = 1; export let l = 1; export enum E { A } export namespace N { export const c = 1; export let l = 1; }
`,
        "w.js": `Object.defineProperty(exports, "v", { value: 1 });
Object.defineProperty(exports, "g", { get() { return 1; } });
Object.defineProperty(exports, "gs", { get() { return 1; }, set(x) {} });
Object.defineProperty(exports, "wr", { value: 1, writable: true });
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(5,31): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(5,68): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(5,105): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(5,143): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(6,31): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(6,69): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(7,77): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(7,114): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(7,151): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(7,190): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(7,229): error TS2790: The operand of a 'delete' operator must be optional.
        a.ts(8,31): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(8,68): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(8,180): error TS2542: Index signature in type '{ readonly [k: string]: 1; }' only permits reading.
        a.ts(8,218): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(8,257): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(9,31): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(9,69): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(9,107): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(9,145): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(9,221): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(9,262): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(9,275): error TS2704: The operand of a 'delete' operator cannot be a read-only property.
        a.ts(10,26): error TS2540: Cannot assign to 'v' because it is a read-only property.
        a.ts(10,60): error TS2540: Cannot assign to 'g' because it is a read-only property.
        a.ts(10,94): error TS2540: Cannot assign to 'gs' because it is a read-only property.
        a.ts(10,129): error TS2540: Cannot assign to 'wr' because it is a read-only property.
        a.ts(10,165): error TS2540: Cannot assign to 'v' because it is a read-only property.
        a.ts(10,199): error TS2540: Cannot assign to 'v' because it is a read-only property.
        a.ts(10,237): error TS2540: Cannot assign to 'v' because it is a read-only property.
        a.ts(10,286): error TS2540: Cannot assign to 'v' because it is a read-only property.
        a.ts(11,27): error TS2540: Cannot assign to 'a' because it is a read-only property.
        a.ts(11,62): error TS2540: Cannot assign to 'a' because it is a read-only property.
        a.ts(11,97): error TS2540: Cannot assign to 'a' because it is a read-only property.
        a.ts(11,167): error TS2540: Cannot assign to 'a' because it is a read-only property.
        a.ts(11,199): error TS2542: Index signature in type '{ readonly [k: string]: 1; }' only permits reading.
        a.ts(11,237): error TS2540: Cannot assign to '0' because it is a read-only property.
        a.ts(11,273): error TS2540: Cannot assign to 'a' because it is a read-only property."
      `);
      expect(exitCode).toBe(1);
    });

    test("a comment before the constraint of a type parameter", async () => {
      using dir = project({
        "a.ts": `export class C<T extends ( /*c*/ T)> {}
export function f(): ( /*c*/ number) {}
export function g(): ( // c
  number) {}
export function h(c: boolean): ( /*c*/ number) { if (c) return 1; }
export function* i(): ( /*c*/ number) {}
export async function j(): ( /*c*/ number) { return 1; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,26): error TS2313: Type parameter 'T' has a circular constraint.
        a.ts(2,22): error TS2355: A function whose declared type is neither 'undefined', 'void', nor 'any' must return a value.
        a.ts(3,22): error TS2355: A function whose declared type is neither 'undefined', 'void', nor 'any' must return a value.
        a.ts(5,32): error TS2366: Function lacks ending return statement and return type does not include 'undefined'.
        a.ts(6,23): error TS2322: Type 'Generator<any, any, unknown>' is not assignable to type 'number'.
        a.ts(7,28): error TS1064: The return type of an async function or method must be the global Promise<T> type. Did you mean to write 'Promise<number>'?"
      `);
      expect(exitCode).toBe(1);
    });

    test("a type parameter whose constraint refers to the function", async () => {
      using dir = project({
        "a.ts": `export const a1 = <T extends { p: typeof a1 }>(x: T) => 1;
export const a2 = <T = typeof a2>(x: T) => 1;
export const a3 = (x: typeof a3) => 1;
export const a4 = (x: number): typeof a4 => null!;
export const a5 = { m<T extends typeof a5>(x: T) { return 1; } };
export const a6 = { m(x: typeof a6) { return 1; } };
export const a7 = function <T extends keyof typeof a7>(x: T) { return 1; };
export const a8 = (x: Pick<typeof a8, "length">) => 1;
export const a9 = (x = null! as typeof a9) => 1;
export const a10 = ({ y }: { y: typeof a10 }) => 1;
export const a11 = (...r: (typeof a11)[]) => 1;
export const a12 = { get g(): typeof a12 { return null!; } };
export const a13 = { set s(v: typeof a13) {} };
export const a14 = [(x: typeof a14) => 1];
declare function idf<T>(x: T): T;
export const a15 = idf((x: typeof a15) => 1);
export const a16 = idf(<T extends typeof a16>(x: T) => 1);
export const a17 = (x: number): x is typeof a17 & number => true;
export const a18 = (x: unknown): asserts x is typeof a18 => {};
export const a19 = (this: typeof a19) => 1;
export const a20 = function (this: typeof a20) { return 1; };
export const a21 = async (x: number): Promise<typeof a21> => null!;
export const a22 = function* (x: number): Generator<typeof a22> {};
export const a23 = <T extends U, U extends typeof a23>(x: T, y: U) => 1;
export const a24 = (x: { [K in keyof typeof a24]: 1 }) => 1;
export const a25 = (x: (typeof a25) extends infer Q ? Q : never) => 1;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,14): error TS7022: 'a1' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(2,14): error TS7022: 'a2' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(3,14): error TS7022: 'a3' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(4,14): error TS7022: 'a4' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,14): error TS7022: 'a5' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,14): error TS7022: 'a6' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,14): error TS7022: 'a7' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,14): error TS7022: 'a8' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(9,14): error TS7022: 'a9' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(10,14): error TS7022: 'a10' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(11,14): error TS7022: 'a11' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(14,14): error TS7022: 'a14' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(18,14): error TS7022: 'a17' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(19,14): error TS7022: 'a18' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(20,14): error TS7022: 'a19' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(20,21): error TS2730: An arrow function cannot have a 'this' parameter.
        a.ts(21,14): error TS7022: 'a20' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(22,14): error TS7022: 'a21' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(23,14): error TS7022: 'a22' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(24,14): error TS7022: 'a23' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(24,31): error TS2313: Type parameter 'T' has a circular constraint.
        a.ts(24,44): error TS2313: Type parameter 'U' has a circular constraint.
        a.ts(25,14): error TS7022: 'a24' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(26,14): error TS7022: 'a25' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("a default in a binding pattern that mentions a type parameter", async () => {
      using dir = project({
        "a.ts": `function f1<T>(x: T, o: { a?: undefined }) { const { a = { v: x } } = o; return a; }
export const n1: number = f1(1, {}).v;
function f2<T>(x: T, o: [undefined?]) { const [a = { v: x }] = o; return a; }
export const n2: number = f2(1, []).v;
function f3<T>(x: T, { a = { v: x } }: { a?: undefined }) { return a; }
export const n3: number = f3(1, {}).v;
function f4<T>(x: T, o: { a?: undefined }) { let a; ({ a = { v: x } } = o); return a; }
export const n4: number = f4(1, {}).v;
function f5<T>(x: T) { const k = { [String({ v: x }.v)]: { v: x } }; return k; }
export const n5: number = f5(1)["a"].v;
function f6<T>(x: T) { return class { p = { v: x }; }; }
export const n6: number = new (f6(1))().p.v;
function f7<T>(x: T) { const { [(() => "a")()]: a = { v: x } } = {} as Record<string, undefined>; return a; }
export const n7: number = f7(1).v;
function f8<T>(x: T, o: { a?: undefined }) { const { a = [{ v: x }] } = o; return a; }
export const n8: number = f8(1, {})[0].v;
function f9<T>(x: T, o: { a?: undefined }) { const { a = () => ({ v: x }) } = o; return a; }
export const n9: number = f9(1, {})().v;
function f10<T>(x: T, o: { a?: { b?: undefined } }) { const { a: { b = { v: x } } = {} } = o; return b; }
export const n10: number = f10(1, {}).v;
function f11<T>(x: T) { enum E { A = 1 } return { v: x, e: E.A }; }
export const n11: number = f11(1).v;
function f12<T>(x: T, o: { a?: undefined }[]) { for (const { a = { v: x } } of o) return a; return null!; }
export const n12: number = f12(1, []).v;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(5,24): error TS2322: Type '{ v: T; }' is not assignable to type 'never'.
        a.ts(6,37): error TS2339: Property 'v' does not exist on type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test('a surrogate pair in the "types" of a package.json', async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "module": "nodenext", "target": "esnext", "types": [], "skipLibCheck": true}, "files": ["a.ts"]}`,
        "a.ts": `import { x } from "p";
export const s: string = x;
`,
        "node_modules/p/package.json": `{ "name": "p", "version": "1.0.0", "types": "./\\uD83D\\uDE00.d.ts" }
`,
        "node_modules/p/😀.d.ts": `export declare const x: number;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(2,14): error TS2322: Type 'number' is not assignable to type 'string'."`,
      );
      expect(exitCode).toBe(1);
    });

    test("a package.json that does not parse is still the scope of its directory", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "module": "nodenext", "target": "esnext", "types": [], "skipLibCheck": true}, "files": ["sub/a.ts", "empty/b.ts", "c.ts"]}`,
        "c.ts": `export const m = import.meta.url;
`,
        "empty/b.ts": `export const m = import.meta.url;
`,
        "empty/package.json": ``,
        "package.json": `{ "type": "module" }
`,
        "sub/a.ts": `export const m = import.meta.url;
`,
        "sub/package.json": `{ "type": "module", 
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "empty/b.ts(1,18): error TS1470: The 'import.meta' meta-property is not allowed in files which will build into CommonJS output.
        sub/a.ts(1,18): error TS1470: The 'import.meta' meta-property is not allowed in files which will build into CommonJS output."
      `);
      expect(exitCode).toBe(1);
    });

    test("package.json is strict JSON, and the last of two keys counts", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "module": "nodenext", "target": "esnext", "types": [], "skipLibCheck": true}, "files": ["a.ts"]}`,
        "a.ts": `import { x as comment } from "comment";
export const s_comment: string = comment;
import { x as trailing } from "trailing";
export const s_trailing: string = trailing;
import { x as stray } from "stray";
export const s_stray: string = stray;
import { x as after } from "after";
export const s_after: string = after;
import { x as mark } from "mark";
export const s_mark: string = mark;
import { x as twice } from "twice";
export const s_twice: string = twice;
import { x as again } from "again";
export const s_again: string = again;
import { x as list } from "list";
export const s_list: string = list;
import { x as escape } from "escape";
export const s_escape: string = escape;
`,
        "node_modules/after/package.json": `{ "name": "after", "types": "./t.d.ts" } x
`,
        "node_modules/after/t.d.ts": `export declare const x: number;
`,
        "node_modules/again/package.json": `{ "name": "again", "types": "./missing.d.ts", "types": "./t.d.ts" }
`,
        "node_modules/again/t.d.ts": `export declare const x: number;
`,
        "node_modules/comment/package.json": `// c
{ "name": "comment", "types": "./t.d.ts" }
`,
        "node_modules/comment/t.d.ts": `export declare const x: number;
`,
        "node_modules/escape/package.json": `{ "name": "escape", "types": "./\\u0074.d.ts" }
`,
        "node_modules/escape/t.d.ts": `export declare const x: number;
`,
        "node_modules/list/package.json": `[{ "types": "./t.d.ts" }]
`,
        "node_modules/list/t.d.ts": `export declare const x: number;
`,
        "node_modules/mark/package.json": `﻿{ "name": "mark", "types": "./t.d.ts" }
`,
        "node_modules/mark/t.d.ts": `export declare const x: number;
`,
        "node_modules/stray/package.json": `{ "name": "stray",, "types": "./t.d.ts" }
`,
        "node_modules/stray/t.d.ts": `export declare const x: number;
`,
        "node_modules/trailing/package.json": `{ "name": "trailing", "types": "./t.d.ts", }
`,
        "node_modules/trailing/t.d.ts": `export declare const x: number;
`,
        "node_modules/twice/package.json": `{ "name": "twice", "types": "./t.d.ts", "types": "./missing.d.ts" }
`,
        "node_modules/twice/t.d.ts": `export declare const x: number;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,30): error TS2307: Cannot find module 'comment' or its corresponding type declarations.
        a.ts(3,31): error TS2307: Cannot find module 'trailing' or its corresponding type declarations.
        a.ts(5,28): error TS2307: Cannot find module 'stray' or its corresponding type declarations.
        a.ts(7,28): error TS2307: Cannot find module 'after' or its corresponding type declarations.
        a.ts(10,14): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(11,28): error TS2307: Cannot find module 'twice' or its corresponding type declarations.
        a.ts(14,14): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(15,27): error TS2307: Cannot find module 'list' or its corresponding type declarations.
        a.ts(18,14): error TS2322: Type 'number' is not assignable to type 'string'."
      `);
      expect(exitCode).toBe(1);
    });

    // The route strings of the app become a tree of objects and functions, by template literal types and recursive
    // conditional types over the type of the app.
    test("the client that Eden Treaty infers from an Elysia app", async () => {
      // Elysia is a peer dependency of Eden, so it is next to it in the store.
      const eden = realpathSync(join(import.meta.dir, "..", "..", "node_modules", "@elysia", "eden"));
      const elysia = join(eden, "..", "..", "elysia");
      using dir = project({
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            ...JSON.parse(tsconfig).compilerOptions,
            lib: ["esnext", "dom"],
            paths: {
              "@elysia/eden": [join(eden, "dist", "index.d.ts")],
              "elysia": [join(elysia, "dist", "index.d.ts")],
              "elysia/*": [join(elysia, "dist", "*")],
            },
          },
          files: ["a.ts"],
        }),
        "a.ts": `import { Elysia, t } from "elysia";
import { treaty } from "@elysia/eden";

const users = new Elysia({ prefix: "/users" })
  .get("/", () => [{ id: 1, name: "a" }])
  .get("/:id", ({ params: { id } }) => ({ id, name: "a" }))
  .post("/", ({ body }) => ({ ...body, id: 1 }), { body: t.Object({ name: t.String(), age: t.Optional(t.Number()) }) })
  .patch("/:id/profile", ({ body, params }) => ({ id: params.id, bio: body.bio }), { body: t.Object({ bio: t.String() }) })
  .delete("/:id", ({ params, status }) => (params.id === "0" ? status(404, "missing" as const) : { ok: true as const }));

const app = new Elysia()
  .get("/", () => "hi")
  .get("/search", ({ query }) => query.q, { query: t.Object({ q: t.String(), page: t.Optional(t.Numeric()) }) })
  .post("/login", ({ body, status }) => (body.password ? { token: "t" } : status(401, { reason: "bad" })), {
    body: t.Object({ user: t.String(), password: t.String() }),
    response: { 200: t.Object({ token: t.String() }), 401: t.Object({ reason: t.String() }) },
  })
  .group("/v1", v1 => v1.get("/health", () => ({ up: true })).group("/admin", a => a.get("/stats/:kind", ({ params }) => params.kind)))
  .headers({ "x-app": "1" })
  .use(users);

export type App = typeof app;
const api = treaty<App>("localhost:3000");

export async function right() {
  const root = await api.get();
  const s: string | null = root.data;
  const list = await api.users.get();
  const first: number | undefined = list.data?.[0]?.id;
  const one = await api.users({ id: "1" }).get();
  const name: string | undefined = one.data?.name;
  const made = await api.users.post({ name: "b" });
  const age: number | undefined = made.data?.age;
  const bio = await api.users({ id: "1" }).profile.patch({ bio: "x" });
  const found = await api.search.get({ query: { q: "x" } });
  const login = await api.login.post({ user: "u", password: "p" });
  if (login.error) {
    const status: 401 | 422 = login.error.status;
    if (login.error.status === 401) { const reason: string = login.error.value.reason; return reason; }
  } else {
    const token: string = login.data.token;
  }
  const up = await api.v1.health.get();
  const kind = await api.v1.admin.stats({ kind: "cpu" }).get();
  const gone = await api.users({ id: "0" }).delete();
  return [s, first, name, age, bio.data?.bio, found.data, up.data?.up, kind.data, gone.error?.status, gone.data?.ok];
}

export async function wrong() {
  await api.nope.get();
  await api.users.post({ nam: "b" });
  await api.users.post({ name: 1 });
  await api.users({ ident: "1" }).get();
  await api.users({ id: "1" }).profile.patch({});
  await api.search.get();
  await api.search.get({ query: { page: 1 } });
  await api.login.post({ user: "u" });
  await api.v1.admin.stats.get();
  const root = await api.get();
  const n: number = root.data;
  const one = await api.users({ id: "1" }).get();
  const bad: boolean = one.data!.name;
  const login = await api.login.post({ user: "u", password: "p" });
  const t2: number = login.data!.token;
  const st: 500 = login.error!.status;
  await api.users.put({ name: "b" });
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(50,13): error TS2339: Property 'nope' does not exist on type '{ get: ((options?: { fetch?: RequestInit | undefined; throwHttpError?: ThrowHttpError | undefined; headers?: Record<string, unknown> | undefined; query?: Record<...> | undefined; } | undefined) => Promise<...>) & { ...; }; login: { ...; } & { ...; }; search: { ...; } & { ...; }; users: ((params: { ...; }) => { ...; ...'.
        a.ts(53,21): error TS2353: Object literal may only specify known properties, and 'ident' does not exist in type '{ id: string | number; }'.
        a.ts(58,28): error TS2339: Property 'get' does not exist on type '((params: { kind: string | number; }) => { get: ((options?: { fetch?: RequestInit | undefined; throwHttpError?: ThrowHttpError | undefined; headers?: Record<...> | undefined; query?: Record<...> | undefined; } | undefined) => Promise<...>) & { ...; }; '~path': string; } & { ...; }) & {} & { ...; }'.
        a.ts(60,9): error TS2322: Type 'string | null' is not assignable to type 'number'.
          Type 'null' is not assignable to type 'number'.
        a.ts(62,9): error TS2322: Type 'string' is not assignable to type 'boolean'.
        a.ts(66,19): error TS2339: Property 'put' does not exist on type '((params: { id: string | number; }) => { get: ((options?: { fetch?: RequestInit | undefined; throwHttpError?: ThrowHttpError | undefined; headers?: Record<string, unknown> | undefined; query?: Record<...> | undefined; } | undefined) => Promise<...>) & { ...; }; delete: ((body?: unknown, options?: { ...; } | undefine...'."
      `);
      expect(exitCode).toBe(1);
    });

    test("narrowing of an outer constant in a callback, after a branch in the callback", async () => {
      using dir = project({
        "a.ts": `declare const values: Set<string | null>;
declare const record: Record<string, number>;
declare const c: boolean;
export const afterIf = () => {
  for (const key of values) {
    if (key !== null) [1].forEach(n => { if (n) { } record[key] = n; });
  }
};
export const afterLoop = (key: string | null) => {
  if (key !== null) [1].forEach(n => { while (c) { } record[key] = n; });
};
export const afterTry = (key: string | null) => {
  if (key !== null) [1].forEach(n => { try { c; } catch { } record[key] = n; });
};
export const twoFunctionsOut = (key: string | null) => {
  if (key !== null) [1].forEach(() => { [2].forEach(n => { if (n) { } record[key] = n; }); });
};
export const narrowedByItsInitializer = () => {
  const index: string | number = 1;
  return () => { if (c) { } const n: number = index; return n; };
};
export const assignedLater = () => {
  let key: string | null = null! as string | null;
  if (key !== null) [1].forEach(n => { if (n) { } record[key] = n; });
  key = null;
};
export function ownParameterIsNotNarrowedOutside(key: string | null) {
  if (key === null) return;
  [null! as string | null].forEach(key => { if (c) { } record[key] = 1; });
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(24,58): error TS2538: Type 'null' cannot be used as an index type.
        a.ts(29,63): error TS2538: Type 'null' cannot be used as an index type."
      `);
      expect(exitCode).toBe(1);
    });

    test("a type assertion in an argument of a generic call, to a mapped type over an intersection with what is being declared", async () => {
      using dir = project({
        "a.ts": `export {};
declare function idf<T>(v: T): T;
class A { static x = idf(null! as Readonly<typeof A & { x: 1 }>); static y = 1 }
class B { static x = idf<Readonly<typeof B & { x: 1 }>>(null!); static y = 1 }
class C { static x = idf({ a: null! as Partial<typeof C & { x: string }> }); static y = 1 }
class D { static x = idf((null! as Readonly<typeof D & { x: 1 }>, 1)); static y = 1 }
class E { x = idf(null! as Readonly<E & { x: 1 }>); y = 1 }
namespace N { export const x = idf(null! as Readonly<typeof N & { x: 1 }>); export const y = 1; }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(3,18): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(5,18): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(6,18): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(7,11): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer.
        a.ts(8,28): error TS7022: 'x' implicitly has type 'any' because it does not have a type annotation and is referenced directly or indirectly in its own initializer."
      `);
      expect(exitCode).toBe(1);
    });

    test("a class expression in a callback of a generic call whose method refers to the result of the call", async () => {
      using dir = project({
        "a.ts": `export {};
declare class Base { p: {}; m(): {} }
declare function call<T>(f: () => T): T;
const a = [1].map(() => class extends Base { m(): (typeof a)[0] | undefined { return undefined; } });
const b = call(() => class extends Base { p: undefined; m(): typeof b | undefined { return undefined; } });
const c = call(() => ({ k: class extends Base { m(): typeof c | undefined { return undefined; } } }));
const d = call(function () { return class extends Base { m(): typeof d | undefined { return undefined; } }; });
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(4,46): error TS2416: Property 'm' in type '(Anonymous class)' is not assignable to the same property in base type 'Base'.
          Type '() => typeof (Anonymous class) | undefined' is not assignable to type '() => {}'.
            Type 'typeof (Anonymous class) | undefined' is not assignable to type '{}'.
              Type 'undefined' is not assignable to type '{}'.
        a.ts(5,43): error TS2416: Property 'p' in type '(Anonymous class)' is not assignable to the same property in base type 'Base'.
          Type 'undefined' is not assignable to type '{}'.
        a.ts(5,43): error TS2612: Property 'p' will overwrite the base property in 'Base'. If this is intentional, add an initializer. Otherwise, add a 'declare' modifier or remove the redundant declaration.
        a.ts(5,57): error TS2416: Property 'm' in type '(Anonymous class)' is not assignable to the same property in base type 'Base'.
          Type '() => typeof (Anonymous class) | undefined' is not assignable to type '() => {}'.
            Type 'typeof (Anonymous class) | undefined' is not assignable to type '{}'.
              Type 'undefined' is not assignable to type '{}'.
        a.ts(6,49): error TS2416: Property 'm' in type 'k' is not assignable to the same property in base type 'Base'.
          Type '() => { k: typeof k; } | undefined' is not assignable to type '() => {}'.
            Type '{ k: typeof k; } | undefined' is not assignable to type '{}'.
              Type 'undefined' is not assignable to type '{}'.
        a.ts(7,58): error TS2416: Property 'm' in type '(Anonymous class)' is not assignable to the same property in base type 'Base'.
          Type '() => typeof (Anonymous class) | undefined' is not assignable to type '() => {}'.
            Type 'typeof (Anonymous class) | undefined' is not assignable to type '{}'.
              Type 'undefined' is not assignable to type '{}'."
      `);
      expect(exitCode).toBe(1);
    });

    test("`@this` whose type refers to `this`", async () => {
      using dir = project({
        "tsconfig.json": `{"compilerOptions": {"strict": true, "noEmit": true, "allowJs": true, "checkJs": true, "target": "esnext", "module": "esnext", "lib": ["esnext"], "types": [], "skipLibCheck": true}, "files": ["a.js"]}`,
        "a.js": `class C {
  k = 1;
  /** @this {typeof this} */ p() { return this; }
  /** @this {typeof this.k} */ q() { return this; }
}
/** @this {typeof this} */
function f() { return this; }
const o = {
  /** @this {typeof this} */ m() { return this; },
};
/** @type {never} */ const r = new C().p();
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.js(3,8): error TS2502: '(Missing)' is referenced directly or indirectly in its own type annotation.
        a.js(4,8): error TS2502: '(Missing)' is referenced directly or indirectly in its own type annotation.
        a.js(6,6): error TS2502: '(Missing)' is referenced directly or indirectly in its own type annotation.
        a.js(9,8): error TS2502: '(Missing)' is referenced directly or indirectly in its own type annotation.
        a.js(11,28): error TS2322: Type 'any' is not assignable to type 'never'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an unresolved name from another file is printed as an unresolved import of this file", async () => {
      using dir = project({
        "a.ts": `import type { Elsewhere, Generic } from "./nowhere1";
import type * as NS from "./nowhere1";
import type { NotExported } from "./d";
import type { Shorthand } from "shorthand";
export interface Policy { naming?: Elsewhere; tableName: string }
export interface Qualified { naming?: NS.Inner; tableName: string }
export interface WithArguments { naming?: Generic<string>; tableName: string }
export interface Missing { naming?: NotExported; tableName: string }
export interface Ambient { naming?: Shorthand; tableName: string }
export interface Query { naming?: typeof NS.value; tableName: string }
export declare function take(input: { tableName: number }): void;
`,
        "ambient.d.ts": `declare module "shorthand";
`,
        "b.ts": `import type { Zeta } from "./nowhere2";
import type { Alpha } from "./nowhere3";
import { take, type Policy, type Qualified, type WithArguments, type Missing, type Ambient, type Query } from "./a";
declare const p1: Policy, p2: Qualified, p3: WithArguments, p4: Missing, p5: Ambient, p6: Query;
const c1 = { ...p1 }; take(c1);
const c2 = { ...p2 }; take(c2);
const c3 = { ...p3 }; take(c3);
const c4 = { ...p4 }; take(c4);
const c5 = { ...p5 }; take(c5);
const c6 = { ...p6 }; take(c6);
function inner() { type Local = 1; const c7 = { ...p1 }; take(c7); return null! as Local; }
export type { Zeta, Alpha };
export { inner };
`,
        "c.ts": `import { take, type Policy, type WithArguments } from "./a";
declare const p1: Policy, p3: WithArguments;
const c1 = { ...p1 }; take(c1);
const c3 = { ...p3 }; take(c3);
`,
        "d.ts": `export const d = 1;
`,
        "e.ts": `import value from "./nowhere4";
import * as Star from "./nowhere5";
import { take, type Policy } from "./a";
declare const p1: Policy;
const c1 = { ...p1 }; take(c1);
export { value, Star };
`,
        "f.ts": `import { take, type Policy } from "./a";
import { Late } from "shorthand";
declare const p1: Policy;
const c1 = { ...p1 }; take(c1);
export { Late };
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,41): error TS2307: Cannot find module './nowhere1' or its corresponding type declarations.
        a.ts(2,26): error TS2307: Cannot find module './nowhere1' or its corresponding type declarations.
        a.ts(3,15): error TS2305: Module '"./d"' has no exported member 'NotExported'.
        a.ts(9,37): error TS2709: Cannot use namespace 'Shorthand' as a type.
        b.ts(1,27): error TS2307: Cannot find module './nowhere2' or its corresponding type declarations.
        b.ts(2,28): error TS2307: Cannot find module './nowhere3' or its corresponding type declarations.
        b.ts(5,28): error TS2345: Argument of type '{ naming?: Zeta; tableName: string; }' is not assignable to parameter of type '{ tableName: number; }'.
          Types of property 'tableName' are incompatible.
            Type 'string' is not assignable to type 'number'.
        b.ts(6,28): error TS2345: Argument of type '{ naming?: Zeta; tableName: string; }' is not assignable to parameter of type '{ tableName: number; }'.
          Types of property 'tableName' are incompatible.
            Type 'string' is not assignable to type 'number'.
        b.ts(7,28): error TS2345: Argument of type '{ naming?: Zeta<string>; tableName: string; }' is not assignable to parameter of type '{ tableName: number; }'.
          Types of property 'tableName' are incompatible.
            Type 'string' is not assignable to type 'number'.
        b.ts(8,28): error TS2345: Argument of type '{ naming?: Zeta; tableName: string; }' is not assignable to parameter of type '{ tableName: number; }'.
          Types of property 'tableName' are incompatible.
            Type 'string' is not assignable to type 'number'.
        b.ts(9,28): error TS2345: Argument of type '{ naming?: Shorthand; tableName: string; }' is not assignable to parameter of type '{ tableName: number; }'.
          Types of property 'tableName' are incompatible.
            Type 'string' is not assignable to type 'number'.
        b.ts(10,28): error TS2345: Argument of type '{ naming?: typeof Zeta; tableName: string; }' is not assignable to parameter of type '{ tableName: number; }'.
          Types of property 'tableName' are incompatible.
            Type 'string' is not assignable to type 'number'.
        b.ts(11,63): error TS2345: Argument of type '{ naming?: Zeta; tableName: string; }' is not assignable to parameter of type '{ tableName: number; }'.
          Types of property 'tableName' are incompatible.
            Type 'string' is not assignable to type 'number'.
        c.ts(3,28): error TS2345: Argument of type '{ naming?: Elsewhere; tableName: string; }' is not assignable to parameter of type '{ tableName: number; }'.
          Types of property 'tableName' are incompatible.
            Type 'string' is not assignable to type 'number'.
        c.ts(4,28): error TS2345: Argument of type '{ naming?: Generic<string>; tableName: string; }' is not assignable to parameter of type '{ tableName: number; }'.
          Types of property 'tableName' are incompatible.
            Type 'string' is not assignable to type 'number'.
        e.ts(1,19): error TS2307: Cannot find module './nowhere4' or its corresponding type declarations.
        e.ts(2,23): error TS2307: Cannot find module './nowhere5' or its corresponding type declarations.
        e.ts(5,28): error TS2345: Argument of type '{ naming?: value; tableName: string; }' is not assignable to parameter of type '{ tableName: number; }'.
          Types of property 'tableName' are incompatible.
            Type 'string' is not assignable to type 'number'.
        f.ts(4,28): error TS2345: Argument of type '{ naming?: Elsewhere; tableName: string; }' is not assignable to parameter of type '{ tableName: number; }'.
          Types of property 'tableName' are incompatible.
            Type 'string' is not assignable to type 'number'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a union is `unknown` where a property is read if the constraint of a generic member is `unknown`", async () => {
      using dir = project({
        "a.ts": `type Cond<N> = N extends string ? { type: "a"; n: N } : unknown
type Other<N> = N extends string ? { type: "b" } | { type: "c" } : never
type Part<T> = { type: "x" } | Cond<keyof T> | Other<keyof T>
export function f<T>(part: Part<T>) {
  return part.type
}
type Part2<T> = { type: "x" } | Cond<keyof T>
export function g<T>(part: Part2<T>) {
  return part.type
}
export function h<T>(part: Cond<keyof T>) {
  return part.type
}
export function i<T>(parts: Array<Part<T>>) {
  for (const part of parts) {
    if (part.type === "x") return part
  }
  return parts.find((part) => part.type === "x")
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(5,10): error TS18046: 'part' is of type 'unknown'.
        a.ts(9,15): error TS2339: Property 'type' does not exist on type 'Part2<T>'.
          Property 'type' does not exist on type 'Cond<keyof T>'.
        a.ts(12,15): error TS2339: Property 'type' does not exist on type 'Cond<keyof T>'.
        a.ts(16,9): error TS18046: 'part' is of type 'unknown'.
        a.ts(18,31): error TS18046: 'part' is of type 'unknown'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a member with the name of a type parameter of its class or interface comes first", async () => {
      using dir = project({
        "a.ts": `export interface Key<out Identifier, out Shape> {
  readonly first: 1
  readonly Service: Shape
  readonly Identifier: Identifier
  readonly key: string
  readonly Shape: 2
}
export const k: Key<1, 2> = new Set<string>()
export class C<Zed, Why> {
  a = 1
  Why = 2
  b = 3
  Zed = 4
}
export const c: C<1, 2> = new Set<string>()
export type Keys = keyof Key<1, 2>
export const bad: Keys = 0
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(8,14): error TS2739: Type 'Set<string>' is missing the following properties from type 'Key<1, 2>': Identifier, Shape, first, Service, key
        a.ts(15,14): error TS2739: Type 'Set<string>' is missing the following properties from type 'C<1, 2>': Zed, Why, a, b
        a.ts(17,14): error TS2322: Type '0' is not assignable to type 'keyof Key<1, 2>'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a mapped type whose key has a circular constraint reports nothing else about the key", async () => {
      using dir = project({
        "a.ts": `export declare const catchTags: {
  <
    E,
    Cases extends
      & { [K in Extract<E, { _tag: string }>["_tag"]]+?: (error: Extract<E, { _tag: K }>) => any }
      & (unknown extends E ? {} : { [K in Exclude<Cases, Extract<E, { _tag: string }>["_tag"]>]: never })
  >(cases: Cases): E
}
export type M<Cases extends { [K in Exclude<Cases, "a">]: never }> = Cases
export type N<Cases extends { a: 1 }> = { [K in Exclude<Cases, "a">]: never }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(5,7): error TS2313: Type parameter 'Cases' has a circular constraint.
        a.ts(6,43): error TS2313: Type parameter 'K' has a circular constraint.
        a.ts(9,29): error TS2313: Type parameter 'Cases' has a circular constraint.
        a.ts(9,37): error TS2313: Type parameter 'K' has a circular constraint.
        a.ts(10,49): error TS2322: Type 'Exclude<Cases, "a">' is not assignable to type 'string | number | symbol'.
          Type '{ a: 1; }' is not assignable to type 'string | number | symbol'."
      `);
      expect(exitCode).toBe(1);
    });

    test("an `infer` type parameter that the extends type does not mention is not inferred when conditional types are compared", async () => {
      using dir = project({
        "a.ts": `type Ignore<X> = string;
type Simple<T, E> = T extends Ignore<infer A> ? [A, E] : E;
declare const make: <T>(x: T) => Simple<T, 1 | 2>;
export const wider: <T>(x: T) => Simple<T, 1 | 2 | 3> = make;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(4,14): error TS2322: Type '<T>(x: T) => Simple<T, 1 | 2>' is not assignable to type '<T>(x: T) => Simple<T, 1 | 2 | 3>'.
          Type 'Simple<T, 1 | 2>' is not assignable to type 'Simple<T, 1 | 2 | 3>'.
            Type '1 | 2 | [unknown, 1 | 2]' is not assignable to type 'Simple<T, 1 | 2 | 3>'.
              Type '1' is not assignable to type 'Simple<T, 1 | 2 | 3>'.
                Type '[unknown, 1 | 2]' is not assignable to type '[A, 1 | 2 | 3]'.
                  Type at position 0 in source is not compatible with type at position 0 in target.
                    Type 'unknown' is not assignable to type 'A'.
                      'A' could be instantiated with an arbitrary type which could be unrelated to 'unknown'."
      `);
      expect(exitCode).toBe(1);
    });

    test("type arguments are inferred from a union to a union of conditional types that differ where there is no type parameter", async () => {
      using dir = project({
        "a.ts": `type Ev =
  | { type: "a"; data: { x: number } }
  | { type: "b"; data: { y: string } }
  | { type: "c"; data: { z: boolean } }
  | { type: "d"; data: { w: null } }
  | { type: "e"; data: { v: 1 } };
type Payload<K extends Ev["type"]> = Extract<Ev, { type: K }>;
declare function event<K extends Ev["type"]>(type: K, data: Payload<K>["data"]): Payload<K>;
declare function pick<K extends Ev["type"]>(): Payload<K>;
declare function both<K extends Ev["type"], L>(other: L): Extract<Ev, { type: K }> | Extract<Ev, { data: L }>;
const list: Ev[] = [event("a", { x: 1 }), event("b", { y: 1 })];
const all: Ev = pick();
const some: Extract<Ev, { type: "a" | "b" }> = pick();
const none: { type: "a"; data: { x: string } } = pick();
const mixed: Ev = both({ x: 1 });
const shown: number = pick<"a" | "c">();
const inferred = [pick()].map(it => it.type);
const wrong: "a"[] = inferred;
export {};
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(11,56): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(14,7): error TS2322: Type '{ type: "a"; data: { x: number; }; }' is not assignable to type '{ type: "a"; data: { x: string; }; }'.
          The types of 'data.x' are incompatible between these types.
            Type 'number' is not assignable to type 'string'.
        a.ts(16,7): error TS2322: Type 'Payload<"a" | "c">' is not assignable to type 'number'.
          Type '{ type: "a"; data: { x: number; }; }' is not assignable to type 'number'.
        a.ts(18,7): error TS2322: Type '("a" | "b" | "c" | "d" | "e")[]' is not assignable to type '"a"[]'.
          Type '"a" | "b" | "c" | "d" | "e"' is not assignable to type '"a"'.
            Type '"b"' is not assignable to type '"a"'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a conditional type that recurs through a type node that is not deferred reaches the instantiation limit", async () => {
      using dir = project({
        "a.ts": `type H<X> = X;
type Template<T> = T extends string ? \`x\${Template<any>}\` : never;
type Union<T> = T extends string ? 1 | Union<any> : never;
type Intersection<T> = T extends string ? { a: 1 } & Intersection<any> : never;
type Keyof<T> = T extends string ? keyof Keyof<any> : never;
type Indexed<T> = T extends string ? Indexed<any>["a"] : never;
type Argument<T> = T extends string ? H<Argument<any>> : never;
type Intrinsic<T> = T extends string ? Uppercase<Intrinsic<any>> : never;
type Deferred<T> = T extends string ? [Deferred<any>] : never;
export const template: Template<"a"> = 1;
export const keys: Keyof<"a"> = 1;
export const deferred: Deferred<"a"> = 1;
`,
      });
      const { stdout, exitCode } = await check(dir);
      // The type has a level for every round up to the limit.
      expect(stdout.replace("x".repeat(99), "<99 x>")).toMatchInlineSnapshot(`
        "a.ts(2,43): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(3,40): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(4,54): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(5,42): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(6,38): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(7,41): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(8,50): error TS2589: Type instantiation is excessively deep and possibly infinite.
        a.ts(10,14): error TS2322: Type '1' is not assignable to type '\`<99 x>\${any}\`'.
        a.ts(12,14): error TS2322: Type 'number' is not assignable to type '[[[[[[[[[[[[...]]]]]]]]]]]]'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a member with the name of a type parameter of its class or interface is printed as the type parameter is written", async () => {
      using dir = project({
        "a.ts": `interface A<Rebuild> { readonly "Rebuild": Rebuild; b: number }
export const x: A<1> = {};
interface B<Rebuild> { "Rebuild": Rebuild }
export const y: B<1> = {};
class C<Q> { "Q" = 1; s = 3 }
export const z: C<1> = {};
interface D<Other> { "Rebuild": Other }
export const w: D<1> = {};
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,14): error TS2739: Type '{}' is missing the following properties from type 'A<1>': Rebuild, b
        a.ts(4,14): error TS2741: Property 'Rebuild' is missing in type '{}' but required in type 'B<1>'.
        a.ts(6,14): error TS2739: Type '{}' is missing the following properties from type 'C<1>': Q, s
        a.ts(8,14): error TS2741: Property '"Rebuild"' is missing in type '{}' but required in type 'D<1>'."
      `);
      expect(exitCode).toBe(1);
    });

    test("`this` counts where the parameters of an immediately invoked function are matched with its arguments", async () => {
      using dir = project({
        "a.ts": `export const one = (function (this: unknown, a, b) { return [a, b]; })(1);
export const two = (function (a, b) { return [a, b]; })(1);
export const three = (function (this: unknown, a, b) { return [a, b]; })();
export const four = (function (this: unknown, ...rest) { return rest; })(1, 2);
export const five: [number, number] = four;
export const six = (function (this: unknown, a = 1, b) { return [a, b]; })(1, "s");
export const seven: number = six;
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,72): error TS2345: Argument of type '1' is not assignable to parameter of type 'undefined'.
        a.ts(4,77): error TS2554: Expected 1 arguments, but got 2.
        a.ts(5,14): error TS2322: Type '[number]' is not assignable to type '[number, number]'.
          Source has 1 element(s) but target requires 2.
        a.ts(6,46): error TS2322: Type 'number' is not assignable to type 'string'.
        a.ts(6,76): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.
        a.ts(7,14): error TS2322: Type '(string | undefined)[]' is not assignable to type 'number'."
      `);
      expect(exitCode).toBe(1);
    });

    test("a parenthesized list with a colon that turns out not to be the parameters of an arrow function", async () => {
      using dir = project({
        "a.ts": `declare const map: any, f: any, name: string
export const x = (a: any) => map(f(a), (b: any) => ([name]: b }, { ...a) as any)
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,59): error TS1005: ')' expected.
        a.ts(2,63): error TS1005: ',' expected.
        a.ts(2,64): error TS1128: Declaration or statement expected.
        a.ts(2,68): error TS1128: Declaration or statement expected.
        a.ts(2,71): error TS1434: Unexpected keyword or identifier.
        a.ts(2,72): error TS1128: Declaration or statement expected.
        a.ts(2,74): error TS1434: Unexpected keyword or identifier.
        a.ts(2,77): error TS1434: Unexpected keyword or identifier.
        a.ts(2,80): error TS1128: Declaration or statement expected.
        a.ts(3,1): error TS1005: '}' expected."
      `);
      expect(exitCode).toBe(1);
    });

    test("a name and type parameters in an object literal are a method", async () => {
      using dir = project({
        "a.ts": `export const O = {
  Complete: <A>(value: A): A => ({ _tag: "Complete"),
  InputRequired: (fields: number): number => ({
    _tag: "InputRequired",
    ...fields
  })
}

export type C = NonNullable<
  string
>

export interface N<out Version extends string = "a"> {
  readonly protocolVersion: Version
  readonly clientInfo: Version extends "a" ? 1
    : 2 | undefined
  readonly requestMetadata?:
    | (Version extends "a" ? C
      : C | 3)
    | undefined
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(2,52): error TS1005: ',' expected.
        a.ts(2,53): error TS1136: Property assignment expected.
        a.ts(9,1): error TS1005: ')' expected.
        a.ts(9,13): error TS1005: ',' expected.
        a.ts(13,1): error TS1005: ',' expected.
        a.ts(13,18): error TS1005: ',' expected.
        a.ts(13,54): error TS1005: '(' expected.
        a.ts(14,3): error TS1128: Declaration or statement expected.
        a.ts(15,3): error TS1005: ',' expected.
        a.ts(15,32): error TS1005: ',' expected.
        a.ts(15,40): error TS1005: ':' expected.
        a.ts(17,3): error TS1005: ',' expected.
        a.ts(18,5): error TS1109: Expression expected.
        a.ts(18,16): error TS1005: ')' expected.
        a.ts(18,24): error TS1005: ':' expected.
        a.ts(19,14): error TS1005: ',' expected.
        a.ts(20,5): error TS1136: Property assignment expected.
        a.ts(21,1): error TS1128: Declaration or statement expected."
      `);
      expect(exitCode).toBe(1);
    });

    test("the parameters of an arrow function are not parsed as expressions", async () => {
      using dir = project({
        "a.ts": `export const annotate = (text: string, ...styles: Array<string<string>>) => {
  const flat = styles.flat()
  return \`\${flat.join("")}\${text}\`
}
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(`
        "a.ts(1,63): error TS1005: '>' expected.
        a.ts(1,70): error TS1005: ',' expected.
        a.ts(1,72): error TS1109: Expression expected.
        a.ts(1,74): error TS1128: Declaration or statement expected."
      `);
      expect(exitCode).toBe(1);
    });

    test("of two copies of a package the one that is reached first, depth first, is in the program", async () => {
      using dir = project({
        "a.ts": `import "x";
import "y";
`,
        "node_modules/x/index.d.ts": `import "z";
`,
        "node_modules/x/node_modules/z/index.d.ts": `import "dup";
`,
        "node_modules/x/node_modules/z/node_modules/dup/index.ts": `export const n: string = 1;
`,
        "node_modules/x/node_modules/z/node_modules/dup/package.json": `{ "name": "dup", "version": "1.0.0", "types": "index.ts" }
`,
        "node_modules/x/node_modules/z/package.json": `{ "name": "z", "version": "1.0.0", "types": "index.d.ts" }
`,
        "node_modules/x/package.json": `{ "name": "x", "version": "1.0.0", "types": "index.d.ts" }
`,
        "node_modules/y/index.d.ts": `import "dup";
`,
        "node_modules/y/node_modules/dup/index.ts": `export const n: string = 1;
`,
        "node_modules/y/node_modules/dup/package.json": `{ "name": "dup", "version": "1.0.0", "types": "index.ts" }
`,
        "node_modules/y/package.json": `{ "name": "y", "version": "1.0.0", "types": "index.d.ts" }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"node_modules/x/node_modules/z/node_modules/dup/index.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'."`,
      );
      expect(exitCode).toBe(1);
    });

    test("a `main` that ends in a slash is only looked up as a directory", async () => {
      using dir = project({
        "a.ts": `import { a } from "p";
export const s: string = a;
`,
        "node_modules/p/lib.d.ts": `export declare const a: string;
`,
        "node_modules/p/lib/index.d.ts": `export declare const a: number;
`,
        "node_modules/p/package.json": `{ "name": "p", "version": "1.0.0", "main": "lib/" }
`,
      });
      const { stdout, exitCode } = await check(dir);
      expect(stdout).toMatchInlineSnapshot(
        `"a.ts(2,14): error TS2322: Type 'number' is not assignable to type 'string'."`,
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

    test("flags are parsed as for Bun's other commands", async () => {
      using dir = project({
        "sub/tsconfig.json": tsconfig,
        "sub/a.ts": `export const a: number = "1";\n`,
        "--b.ts": `export const b: string = 1;\n`,
      });
      const [attached, equals, afterDashes, notPretty, likeTsc, short, valueless] = await Promise.all([
        check(dir, ["-psub"]),
        check(dir, ["-p=sub"]),
        check(dir, ["--", "--b.ts"]),
        check(dir, ["--pretty=false", "-p", "sub"]),
        check(dir, ["--pretty", "false", "-p", "sub"]),
        check(dir, ["-x"]),
        check(dir, ["--threads"]),
      ]);
      const a = `sub/a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.`;
      expect([attached.stdout, equals.stdout, notPretty.stdout, likeTsc.stdout]).toEqual([a, a, a, a]);
      expect(afterDashes.stdout).toBe(`--b.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.`);
      expect(short.stderr).toMatchInlineSnapshot(`
        "error: Invalid Argument '-x'
        note: run 'bun check --help' for more information"
      `);
      expect(valueless.stderr).toMatchInlineSnapshot(`
        "error: The argument '--threads' requires a value but none was supplied.
        note: run 'bun check --help' for more information"
      `);
      expect([short.exitCode, valueless.exitCode]).toEqual([1, 1]);
    });
  });

  // What `bun check` reports for a file or in a directory is what is reported when that is named, however it is
  // spelled, from wherever, and by whichever command.
  describe("a path means the same however it is spelled", () => {
    const bad = `export const bad: string = 1;\n`;
    const options = {
      ...JSON.parse(tsconfig).compilerOptions,
      noEmit: false,
      composite: true,
      emitDeclarationOnly: true,
    };
    const config = (more: object) => JSON.stringify({ compilerOptions: options, ...more });
    const layouts: Record<string, { files: Record<string, string>; file: string; directory: string }> = {
      "one project": {
        files: { "src/a.ts": bad, "src/deep/b.ts": bad, "other/c.ts": bad },
        file: "src/deep/b.ts",
        directory: "src",
      },
      "a solution": {
        files: {
          "console.d.ts": "",
          "tsconfig.json": JSON.stringify({
            files: [],
            references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.tools.json" }],
          }),
          "tsconfig.app.json": config({ include: ["src", "test"] }),
          "tsconfig.tools.json": config({ include: ["tools"] }),
          "src/a.ts": bad,
          "src/deep/b.ts": bad,
          "test/t.ts": bad,
          "tools/x.ts": bad,
        },
        file: "src/deep/b.ts",
        directory: "src",
      },
      "a project that references another": {
        files: {
          "console.d.ts": "",
          "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./packages/app" }] }),
          "packages/lib/tsconfig.json": config({}),
          "packages/lib/index.ts": `export const lib = 1;\n`,
          "packages/app/tsconfig.json": config({ references: [{ path: "../lib" }] }),
          "packages/app/src/a.ts": `import { lib } from "../../lib/index";\nexport const a: string = lib;\n`,
          "packages/app/src/deep/b.ts": bad,
          "packages/app/other/c.ts": bad,
        },
        file: "packages/app/src/deep/b.ts",
        directory: "packages/app/src",
      },
      "no tsconfig.json at the root": {
        files: {
          "tsconfig.json": "",
          "console.d.ts": "",
          "packages/x/tsconfig.json": tsconfig,
          "packages/x/src/a.ts": bad,
          "packages/x/src/deep/b.ts": bad,
          "packages/y/tsconfig.json": tsconfig,
          "packages/y/c.ts": bad,
          "loose/d.ts": bad,
        },
        file: "packages/x/src/deep/b.ts",
        directory: "packages/x/src",
      },
      "a tsconfig.json below that of the project": {
        files: {
          "a.ts": bad,
          "nested/tsconfig.json": tsconfig,
          "nested/src/a.ts": bad,
          "nested/src/deep/b.ts": bad,
          "nested/other/c.ts": bad,
        },
        file: "nested/src/deep/b.ts",
        directory: "nested/src",
      },
    };

    // Each starts up to 29 processes at once.
    test.serial.each(Object.keys(layouts))("%s", async layout => {
      const { files, file, directory } = layouts[layout];
      using dir = project(files);
      const root = String(dir);
      if (files["tsconfig.json"] === "") rmSync(join(root, "tsconfig.json"));
      const inRoot = (cwd: string, path: string) => {
        const full = path.startsWith("<dir>")
          ? cwd + path.slice("<dir>".length)
          : isAbsolute(path)
            ? path
            : join(cwd, path);
        const name = `/${basename(root)}/`;
        const slashes = full.replaceAll("\\", "/");
        return slashes.slice(slashes.lastIndexOf(name) + name.length);
      };
      // `path:line:column TS2322`, sorted, with the path from the root of the project.
      const reported = (cwd: string, text: string) =>
        [
          ...text.matchAll(/^(.+?)\((\d+),(\d+)\): error TS(\d+):/gm),
          // As the bundler prints it.
          ...[...text.matchAll(/^error: TS(\d+):.*\n\s+at (.+?):(\d+):(\d+)$/gm)].map(it => [
            it[0],
            it[2],
            it[3],
            it[4],
            it[1],
          ]),
        ]
          .map(it => `${inRoot(cwd, it[1])}:${it[2]}:${it[3]} TS${it[4]}`)
          .sort();

      const below = join(root, dirname(file));
      // What is named, where `bun` is started, its arguments, and what the paths that it prints are relative to.
      const commands: ["file" | "directory", string, string[], string?][] = [
        ["file", root, ["check", file]],
        ["file", root, ["check", `./${file}`]],
        ["file", root, ["check", join(root, file)]],
        ["file", below, ["check", basename(file)]],
        ["file", below, ["check", `./${basename(file)}`]],
        ["file", below, ["check", "--cwd", root, file], root],
        ["directory", root, ["check", directory]],
        ["directory", root, ["check", `${directory}/`]],
        ["directory", root, ["check", `./${directory}`]],
        ["directory", root, ["check", join(root, directory)]],
        ["directory", join(root, directory), ["check", "."]],
        ["directory", below, ["check", ".."]],
        ["file", root, ["--check", file]],
        ["file", root, ["--check", `./${file}`]],
        ["file", root, ["--check", join(root, file)]],
        ["file", root, ["build", "--check", file, "--outdir", "out"]],
        ["file", below, ["build", "--check", `./${basename(file)}`, "--outdir", "out"]],
      ];
      // Where the file system takes one spelling of a name for another, so does `bun check`. It prints the name that the
      // directory has.
      const inUpperCaseDirectories = `${dirname(file).toUpperCase()}/${basename(file)}`;
      if (foldsCase) {
        // On Windows the working directory is spelled as whoever started the process spelled it.
        const respelled = join(dirname(root), basename(root).toUpperCase());
        commands.push(
          ["file", respelled, ["check", file], root],
          ["directory", respelled, ["check", directory], root],
          ["directory", join(respelled, directory), ["check", "."], join(root, directory)],
          ["file", respelled, ["--check", file], root],
          ["file", root, ["check", file.toUpperCase()]],
          ["file", root, ["check", `./${inUpperCaseDirectories}`]],
          ["file", root, ["check", join(root, inUpperCaseDirectories)]],
          ["file", below, ["check", basename(file).toUpperCase()]],
          ["directory", root, ["check", directory.toUpperCase()]],
          ["directory", root, ["check", `./${directory.toUpperCase()}/`]],
          ["file", root, ["--check", inUpperCaseDirectories]],
        );
      }
      const [whole, ...results] = await Promise.all([
        run(root, ["check"]),
        ...commands.map(([, cwd, cmd]) => run(cwd, cmd)),
      ]);
      const all = reported(root, whole.stdout);
      const expected = {
        file: all.filter(it => it.startsWith(`${file}:`)),
        directory: all.filter(it => it.startsWith(`${directory}/`)),
      };
      expect(expected.file).toHaveLength(1);
      expect(expected.directory.length).toBeGreaterThan(1);
      expect(all.length).toBeGreaterThan(expected.directory.length);
      const name = ([, cwd, cmd]: (typeof commands)[number]) =>
        `${inRoot(root, cwd) || "."}$ bun ${cmd.join(" ").replaceAll(root, "<root>")}`;
      expect(
        results.map((it, i) => [
          name(commands[i]),
          reported(commands[i][3] ?? commands[i][1], `${it.stdout}\n${it.stderr}`),
          it.exitCode,
        ]),
      ).toEqual(commands.map(command => [name(command), expected[command[0]], 1]));

      // The bundler names a file as its entry point is spelled, in its own errors too.
      if (foldsCase) {
        const built = await run(root, ["build", "--check", inUpperCaseDirectories, "--outdir", "out"]);
        expect([reported(root, built.stderr), built.exitCode]).toEqual([
          expected.file.map(it => it.replace(file, inUpperCaseDirectories)),
          1,
        ]);
      }
    });

    // The name in `files` is the name of the file in the program. The argument is spelled as the directory has it.
    test.skipIf(!foldsCase)("a file that the configuration file spells differently", async () => {
      using dir = project({
        "tsconfig.json": JSON.stringify({ ...JSON.parse(tsconfig), files: ["Src/One.ts"] }),
        "src/one.ts": bad,
      });
      const whole = await check(dir);
      expect(whole.stdout).toContain("One.ts(1,14): error TS2322");
      for (const argument of ["src/one.ts", "Src/One.ts", "SRC/ONE.ts", "src", "SRC"]) {
        const named = await check(dir, [argument]);
        expect({ argument, stdout: named.stdout, exitCode: named.exitCode }).toEqual({
          argument,
          stdout: whole.stdout,
          exitCode: 1,
        });
      }
    });
  });

  test("-h is --help", async () => {
    using dir = project({});
    const [short, long] = await Promise.all([check(dir, ["-h"]), check(dir, ["--help"])]);
    expect([short.stdout, short.exitCode]).toEqual([long.stdout, 0]);
  });

  test("--help", async () => {
    using dir = project({});
    const { stdout, exitCode } = await check(dir, ["--help"]);
    expect(stdout).toContain("Usage: bun check [flags] [...files or directories]");
    expect(stdout).toContain("-p, --project=<val>");
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
      "note: Bun's type definitions (console, fetch, Bun, bun:test) are installed, but tsconfig.json does not include them. Add to compilerOptions: "types": ["bun"]
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
  test("a `check` script keeps `bun check`, and `bun --check` is the type checker everywhere", async () => {
    const files = { "a.ts": `export const a: number = "1";\n`, "src/empty.txt": "" };
    using scripted = project({
      ...files,
      "package.json": JSON.stringify({ scripts: { check: "echo the script ran" } }),
    });
    // The word is there, the script is not.
    using unscripted = project({
      ...files,
      "package.json": JSON.stringify({ description: "check", scripts: { "check:all": "echo no", lint: "check" } }),
    });
    const bun = `"${bunExe().replaceAll("\\", "/")}"`;
    // The script is the type checker, with an option.
    using wrapped = project({
      ...files,
      "package.json": JSON.stringify({ scripts: { check: `${bun} check --pretty false` } }),
    });
    // By way of another script.
    using aggregate = project({
      ...files,
      "package.json": JSON.stringify({
        scripts: { "check": `${bun} run check:types`, "check:types": `${bun} check --pretty false` },
      }),
    });
    // Before the script, which is part of running it.
    using before = project({
      ...files,
      "package.json": JSON.stringify({ scripts: { precheck: `${bun} check --pretty false`, check: "echo no" } }),
    });
    // The script of another package is a script all the same.
    using nested = project({
      ...files,
      "package.json": JSON.stringify({ scripts: { check: `cd sub && ${bun} check` } }),
      "sub/package.json": JSON.stringify({ scripts: { check: "echo the script of sub ran" } }),
    });
    const error = `a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.`;
    const inScripts = await Promise.all([wrapped, aggregate, before, nested].map(dir => run(String(dir), ["check"])));
    expect(inScripts.map(it => [it.stdout, it.exitCode])).toEqual([
      [error, 1],
      [error, 1],
      [error, 1],
      ["the script of sub ran", 0],
    ]);
    const [script, below, elsewhere, flag, command, sameFlag, flagElsewhere, withOthers, after] = await Promise.all([
      run(String(scripted), ["check"]),
      run(join(String(scripted), "src"), ["check"]),
      run(String(unscripted), ["--cwd", String(scripted), "check"]),
      run(String(scripted), ["--check"]),
      run(String(unscripted), ["check"]),
      run(String(unscripted), ["--check"]),
      // The arguments are those of `bun`.
      run(join(String(scripted), "src"), ["--cwd", "..", "--check"]),
      run(String(scripted), ["--silent", "--check", "--no-install"]),
      // `bun run` looks for the script where it is, since what follows the name is for the script.
      run(String(unscripted), ["check", "--cwd", String(scripted)]),
    ]);
    // It is about scripts, and there is none.
    const ifPresent = await run(String(unscripted), ["--if-present", "check"]);
    expect([ifPresent.stdout, ifPresent.exitCode]).toEqual(["", 0]);
    expect([script, below, elsewhere].map(it => [it.stdout, it.exitCode])).toEqual([
      ["the script ran", 0],
      ["the script ran", 0],
      ["the script ran", 0],
    ]);
    expect([flag, command, sameFlag, flagElsewhere, withOthers, after].map(it => [it.stdout, it.exitCode])).toEqual([
      [error, 1],
      [error, 1],
      [error, 1],
      [error, 1],
      [error, 1],
      [error, 1],
    ]);
    expect(sameFlag.stderr).toBe(command.stderr);
  });

  // Runs `bun` until the test ends. `until` waits for a condition on what it has printed, and does `between` while it
  // does not hold: a file is written again, because a write can come before the file is watched.
  const watching = (dir: { toString(): string }, cmd: readonly string[]) => {
    const proc = Bun.spawn({ cmd: [bunExe(), ...cmd], cwd: String(dir), env, stdout: "pipe", stderr: "pipe" });
    const output = { stdout: "", stderr: "" };
    const read = async (name: "stdout" | "stderr") => {
      for await (const chunk of proc[name]) output[name] += Buffer.from(chunk).toString();
    };
    const closed = Promise.all([read("stdout"), read("stderr")]);
    return {
      output,
      async until(has: () => boolean, between: () => Promise<unknown> = async () => {}) {
        while (!has()) {
          expect(proc.exitCode).toBeNull();
          await between();
          await Bun.sleep(50);
        }
      },
      async [Symbol.asyncDispose]() {
        proc.kill();
        await closed;
      },
    };
  };

  // The error is in a file that is imported, which nothing has loaded but the type checker.
  test.each([
    [["--watch", "--check", "a.ts"], "stdout", "ran 1"],
    [["--hot", "--check", "a.ts"], "stdout", "ran 1"],
    [["test", "--watch", "--check", "a.test.ts"], "stderr", "1 pass"],
  ] as const)("bun %j waits until the error is fixed", async (cmd, stream, expected) => {
    using dir = project({
      "bun-test.d.ts": `declare module "bun:test" {\n  export function test(name: string, fn: () => void): void;\n}\n`,
      "imported.ts": `export const n: number = "1";\n`,
      "a.ts": `import { n } from "./imported";\nconsole.log("ran", n);\n`,
      "a.test.ts": `import { test } from "bun:test";\nimport { n } from "./imported";\ntest("a", () => void n);\n`,
    });
    await using bun = watching(dir, cmd);
    await bun.until(() => bun.output.stderr.includes("TS2322"));
    expect(bun.output[stream]).not.toContain(expected);
    await bun.until(
      () => bun.output[stream].includes(expected),
      () => Bun.write(join(String(dir), "imported.ts"), `export const n: number = 1;\n`),
    );
  });

  // The file that changes only has types, so nothing loads it when the program runs.
  test.each(["--watch", "--hot"])("bun %s --check checks again before it runs again", async flag => {
    using dir = project({
      "types.ts": `export type N = number;\n`,
      "a.ts": `import type { N } from "./types";\nconst n: N = 1;\nconsole.log("ran", n);\n`,
    });
    await using bun = watching(dir, [flag, "--check", "a.ts"]);
    await bun.until(() => bun.output.stdout.includes("ran 1"));
    await bun.until(
      () => bun.output.stderr.includes("TS2322"),
      () => Bun.write(join(String(dir), "types.ts"), `export type N = string;\n`),
    );
    expect(bun.output.stdout.match(/ran/g)).toHaveLength(1);
  });

  // Nothing is emitted for a file that is only named, so where the project emits from is not about it.
  test.each([
    ["rootDir", { rootDir: "src" }],
    ["composite", { composite: true, noEmit: false, emitDeclarationOnly: true }],
  ])("a file outside `include` is checked in a project with %s", async (_, more) => {
    using dir = project({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, ...more },
        include: ["src", "console.d.ts", "bun-test.d.ts"],
      }),
      "bun-test.d.ts": `declare module "bun:test" {\n  export function test(name: string, fn: () => void): void;\n}\n`,
      "src/a.ts": `export const a: number = 1;\n`,
      "test/helper.ts": `export const helper: number = 1;\n`,
      "test/a.test.ts": `import { test } from "bun:test";\nimport { a } from "../src/a";\nimport { helper } from "./helper";\ntest("t", () => void (a + helper));\n`,
      "scripts/x.ts": `import { a } from "../src/a";\nimport { helper } from "../test/helper";\nconsole.log("ran", a + helper);\n`,
    });
    const results = await Promise.all([
      check(dir),
      check(dir, ["test/a.test.ts"]),
      check(dir, ["test"]),
      run(String(dir), ["--check", "scripts/x.ts"]),
      run(String(dir), ["test", "--check"]),
      run(String(dir), ["build", "--check", "scripts/x.ts", "--outdir", "out"]),
    ]);
    expect(results.map(it => [/TS\d+/.exec(it.stdout + it.stderr)?.[0], it.exitCode])).toEqual(
      results.map(() => [undefined, 0]),
    );
    expect(results[3].stdout).toBe("ran 2");
  });

  test("`rootDir` is still about what the project itself brings in", async () => {
    using dir = project({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, rootDir: "src" },
        include: ["src", "console.d.ts"],
      }),
      "src/a.ts": `import { outside } from "../outside";\nexport const a: number = outside;\n`,
      "outside.ts": `export const outside: number = 1;\n`,
      "scripts/x.ts": `import { a } from "../src/a";\nconsole.log("ran", a);\n`,
    });
    const [plain, named] = await Promise.all([check(dir), run(String(dir), ["--check", "scripts/x.ts"])]);
    expect(plain.stdout).toContain("TS6059");
    expect([
      named.stderr.includes("TS6059"),
      named.stderr.includes("scripts/x.ts' is not under"),
      named.exitCode,
    ]).toEqual([true, false, 1]);
  });

  test("a JavaScript entry point under a solution has the options of the project that would have it", async () => {
    const options = {
      ...JSON.parse(tsconfig).compilerOptions,
      noEmit: false,
      composite: true,
      emitDeclarationOnly: true,
    };
    using dir = project({
      "console.d.ts": "",
      "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }),
      "tsconfig.app.json": JSON.stringify({
        compilerOptions: { ...options, paths: { "@/*": ["./src/*"] } },
        include: ["src", "scripts"],
      }),
      "src/console.d.ts": `declare var console: { log(...args: unknown[]): void };\n`,
      // Only a type: when it runs, `paths` are those of `tsconfig.json`.
      "src/config.ts": `export type Config = number;\n`,
      "src/db.ts": `import type { Config } from "@/config";\nexport const db: Config = 1;\n`,
      "scripts/seed.js": `import { db } from "../src/db";\nconsole.log("ran", db);\n`,
    });
    const { stdout, stderr, exitCode } = await run(String(dir), ["--check", "scripts/seed.js"]);
    expect([/TS\d+/.exec(stderr)?.[0], stdout, exitCode]).toEqual([undefined, "ran 1", 0]);
  });

  // `allowJs` cannot be specified with `isolatedDeclarations`.
  test("a JavaScript entry point leaves the options of the project as they are", async () => {
    const files = (n: string) => ({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, declaration: true, isolatedDeclarations: true },
      }),
      "app.js": `import { n } from "./n";\nconsole.log("ran", n);\n`,
      "app.test.js": `import { n } from "./n";\nimport { test } from "bun:test";\ntest("t", () => void n);\n`,
      "n.ts": `export const n: number = ${n};\n`,
    });
    using good = project(files("1"));
    using bad = project(files(`"1"`));
    const commands = [
      ["--check", "app.js"],
      ["build", "--check", "app.js", "--outdir", "out"],
      ["test", "--check", "app.test.js"],
    ];
    const [passed, failed, plain] = await Promise.all([
      Promise.all(commands.map(cmd => run(String(good), cmd))),
      Promise.all(commands.map(cmd => run(String(bad), cmd))),
      check(good),
    ]);
    expect([plain.stdout, plain.exitCode]).toEqual(["", 0]);
    expect(passed.map(it => [/TS\d+/.exec(it.stdout + it.stderr)?.[0], it.exitCode])).toEqual(
      commands.map(() => [undefined, 0]),
    );
    expect(passed[0].stdout).toBe("ran 1");
    expect(failed.map(it => [/TS\d+/.exec(it.stdout + it.stderr)?.[0], it.exitCode])).toEqual(
      commands.map(() => ["TS2322", 1]),
    );
  });

  test("bun --check -e: there is no file to check", async () => {
    using dir = project({});
    const { stdout, exitCode } = await run(String(dir), [
      "--check",
      "-e",
      `const n: number = "1"; console.log("ran", n)`,
    ]);
    expect([stdout, exitCode]).toEqual(["ran 1", 0]);
  });

  // These take a shorter way to the file, on which less is set up.
  test("bun --check with an entry point that starts with `./` or is absolute", async () => {
    using dir = project({
      "good.ts": `export const n: number = 1;\nconsole.log("ran", n);\n`,
      "bad.ts": `export const n: number = "1";\nconsole.log("ran", n);\n`,
    });
    const results = await Promise.all(
      ["./good.ts", join(String(dir), "good.ts"), "./bad.ts", join(String(dir), "bad.ts")].map(entry =>
        run(String(dir), ["--check", entry]),
      ),
    );
    expect(results.map(it => [it.stdout, it.stderr.includes("bad.ts(1,14): error TS2322"), it.exitCode])).toEqual([
      ["ran 1", false, 0],
      ["ran 1", false, 0],
      ["", true, 1],
      ["", true, 1],
    ]);
  });

  // `./` takes a shorter way to the page, on which less is set up.
  test.each(["index.html", "./index.html"])(
    "bun --check %s: a script that the page names from its root",
    async page => {
      using dir = project({
        "index.html": `<!doctype html>\n<script type="module" src="/src/main.ts"></script>\n`,
        "src/main.ts": `export const a: number = "1";\n`,
      });
      const { stderr, exitCode } = await run(String(dir), ["--check", page]);
      expect(stderr).toContain(`src/main.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.`);
      expect(stderr).not.toContain("TS6053");
      expect(exitCode).toBe(1);
    },
  );

  // What is served is checked: every page, also those that a pattern stands for.
  test.each([
    [["index.html", "about.html"]],
    [["./index.html", "./pages/contact.html"]],
    [["./*.html"]],
    [["./**/*.html"]],
    // Not the first: `bun` looks for a file with that name.
    [["index.html", "{about,none}.html"]],
    [["index.html", "./pages/*.html"]],
  ])("bun --check %j: the scripts of every page", async pages => {
    const page = (script: string) => `<!doctype html>\n<script type="module" src="${script}"></script>\n`;
    using dir = project({
      "index.html": page("./src/index.ts"),
      "about.html": page("./src/about.ts"),
      "pages/contact.html": page("../src/contact.ts"),
      "node_modules/installed/page.html": page("./installed.ts"),
      "node_modules/installed/installed.ts": `export const installed: number = "1";\n`,
      "src/index.ts": `export const index = 1;\n`,
      "src/about.ts": `export const about: number = "1";\n`,
      "src/contact.ts": `export const contact: number = "1";\n`,
    });
    const { stderr, exitCode } = await run(String(dir), ["--check", ...pages]);
    const served = (name: string) => pages.some(it => it.includes(name) || it.includes("**"));
    expect({
      about: stderr.includes("src/about.ts(1,14): error TS2322"),
      contact: stderr.includes("src/contact.ts(1,14): error TS2322"),
      installed: stderr.includes("installed.ts"),
      exitCode,
    }).toEqual({
      about: served("about") || pages.includes("./*.html"),
      contact: served("contact") || pages.includes("./pages/*.html"),
      installed: false,
      exitCode: 1,
    });
  });

  test("--tsconfig-override is the tsconfig.json of the check too", async () => {
    using dir = project({
      "tsconfig.build.json": JSON.stringify({
        compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, paths: { "@/*": ["./src/*"] } },
      }),
      "src/lib.ts": `export const a: number = 1;\n`,
      "src/index.ts": `import { a } from "@/lib";\nconsole.log("ran", a);\n`,
    });
    const override = ["--tsconfig-override", "tsconfig.build.json"];
    const [without, alone, ran, built] = await Promise.all([
      run(String(dir), ["--check", "src/index.ts"]),
      run(String(dir), [...override, "--check"]),
      run(String(dir), [...override, "--check", "src/index.ts"]),
      run(String(dir), ["build", "--check", ...override, "src/index.ts", "--outdir", "out"]),
    ]);
    expect(without.stderr).toContain("TS2307");
    expect(alone.stdout + ran.stderr + built.stderr).not.toContain("TS2307");
    expect([alone.exitCode, ran.stdout, ran.exitCode, built.exitCode]).toEqual([0, "ran 1", 0, 0]);
  });

  // npm, pnpm and yarn say which script they run, and the first two of which package.
  test("a `check` script that another package manager runs", async () => {
    using dir = project({
      "a.ts": `export const a: number = "1";\n`,
      "package.json": JSON.stringify({ scripts: { check: "echo the script ran" } }),
      "other/package.json": JSON.stringify({ scripts: { check: "echo no" } }),
    });
    const own = join(String(dir), "package.json");
    const other = join(String(dir), "other", "package.json");
    const error = `a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.`;
    const cases: [Record<string, string>, string][] = [
      [{}, "the script ran"],
      [{ npm_lifecycle_event: "lint" }, "the script ran"],
      // In the script, `bun check` is the type checker.
      [{ npm_lifecycle_event: "check" }, error],
      [{ npm_lifecycle_event: "check", npm_package_json: own }, error],
      // The script of another package is running.
      [{ npm_lifecycle_event: "check", npm_package_json: other }, "the script ran"],
    ];
    const results = await Promise.all(cases.map(([extra]) => check(dir, [], extra)));
    expect(results.map(it => it.stdout)).toEqual(cases.map(it => it[1]));
  });

  test("the `check` scripts of several packages are scripts, and each runs once", async () => {
    const bun = `"${bunExe().replaceAll("\\", "/")}"`;
    const files = {
      // It has no `check` script of its own.
      "package.json": JSON.stringify({ workspaces: ["packages/*"] }),
      "packages/a/package.json": JSON.stringify({
        name: "a",
        scripts: { check: `${bun} check && echo ran >> ran.txt`, other: "echo other" },
      }),
      "packages/a/src/a.ts": `export const a: number = 1;\n`,
    };
    // Where `bun` is started, and where the script then runs.
    const cases = [
      [".", "packages/a", ["--workspaces", "check"]],
      [".", "packages/a", ["--filter=*", "check"]],
      [".", "packages/a", ["-F", "*", "check"]],
      ["packages/a", "packages/a", ["run", "--parallel", "check", "other"]],
      ["packages/a", "packages/a", ["run", "--sequential", "check", "other"]],
      ["packages/a/src", "packages/a/src", ["run", "--parallel", "check", "other"]],
      ["packages/a/src", "packages/a/src", ["run", "--sequential", "check", "other"]],
      ["packages/a/src", "packages/a", ["check"]],
    ] as const;
    const seen = await Promise.all(
      cases.map(async ([cwd, where, cmd]) => {
        using dir = project(files);
        const { exitCode, stderr } = await run(join(String(dir), cwd), [...cmd]);
        const ran = join(String(dir), where, "ran.txt");
        return [exitCode, stderr.includes("Unknown flag"), existsSync(ran) ? readFileSync(ran, "utf8").trim() : ""];
      }),
    );
    expect(seen).toEqual(cases.map(() => [0, false, "ran"]));
  });

  // What separates the entries of PATH is a character like any other in the name of a directory.
  test("a `check` script that is the type checker, in a directory with a delimiter in its name", async () => {
    const bun = `"${bunExe().replaceAll("\\", "/")}"`;
    const name = `a${delimiter}b`;
    using dir = project({
      [`${name}/package.json`]: JSON.stringify({ scripts: { check: `${bun} check --pretty false` } }),
      [`${name}/tsconfig.json`]: tsconfig,
      [`${name}/a.ts`]: `export const a: number = "1";\n`,
    });
    const { stdout, exitCode } = await run(join(String(dir), name), ["check"]);
    expect([stdout, exitCode]).toEqual([
      `a.ts(1,14): error TS2322: Type 'string' is not assignable to type 'number'.`,
      1,
    ]);
  });

  test("--check with --filter, --parallel or --sequential checks the project before the scripts", async () => {
    using dir = project({
      "package.json": JSON.stringify({
        workspaces: ["packages/*"],
        scripts: { one: "echo one ran", two: "echo two ran" },
      }),
      "packages/a/package.json": JSON.stringify({ name: "a", scripts: { build: "echo a ran" } }),
      "a.ts": `export const a: number = "1";\n`,
    });
    const results = await Promise.all([
      run(String(dir), ["--check", "--filter", "*", "build"]),
      run(String(dir), ["run", "--check", "--parallel", "one", "two"]),
      run(String(dir), ["run", "--check", "--sequential", "one", "two"]),
    ]);
    const seen = results.map(it => [
      it.exitCode,
      it.stderr.includes("TS2322"),
      (it.stdout + it.stderr).includes("ran"),
    ]);
    expect(seen).toEqual([
      [1, true, false],
      [1, true, false],
      [1, true, false],
    ]);
  });

  test("bun test --watch --check watches the tsconfig.json of every project", async () => {
    const declared = `declare module "bun:test" {\n  export function test(name: string, fn: () => void): void;\n}\n`;
    const tests = `import { test } from "bun:test";\nfunction f(x) {\n  return x;\n}\ntest("t", () => void f(1));\n`;
    const loose = JSON.stringify({ compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, strict: false } });
    using dir = project({
      "a/tsconfig.json": loose,
      "a/bun-test.d.ts": declared,
      "a/a.test.ts": tests,
      "b/tsconfig.json": loose,
      "b/bun-test.d.ts": declared,
      "b/b.test.ts": tests,
    });
    await using bun = watching(dir, ["test", "--watch", "--check"]);
    await bun.until(() => bun.output.stderr.includes("2 pass"));
    await bun.until(
      () => bun.output.stderr.includes("b/b.test.ts(2,12): error TS7006"),
      () => Bun.write(join(String(dir), "b", "tsconfig.json"), tsconfig),
    );
    expect(bun.output.stderr).not.toContain("a/a.test.ts(2,12)");
  });

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

  // Neither has an entry point to start from, like a script of a package.json.
  describe.each([
    ["an executable in node_modules/.bin", ["--check", "tool"]],
    ["an executable in node_modules/.bin, with arguments", ["--check", "tool", "build", "--flag"]],
    ["bun run and an executable in node_modules/.bin", ["run", "--check", "tool"]],
    ["a shell script", ["--check", "./tool.sh"]],
  ])("bun --check with %s", (_, cmd) => {
    // There it would have to be a program: `bun` does not start a batch file.
    test.skipIf(isWindows && cmd.includes("tool"))("type checks the project first", async () => {
      const files = { "tool.sh": `echo ran\n`, "node_modules/.bin/tool": `#!/bin/sh\necho ran\n` };
      using good = project({ ...files, "a.ts": `export const a: number = 1;\n` });
      using bad = project({ ...files, "a.ts": `export const a: number = "1";\n` });
      for (const dir of [good, bad]) chmodSync(join(String(dir), "node_modules", ".bin", "tool"), 0o755);
      const [ran, stopped] = await Promise.all([run(String(good), cmd), run(String(bad), cmd)]);
      expect([ran.stdout, ran.exitCode]).toEqual(["ran", 0]);
      expect(stopped.stderr).toContain("a.ts(1,14): error TS2322");
      expect([stopped.stdout, stopped.exitCode]).toEqual(["", 1]);
    });
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
      "1 | export const bad: number = "1";
                       ^
      error: TS2322: Type 'string' is not assignable to type 'number'.
          at <dir>/bad.ts:1:14"
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
      "1 | export const imported: number = "1";
                       ^
      error: TS2322: Type 'string' is not assignable to type 'number'.
          at <dir>/bad/src/imported.ts:1:14"
    `);
    expect(await Bun.file(join(String(dir), "out-bad", "index.html")).exists()).toBe(false);
    expect(bad.exitCode).toBe(1);
  });

  // What is checked is what the bundler resolved the entry point to, whatever it is written like.
  test("bun build --check checks an entry point that is written without its extension, or as its directory", async () => {
    using dir = project({
      "src/index.ts": `export const value: number = "1";\n`,
    });
    const results = await Promise.all([
      run(String(dir), ["build", "--check", "./src/index", "--outdir", "out-file"]),
      run(String(dir), ["build", "--check", "./src", "--outdir", "out-directory"]),
    ]);
    for (const { stderr, exitCode } of results) {
      expect(stderr).toMatchInlineSnapshot(`
        "1 | export const value: number = "1";
                         ^
        error: TS2322: Type 'string' is not assignable to type 'number'.
            at <dir>/src/index.ts:1:14"
      `);
      expect(exitCode).toBe(1);
    }
  });

  // Prints what `Bun.build` returns or throws, with paths relative to the working directory. `run` turns every
  // backslash into a slash, so the sources have no double quotes: JSON would escape them.
  const buildScript = `
    import { relative } from "node:path";
    const [options] = process.argv.slice(2);
    const shown = log => ({
      name: log.name,
      level: log.level,
      message: log.message,
      file: log.position && relative(process.cwd(), log.position.file).replaceAll("\\\\", "/"),
      line: log.position?.line,
      column: log.position?.column,
      lineText: log.position?.lineText,
    });
    try {
      const result = await Bun.build({ outdir: "out", check: true, ...JSON.parse(options) });
      console.log(JSON.stringify({ success: result.success, outputs: result.outputs.length, logs: result.logs.map(shown) }));
    } catch (error) {
      console.log(JSON.stringify({ thrown: error.name, errors: error.errors.map(shown) }));
    }
  `;
  const build = async (dir: { toString(): string }, options: object) => {
    const { stdout, stderr, exitCode } = await run(String(dir), ["build.mjs", JSON.stringify(options)]);
    return { stderr, exitCode, result: JSON.parse(stdout || "null") };
  };
  const ts2322 = (file: string, lineText: string) => ({
    name: "BuildMessage",
    level: "error",
    message: "TS2322: Type 'string' is not assignable to type 'number'.",
    file,
    line: 1,
    column: 14,
    lineText,
  });

  test("Bun.build({ check: true })", async () => {
    using dir = project({
      "build.mjs": buildScript,
      "good.ts": `export const good: number = 1;\nconsole.log(good);\n`,
      "bad.ts": `import { imported } from "./imported";\nconsole.log(imported);\n`,
      "imported.ts": `export const imported: number = '1';\n`,
    });
    const [good, bad, thrown, unchecked] = await Promise.all([
      build(dir, { entrypoints: ["good.ts"], outdir: "out-good", throw: false }),
      build(dir, { entrypoints: ["bad.ts"], outdir: "out-bad", throw: false }),
      build(dir, { entrypoints: ["bad.ts"], outdir: "out-thrown" }),
      build(dir, { entrypoints: ["bad.ts"], outdir: "out-unchecked", check: false }),
    ]);
    const error = ts2322("imported.ts", `export const imported: number = '1';`);
    expect(good.result).toEqual({ success: true, outputs: 1, logs: [] });
    expect(bad.result).toEqual({ success: false, outputs: 0, logs: [error] });
    expect(thrown.result).toEqual({ thrown: "AggregateError", errors: [error] });
    expect(unchecked.result).toEqual({ success: true, outputs: 1, logs: [] });
    // Nothing is printed: the errors are values.
    expect([good.stderr, bad.stderr, thrown.stderr]).toEqual(["", "", ""]);
    const written = (outdir: string, file: string) => Bun.file(join(String(dir), outdir, file)).exists();
    expect(await written("out-good", "good.js")).toBe(true);
    expect(await written("out-bad", "bad.js")).toBe(false);
    expect(await written("out-thrown", "bad.js")).toBe(false);
    expect([good.exitCode, bad.exitCode, thrown.exitCode]).toEqual([0, 0, 0]);
  });

  test("Bun.build({ check: true }) reports where a related declaration is", async () => {
    using dir = project({
      "build.mjs": `
        const result = await Bun.build({ entrypoints: ["a.ts"], check: true, throw: false });
        console.log(JSON.stringify(result.logs.map(log => [log.message, log.notes.map(note => note.text ?? note.message)])));
      `,
      "a.ts": `function f(wanted: number) {}\nf();\n`,
    });
    const { stdout, exitCode } = await run(String(dir), ["build.mjs"]);
    expect(JSON.parse(stdout)).toEqual([
      ["TS2554: Expected 1 arguments, but got 0.", ["TS6210: An argument for 'wanted' was not provided."]],
    ]);
    expect(exitCode).toBe(0);
  });

  // The type checker takes the text of a file of the bundle from the bundler and does not open the file. What is on
  // disk and what is bundled differ here, so the result shows which of the two was checked.
  test("the files of the bundle are not read again", async () => {
    using dir = project({
      "build.mjs": buildScript,
      "right-on-disk.ts": `export const value: number = 1;\n`,
      "wrong-on-disk.ts": `export const value: number = "1";\n`,
    });
    const inMemory = (file: string, text: string) => ({
      entrypoints: [file],
      files: { [join(String(dir), file)]: text },
      throw: false,
    });
    const [wrong, right] = await Promise.all([
      build(dir, inMemory("right-on-disk.ts", `export const other: number = '2';\n`)),
      build(dir, inMemory("wrong-on-disk.ts", `export const other: number = 2;\n`)),
    ]);
    expect(wrong.result).toEqual({
      success: false,
      outputs: 0,
      logs: [ts2322("right-on-disk.ts", `export const other: number = '2';`)],
    });
    expect(right.result).toEqual({ success: true, outputs: 1, logs: [] });
  });

  test("a file that is only in memory is checked like one on the disk", async () => {
    using dir = project({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, allowImportingTsExtensions: true },
      }),
      "build.mjs": buildScript,
      // The bundler finds such a file by its whole name.
      "on-disk.ts": `import { value } from './in/memory/imported.ts';\nexport const other: number = value;\n`,
    });
    const at = (file: string) => join(String(dir), file);
    const [entryPoint, imported, wrong] = await Promise.all([
      build(dir, { entrypoints: [at("entry.ts")], files: { [at("entry.ts")]: `export const a: number = 1;\n` } }),
      build(dir, {
        entrypoints: ["on-disk.ts"],
        files: { [at("in/memory/imported.ts")]: `export const value: number = 1;\n` },
      }),
      build(dir, {
        entrypoints: [at("entry.ts")],
        files: { [at("entry.ts")]: `export const a: number = '1';\n` },
        throw: false,
      }),
    ]);
    const passed = { success: true, outputs: 1, logs: [] };
    expect([entryPoint.result, imported.result]).toEqual([passed, passed]);
    expect(wrong.result).toEqual({
      success: false,
      outputs: 0,
      logs: [ts2322("entry.ts", `export const a: number = '1';`)],
    });
  });

  test("what is checked is what is written, not what an onLoad plugin makes of it", async () => {
    using dir = project({
      "build.mjs": `
        const [entrypoint, contents] = process.argv.slice(2);
        const plugin = {
          name: "replaces the text",
          setup(build) {
            build.onLoad({ filter: /[.]ts$/ }, () => ({ contents, loader: "ts" }));
          },
        };
        const result = await Bun.build({ entrypoints: [entrypoint], outdir: "out", check: true, throw: false, plugins: [plugin] });
        console.log(JSON.stringify({ success: result.success, logs: result.logs.map(log => [log.message, log.position?.line]) }));
      `,
      "right.ts": `export const a: number = 1;\n`,
      "wrong.ts": `export const a: number = '1';\n`,
    });
    const build = async (...args: string[]) => JSON.parse((await run(String(dir), ["build.mjs", ...args])).stdout);
    const [right, wrong] = await Promise.all([
      build("right.ts", `\n\n\nexport const generated: number = '1';\n`),
      build("wrong.ts", `\n\n\nexport const generated: number = 1;\n`),
    ]);
    expect(right).toEqual({ success: true, logs: [] });
    expect(wrong).toEqual({
      success: false,
      logs: [["TS2322: Type 'string' is not assignable to type 'number'.", 1]],
    });
  });

  test("what only a plugin provides: an entry point in another language, and a file that is nowhere else", async () => {
    using dir = project({
      "build.mjs": `
        import { join } from "node:path";
        const [entrypoint, contents] = process.argv.slice(2);
        const plugin = {
          name: "provides the text",
          setup(build) {
            build.onResolve({ filter: /[/]generated$/ }, () => ({ path: join(process.cwd(), "generated.ts") }));
            build.onLoad({ filter: /Outer[.]svelte$/ }, () => ({ contents: "export * from './App.svelte';", loader: "ts" }));
            build.onLoad({ filter: /generated[.]ts$|[.]svelte$/ }, () => ({ contents, loader: "ts" }));
          },
        };
        const result = await Bun.build({ entrypoints: [entrypoint], outdir: "out", check: true, throw: false, plugins: [plugin] });
        console.log(JSON.stringify({ success: result.success, logs: result.logs.map(log => [log.message, log.position?.line]) }));
      `,
      "App.svelte": `<script lang='ts'>let a: number = 1;</script>\n`,
      "Outer.svelte": `<script lang='ts'></script>\n`,
      "store.ts": `export const n: number = '1';\n`,
      "uses.ts": `import { value } from './generated';\nexport const own: number = value;\n`,
      "node_modules/runtime/package.json": JSON.stringify({ name: "runtime", version: "1.0.0", main: "index.js" }),
      "node_modules/runtime/index.js": `// @ts-check\n/** @type {number} */\nexport const runtime = '1';\n`,
    });
    const build = async (...args: string[]) => JSON.parse((await run(String(dir), ["build.mjs", ...args])).stdout);
    // It cannot be named, so what it imports is.
    const importsStore = `import { n } from './store';\nexport const a: number = n;\n`;
    const [imported, throughAnother, installed] = await Promise.all([
      build("App.svelte", importsStore),
      build("Outer.svelte", importsStore),
      // What a plugin makes of it imports the plugin's own runtime, which is not of the project.
      build("App.svelte", `import { runtime } from 'runtime';\nexport const a = runtime;\n`),
    ]);
    for (const result of [imported, throughAnother]) {
      expect(result).toEqual({
        success: false,
        logs: [["TS2322: Type 'string' is not assignable to type 'number'.", 1]],
      });
    }
    expect(installed).toEqual({ success: true, logs: [] });
    const [component, right, wrong] = await Promise.all([
      build("App.svelte", `export const a: number = 1;\n`),
      build("uses.ts", `export const value: number = 1;\n`),
      build("uses.ts", `export const value: string = '1';\n`),
    ]);
    expect(component).toEqual({ success: true, logs: [] });
    expect(right).toEqual({ success: true, logs: [] });
    expect(wrong).toEqual({
      success: false,
      logs: [["TS2322: Type 'string' is not assignable to type 'number'.", 2]],
    });
  });

  test("a file that is only in memory can be in two programs", async () => {
    const config = JSON.stringify({
      compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, allowImportingTsExtensions: true },
    });
    const entry = `import { value } from '../shared/generated.ts';\nexport const own: number = value;\n`;
    using dir = project({
      "build.mjs": buildScript,
      "a/tsconfig.json": config,
      "a/index.ts": entry,
      "b/tsconfig.json": config,
      "b/index.ts": entry,
    });
    const { result } = await build(dir, {
      entrypoints: ["a/index.ts", "b/index.ts"],
      files: { [join(String(dir), "shared/generated.ts")]: `export const value: number = 1;\n` },
      throw: false,
    });
    expect(result).toEqual({ success: true, outputs: 2, logs: [] });
  });

  // The bundler asserts that the path of an entry point is absolute.
  test.skipIf(isDebug || isASAN)("a file that is only in memory can have a relative name", async () => {
    using dir = project({ "build.mjs": buildScript });
    const { result } = await build(dir, {
      entrypoints: ["./entry.ts"],
      files: { "./entry.ts": `export const a: number = '1';\n` },
      throw: false,
    });
    expect(result).toEqual({
      success: false,
      outputs: 0,
      logs: [ts2322("entry.ts", `export const a: number = '1';`)],
    });
  });

  test("bun build --check: an error of the bundler comes first", async () => {
    using dir = project({
      "syntax.ts": `export const a: number = "1";\nexport const b = ;\n`,
      "unresolved.ts": `import "./missing";\nexport const a: number = "1";\n`,
    });
    const [syntax, unresolved] = await Promise.all([
      run(String(dir), ["build", "--check", "syntax.ts", "--outdir", "out"]),
      run(String(dir), ["build", "--check", "unresolved.ts", "--outdir", "out"]),
    ]);
    expect(syntax.stderr).toContain("error: Unexpected ;");
    expect(syntax.stderr).not.toContain("TS2322");
    expect(unresolved.stderr).toContain(`error: Could not resolve: "./missing"`);
    expect(unresolved.stderr).not.toContain("TS2322");
    expect([syntax.exitCode, unresolved.exitCode]).toEqual([1, 1]);
  });

  test("bun build --no-bundle --check", async () => {
    using dir = project({
      "good.ts": `export const good: number = 1;\n`,
      "bad.ts": `export const bad: number = "1";\n`,
    });
    const [good, bad] = await Promise.all([
      run(String(dir), ["build", "--no-bundle", "--check", "good.ts"]),
      run(String(dir), ["build", "--no-bundle", "--check", "bad.ts"]),
    ]);
    expect(good.stdout).toContain("good = 1");
    expect(good.exitCode).toBe(0);
    expect(bad.stderr).toMatchInlineSnapshot(`
      "1 | export const bad: number = "1";
                       ^
      error: TS2322: Type 'string' is not assignable to type 'number'.
          at <dir>/bad.ts:1:14"
    `);
    expect(bad.stdout).toBe("");
    expect(bad.exitCode).toBe(1);
  });

  // Each check loads TypeScript's library, some 40 MB. All of it is in the arenas of the check's session.
  // A debug build takes a second per check, and a sanitizer keeps freed memory for a while.
  test.skipIf(isDebug || isASAN)("repeated builds with `check: true` in one process do not grow", async () => {
    using dir = project({
      "build.mjs": `
        const once = () => Bun.build({ entrypoints: ["a.ts"], check: true });
        for (let i = 0; i < 4; i++) await once();
        Bun.gc(true);
        const before = process.memoryUsage.rss();
        for (let i = 0; i < 16; i++) await once();
        Bun.gc(true);
        console.log(Math.round((process.memoryUsage.rss() - before) / 1024 / 1024));
      `,
      "a.ts": `export const a: number = [1, 2, 3].map(n => n * 2).length;\n`,
    });
    const { stdout, exitCode } = await run(String(dir), ["build.mjs"]);
    // 16 leaked programs would be more than 600 MB.
    expect(Number(stdout)).toBeLessThan(150);
    expect(exitCode).toBe(0);
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
    const bundle = Buffer.from(
      Bun.zstdDecompressSync(readFileSync(join(import.meta.dir, "typescript-go", "bundle.zst"))),
    );
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
    // Lines, not depth: nothing here nests.
    const long = isDebug || isASAN ? 3000 : 40000;
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
      [
        "a parameter of a callback after many conditions at the top level",
        1100,
        n =>
          `declare function on(f: (a: number, b: string) => number): void;\n${range(n)
            .map(() => `if (typeof on === "function") { on; }`)
            .join("\n")}\non((a, b) => a + b.length);\nexport {};`,
      ],
      [
        "call statements with callbacks",
        long,
        n =>
          `declare function on(f: (a: number, b: string) => number): void; declare function on2(f: (a: number) => (b: string) => number): void;\n${range(
            n,
          )
            .map(i => `on((a, b) => a + b.length + ${i}); on2(a => b => a + b.length);`)
            .join("\n")}`,
      ],
      [
        "constants that read properties of ambient constants",
        long,
        n =>
          `declare const o: { a: { b: { c: number } }; d: string[] }; declare class K { x: number; y: K; z(): K }\ndeclare const k: K;\n${range(
            n,
          )
            .map(i => `export const v${i} = o.a.b.c + k.y.y.x + k.z().y.x + o.d.length + ${i};`)
            .join("\n")}`,
      ],
      [
        "constants with template expressions over ambient constants",
        long,
        n =>
          `declare const n: number; declare const s: string; declare const o: { a: 1 }; declare const u: string | number | undefined;\n${range(
            n,
          )
            .map(i => `export const t${i} = \`a\${n}b\${s}c\${u}d\${${i}}\` + \`\${o}\`;`)
            .join("\n")}`,
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

    // The limit of 5,000,000 instantiations is for one statement or expression. Under `exactOptionalPropertyTypes` one of
    // these comparisons takes about 45,000. After 110 of them every instantiation in the file gave the error type, to
    // which anything is assignable.
    test.skipIf(isDebug || isASAN).each([130])(
      "%i comparisons that reach the depth limit do not hide the next error",
      async n => {
        using dir = project({
          "tsconfig.json": JSON.stringify({
            compilerOptions: { ...JSON.parse(tsconfig).compilerOptions, exactOptionalPropertyTypes: true },
          }),
          "index.ts": `interface Sub { a: 1; b: 2 } interface Sup { a: 1 }\n${range(n)
            .map(
              i =>
                `export function f${i}() { interface G<in out T> { r: G<T[]> | null } let s!: G<Sub>, S!: G<Sup>; S = s; }`,
            )
            .join(
              "\n",
            )}\nexport function last() { interface G<T> { p: T } let s!: G<string>, S!: G<number>; S = s; }\n`,
        });
        const { stdout, exitCode } = await check(dir);
        const errors = stdout
          .split("\n")
          .flatMap(line => /^index\.ts\((\d+),\d+\): error (TS\d+)/.exec(line)?.slice(1, 3).join(" ") ?? []);
        expect(errors).toEqual([...range(n).map(i => `${i + 2} TS2321`), `${n + 2} TS2322`]);
        expect(exitCode).toBe(1);
      },
    );

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

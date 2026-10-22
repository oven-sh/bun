// Programs about which `bun check` and `tsc` once said something else, with what `tsc` 7.0.2 prints for them.
// `differential-cases.json` has the same programs, and there `tsc` itself is the oracle. That needs the `typescript7`
// package, and a debug build runs one in forty of them.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";
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
const options = {
  strict: true,
  noEmit: true,
  types: [],
  lib: ["es5"],
  skipLibCheck: true,
  module: "esnext",
  moduleResolution: "bundler",
};
const tsconfig = (more: object = {}, others: object = {}) =>
  JSON.stringify({ compilerOptions: { ...options, ...more }, ...others });
// A project that another refers to.
const referenced = (files: string[], more: object = {}) =>
  tsconfig({ noEmit: undefined, composite: true, outDir: "out", rootDir: ".", ...more }, { files });

/** What `bun check` prints for a project of `files`, by line, and its exit code. */
async function check(files: Record<string, string>, args: string[] = []) {
  using dir = tempDir("bun-check", files);
  const cwd = String(dir);
  await using proc = spawn({
    cmd: [bunExe(), "check", ...args],
    cwd,
    env,
    timeout: longLimit,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // A crash, an assertion or a sanitizer report: the test that asserts the exit code says nothing about why.
  if (exitCode !== 0 && exitCode !== 1)
    console.error(`bun check ${args.join(" ")} exited with ${exitCode}:\n${stderr}`);
  const lines = stdout.replaceAll("\\", "/").replaceAll(cwd.replaceAll("\\", "/"), "<dir>").trimEnd().split("\n");
  return { lines, exitCode };
}

const quote = `export const Quote = 1;\n`;
const quotes = `export const quotes = [1];\n`;
// What a program with `lib: []` needs: `--explainFiles` then lists no file of the library, whose path is not that of `tsc`.
const globals = ["Array<T>", "Boolean", "CallableFunction", "Function", "IArguments", "NewableFunction"]
  .concat(["Number", "Object", "RegExp", "String"])
  .map(it => `interface ${it} {}\n`)
  .join("");
const runtime = `export declare namespace JSX { interface IntrinsicElements { div: {} } interface Element {} }
export declare function jsx(type: any, props: any): JSX.Element;
export declare function jsxs(type: any, props: any): JSX.Element;
`;
const augments = (name: string) => `declare module "${name}" {\n  export const extra: number;\n}\n`;
const notUnderRootDir = (file: string) =>
  `error TS6059: File '<dir>/${file}' is not under 'rootDir' '<dir>/src'. 'rootDir' is expected to contain all source files.`;
const jsxIsNotSet = (specifier: string, file: string) =>
  `error TS6142: Module '${specifier}' was resolved to '<dir>/${file}', but '--jsx' is not set.`;
const isListed = "   Part of 'files' list in tsconfig.json";
const isNotListed = (file: string) =>
  `error TS6307: File '<dir>/${file}' is not listed within the file list of project '<dir>/tsconfig.json'. Projects must list all files or use an 'include' pattern.`;
const packageJson = (name: string, entry: object) => JSON.stringify({ name, version: "1.0.0", ...entry }) + "\n";
// Two names that differ only in case are two files here. Where they are one file, `tsc` prints something else.
const isCaseSensitive = (() => {
  using probe = tempDir("bun-check", { "probe": "" });
  return !existsSync(join(String(probe), "PROBE"));
})();

// A debug build that was just linked is read from the disk by the first process, and starts twenty processes together
// too slowly for the five seconds that a test has by default. So a hook with the limit of a process starts the first
// one, and the tests start one at a time.
beforeAll(async () => {
  await check({ "tsconfig.json": tsconfig(), "a.ts": `export {};\n` });
}, longLimit);

describe("bun check", () => {
  // `shouldAddFile`: an import of a `.tsx` or a `.jsx` file without `jsx`, of a `.js` file without `allowJs`, or any
  // import with `noResolve`, adds no file to the program, and so is no reason for one to be there. The imports that
  // follow it in the same file are.
  describe("an import that adds no file is no reason for a file to be in the program", () => {
    // kysely: site/src/components/SectionQuotes/index.tsx
    const matchedByInclude = {
      "tsconfig.json": tsconfig({ rootDir: "./src" }),
      "src/main.ts": `export const main = 1;\n`,
      "site/Quote.tsx": quote,
      "site/quotes.ts": quotes,
      // 6059 for `site/quotes.ts` is reported at its import, where the errors without a file hide it.
      "site/index.tsx": `import { Quote } from "./Quote";\nimport { quotes } from "./quotes";\nexport const both = [Quote, quotes];\n`,
    };

    test("6059 for a file that is also matched by `include`", async () => {
      expect(await check(matchedByInclude)).toEqual({
        lines: [
          notUnderRootDir("site/Quote.tsx"),
          "  The file is in the program because:",
          "    Matched by default include pattern '**/*'",
          notUnderRootDir("site/index.tsx"),
          "  The file is in the program because:",
          "    Matched by default include pattern '**/*'",
        ],
        exitCode: 1,
      });
    });

    test("`--explainFiles` for a file that is also matched by `include`", async () => {
      const { lines } = await check(matchedByInclude, ["--explainFiles"]);
      const reasons = (file: string) => {
        const rest = lines.slice(lines.indexOf(file) + 1);
        const end = rest.findIndex(line => !line.startsWith("   "));
        return rest.slice(0, end < 0 ? rest.length : end).map(line => line.trim());
      };
      expect({ quotes: reasons("site/quotes.ts"), Quote: reasons("site/Quote.tsx") }).toEqual({
        quotes: [`Imported via "./quotes" from file 'site/index.tsx'`, "Matched by default include pattern '**/*'"],
        Quote: ["Matched by default include pattern '**/*'"],
      });
    });

    test("6059 at the import does not stop the type check", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig({ rootDir: "./src" }),
          "src/Quote.tsx": quote,
          "other/quotes.ts": quotes,
          "src/index.tsx": `import { Quote } from "./Quote";\nimport { quotes } from "../other/quotes";\nexport const both = [Quote, quotes];\nexport const wrong: string = 1;\n`,
        }),
      ).toEqual({
        lines: [
          `src/index.tsx(1,23): ${jsxIsNotSet("./Quote", "src/Quote.tsx")}`,
          `src/index.tsx(2,24): ${notUnderRootDir("other/quotes.ts")}`,
          "  The file is in the program because:",
          "    Matched by default include pattern '**/*'",
          `    Imported via "../other/quotes" from file '<dir>/src/index.tsx'`,
          "src/index.tsx(4,14): error TS2322: Type 'number' is not assignable to type 'string'.",
        ],
        exitCode: 1,
      });
    });

    test("6307 in a composite project, after an import of a `.jsx` file", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig({ composite: true, allowJs: true }, { files: ["site/index.ts", "site/Quote.jsx"] }),
          "site/Quote.jsx": quote,
          "site/quotes.ts": quotes,
          "site/index.ts": `import { Quote } from "./Quote";\nimport { quotes } from "./quotes";\nexport const both = [Quote, quotes];\n`,
        }),
      ).toEqual({
        lines: [
          `site/index.ts(1,23): ${jsxIsNotSet("./Quote", "site/Quote.jsx")}`,
          `site/index.ts(2,24): ${isNotListed("site/quotes.ts")}`,
        ],
        exitCode: 1,
      });
    });

    // The reference path has added `site/Quote.tsx` for the same file: it is one of its tasks, and the import is not.
    test("after a reference path to the file that the import does not add", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig({ rootDir: "./src" }, { include: ["src"] }),
          "site/Quote.tsx": quote,
          "site/quotes.ts": quotes,
          "src/index.ts": `/// <reference path="../site/Quote.tsx" />\nimport { Quote } from "../site/Quote";\nimport { quotes } from "../site/quotes";\nexport const both = [quotes, Quote];\n`,
        }),
      ).toEqual({
        lines: [
          `src/index.ts(1,22): ${notUnderRootDir("site/Quote.tsx")}`,
          `src/index.ts(2,23): ${jsxIsNotSet("../site/Quote", "site/Quote.tsx")}`,
          `src/index.ts(3,24): ${notUnderRootDir("site/quotes.ts")}`,
        ],
        exitCode: 1,
      });
    });

    // The referenced project has `jsx`, this one has not. What is read for `../lib/a` is a declaration file, whose name
    // does not say that the import adds nothing.
    test("after an import of a `.tsx` source of a referenced project", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig({ rootDir: "./src" }, { files: ["src/main.ts"], references: [{ path: "./lib" }] }),
          "lib/tsconfig.json": referenced(["index.ts", "a.tsx"], { jsx: "react-jsx" }),
          "lib/a.tsx": `export const A = 1;\n`,
          "lib/index.ts": `export { A as A2 } from "./a";\n`,
          "lib/out/a.d.ts": `export declare const A = 1;\n`,
          "lib/out/index.d.ts": `export { A as A2 } from "./a";\n`,
          "site/later.ts": `export const later = 1;\n`,
          "src/main.ts": `import { A2 } from "../lib/index";\nimport { A } from "../lib/a";\nimport { later } from "../site/later";\nexport const all = [A, A2, later];\n`,
        }),
      ).toEqual({
        lines: [
          `src/main.ts(2,19): ${jsxIsNotSet("../lib/a", "lib/a.tsx")}`,
          `src/main.ts(3,23): ${notUnderRootDir("site/later.ts")}`,
        ],
        exitCode: 1,
      });
    });

    // `outputFileToProjectReferenceSource`: the declaration file of `lib/a.tsx` is in the program as one of `files`, or
    // by a reference path, and not as what is read in place of a source that an import found.
    test.each([
      ["one of `files`", ["lib/out/a.d.ts"], "", isListed],
      [
        "added by a reference path",
        [],
        `/// <reference path="./lib/out/a.d.ts" />\n`,
        "   Referenced via './lib/out/a.d.ts' from file 'main.ts'",
      ],
    ])(
      "a declaration file that is %s is not the output of a source that an import did not add",
      async (_, listed, path, reason) => {
        expect(
          await check({
            "tsconfig.json": tsconfig(
              { lib: [], explainFiles: true },
              { files: ["globals.d.ts", ...listed, "main.ts"], references: [{ path: "./lib" }] },
            ),
            "globals.d.ts": globals,
            "lib/tsconfig.json": referenced(["a.tsx"], { jsx: "react-jsx" }),
            "lib/a.tsx": `export const A = 1;\n`,
            "lib/out/a.d.ts": `export declare const A = 1;\n`,
            "later.ts": `export const later = 1;\n`,
            "main.ts": `${path}import { A } from "./lib/a";\nimport { later } from "./later";\nexport const all = [A, later];\n`,
          }),
        ).toEqual({
          lines: [
            `main.ts(${path ? 2 : 1},19): ${jsxIsNotSet("./lib/a", "lib/a.tsx")}`,
            "globals.d.ts",
            isListed,
            "lib/out/a.d.ts",
            reason,
            "later.ts",
            `   Imported via "./later" from file 'main.ts'`,
            "main.ts",
            isListed,
          ],
          exitCode: 1,
        });
      },
    );

    // `lib/types.d.ts` is a file of the referenced project, which has no `allowJs`: its import of `src/b.js` adds no
    // file. No other error makes the check fail here.
    test("after an import of a `.js` file from a file of a referenced project without `allowJs`", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig(
            { lib: [], skipLibCheck: false, allowJs: true, rootDir: "./src" },
            { files: ["globals.d.ts", "src/b.js", "lib/types.d.ts"], references: [{ path: "./lib" }] },
          ),
          "globals.d.ts": globals,
          "lib/tsconfig.json": referenced(["types.d.ts"]),
          "lib/types.d.ts": `import "../src/b.js";\nimport { c } from "../other/c";\nexport declare const t: typeof c;\n`,
          "other/c.ts": `export const c = 1;\n`,
          "src/b.js": `export const b = 1;\n`,
        }),
      ).toEqual({ lines: [`lib/types.d.ts(2,19): ${notUnderRootDir("other/c.ts")}`], exitCode: 1 });
    });

    // With `noResolve` no import adds a file. The library reference has added this one.
    test("`noResolve`: an import of a file that a library reference adds is no second reason", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig(
            { lib: [], libReplacement: true, noResolve: true, explainFiles: true },
            { files: ["globals.d.ts", "a.ts"] },
          ),
          "globals.d.ts": globals,
          "node_modules/@typescript/lib-es2015/promise.d.ts": `interface Promise<T> {}\n`,
          "a.ts": `/// <reference lib="es2015.promise" />\nimport "@typescript/lib-es2015/promise";\nexport const a = 1;\n`,
        }),
      ).toEqual({
        lines: [
          "node_modules/@typescript/lib-es2015/promise.d.ts",
          "   Library referenced via 'es2015.promise' from file 'a.ts'",
          "globals.d.ts",
          isListed,
          "a.ts",
          isListed,
        ],
        exitCode: 0,
      });
    });

    // The import of `tslib` that `importHelpers` adds is before every import of the file. No other error makes the
    // check fail here.
    test("after the import of the helpers, which adds no file", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig(
            { lib: [], importHelpers: true, rootDir: "./src", paths: { tslib: ["./src/helpers.tsx"] } },
            { files: ["globals.d.ts", "src/helpers.tsx", "src/index.ts"] },
          ),
          "globals.d.ts": globals,
          "other/a.ts": `export const a = 1;\n`,
          "src/helpers.tsx": `export declare function __assign(...a: any[]): any;\n`,
          "src/index.ts": `import { a } from "../other/a";\nexport const o = a;\n`,
        }),
      ).toEqual({ lines: [`src/index.ts(1,19): ${notUnderRootDir("other/a.ts")}`], exitCode: 1 });
    });

    // `p/main.d.ts`, which `-b` gives to the next project, names `p/lib/out/a.d.ts` by its own name: no task was
    // redirected to it.
    test("`-b`: the declaration file of a project names a listed declaration file by its own name", async () => {
      expect(
        await check(
          {
            "tsconfig.json": tsconfig({}, { files: ["r.ts"], references: [{ path: "./p" }] }),
            "r.ts": `import { t } from "./p/main";\nexport const u: string = t.x;\n`,
            "p/tsconfig.json": tsconfig(
              { noEmit: undefined, composite: true, emitDeclarationOnly: true },
              { files: ["lib/out/a.d.ts", "main.ts"], references: [{ path: "./lib" }] },
            ),
            "p/main.ts": `import { make } from "./lib/a";\nexport const t = make();\n`,
            "p/main.d.ts": `export declare const t: import("./lib/out/a").Thing;\n`,
            "p/lib/tsconfig.json": referenced(["a.tsx"], { emitDeclarationOnly: true, jsx: "react-jsx" }),
            "p/lib/a.tsx": `export interface Thing { x: number }\nexport function make(): Thing { return { x: 1 }; }\n`,
            "p/lib/out/a.d.ts": `export interface Thing {\n    x: number;\n}\nexport declare function make(): Thing;\n`,
          },
          ["-b"],
        ),
      ).toEqual({
        lines: [
          `p/main.ts(1,22): ${jsxIsNotSet("./lib/a", "p/lib/a.tsx")}`,
          "r.ts(2,14): error TS2322: Type 'number' is not assignable to type 'string'.",
        ],
        exitCode: 1,
      });
    });

    // The first import adds no file, so the second is no repeat of it: one reason, and no source that the file
    // stands for.
    test("an import of a declaration file, after an import of its `.tsx` source, is its only reason", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig(
            { lib: [], explainFiles: true },
            { files: ["globals.d.ts", "main.ts"], references: [{ path: "./lib" }] },
          ),
          "globals.d.ts": globals,
          "lib/tsconfig.json": referenced(["a.tsx"], { jsx: "react-jsx" }),
          "lib/a.tsx": `export const A = 1;\n`,
          "lib/out/a.d.ts": `export declare const A = 1;\n`,
          "main.ts": `import { A } from "./lib/a";\nimport { A as B } from "./lib/out/a";\nexport const all = [A, B];\n`,
        }),
      ).toEqual({
        lines: [
          `main.ts(1,19): ${jsxIsNotSet("./lib/a", "lib/a.tsx")}`,
          "globals.d.ts",
          isListed,
          "lib/out/a.d.ts",
          `   Imported via "./lib/out/a" from file 'main.ts'`,
          "main.ts",
          isListed,
        ],
        exitCode: 1,
      });
    });

    // The task for a JavaScript file of a package is not loaded, and the reasons go on after it.
    test("6307 after an import of a package without types", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig(
            { composite: true, allowJs: true, noImplicitAny: false },
            { files: ["site/index.ts", "site/Quote.jsx"] },
          ),
          "site/Quote.jsx": quote,
          "site/quotes.ts": quotes,
          "site/more.ts": `export const more = [1];\n`,
          "node_modules/pkg/package.json": packageJson("pkg", { main: "index.js" }),
          "node_modules/pkg/index.js": `exports.p = 1;\n`,
          "site/index.ts": `import { Quote } from "./Quote";\nimport { p } from "pkg";\nimport { quotes } from "./quotes";\nimport { more } from "./more";\nimport { quotes as again } from "./quotes";\nexport const all = [Quote, p, quotes, more, again];\n`,
        }),
      ).toEqual({
        lines: [
          `site/index.ts(1,23): ${jsxIsNotSet("./Quote", "site/Quote.jsx")}`,
          `site/index.ts(3,24): ${isNotListed("site/quotes.ts")}`,
          "  The file is in the program because:",
          `    Imported via "./quotes" from file '<dir>/site/index.ts'`,
          `    Imported via "./quotes" from file '<dir>/site/index.ts'`,
          `site/index.ts(4,22): ${isNotListed("site/more.ts")}`,
        ],
        exitCode: 1,
      });
    });

    // Of two copies of a package file the program has one: the task for the other is not a second file.
    test("6307 after imports of two copies of a package", async () => {
      const copy = {
        "package.json": packageJson("x", { types: "index.d.ts" }),
        "index.d.ts": `export declare class X { private a: number; }\n`,
      };
      expect(
        await check({
          "tsconfig.json": tsconfig(
            { composite: true, allowJs: true, noImplicitAny: false },
            { files: ["site/index.ts", "site/Quote.jsx"] },
          ),
          "site/Quote.jsx": quote,
          "site/quotes.ts": quotes,
          "node_modules/x/package.json": copy["package.json"],
          "node_modules/x/index.d.ts": copy["index.d.ts"],
          "node_modules/y/package.json": packageJson("y", { types: "index.d.ts" }),
          "node_modules/y/index.d.ts": `export { X } from "x";\n`,
          "node_modules/y/node_modules/x/package.json": copy["package.json"],
          "node_modules/y/node_modules/x/index.d.ts": copy["index.d.ts"],
          "site/index.ts": `import { Quote } from "./Quote";\nimport { X as Y } from "y";\nimport { X } from "x";\nimport { quotes } from "./quotes";\nexport const all = [Quote, X, Y, quotes];\n`,
        }),
      ).toEqual({
        lines: [
          `site/index.ts(1,23): ${jsxIsNotSet("./Quote", "site/Quote.jsx")}`,
          `site/index.ts(4,24): ${isNotListed("site/quotes.ts")}`,
        ],
        exitCode: 1,
      });
    });

    // `__inferred type names__.ts` is the name of the task for `types`, which is no file: an import cannot find it,
    // and the task that the import adds is that one.
    test("6059 after an import of the name of the task for the automatic type directives", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig(
            { lib: [], types: ["foo", "bar"], rootDir: "./src", explainFiles: true },
            { files: ["globals.d.ts", "src/a.ts", "src/Quote.tsx"] },
          ),
          "globals.d.ts": globals,
          "__inferred type names__.ts": `export const c = 1;\n`,
          "src/Quote.tsx": quote,
          "src/a.ts": `import { Quote } from "./Quote";\nimport { c } from "../__inferred type names__";\nimport { d } from "../other/d";\nexport const all = [Quote, c, d];\n`,
          "other/d.ts": `export const d = 1;\n`,
          "node_modules/@types/foo/index.d.ts": `declare const foo: 1;\n`,
          "node_modules/@types/bar/index.d.ts": `declare const bar: 1;\n`,
        }),
      ).toEqual({
        lines: [
          `src/a.ts(1,23): ${jsxIsNotSet("./Quote", "src/Quote.tsx")}`,
          "src/a.ts(2,19): error TS2307: Cannot find module '../__inferred type names__' or its corresponding type declarations.",
          `src/a.ts(3,19): ${notUnderRootDir("other/d.ts")}`,
          "globals.d.ts",
          isListed,
          "node_modules/@types/foo/index.d.ts",
          "   Entry point of type library 'foo' specified in compilerOptions",
          "node_modules/@types/bar/index.d.ts",
          "   Entry point of type library 'bar' specified in compilerOptions",
          "other/d.ts",
          `   Imported via "../other/d" from file 'src/a.ts'`,
          "src/a.ts",
          isListed,
          "src/Quote.tsx",
          isListed,
        ],
        exitCode: 1,
      });
    });

    // One name in two modes: `require("#q")` is a `.tsx` file and adds none, `import "#q"` is a file with a task.
    test("6307 for a name that adds a file in one of its two modes", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig(
            { lib: [], module: "nodenext", moduleResolution: undefined, composite: true },
            { files: ["globals.d.ts", "a.mts", "Quote.tsx"] },
          ),
          "globals.d.ts": globals,
          "package.json": `{ "name": "app", "imports": { "#q": { "import": "./quotes.mts", "require": "./Quote.tsx" } } }\n`,
          "Quote.tsx": quote,
          "quotes.mts": quotes,
          "a.mts": `import Q = require("#q");\nimport { quotes } from "#q";\nexport const both = [quotes, Q];\n`,
        }),
      ).toEqual({
        lines: [`a.mts(1,20): ${jsxIsNotSet("#q", "Quote.tsx")}`, `a.mts(2,24): ${isNotListed("quotes.mts")}`],
        exitCode: 1,
      });
    });

    test.skipIf(!isCaseSensitive)("1149 for a name that differs in case from that of an earlier import", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig({}, { files: ["a.ts", "Quote.tsx"] }),
          "Quote.tsx": quote,
          "Quotes.ts": `export const a = 1;\nexport const b = 2;\n`,
          "quotes.ts": `export const a = 1;\nexport const b = 2;\n`,
          "a.ts": `import { Quote } from "./Quote";\nimport { a } from "./Quotes";\nimport { b } from "./quotes";\nexport const all = [Quote, a, b];\n`,
        }),
      ).toEqual({
        lines: [
          `a.ts(1,23): ${jsxIsNotSet("./Quote", "Quote.tsx")}`,
          "a.ts(3,19): error TS1149: File name '<dir>/quotes.ts' differs from already included file name '<dir>/Quotes.ts' only in casing.",
          "  The file is in the program because:",
          `    Imported via "./Quotes" from file '<dir>/a.ts'`,
          `    Imported via "./quotes" from file '<dir>/a.ts'`,
        ],
        exitCode: 1,
      });
    });
  });

  // The name of a module augmentation is resolved like an import, and adds no file. It is no import of the file: where
  // the file imports the same module, that import has its task.
  describe("the name of a module augmentation is no reason for a file to be in the program", () => {
    test("a declaration file in `files` is not the output of a source that an augmentation names", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig(
            { lib: [], explainFiles: true },
            { files: ["globals.d.ts", "lib/out/a.d.ts", "main.ts"], references: [{ path: "./lib" }] },
          ),
          "globals.d.ts": globals,
          "lib/tsconfig.json": referenced(["a.ts"]),
          "lib/a.ts": `export const A = 1;\n`,
          "lib/out/a.d.ts": `export declare const A = 1;\n`,
          "main.ts": `${augments("./lib/a")}export const later = 1;\n`,
        }),
      ).toEqual({
        lines: ["globals.d.ts", isListed, "lib/out/a.d.ts", isListed, "main.ts", isListed],
        exitCode: 0,
      });
    });

    // The import of the JSX runtime is the only reason for `runtime.ts`, and the only error.
    test("6307 for the JSX runtime of a file that augments it", async () => {
      const jsx = { jsx: "react-jsx", jsxImportSource: "myjsx", paths: { "myjsx/jsx-runtime": ["./runtime.ts"] } };
      expect(
        await check({
          "tsconfig.json": tsconfig({ lib: [], composite: true, ...jsx }, { files: ["globals.d.ts", "a.tsx"] }),
          "globals.d.ts": globals,
          "runtime.ts": runtime,
          "a.tsx": `export const a = <div />;\n${augments("myjsx/jsx-runtime")}`,
        }),
      ).toEqual({
        lines: [
          "error TS6307: File '<dir>/runtime.ts' is not listed within the file list of project '<dir>/tsconfig.json'. Projects must list all files or use an 'include' pattern.",
          "  The file is in the program because:",
          `    Imported via "myjsx/jsx-runtime" from file '<dir>/a.tsx' to import 'jsx' and 'jsxs' factory functions`,
        ],
        exitCode: 1,
      });
    });

    test("the JSX runtime of a file that augments it is the output of a source of a referenced project", async () => {
      const jsx = { jsx: "react-jsx", jsxImportSource: "myjsx", paths: { "myjsx/jsx-runtime": ["./lib/runtime.ts"] } };
      expect(
        await check({
          "tsconfig.json": tsconfig(
            { lib: [], explainFiles: true, ...jsx },
            { files: ["globals.d.ts", "a.tsx"], references: [{ path: "./lib" }] },
          ),
          "globals.d.ts": globals,
          "lib/tsconfig.json": referenced(["runtime.ts"]),
          "lib/runtime.ts": runtime,
          "lib/out/runtime.d.ts": runtime,
          "a.tsx": `export const a = <div />;\n${augments("myjsx/jsx-runtime")}`,
        }),
      ).toEqual({
        lines: [
          "globals.d.ts",
          isListed,
          "lib/out/runtime.d.ts",
          `   Imported via "myjsx/jsx-runtime" from file 'a.tsx' to import 'jsx' and 'jsxs' factory functions`,
          "   File is output of project reference source 'lib/runtime.ts'",
          "a.tsx",
          isListed,
        ],
        exitCode: 0,
      });
    });
  });

  // A file of a referenced project is loaded with the options of that project: `ref/out/index.d.ts` may import the
  // JavaScript file `ref/util.js`, which this project may not. Its declaration file is in the program all the same.
  describe("an import that the checker does not resolve can add a file", () => {
    const ref = {
      "ref/tsconfig.json": tsconfig(
        { noEmit: undefined, composite: true, allowJs: true, outDir: "out" },
        { files: ["index.ts", "util.js"] },
      ),
      "ref/index.ts": `export * from "./util.js";\n`,
    };

    test("the reasons for its declaration file", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig(
            { lib: [], explainFiles: true },
            { files: ["globals.d.ts", "a.ts"], references: [{ path: "./ref" }] },
          ),
          "globals.d.ts": globals,
          "a.ts": `import { fromJs } from "./ref/index";\nexport const d: string = fromJs;\n`,
          ...ref,
          "ref/util.js": `export const fromJs = 1;\n`,
          "ref/out/index.d.ts": `export * from "./util.js";\n`,
          "ref/out/util.d.ts": `export declare const fromJs = 1;\n`,
        }),
      ).toEqual({
        lines: [
          `a.ts(1,10): error TS2305: Module '"./ref/index"' has no exported member 'fromJs'.`,
          "globals.d.ts",
          isListed,
          "ref/out/util.d.ts",
          `   Imported via "./util.js" from file 'ref/out/index.d.ts'`,
          "   File is output of project reference source 'ref/util.js'",
          "ref/out/index.d.ts",
          `   Imported via "./ref/index" from file 'a.ts'`,
          "   File is output of project reference source 'ref/index.ts'",
          "a.ts",
          isListed,
        ],
        exitCode: 1,
      });
    });

    // The declaration file of `mid/a.ts` names `ref/out/util.d.ts` by its source, `../ref/util`, which `top` may not
    // import. With `skipLibCheck` that is no error, and `x` is `any`.
    const build = (top: object, use: string) => ({
      "tsconfig.json": `{ "files": [], "references": [{ "path": "./top" }] }\n`,
      "globals.d.ts": globals,
      ...ref,
      "ref/util.js": `export class Bar { v = 1; }\nexport function makeBar() { return new Bar(); }\n`,
      "mid/tsconfig.json": tsconfig(
        { noEmit: undefined, composite: true, outDir: "out" },
        { files: ["a.ts", "helper.ts"], references: [{ path: "../ref" }] },
      ),
      "mid/a.ts": `import { makeBar } from "./helper";\nexport const x = makeBar();\n`,
      "mid/helper.ts": `import "../ref/index";\nexport { makeBar } from "../ref/out/util";\n`,
      "top/tsconfig.json": tsconfig(top, { files: ["../globals.d.ts", "t.ts"], references: [{ path: "../mid" }] }),
      "top/t.ts": `import { x } from "../mid/a";\n${use}`,
    });

    test("`-b`: 7016 in the declaration file of a project, two projects down", async () => {
      expect(await check(build({ lib: [], skipLibCheck: false }, `export const n = x;\n`), ["-b"])).toEqual({
        lines: [
          "mid/out/a.d.ts(1,32): error TS7016: Could not find a declaration file for module '../ref/util'. '<dir>/ref/util.js' implicitly has an 'any' type.",
        ],
        exitCode: 1,
      });
    });

    test("`-b`: no error for a use of what that declaration file exports", async () => {
      expect(await check(build({ lib: [] }, `export const n: string = x.v;\n`), ["-b"])).toEqual({
        lines: [""],
        exitCode: 0,
      });
    });
  });

  // A task starts its sub tasks when it is the first to reach its file at that depth. The import of `pkg`, a
  // JavaScript file of a package, is not loaded. The reference path from `other` then loads the file, and is not the
  // first: what `pkg/index.js` itself refers to is never loaded for it.
  describe("a sub task that never starts is no task", () => {
    const packages = (prefix: string, text: string) => ({
      [`${prefix}node_modules/pkg/package.json`]: packageJson("pkg", { main: "index.js" }),
      [`${prefix}node_modules/pkg/index.js`]: text,
      [`${prefix}node_modules/other/package.json`]: packageJson("other", { types: "index.d.ts" }),
      [`${prefix}node_modules/other/index.d.ts`]: `/// <reference path="../pkg/index.js" />\nexport declare const o: number;\n`,
    });

    test("its reference path to a source of a referenced project redirects no task", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig(
            { lib: [], allowJs: true, explainFiles: true },
            { files: ["globals.d.ts", "a.ts", "ref/src.d.ts"], references: [{ path: "./ref" }] },
          ),
          "globals.d.ts": globals,
          "ref/tsconfig.json": referenced(["src.ts"], { outDir: undefined, rootDir: undefined }),
          "ref/src.ts": `export const s = 1;\n`,
          "ref/src.d.ts": `export declare const s = 1;\n`,
          ...packages("", `/// <reference path="../../ref/src.ts" />\nexports.p = 1;\n`),
          "a.ts": `import { o } from "other";\nimport { p } from "pkg";\nexport const c = [o, p];\n`,
        }),
      ).toEqual({
        lines: [
          "globals.d.ts",
          isListed,
          "node_modules/pkg/index.js",
          "   Referenced via '../pkg/index.js' from file 'node_modules/other/index.d.ts'",
          `   Imported via "pkg" from file 'a.ts' with packageId 'pkg/index.js@1.0.0'`,
          "node_modules/other/index.d.ts",
          `   Imported via "other" from file 'a.ts' with packageId 'other/index.d.ts@1.0.0'`,
          "a.ts",
          isListed,
          "ref/src.d.ts",
          isListed,
        ],
        exitCode: 0,
      });
    });

    // The declaration file of `mid/a.ts` names `ref/out/util.d.ts` by its own name, and `x.v` is a number.
    test("`-b`: its import of a JavaScript source does not rename the declaration file for the next project", async () => {
      const composite = { noEmit: undefined, composite: true, allowJs: true, outDir: "out" };
      expect(
        await check(
          {
            "tsconfig.json": `{ "files": [], "references": [{ "path": "./top" }] }\n`,
            "ref/tsconfig.json": tsconfig(composite, { files: ["util.js"] }),
            "ref/util.js": `export class Bar { v = 1; }\nexport function makeBar() { return new Bar(); }\n`,
            "mid/tsconfig.json": tsconfig(composite, {
              files: ["a.ts", "helper.ts"],
              references: [{ path: "../ref" }],
            }),
            "mid/a.ts": `import { o } from "other";\nimport { p } from "pkg";\nimport { makeBar } from "./helper";\nexport const x = makeBar();\nexport const q = [o, p];\n`,
            "mid/helper.ts": `export { makeBar } from "../ref/out/util";\n`,
            ...packages("mid/", `import { makeBar } from "../../../ref/util";\nexport const p = 1;\n`),
            "top/tsconfig.json": tsconfig({}, { files: ["t.ts"], references: [{ path: "../mid" }] }),
            "top/t.ts": `import { x } from "../mid/a";\nexport const n: string = x.v;\n`,
          },
          ["-b"],
        ),
      ).toEqual({
        lines: ["top/t.ts(2,14): error TS2322: Type 'number' is not assignable to type 'string'."],
        exitCode: 1,
      });
    });
  });

  // `tasksSeenByNameIgnoreCase` has the name of every task, also of one that is redirected to a declaration file and
  // has no file of its own.
  describe("the name of a task that is redirected", () => {
    test.skipIf(!isCaseSensitive)(
      "1149 for a name that differs in case from a root file that is a source of a referenced project",
      async () => {
        expect(
          await check({
            "tsconfig.json": tsconfig({}, { files: ["ref/Util.ts", "a.ts"], references: [{ path: "./ref" }] }),
            "ref/tsconfig.json": referenced(["Util.ts"], { rootDir: undefined }),
            "ref/Util.ts": `export const A = 1;\n`,
            "ref/out/Util.d.ts": `export declare const A = 1;\n`,
            "ref/util.ts": `export const b = 2;\n`,
            "a.ts": `import { b } from "./ref/util";\nexport const c = [b];\n`,
          }),
        ).toEqual({
          lines: [
            "a.ts(1,19): error TS1149: File name '<dir>/ref/util.ts' differs from already included file name '<dir>/ref/Util.ts' only in casing.",
          ],
          exitCode: 1,
        });
      },
    );
  });

  // `collectModuleReferences`: only a statement of the file itself, or of an ambient module in it, is one of its
  // imports. Nothing resolves the name of an import that is the statement of an `if`, a label or a loop.
  describe("an import that is not a statement of its file adds no file", () => {
    test("no error from inside a file that only such an import names, and no 6059 for it", async () => {
      const wrong = `export const x: string = 1;\n`;
      expect(
        await check({
          "tsconfig.json": tsconfig(
            { lib: [], rootDir: "./src" },
            { files: ["globals.d.ts", "src/if.ts", "src/label.ts", "src/loop.ts", "src/top.ts"] },
          ),
          "globals.d.ts": globals,
          "src/if.ts": `if (true) import "../other/in-if";\nexport {};\n`,
          "src/label.ts": `label: import { x } from "../other/in-label";\nexport {};\n`,
          "src/loop.ts": `while (false) export * from "../other/in-loop";\nexport {};\n`,
          "src/top.ts": `if (true) import "../other/in-if";\nimport "../other/at-top";\nexport {};\n`,
          "other/in-if.ts": wrong,
          "other/in-label.ts": wrong,
          "other/in-loop.ts": wrong,
          "other/at-top.ts": wrong,
        }),
      ).toEqual({
        lines: [
          "other/at-top.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.",
          "src/if.ts(1,11): error TS1232: An import declaration can only be used at the top level of a namespace or module.",
          "src/label.ts(1,1): error TS1344: A label is not allowed here.",
          "src/label.ts(1,8): error TS1232: An import declaration can only be used at the top level of a namespace or module.",
          "src/loop.ts(1,15): error TS1233: An export declaration can only be used at the top level of a namespace or module.",
          "src/loop.ts(1,29): error TS2307: Cannot find module '../other/in-loop' or its corresponding type declarations.",
          "src/top.ts(1,11): error TS1232: An import declaration can only be used at the top level of a namespace or module.",
          `src/top.ts(2,8): ${notUnderRootDir("other/at-top.ts")}`,
        ],
        exitCode: 1,
      });
    });
  });

  // `getTypeReferenceType`: an alias that `resolveSymbol` does not follow, because it is also a value or has exports
  // beside it, takes no type arguments. For `export =`, TypeScript 6 follows the alias to the class, as TypeScript 7
  // does in a type reference (microsoft/typescript-go#4038): this is what the version that `bun check` follows prints.
  describe("an `import()` type that names an alias", () => {
    // webpack: lib/Compiler.js(142,15). The member of the mapped type is not checked.
    test("2315 for its type arguments: `module.exports =` next to a `@typedef`, also where the name does not resolve", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig({ module: "commonjs", moduleResolution: undefined, allowJs: true, checkJs: true }),
          "map.js": `/**
 * @template T
 * @typedef {T extends ReadonlyArray<infer E> ? E : never} Element
 */
/**
 * @template K
 * @template V
 */
class TupleMap {
  constructor() {
    /** @type {Array<[K, V]>} */
    this.inner = [];
  }
}
module.exports = TupleMap;
`,
          "missing.js": `/** @typedef {number} Num */\nmodule.exports = Missing;\n`,
          "use.js": `/** @typedef {import("./map")<string, number>} Cache */
/** @typedef {import("./map")} Plain */
/** @typedef {import("./missing")<string>} Unresolved */
/** @typedef {{ [K in "a"]: 1; map: import("./map")<string, number>; none: import("./missing")<string> }} Unchecked */
/** @type {Cache | Plain | Unresolved | Unchecked | undefined} */
let cache;
module.exports = { cache };
`,
        }),
      ).toEqual({
        lines: [
          "missing.js(2,18): error TS2304: Cannot find name 'Missing'.",
          "use.js(1,15): error TS2315: Type 'export=' is not generic.",
          "use.js(3,15): error TS2315: Type 'export=' is not generic.",
          "use.js(4,32): error TS7061: A mapped type may not declare properties or methods.",
        ],
        exitCode: 1,
      });
    });

    test("2315 for its type arguments: an import that is merged with a value, and `export =` next to an exported type", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig(),
          "box.ts": `export interface Box<T> { value: T }\n`,
          "m.ts": `import type { Box } from "./box";\nconst Box = 1;\nexport { Box };\n`,
          "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "types": "index.d.ts" }\n`,
          "node_modules/pkg/index.d.ts": `export = TupleMap;
export type Element<T> = T extends ReadonlyArray<infer E> ? E : never;
declare class TupleMap<K, V> {
    inner: Array<[K, V]>;
    constructor();
}
`,
          "use.ts": `type A = import("./m").Box<string>;
type B = import("./m").Box;
type Cache = import("pkg")<string, number>;
type Plain = import("pkg");
type El = import("pkg").Element<string[]>;
declare const a: A, b: B, cache: Cache | Plain, el: El;
const s: number = el;
export { a, b, cache, s };
type Unchecked = { [K in "a"]: 1; box: import("./m").Box<string>; map: import("pkg")<string, number> };
`,
        }),
      ).toEqual({
        lines: [
          "use.ts(1,10): error TS2315: Type 'Box' is not generic.",
          "use.ts(3,14): error TS2315: Type 'TupleMap' is not generic.",
          "use.ts(7,7): error TS2322: Type 'string' is not assignable to type 'number'.",
          "use.ts(9,35): error TS7061: A mapped type may not declare properties or methods.",
        ],
        exitCode: 1,
      });
    });

    // `tryGetDeclaredTypeOfSymbol`: the type is that of what the last alias names.
    test("its type through two aliases that are also values", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig(),
          "box.ts": `export interface Box<T> { value: T }\n`,
          "m.ts": `import type { Box } from "./box";\nconst Box = 1;\nexport { Box };\n`,
          "ns.ts": `import type { Box } from "./m";\nnamespace Box { export type Key = string }\nexport { Box };\n`,
          "use.ts": `declare const b: import("./ns").Box;\nconst n: number = b;\nexport { n };\n`,
        }),
      ).toEqual({
        lines: ["use.ts(2,7): error TS2322: Type 'Box<T>' is not assignable to type 'number'."],
        exitCode: 1,
      });
    });

    // Not a type that is only unresolved: `never` would take that.
    test("the error type for an alias that names nothing", async () => {
      expect(
        await check({
          "tsconfig.json": tsconfig(),
          "box.ts": `export interface Box<T> { value: T }\n`,
          "m.ts": `import type { Gone } from "./box";\nconst Gone = 1;\nexport { Gone };\n`,
          "use.ts": `declare const b: import("./m").Gone;\nconst n: never = b;\nexport { n };\n`,
        }),
      ).toEqual({
        lines: [
          `m.ts(1,15): error TS2305: Module '"./box"' has no exported member 'Gone'.`,
          "use.ts(2,7): error TS2322: Type 'any' is not assignable to type 'never'.",
        ],
        exitCode: 1,
      });
    });

    // The declared type is asked for before the type arguments are counted: that finds the circle.
    test("2456, and 2315 for its type arguments, inside the type alias that it names", async () => {
      const merged = (name: string) =>
        `import type { ${name} } from "./box";\nconst ${name} = 1;\nexport { ${name} };\n`;
      expect(
        await check({
          "tsconfig.json": tsconfig(),
          "box.ts": `export type AliasBox<T> = T | import("./m_alias").AliasBox<T>;
export type Plain = number | import("./m_plain").Plain;
export type Deep<T> = { value: T; next: import("./m_deep").Deep<T> };
`,
          "m_alias.ts": merged("AliasBox"),
          "m_deep.ts": merged("Deep"),
          "m_plain.ts": merged("Plain"),
          "use.ts": `import type { AliasBox, Plain, Deep } from "./box";\ndeclare const a: AliasBox<string>, p: Plain, d: Deep<string>;\nexport const all = [a, p, d.next];\n`,
        }),
      ).toEqual({
        lines: [
          "box.ts(1,13): error TS2456: Type alias 'AliasBox' circularly references itself.",
          "box.ts(1,31): error TS2315: Type 'AliasBox' is not generic.",
          "box.ts(2,13): error TS2456: Type alias 'Plain' circularly references itself.",
          "box.ts(3,41): error TS2315: Type 'Deep' is not generic.",
          "use.ts(2,18): error TS2315: Type 'AliasBox' is not generic.",
        ],
        exitCode: 1,
      });
    });
  });
});

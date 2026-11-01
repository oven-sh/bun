// For ./same-program-however-the-threads-fall-<part>.test.ts: one process took too much of what CI gives a file.
// A build is a function of its sources and flags. The tsconfig.json here lists thousands of files by `include`, and threads read them
// while others follow the imports of the code; 40 of the listed folders have a tsconfig.json of their own that names `types`, and no code is in them.
import { expect, setDefaultTimeout } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { cpSync, mkdirSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { run } from "./harness/run";
import { wanted } from "./harness/shares";
// One by one: a case builds for minutes, and beside others it would pass its limit where Bun has a sanitizer.
import { testOneByOne as test } from "./supported";

export function sameProgram(part: number) {
  setDefaultTimeout(300_000);

  const chainLength = 120;
  const sideProjects = 40;
  const filesInSideProject = 10;
  const compilerOptions = { strict: true, module: "esnext", moduleResolution: "bundler", noEmit: true };

  function program(
    declarationOf: (project: number) => string,
    bodyOf: (index: number) => string,
  ): Record<string, string> {
    const files: Record<string, string> = {
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          ...compilerOptions,
          target: "esnext",
          allowImportingTsExtensions: true,
          types: [],
          skipLibCheck: true,
        },
        include: ["**/*.ts"],
      }),
    };
    for (let index = 0; index < chainLength; index++) {
      const next = index + 1 < chainLength;
      files[`chain/c${index}.ts`] =
        (next ? `import { run${index + 1} } from "./c${index + 1}.ts";\n` : "") +
        `function helper${index}(x: number): number { return ${bodyOf(index)}; }\n` +
        `export function run${index}(seed: number): number { return helper${index}(seed)${next ? ` + run${index + 1}(seed + 1)` : ""}; }\n`;
    }
    for (let project = 0; project < sideProjects; project++) {
      files[`side/p${project}/tsconfig.json`] = JSON.stringify({
        compilerOptions: { ...compilerOptions, types: [`t${project}`] },
      });
      for (let file = 0; file < filesInSideProject; file++)
        files[`side/p${project}/f${file}.ts`] =
          `export interface Side${file} { value: number }\nexport function side${file}(x: Side${file}): number { return x.value + ${file}; }\n`;
      files[`node_modules/@types/t${project}/package.json`] = JSON.stringify({
        name: `@types/t${project}`,
        version: "1.0.0",
        types: "index.d.ts",
      });
      files[`node_modules/@types/t${project}/index.d.ts`] = declarationOf(project);
    }
    return files;
  }

  const entryPoint = (modules: number, more = "") =>
    `import { run${chainLength - modules} as first } from "./chain/c${chainLength - modules}.ts";\n${more}` +
    `declare const console: { log(...values: unknown[]): void };\nconsole.log(first(1), first.name.length);\n`;

  // For the two large programs. What has differed between thread counts there was decided by the front end and by the flow analysis.
  // These make the stages after them cost half, and what those two decide still reaches the bytes of the executable.
  const withCheapBackEnd = ["--aot-heat=everything-is-cold", "--aot-limit=MaxOptimizationRounds:1"];

  async function build(directory: string, entry: string, threads: number, flags: string[] = []) {
    const { stderr, exitCode } = await run(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        `--aot-threads=${threads}`,
        "--aot-out=emitted.program",
        "--minify",
        ...flags,
        entry,
        "--outfile",
        "app",
      ],
      directory,
    );
    const hashOf = async (name: string) => {
      const file = Bun.file(join(directory, name));
      return (await file.exists()) ? new Bun.CryptoHasher("sha256").update(await file.bytes()).digest("hex") : "";
    };
    const built = {
      exitCode,
      errors: stderr.split("\n").filter(line => line.startsWith("error")).length,
      program: await hashOf("emitted.program"),
      executable: await hashOf(isWindows ? "app.exe" : "app"),
    };
    await Promise.all(
      ["emitted.program", "app", "app.exe"].map(name =>
        Bun.file(join(directory, name))
          .delete()
          .catch(() => {}),
      ),
    );
    return built;
  }

  if (part === 1)
    test("how many of the listed files are read by the time the code is loaded changes nothing", async () => {
      const lengths = [chainLength];
      using dir = tempDir("aot-threads-fall", {
        ...program(
          project => `declare const global${project}: number;\n`,
          index => `x * ${index + 1}`,
        ),
        ...Object.fromEntries(lengths.map(length => [`main${length}.ts`, entryPoint(length)])),
      });
      for (const length of lengths) {
        const first = await build(String(dir), `main${length}.ts`, 1);
        expect({ length, ...first }).toEqual({ length, ...first, exitCode: 0, errors: 0 });
        for (const threads of [4, 16])
          expect({ length, threads, ...(await build(String(dir), `main${length}.ts`, threads)) }).toEqual({
            length,
            threads,
            ...first,
          });
      }
    });

  if (part === 1)
    test("what a folder without code names in `types` is not declared to the code, in any build", async () => {
      using dir = tempDir("aot-threads-fall-global", {
        ...program(
          project => `declare var shared: ${project % 2 ? "string" : "number"};\n`,
          () => `x + Number(shared)`,
        ),
        "main.ts": entryPoint(60),
      });
      for (const threads of [1, 16])
        expect(await build(String(dir), "main.ts", threads)).toEqual({
          exitCode: 1,
          errors: 60,
          program: "",
          executable: "",
        });
    });

  if (part === 1)
    test("library modules lower the same at any thread count", async () => {
      using dir = tempDir("aot-threads-fall-library", {
        "main.js": `
      const modules = [
        require("node:http"),
        require("node:http2"),
        require("node:readline"),
        require("node:child_process"),
        require("node:zlib"),
      ];
      const server = modules[0].createServer(function listener(request, response) {
        response.end(request.url);
      });
      console.log(modules.length, typeof server.listen);
    `,
      });
      const first = await build(String(dir), "main.js", 1, withCheapBackEnd);
      expect(first).toEqual({ ...first, exitCode: 0, errors: 0 });
      for (const threads of [2, 4, 8, 16, 64])
        expect({ threads, ...(await build(String(dir), "main.js", threads, withCheapBackEnd)) }).toEqual({
          threads,
          ...first,
        });
    });

  // `take(make())` does not fit, so the type checker writes an error message. To name `Hidden`, which maker.js does not import, it looks
  // through the exports of every module of the program, and in a page `module.exports = exports.default` leads back to itself. What such
  // a page knows about `exports.default` depends on who asks first. In the order of the program that is first.js, however long it takes.
  if (part === 2)
    test("a module that exports its own `exports.default` lowers the same whichever file asks about it first", async () => {
      const pages = Array.from({ length: 12 }, (_, index) => index + 1);
      const steps = Array.from({ length: 400 }, (_, index) => index);
      using dir = tempDir("aot-threads-fall-own-default", {
        "tsconfig.json": JSON.stringify({
          compilerOptions: { ...compilerOptions, target: "esnext", allowJs: true, skipLibCheck: true, types: [] },
        }),
        "package.json": JSON.stringify({ name: "pages", type: "module" }),
        "main.ts":
          `import { taken } from "./first.js";\n` +
          pages.map(page => `import * as page${page} from "./pages/page${page}.js";\n`).join("") +
          `declare const console: { log(...values: unknown[]): void };\n` +
          `console.log(taken, ${pages.map(page => `page${page}.name${page}`).join(", ")});\n`,
        "hidden.js": `export class Hidden {\n  constructor() {\n    this.count = 1;\n  }\n}\n`,
        "factory.js": `import { Hidden } from "./hidden.js";\nexport function create() {\n  return new Hidden();\n}\n`,
        "maker.js": `import { create } from "./factory.js";\nexport function make() {\n  return { inner: create() };\n}\n`,
        "first.js":
          `import { make } from "./maker.js";\n/** @param {number} count */\nfunction take(count) {\n  return count;\n}\n` +
          steps
            .map(step => `function step${step}(value) {\n  return { at: ${step}, value, next: [value, ${step}] };\n}\n`)
            .join("") +
          `export const steps = [${steps.map(step => `step${step}(${step})`).join(", ")}];\n` +
          `export const taken = take(make());\n`,
        "pages/package.json": JSON.stringify({ type: "commonjs" }),
        ...Object.fromEntries(
          pages.map(page => [
            `pages/page${page}.js`,
            `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
Object.defineProperty(exports, "name${page}", { enumerable: true, get: function () { return name${page}; } });
const name${page} = "page ${page}";
if ((typeof exports.default === "function" || (typeof exports.default === "object" && exports.default !== null)) && typeof exports.default.__esModule === "undefined") {
  Object.defineProperty(exports.default, "__esModule", { value: true });
  Object.assign(exports.default, exports);
  module.exports = exports.default;
}
`,
          ]),
        ),
      });
      const first = await build(String(dir), "main.ts", 1, withCheapBackEnd);
      expect(first).toEqual({ ...first, exitCode: 0, errors: 0 });
      for (const threads of [2, 4, 8, 16])
        expect({ threads, ...(await build(String(dir), "main.ts", threads, withCheapBackEnd)) }).toEqual({
          threads,
          ...first,
        });
    });

  // `Middle` has no constructor, so `super(..)` below it takes the parameters of `Base`. In the file of `Base` they have the types that
  // index.d.ts declares, and in any other file they are untyped. One thread lowers base and far one after the other and remembers what
  // it has found out about `Middle`; with more threads far, the largest file, is lowered by itself.
  if (part === 2)
    test("a class without a constructor takes the same parameters whichever file was lowered before", async () => {
      const steps = Array.from({ length: 1500 }, (_, index) => index);
      using dir = tempDir("aot-threads-fall-inherited-constructor", {
        "tsconfig.json": JSON.stringify({
          compilerOptions: { ...compilerOptions, target: "esnext", allowJs: true, skipLibCheck: true, types: [] },
        }),
        "package.json": JSON.stringify({ name: "classes", type: "module" }),
        "main.ts": `import { Near } from "base";
import { Far, Farther } from "far";
declare const console: { log(...values: unknown[]): void };
console.log(new Near("near").name, new Far({ name: "far", size: [2] }).name, new Farther({ name: "farther", size: [3] }).name);
`,
        "node_modules/base/package.json": JSON.stringify({
          name: "base",
          version: "1.0.0",
          main: "index.js",
          types: "index.d.ts",
        }),
        "node_modules/base/index.d.ts": `export declare class Base {
  constructor(options: { name: string; size?: number[] });
  name: string;
}
export declare class Middle extends Base {}
export declare class Other extends Base {}
export declare class Near extends Middle {
  constructor(name: string);
}
`,
        "node_modules/base/index.js": `"use strict";
class Base {
  constructor(options) {
    this.name = options.name;
    this.size = options.size;
  }
}
class Middle extends Base {}
class Other extends Base {}
class Near extends Middle {
  constructor(name) {
    super({ name, size: [1] });
  }
}
exports.Base = Base;
exports.Middle = Middle;
exports.Other = Other;
exports.Near = Near;
`,
        "node_modules/far/package.json": JSON.stringify({ name: "far", version: "1.0.0", main: "index.js" }),
        "node_modules/far/index.js":
          `"use strict";
const { Middle, Other } = require("base");
class Far extends Middle {
  constructor({ name, size }) {
    super({ name, size });
  }
}
class Farther extends Other {
  constructor({ name, size }) {
    super({ name, size });
  }
}
exports.Far = Far;
exports.Farther = Farther;
` +
          steps
            .map(step => `function step${step}(value) {\n  return { at: ${step}, value, next: [value, ${step}] };\n}\n`)
            .join("") +
          `exports.steps = [${steps.map(step => `step${step}(${step})`).join(", ")}];\n`,
      });
      const first = await build(String(dir), "main.ts", 1, withCheapBackEnd);
      expect(first).toEqual({ ...first, exitCode: 0, errors: 0 });
      for (const threads of [2, 8])
        expect({ threads, ...(await build(String(dir), "main.ts", threads, withCheapBackEnd)) }).toEqual({
          threads,
          ...first,
        });
    });

  // The typescript package is large enough for the flow analysis to split its work into batches, which the small programs above never do.
  // One thread takes serial code paths that two or more threads skip. A debug or ASAN build of Bun takes an hour here.
  if (part === 2)
    test.skipIf(wanted === "quick")("a large untyped package builds the same at one thread", async () => {
      using dir = tempDir("aot-threads-fall-typescript", {});
      cpSync(join(import.meta.dir, "servers", "typescript-check.ts"), join(String(dir), "typescript-check.ts"));
      mkdirSync(join(String(dir), "node_modules"));
      symlinkSync(
        dirname(require.resolve("typescript/package.json")),
        join(String(dir), "node_modules", "typescript"),
        "junction",
      );
      const first = await build(String(dir), "typescript-check.ts", 1, withCheapBackEnd);
      expect(first).toEqual({ ...first, exitCode: 0, errors: 0 });
      expect({ threads: 4, ...(await build(String(dir), "typescript-check.ts", 4, withCheapBackEnd)) }).toEqual({
        threads: 4,
        ...first,
      });
    });
}

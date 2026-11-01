import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// An ES file takes a name of a CommonJS file whose text does not prove that the name is made. Whatever links the ES file runs the CommonJS file first and then
// looks whether the name is there. Here `"sideEffects": false` removes the import that leads from the entry point to the ES file, and an `import()` or a
// `require()` still loads it: the entry point has nothing to look for, and the load looks for itself.

const pure = `{ "name": "p", "sideEffects": false }\n`;
const index = `export * from "./c2.mjs";\nexport * from "./b.mjs";\n`;
const start = `import { C } from "./p/index.mjs";\nconsole.log("start", C);\n`;
const load = `const m = await import("./p/b.mjs");\nconsole.log(typeof m.K1);\n`;
const packageOf = (files: Record<string, string>) => ({
  "p/package.json": pure,
  "p/index.mjs": index,
  "p/c2.mjs": `export const C = 1;\n`,
  "p/b.mjs": `export { K1 } from "./c.cjs";\n`,
  "p/c.cjs": `exports.K1 = class {};\n`,
  "main.mjs": start + load,
  ...files,
});

const twoHandOns = (index: string) => ({
  "node_modules/pure/package.json": `{ "name": "pure", "version": "1.0.0", "sideEffects": false, "exports": { ".": "./index.mjs", "./owner": "./owner.mjs" } }\n`,
  "node_modules/pure/index.mjs": index,
  "node_modules/pure/owner.mjs": `export { K1 } from "./side.cjs";\n`,
  "node_modules/pure/side.cjs": `exports.K1 = class {};\n`,
  "main.mjs": `import "pure";\nconst m = await import("pure");\nconsole.log(typeof m.K1);\n`,
});

const forms: Record<string, Record<string, string>> = {
  "an index of stars": packageOf({}),
  "an import of the file that nothing uses": packageOf({
    "main.mjs": `import { C } from "./p/c2.mjs";\nimport "./p/b.mjs";\nconsole.log("start", C);\n` + load,
  }),
  "the CommonJS file is on the list of sideEffects": packageOf({
    "p/package.json": `{ "name": "p", "sideEffects": ["./c.cjs"] }\n`,
  }),
  "the ES file imports the name and uses it": packageOf({
    "p/b.mjs": `import { parse } from "./c.cjs";\nexport function run() { return typeof parse; }\n`,
    "p/c.cjs": `exports.parse = class {};\n`,
    "main.mjs": start + `const { run } = await import("./p/b.mjs");\nconsole.log(run());\n`,
  }),
  "the load stands in a function that nobody calls": packageOf({
    "main.mjs": start + `export async function later() { const m = await import("./p/b.mjs"); return m; }\n`,
  }),
  "the load stands in a try": packageOf({
    "main.mjs":
      start +
      `try { const m = await import("./p/b.mjs"); console.log(typeof m.K1); } catch (e) { console.log("caught", e.message); }\n`,
  }),
  "a require() that is called": packageOf({
    "main.mjs":
      start +
      `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nfunction get() { return require("./p/b.mjs"); }\nconsole.log(typeof get().K1);\n`,
  }),
  "a class as tsc prints it": packageOf({
    "p/c.cjs": `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.K1 = void 0;\nclass K1 {\n}\nexports.K1 = K1;\n`,
  }),
  "the value of a call": packageOf({ "p/c.cjs": `exports.K1 = Symbol("k");\n` }),
  "two loads share the CommonJS file": packageOf({
    "p/index.mjs": index + `export * from "./b2.mjs";\n`,
    "p/b2.mjs": `export { K1 as K2 } from "./c.cjs";\n`,
    "main.mjs":
      start +
      `const [m, n] = await Promise.all([import("./p/b.mjs"), import("./p/b2.mjs")]);\nconsole.log(typeof m.K1, typeof n.K2);\n`,
  }),
  "a package with two builds": {
    "package.json": `{ "name": "app", "type": "module" }\n`,
    "node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "sideEffects": false, "main": "./dist/index.cjs", "module": "./dist/index.mjs", "exports": { ".": { "import": "./dist/index.mjs", "require": "./dist/index.cjs" }, "./extra": { "import": "./dist/extra.mjs", "require": "./dist/extra.cjs" } } }\n`,
    "node_modules/dep/dist/index.mjs": `export * from "./core.mjs";\nexport * from "./extra.mjs";\n`,
    "node_modules/dep/dist/core.mjs": `export const C = 1;\n`,
    "node_modules/dep/dist/extra.mjs": `export { K1 } from "./extra.cjs";\n`,
    "node_modules/dep/dist/extra.cjs": `"use strict";\nObject.defineProperty(exports, "__esModule", { value: true });\nexports.K1 = void 0;\nclass K1 {\n}\nexports.K1 = K1;\n`,
    "node_modules/dep/dist/index.cjs": `exports.C = 1;\n`,
    "main.mjs": `import { C } from "dep";\nconsole.log("start", C);\nconst m = await import("dep/extra");\nconsole.log(typeof m.K1);\n`,
  },
  "one specifier, imported for nothing and then loaded, and two files hand the name on": twoHandOns(
    `export { K1 } from "./owner.mjs";\n`,
  ),
  "the same through a star": twoHandOns(`export * from "./owner.mjs";\n`),
  // The entry point stays the importer, and the file that hands the name on to the index goes.
  "a used and an unused name of one index, and one more file hands the name on": packageOf({
    "p/index.mjs": `export { C } from "./c2.mjs";\nexport { K1 } from "./a2.mjs";\n`,
    "p/a2.mjs": `export { K1 } from "./b.mjs";\n`,
    "main.mjs": `import { C, K1 } from "./p/index.mjs";\nconsole.log("start", C);\n` + load,
  }),
  // The import stays, and the entry point looks.
  "the entry point uses the name too": packageOf({
    "main.mjs": `import { C, K1 } from "./p/index.mjs";\nconsole.log("start", C, typeof K1);\n` + load,
  }),
  "the entry point uses a name that the file lacks": packageOf({
    "p/c.cjs": `exports.Other = class {};\n`,
    "main.mjs": `import { C, K1 } from "./p/index.mjs";\nconsole.log("start", C, typeof K1);\n`,
  }),
};

async function answersOf(files: Record<string, string>) {
  const dir = tempDir("aot-removed-import-check", files);
  const run = async (cmd: string[]) => {
    await using proc = Bun.spawn({ cmd, cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };
  const executableOf = async (name: string, flags: string[]) => {
    const executable = join(String(dir), name);
    const built = await run([bunExe(), "build", "--compile", ...flags, "./main.mjs", "--outfile", executable]);
    expect({ stderr: built.exitCode === 0 ? "" : built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    return run([executable]);
  };
  return {
    dir,
    run: await run([bunExe(), "main.mjs"]),
    plain: () => executableOf("plain", []),
    compiled: await executableOf("compiled", ["--aot"]),
  };
}

const errorOf = (stderr: string) => /^\w*Error: .*$/m.exec(stderr)?.[0] ?? "";

test.concurrent.each(Object.entries(forms))(
  "%s",
  async (_, files) => {
    const { dir, run, compiled } = await answersOf(files);
    using _dir = dir;
    expect({ stdout: compiled.stdout, error: errorOf(compiled.stderr), exitCode: compiled.exitCode }).toEqual({
      stdout: run.stdout,
      error: errorOf(run.stderr),
      exitCode: run.exitCode,
    });
  },
  600_000,
);

// `bun run` links the whole graph that is written and stops before the first line. An executable holds no such import: it starts, without --aot too, and the
// load says what is missing.
test("the file lacks the name, and only the load is left to look", async () => {
  const { dir, run, plain, compiled } = await answersOf(
    packageOf({
      "p/c.cjs": `exports.Other = class {};\n`,
      "main.mjs":
        start +
        `try { const m = await import("./p/b.mjs"); console.log(typeof m.K1); } catch (e) { console.log("caught", e.name, e.message); }\n`,
    }),
  );
  using _dir = dir;
  expect({ stdout: run.stdout, error: errorOf(run.stderr), exitCode: run.exitCode }).toEqual({
    stdout: "",
    error: "SyntaxError: export 'K1' not found in './c.cjs'",
    exitCode: 1,
  });
  expect((await plain()).stdout).toBe("start 1\ncaught ReferenceError __INVALID__REF__ is not defined\n");
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
    stdout: "start 1\ncaught SyntaxError export 'K1' not found in './c.cjs'\n",
    exitCode: 0,
  });
}, 600_000);

// A slope, never a cliff: a construct that the compiler cannot turn into variables and calls costs the file that has it, and no other.
//
// Each program is one odd file beside 200 plain CommonJS files that it requires at its top. The odd file has one odd line: a use of the
// module cache, of its module object, of `require` as a value, of its exports as an object, a `require` that is not at the top.
// Whatever the line is, the build counts the 200 plain files as modules whose exports are variables (ModulesWithNames) and that need no
// "has it started" byte (ModulesWithoutState), as it does without the line, and the program prints the same sum.
//
//   AOT_ODD=<text>    only the lines whose name contains the text
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, slot, spawned, withoutDebugInformation } from "./run-programs";
import { describe, test } from "./supported";

const plainFiles = 200;

// What a line computes goes to `globalThis.sink`: some of it differs from `bun run` on purpose, and none of it is what is tested.
const oddLines: Record<string, string> = {
  "nothing odd": ``,

  // The module cache and the loader.
  "the keys of require.cache": `globalThis.sink = Object.keys(require.cache).length;`,
  "a key in require.cache": `globalThis.sink = __filename in require.cache;`,
  "a delete from require.cache": `delete require.cache[require.resolve("./extra.cjs")];`,
  "the keys of Module._cache": `globalThis.sink = Object.keys(require("node:module")._cache).length;`,
  "Module._load as a value": `globalThis.sink = require("node:module")._load;`,
  "process.getBuiltinModule": `globalThis.sink = process.getBuiltinModule("node:path").sep;`,

  // `require`.
  "require as a value": `globalThis.r = require;`,
  "createRequire of another place": `globalThis.sink = require("node:module").createRequire("/");`,
  "createRequire of the file itself, called": `globalThis.sink = require("node:module").createRequire(__filename)("./extra.cjs").n;`,
  "require.resolve of a constant": `globalThis.sink = require.resolve("./extra.cjs");`,
  "require.resolve of a computed name": `try { globalThis.sink = require.resolve(String(globalThis.someName)); } catch {}`,
  "require.resolve.paths": `globalThis.sink = require.resolve.paths("x");`,
  "require.main.filename": `globalThis.sink = require.main.filename;`,
  "require.main === module": `globalThis.sink = require.main === module;`,
  "require.main as a value": `globalThis.sink = require.main;`,
  "process.mainModule as a value": `globalThis.sink = process.mainModule;`,
  "module.require called": `globalThis.sink = module.require("./extra.cjs").n;`,
  "module.require as a value": `globalThis.sink = module.require;`,
  "import.meta.require called": `globalThis.sink = import.meta.require("./extra.cjs").n;`,

  // `module`, `__filename`, `__dirname`.
  "module as a value": `globalThis.sink = module;`,
  "module handed to native code": `globalThis.sink = new CustomEvent("odd", { detail: module }).detail;`,
  "module.parent tested": `globalThis.sink = !module.parent;`,
  "module.parent as a value": `globalThis.sink = module.parent;`,
  "module.children.length": `globalThis.sink = module.children.length;`,
  "the constant fields of module": `globalThis.sink = [module.id, module.filename, module.path, module.loaded];`,
  "module.paths": `globalThis.sink = module.paths;`,
  "__dirname": `globalThis.sink = __dirname;`,
  "__filename": `globalThis.sink = __filename;`,
  "import.meta.url": `globalThis.sink = import.meta.url;`,
  "typeof the names": `globalThis.sink = typeof module + typeof exports + typeof require;`,

  // The exports as an object.
  "a computed key": `for (const key of ["x", "y"]) exports[key] = key;`,
  "exports as a value": `globalThis.sink = exports;`,
  "this as a value": `globalThis.sink = this;`,
  "the keys of exports": `exports.x = 1; globalThis.sink = Object.keys(exports);`,
  "a name in exports": `globalThis.sink = "x" in exports;`,
  "a delete from exports": `exports.x = 1; delete exports.x;`,
  "exports frozen": `exports.x = 1; Object.freeze(exports);`,
  "a getter that computes": `Object.defineProperty(exports, "x", { enumerable: true, get() { return Math.random(); } });`,
  "a call whose function reads this": `exports.who = function () { return this; }; globalThis.sink = exports.who();`,
  "names that are no plain names": `exports.constructor = 1; exports[0] = 2;`,

  // `module.exports`.
  "module.exports stored in a branch": `if (process.argv.length > 99) module.exports = function () {};`,
  "module.exports stored twice": `module.exports = function () {}; module.exports = function () {};`,
  "module.exports stored in a function": `(() => { module.exports = function () {}; })();`,
  "module.exports is another module": `module.exports = require("./extra.cjs");`,

  // What makes the body a function of five parameters again.
  "a store to exports": `exports = {};`,
  "a store to module": `module = { exports: {} };`,
  "arguments at the top": `globalThis.sink = arguments.length;`,
  "a direct eval": `globalThis.sink = eval("1");`,
  "with": `with (exports) { globalThis.sink = typeof x; }`,
  "a return at the top": `if (process.argv.length > 99) return;`,

  // A `require` that is not at the top, and a result that is a value.
  "a require under a try": `try { globalThis.sink = require("./extra.cjs").n; } catch {}`,
  "a require in a function": `function load() { return require("./extra.cjs"); } globalThis.sink = load().n;`,
  "a require in a branch": `if (process.argv.length < 99) globalThis.sink = require("./extra.cjs").n;`,
  "a require in a loop": `for (let i = 0; i < 2; i++) globalThis.sink = require("./extra.cjs").n;`,
  "an import()": `globalThis.sink = import("./extra.cjs");`,
  "a required module as a value": `globalThis.sink = require("./extra.cjs");`,
  "the keys of a required module": `globalThis.sink = Object.keys(require("./extra.cjs"));`,
  "a variable that is stored again": `let held = require("./extra.cjs"); globalThis.sink = held.n; held = null;`,
  "a require of an ES module": `globalThis.sink = require("./extra.mjs").n;`,
  "a require of a package that is not installed": `try { require("a-package-that-is-not-installed"); } catch {}`,
};

function filesOf(oddLine: string) {
  const files: Record<string, string> = {
    "main.cjs": `require("./odd.cjs");\nconsole.log(globalThis.sum);\n`,
    "extra.cjs": `exports.n = 1000;\n`,
    "extra.mjs": `export const n = 1000;\n`,
  };
  const names = Array.from({ length: plainFiles }, (_, i) => `p${i}`);
  for (const [i, name] of names.entries())
    files[`${name}.cjs`] = `"use strict";\nexports.n = ${i};\nexports.f = function (x) { return x + exports.n; };\n`;
  files["odd.cjs"] =
    names.map(name => `const ${name} = require("./${name}.cjs");\n`).join("") +
    `globalThis.sum = ${names.map(name => `${name}.f(1)`).join(" + ")};\n${oddLine}\n`;
  return files;
}

const sum = (plainFiles * (plainFiles + 1)) / 2;
const only = process.env.AOT_ODD;

// Cliffs that stand today: the line costs the 200 plain files their form. The program is built and run all the same and prints the sum.
const handsTheLoaderOn =
  "the odd file hands require or module to code that the compiler does not see, so every file may be asked for by a computed name";
const cliffs: Record<string, string> = {
  "module.children.length":
    "a program that names a way from one module object to another has a module object for every file",
  "arguments at the top": handsTheLoaderOn,
  "a direct eval": handsTheLoaderOn,
  "with": handsTheLoaderOn,
  "a store to module": handsTheLoaderOn,
  "a store to exports": handsTheLoaderOn,
};

describe.concurrent("one odd file beside 200 plain ones", () => {
  for (const [name, oddLine] of Object.entries(oddLines)) {
    if (only && !name.includes(only)) continue;
    const cliff = cliffs[name];
    if (cliff) test.todo(`${name}: the plain files keep their form (${cliff})`);
    test(
      name,
      () =>
        slot(async () => {
          using directory = tempDir("aot-one-odd-file", filesOf(oddLine));
          const folder = String(directory);
          const executable = join(folder, isWindows ? "program.exe" : "program");
          const build = await spawned(
            [
              bunExe(),
              "build",
              "--compile",
              "--aot",
              "--explain=statistics",
              ...withoutDebugInformation(),
              "main.cjs",
              "--outfile",
              executable,
            ],
            folder,
            bunEnv,
          );
          built(build);
          const statistic = (statistic: string) =>
            Number(new RegExp(`^${statistic} (\\d+)$`, "m").exec(build.stderr + build.stdout)?.[1]);
          if (!cliff)
            expect({
              plainFilesWithNames: Math.min(plainFiles, statistic("ModulesWithNames")),
              plainFilesWithoutState: Math.min(plainFiles, statistic("ModulesWithoutState")),
            }).toEqual({ plainFilesWithNames: plainFiles, plainFilesWithoutState: plainFiles });
          const ran = await spawned([executable], folder, bunEnv);
          expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({
            stdout: `${sum}\n`,
            stderr: "",
            exitCode: 0,
          });
        }),
      600_000,
    );
  }
});

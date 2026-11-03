import { expect } from "bun:test";
import { tempDir } from "harness";
import { test } from "../aot/supported";
import { compileEachAlone, compileInPlace, oneAfterTheOther, startsAtAnyEntryPoint } from "./aot-builtin-modules";

// An executable holds the built-in modules that are imported by a constant name. A mention of `module` brings none with it: not where the
// file asks whether it is the main one or whether hot reloading is on, and not where `module` goes into a variable.

const programs: Record<string, string> = {
  "plain.cjs": `console.log("run");`,
  "asks-for-its-parent.cjs": `if (!module.parent) console.log("run");`,
  "compares-its-parent.cjs": `if (module.parent === null || module.parent == undefined) console.log("run");`,
  "reads-the-name-of-its-parent.cjs": `console.log(module.parent && module.parent.filename ? "required" : "run");`,
  "asks-for-hot-reloading.cjs": `if (module.hot) module.hot.accept();\nconsole.log("run");`,
  "defines-its-exports.cjs": `Object.defineProperty(module, "exports", { enumerable: true, get() { return {}; } });\nconsole.log("run");`,
  "compares-module-with-null.cjs": `if (typeof module !== "undefined" && module != null) module.exports = {};\nconsole.log("run");`,
  "tests-module.cjs": `if (module && module.exports) module.exports = {};\nconsole.log(module ? "run" : "");`,
  "tests-require.cjs": `console.log(typeof require === "function" && require != null && require ? "run" : "");`,
};

// `module.constructor` is node:module, so these programs hold that module and find its functions. Each is measured alone.
const holdingNodeModule: Record<string, string> = {
  "reads-the-constructor.cjs": `module.exports = String(module.constructor._findPath).indexOf("preserveSymlinks") >= 0;\nconsole.log("run");`,
  "finds-a-function-of-the-constructor.cjs": `console.log(typeof module.constructor._findPath === "function" ? "run" : "");`,
};

// The first of them with node:module required by name, which is the measure of what the first one holds.
const namingNodeModule: Record<string, string> = {
  "names-node-module.cjs": `module.exports = String(require("node:module")._findPath).indexOf("preserveSymlinks") >= 0;\nconsole.log("run");`,
};

const inExecutablesOnly: Record<string, string> = {
  "keeps-module-in-a-variable.cjs": `var freeModule = typeof module == "object" && module && !module.nodeType && module;\nconsole.log(freeModule ? "run" : "");`,
  "hands-module-on.cjs": `console.log(Object.keys(module).length > 0 ? "run" : "");`,
};

// How large compiled code is follows from how Bun was built, so the plain program is the measure. A built-in module is larger than all of it.
const grows = (bytes: number, plain: number) => !(bytes - plain <= plain / 8);

test.skipIf(!startsAtAnyEntryPoint)(
  "tests of module.parent and module.hot bring no built-in module into the executable, and a read of module.constructor brings node:module",
  async () => {
    const all = { ...programs, ...holdingNodeModule, ...namingNodeModule, ...inExecutablesOnly };
    using dir = tempDir("builtin-modules-of-a-small-program", all);
    const ran = await compileEachAlone(String(dir), Object.keys(all));
    for (const [entry, { stdout, exitCode, bytes }] of Object.entries(ran))
      expect({ entry, stdout, exitCode, grows: grows(bytes, ran["plain.cjs"].bytes) }).toEqual({
        entry,
        stdout: "run\n",
        exitCode: 0,
        grows: false,
      });
    // What reaches node:module through `module.constructor` is as large as what reaches it through its name.
    expect(ran["reads-the-constructor.cjs"].bytes).toBe(ran["names-node-module.cjs"].bytes);
  },
  120_000,
);

test("nor do they make bun run --debug-aot compile built-in modules", async () => {
  using dir = tempDir("builtin-modules-of-a-small-program", { ...programs, "all.mjs": oneAfterTheOther(programs) });
  const [plain, all] = await Promise.all(["plain.cjs", "all.mjs"].map(entry => compileInPlace(String(dir), entry)));
  expect([plain.exitCode, all.exitCode, grows(all.bytes, plain.bytes)]).toEqual([0, 0, false]);
}, 120_000);

test("bun run --debug-aot compiles for a read of module.constructor what it compiles for a require of node:module", async () => {
  using dir = tempDir("builtin-modules-of-a-small-program", {
    "plain.cjs": programs["plain.cjs"],
    ...holdingNodeModule,
    ...namingNodeModule,
  });
  const inPlace = (entry: string) => compileInPlace(String(dir), entry);
  const [plain, named, reads, finds] = await Promise.all([
    inPlace("plain.cjs"),
    inPlace("names-node-module.cjs"),
    inPlace("reads-the-constructor.cjs"),
    inPlace("finds-a-function-of-the-constructor.cjs"),
  ]);
  expect({ ...reads, grows: grows(reads.bytes, plain.bytes) }).toEqual({
    stdout: "run\n",
    exitCode: 0,
    bytes: named.bytes,
    grows: false,
  });
  expect({ stdout: named.stdout, exitCode: named.exitCode }).toEqual({ stdout: "run\n", exitCode: 0 });
  expect({ stdout: finds.stdout, exitCode: finds.exitCode, grows: grows(finds.bytes, plain.bytes) }).toEqual({
    stdout: "run\n",
    exitCode: 0,
    grows: false,
  });
}, 120_000);

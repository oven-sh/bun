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
  "reads-the-constructor.cjs": `module.exports = String(module.constructor._findPath).indexOf("preserveSymlinks") >= 0;\nconsole.log("run");`,
};

const inExecutablesOnly: Record<string, string> = {
  "keeps-module-in-a-variable.cjs": `var freeModule = typeof module == "object" && module && !module.nodeType && module;\nconsole.log(freeModule ? "run" : "");`,
  "hands-module-on.cjs": `console.log(Object.keys(module).length > 0 ? "run" : "");`,
};

// How large compiled code is follows from how Bun was built, so the plain program is the measure. A built-in module is larger than all of it.
const grows = (bytes: number, plain: number) => !(bytes - plain <= plain / 8);

// The goal is not met for these yet: what they reach of Bun's library is not cut down to what they use. The number is the size of the image in
// sizes of the plain program's image, measured on Linux x64. Each of their cases runs every time and fails once the bound is met: the entry
// goes out of this list then.
const timesThePlainProgram: Record<string, number> = {
  "asks-for-its-parent.cjs": 2.19,
  "compares-its-parent.cjs": 2.19,
  "reads-the-name-of-its-parent.cjs": 2.19,
  "defines-its-exports.cjs": 6.76,
  "reads-the-constructor.cjs": 6.76,
};
const measuredAgainstBound = (times: number) => `: ${times} times the plain program, the bound is 1.125 times`;

const all = { ...programs, ...inExecutablesOnly };
let executables: ReturnType<typeof compileEachAlone> | undefined;
const compiledOnce = () =>
  (executables ??= (async () => {
    using dir = tempDir("builtin-modules-of-a-small-program", all);
    return await compileEachAlone(String(dir), Object.keys(all));
  })());

test.skipIf(!startsAtAnyEntryPoint)(
  "programs that test module.parent and module.hot run as executables",
  async () => {
    for (const [entry, { stdout, exitCode }] of Object.entries(await compiledOnce()))
      expect({ entry, stdout, exitCode }).toEqual({ entry, stdout: "run\n", exitCode: 0 });
  },
  120_000,
);

for (const entry of Object.keys(all)) {
  const times = timesThePlainProgram[entry];
  (times ? test.failing : test.skipIf(!startsAtAnyEntryPoint))(
    `${entry} brings no built-in module into the executable${times ? measuredAgainstBound(times) : ""}`,
    async () => {
      const ran = await compiledOnce();
      expect({ entry, grows: grows(ran[entry].bytes, ran["plain.cjs"].bytes) }).toEqual({ entry, grows: false });
    },
    120_000,
  );
}

let inPlace: Promise<Record<string, Awaited<ReturnType<typeof compileInPlace>>>> | undefined;
const compiledInPlaceOnce = () =>
  (inPlace ??= (async () => {
    using dir = tempDir("builtin-modules-of-a-small-program", { ...programs, "all.mjs": oneAfterTheOther(programs) });
    const entries = ["plain.cjs", "all.mjs"];
    const ran = await Promise.all(entries.map(entry => compileInPlace(String(dir), entry)));
    return Object.fromEntries(entries.map((entry, index) => [entry, ran[index]]));
  })());

test("they run under bun run --debug-aot too", async () => {
  const ran = await compiledInPlaceOnce();
  expect(Object.values(ran).map(({ exitCode }) => exitCode)).toEqual([0, 0]);
}, 120_000);

test.failing(
  `nor do they make bun run --debug-aot compile built-in modules${measuredAgainstBound(6.76)}`,
  async () => {
    const ran = await compiledInPlaceOnce();
    expect(grows(ran["all.mjs"].bytes, ran["plain.cjs"].bytes)).toBe(false);
  },
  120_000,
);

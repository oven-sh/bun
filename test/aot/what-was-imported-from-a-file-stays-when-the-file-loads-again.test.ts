import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

// A CommonJS file is taken out of require.cache and required again. Whoever imported from the first load goes on holding what the first load made.
const files = {
  "value/counter.cjs": `globalThis.value = (globalThis.value ?? 0) + 1;\nmodule.exports = { load: globalThis.value };`,
  "value/one.test.js": `
    import { test } from "bun:test";
    import whole from "./counter.cjs";
    delete require.cache[require.resolve("./counter.cjs")];
    const again = require("./counter.cjs");
    test("value", () => { console.log("value:", whole.load, again.load, whole === again); });`,

  "names/counter.cjs": `globalThis.names = (globalThis.names ?? 0) + 1;\nexports.load = globalThis.names;\nexports.name = "names";`,
  "names/user.mjs": `
    import { load } from "./counter.cjs";
    import whole from "./counter.cjs";
    export const seen = () => [load, whole.load, whole.name].join(" ");`,
  "names/one.test.js": `
    import { test } from "bun:test";
    import { seen } from "./user.mjs";
    test("names", () => {
      const before = seen();
      delete require.cache[require.resolve("./counter.cjs")];
      const again = require("./counter.cjs");
      console.log("names:", before, "|", seen(), "|", again.load);
    });`,

  "closures/counter.cjs": `
    globalThis.closures = (globalThis.closures ?? 0) + 1;
    exports.load = globalThis.closures;
    exports.get = function () { return exports.load; };
    exports.set = function (value) { exports.load = value; };`,
  "closures/one.test.js": `
    import { test } from "bun:test";
    import { get, load, set } from "./counter.cjs";
    test("closures", () => {
      delete require.cache[require.resolve("./counter.cjs")];
      const again = require("./counter.cjs");
      console.log("closures:", load, get(), again.load, again.get(), get === again.get);
      set(10);
      console.log("closures:", get(), again.get(), again.load);
      again.set(20);
      console.log("closures:", get(), again.get(), again.load);
    });`,

  "entry/counter.cjs": `globalThis.entry = (globalThis.entry ?? 0) + 1;\nmodule.exports = { load: globalThis.entry };`,
  "entry/one.test.js": `
    import { test } from "bun:test";
    test("entry", () => {
      const path = require.resolve("./counter.cjs");
      const first = require("./counter.cjs");
      const held = require.cache[path];
      delete require.cache[path];
      const second = require("./counter.cjs");
      console.log("entry:", first.load, second.load, held === require.cache[path], held.exports === first, require.cache[path].exports === second);
      held.exports = "stored";
      console.log("entry:", held.exports, require("./counter.cjs") === second, require.cache[path].exports === second);
    });`,

  "stored/counter.cjs": `globalThis.stored = (globalThis.stored ?? 0) + 1;\nmodule.exports = { load: globalThis.stored };`,
  "stored/one.test.js": `
    import { beforeEach, test } from "bun:test";
    import whole from "./counter.cjs";
    let fresh;
    beforeEach(() => { require.cache[require.resolve("./counter.cjs")] = undefined; fresh = require("./counter.cjs"); });
    test("one", () => { console.log("stored:", whole.load, fresh.load); });
    test("two", () => { console.log("stored:", whole.load, fresh.load); });`,
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }],
];

for (const [way, env] of ways) {
  test(way, async () => {
    using dir = tempDir("imported-from-the-first-load", files);
    const said = async (flags: string[], env: Record<string, string>) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), { ...bunEnv, ...env });
      if (exitCode !== 0) console.error(stderr);
      return { stdout, exitCode };
    };
    const plain = await said([], {});
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout).toContain("value: 1 2 false");
    expect(plain.stdout).toContain("names: 1 1 names | 1 1 names | 2");
    expect(plain.stdout).toContain("closures: 1 1 2 2 false");
    expect(plain.stdout).toContain("entry: 1 2 false true true");
    expect(await said(["--aot"], env)).toEqual(plain);
  });
}

import { expect, test } from "bun:test";
import { bunRun, tempDir } from "harness";
import { join } from "path";
import * as CJSArrayLike from "./cjs-defineProperty-arraylike.cjs";
import * as CJS from "./cjs-defineProperty-fixture.cjs";
import * as Self from "./esm-defineProperty.test.ts";
// https://github.com/oven-sh/bun/issues/4432
test("defineProperty", () => {
  expect(CJS.a).toBe(1);
  expect(CJS.b).toBe(2);
  // non-enumerable getter/setter are not copied, matching node.js
  expect(CJS.c).toBe(undefined);

  expect(Bun.inspect(CJS.default)).toBe(`{\n  a: 1,\n  b: 2,\n  c: [Getter],\n}`);
});
export const __esModule = true;
test("shows __esModule if it was exported", () => {
  expect(Bun.inspect(Self)).toBe(`Module {
  __esModule: true,
}`);
  expect(Object.getOwnPropertyNames(Self)).toContain("__esModule");
});

test("arraylike", () => {
  expect(CJSArrayLike[0]).toBe(0);
  expect(CJSArrayLike[1]).toBe(1);
  expect(CJSArrayLike[2]).toBe(3);
  expect(CJSArrayLike[3]).toBe(4);
  expect(CJSArrayLike[4]).toBe(undefined);
  expect(CJSArrayLike).toHaveProperty("4");
  expect(Object.getOwnPropertyNames(CJSArrayLike)).not.toContain("__esModule");
  expect(Object.getOwnPropertyNames(CJSArrayLike.default)).not.toContain("__esModule");
  expect(Bun.inspect(CJSArrayLike)).toBe(`Module {
  "0": 0,
  "1": 1,
  "2": 3,
  "3": 4,
  "4": undefined,
  default: {
    "0": 0,
    "1": 1,
    "2": [Getter],
    "3": 4,
    "4": [Getter],
  },
}`);
});

// The namespace of a CommonJS module is built by walking module.exports. An object holding only
// data properties is walked through its Structure ("fast"); an accessor or an index on it, or a
// function as module.exports, switches to getOwnPropertyNames ("slow"). With __esModule set, a
// non-enumerable data property (the "defineProperty" rule above) has to come out the same either way.
test.concurrent("__esModule: non-enumerable data exports are exported on both enumeration paths", async () => {
  const esModule = `Object.defineProperty(exports, "__esModule", { value: true });`;
  const hidden = `Object.defineProperty(exports, "hidden", { value: 2 });`;
  // What tsc and babel emit for `export { x } from "./x"`.
  const reexport = `Object.defineProperty(exports, "reexport", { enumerable: true, get: () => 3 });`;
  using dir = tempDir("cjs-esmodule-dontenum", {
    "data-fast.cjs": `${esModule} exports.visible = 1; ${hidden}`,
    "data-slow-getter.cjs": `${esModule} exports.visible = 1; ${hidden} ${reexport}`,
    "data-slow-indexed.cjs": `${esModule} exports.visible = 1; ${hidden} exports[0] = "zero";`,
    // Non-enumerable accessors are not exports (see "defineProperty" above); that rule still applies.
    "accessor-slow.cjs": `${esModule} ${hidden} Object.defineProperty(exports, "hiddenGetter", { get: () => 4 });`,
    "default-fast.cjs": `${esModule} Object.defineProperty(exports, "default", { value: "own default" });`,
    "default-slow.cjs": `${esModule} Object.defineProperty(exports, "default", { value: "own default" }); ${reexport}`,
    "function-slow.cjs": `
      module.exports = function fn() {};
      Object.defineProperty(module.exports, "__esModule", { value: true });
      Object.defineProperty(module.exports, "hidden", { value: 2 });
    `,
    "main.mjs": `
      import * as dataFast from "./data-fast.cjs";
      import * as dataSlowGetter from "./data-slow-getter.cjs";
      import * as dataSlowIndexed from "./data-slow-indexed.cjs";
      import * as accessorSlow from "./accessor-slow.cjs";
      import * as defaultFast from "./default-fast.cjs";
      import * as defaultSlow from "./default-slow.cjs";
      import * as functionSlow from "./function-slow.cjs";
      for (const [name, ns] of Object.entries({ dataFast, dataSlowGetter, dataSlowIndexed, accessorSlow, defaultFast, defaultSlow })) {
        const dflt = typeof ns.default === "object" ? "module.exports" : JSON.stringify(ns.default);
        console.log(name.padEnd(16), JSON.stringify(Object.keys(ns)).padEnd(42), "hidden:", ns.hidden, "default:", dflt);
      }
      // A function's own length/name/prototype also show up here, so only the property under test is printed.
      console.log("functionSlow".padEnd(16), "hidden:", functionSlow.hidden, "default:", typeof functionSlow.default);
    `,
  });

  const result = await bunRun(join(String(dir), "main.mjs"));
  expect(result.stdout).toMatchInlineSnapshot(`
    "dataFast         ["default","hidden","visible"]             hidden: 2 default: module.exports
    dataSlowGetter   ["default","hidden","reexport","visible"]  hidden: 2 default: module.exports
    dataSlowIndexed  ["0","default","hidden","visible"]         hidden: 2 default: module.exports
    accessorSlow     ["default","hidden"]                       hidden: 2 default: module.exports
    defaultFast      ["default"]                                hidden: undefined default: "own default"
    defaultSlow      ["default","reexport"]                     hidden: undefined default: "own default"
    functionSlow     hidden: 2 default: function"
  `);
  expect(result).toSpawn();
});

test.concurrent("__esModule: named import of a non-enumerable data export enumerated on the slow path", async () => {
  using dir = tempDir("cjs-esmodule-dontenum-named-import", {
    "exports.cjs": `
      Object.defineProperty(exports, "__esModule", { value: true });
      Object.defineProperty(exports, "hidden", { value: 2 });
      Object.defineProperty(exports, "reexport", { enumerable: true, get: () => 3 });
    `,
    "main.mjs": `
      import { hidden } from "./exports.cjs";
      console.log(hidden);
    `,
  });

  // Without the export this fails to link: "Export named 'hidden' not found".
  expect(await bunRun(join(String(dir), "main.mjs"))).toSpawn("2");
});

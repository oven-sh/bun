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

// The namespace for a CommonJS module is built by walking module.exports. A plain object is walked
// through its Structure ("fast"); an object with a getter is walked with getOwnPropertyNames
// ("slow"). An own "constructor" property must come out the same either way.
test.concurrent("an own 'constructor' export is exported on both enumeration paths", async () => {
  const getter = `get g() { return 2; }`;
  using dir = tempDir("cjs-constructor-export", {
    "plain-fast.cjs": `module.exports = { a: 1, constructor: "K" };`,
    "plain-slow.cjs": `module.exports = { a: 1, constructor: "K", ${getter} };`,
    "esModule-fast.cjs": `module.exports = { __esModule: true, a: 1, constructor: "K" };`,
    "esModule-slow.cjs": `module.exports = { __esModule: true, a: 1, constructor: "K", ${getter} };`,
    // Foo.prototype.constructor is non-enumerable. Non-enumerable data properties are exported
    // (see "defineProperty" above), so it is exported too, on both paths.
    "prototype-fast.cjs": `
      function Foo() {}
      Foo.prototype.a = 1;
      module.exports = Foo.prototype;
    `,
    "prototype-slow.cjs": `
      function Foo() {}
      Foo.prototype.a = 1;
      Object.defineProperty(Foo.prototype, "g", { enumerable: true, get: () => 2 });
      module.exports = Foo.prototype;
    `,
    "main.mjs": `
      import * as plainFast from "./plain-fast.cjs";
      import * as plainSlow from "./plain-slow.cjs";
      import * as esModuleFast from "./esModule-fast.cjs";
      import * as esModuleSlow from "./esModule-slow.cjs";
      import * as prototypeFast from "./prototype-fast.cjs";
      import * as prototypeSlow from "./prototype-slow.cjs";
      for (const [name, ns] of Object.entries({ plainFast, plainSlow, esModuleFast, esModuleSlow, prototypeFast, prototypeSlow })) {
        const value = typeof ns.constructor === "function" ? ns.constructor.name : JSON.stringify(ns.constructor);
        console.log(name.padEnd(14), JSON.stringify(Object.keys(ns)).padEnd(36), "constructor:", value);
      }
    `,
  });

  const result = await bunRun(join(String(dir), "main.mjs"));
  expect(result.stdout).toMatchInlineSnapshot(`
    "plainFast      ["a","constructor","default"]        constructor: "K"
    plainSlow      ["a","constructor","default","g"]    constructor: "K"
    esModuleFast   ["a","constructor","default"]        constructor: "K"
    esModuleSlow   ["a","constructor","default","g"]    constructor: "K"
    prototypeFast  ["a","constructor","default"]        constructor: Foo
    prototypeSlow  ["a","constructor","default","g"]    constructor: Foo"
  `);
  expect(result).toSpawn();
});

test.concurrent("named import of a 'constructor' export that was enumerated on the slow path", async () => {
  using dir = tempDir("cjs-constructor-named-import", {
    "exports.cjs": `
      exports.constructor = "K";
      Object.defineProperty(exports, "g", { enumerable: true, get: () => 2 });
    `,
    "main.mjs": `
      import { constructor } from "./exports.cjs";
      console.log(constructor);
    `,
  });

  // Without the export this fails to link: "Export named 'constructor' not found".
  expect(await bunRun(join(String(dir), "main.mjs"))).toSpawn("K");
});

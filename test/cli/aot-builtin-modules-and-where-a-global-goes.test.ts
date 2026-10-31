import { expect } from "bun:test";
import { tempDir } from "harness";
import { test } from "../aot/supported";
import { compileEachAlone, importingByName, oneAfterTheOther, startsAtAnyEntryPoint } from "./aot-builtin-modules";

const plain = "plain.mjs";

const withoutADoor: Record<string, string> = {
  "the-global-object-chosen-and-read.cjs": `var OwnUint8Array = (typeof global !== "undefined" ? global : typeof window !== "undefined" ? window : typeof self !== "undefined" ? self : {}).Uint8Array || function () {};
console.log(typeof OwnUint8Array === "function" ? "run" : "");`,
  "the-global-object-kept-and-read.mjs": `const root = typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : {};
console.log(root.Array && root["Object"] && "Map" in root && root.globalThis.Set ? "run" : "");`,
  "a-universal-module-definition.cjs": `(function (global, factory) {
  typeof exports === "object" && typeof module !== "undefined" ? (module.exports = factory()) : typeof define === "function" && define.amd ? define(factory) : ((global = typeof globalThis !== "undefined" ? globalThis : global || self).library = factory());
})(this, function () {
  return { name: "library" };
});
console.log(module.exports.name === "library" ? "run" : "");`,
  "a-native-function-bound-to-the-global-object.cjs": `const later = typeof queueMicrotask === "function" ? queueMicrotask.bind(typeof window !== "undefined" ? window : global) : callback => Promise.resolve().then(callback);
later(() => console.log("run"));`,
  "function-return-this.cjs": `var freeGlobal = typeof global == "object" && global && global.Object === Object && global;
var freeSelf = typeof self == "object" && self && self.Object === Object && self;
var root = freeGlobal || freeSelf || Function("return this")();
console.log(root.Symbol ? "run" : "");`,
  "process-through-the-global-object.mjs": `const root = globalThis;
const variables = root.process && root.process.env;
console.log(variables ? "run" : "");`,
  "process-required.cjs": `const process = require("node:process");
console.log(process.env && process.argv.length > 0 ? "run" : "");`,
  "process-kept.mjs": `const own = process;
console.log(own.env && "argv" in own ? "run" : "");`,
  "process-or-nothing-taken-apart.mjs": `const { env = {}, argv = [], platform = "" } = typeof process === "undefined" ? {} : process;
console.log(env && argv && platform ? "run" : "");`,
  "handed-to-a-function-that-stores-under-computed-keys.cjs": `var assign;
(function (factory) {
  var root = typeof global === "object" ? global : typeof self === "object" ? self : typeof this === "object" ? this : {};
  if (typeof define === "function" && define.amd) {
    define("library", ["exports"], function (exports) { factory(createExporter(root, createExporter(exports))); });
  } else if (typeof module === "object" && typeof module.exports === "object") {
    factory(createExporter(root, createExporter(module.exports)));
  } else {
    factory(createExporter(root));
  }
  function createExporter(exports, previous) {
    if (exports !== root) {
      if (typeof Object.create === "function") {
        Object.defineProperty(exports, "__esModule", { value: true });
      } else {
        exports.__esModule = true;
      }
    }
    return function (id, v) { return exports[id] = previous ? previous(id, v) : v; };
  }
})(function (exporter) {
  assign = function (a) { return a; };
  exporter("assign", assign);
});
console.log(typeof module.exports.assign === "function" ? "run" : "");`,
  "handed-to-a-function-called-on-the-spot.cjs": `(function universalModuleDefinition(root, factory) {
  if (typeof exports === "object" && typeof module === "object") module.exports = factory();
  else if (typeof define === "function" && define.amd) define([], factory);
  else if (typeof exports === "object") exports["library"] = factory();
  else root["library"] = factory();
})(typeof self !== "undefined" ? self : this, function () {
  return { name: "library" };
});
console.log(module.exports.name === "library" ? "run" : "");`,
  "the-default-of-a-parameter.mjs": `function has(name, root = globalThis) {
  return name in root && typeof root.Array === "function";
}
console.log(has("Map") ? "run" : "");`,
  "process-handed-to-a-constant-function.mjs": `const isFit = candidate => !!candidate && typeof candidate === "object" && typeof candidate.emit === "function" && typeof candidate.pid === "number";
const own = globalThis.process;
console.log(isFit(own) ? "run" : "");`,
  "a-symbol-for-a-key.cjs": `var queue = Symbol.for("a-small-program.queue");
if (!global[queue]) Object.defineProperty(global, queue, { get: function () { return []; } });
console.log(Array.isArray(global[queue]) && globalThis[Symbol.for("a-small-program.queue")] ? "run" : "");`,
};

const name = `const name = ["node:querystring"][0];\n`;
const loaded = (how: string) => `console.log(typeof ${how}.escape === "function" ? "run" : "");`;
const withADoor = importingByName("node:querystring", {
  "the-parameter-is-returned.mjs": `const check = it => it && it.Math === Math && it;
const root = check(typeof globalThis == "object" && globalThis);
console.log(typeof root.process.getBuiltinModule(["node:querystring"][0]).escape === "function" ? "run" : "");`,
  "the-arguments-object.cjs": `function first(root) { return arguments[0]; }
console.log(typeof first(globalThis).process.getBuiltinModule(["node:querystring"][0]).escape === "function" ? "run" : "");`,
  "the-global-object-read-by-a-computed-name.mjs": `${name}const first = globalThis;\nconst second = first;\nconst key = ["pro", "cess"].join("");\n${loaded("second[key].getBuiltinModule(name)")}`,
  "the-global-object-handed-to-a-function.mjs": `${name}const use = object => object.process.getBuiltinModule(name);\n${loaded('use(typeof globalThis !== "undefined" ? globalThis : {})')}`,
  "the-global-object-in-a-literal.mjs": `${name}const held = { root: globalThis };\n${loaded("held.root.process.getBuiltinModule(name)")}`,
  "the-global-object-returned.mjs": `${name}const root = (() => globalThis)();\n${loaded("root.process.getBuiltinModule(name)")}`,
  "the-loader-read-off-process-through-the-global-object.mjs": `${name}const root = globalThis;\n${loaded('root.process["getBuiltinModule"](name)')}`,
  "process-kept-and-handed-on.mjs": `${name}const own = process;\nconst use = kept => kept.getBuiltinModule(name);\n${loaded("use(own)")}`,
  "process-required-and-handed-on.cjs": `${name}const use = kept => kept.getBuiltinModule(name);\n${loaded('use(require("node:process"))')}`,
});

const harmless = "without-a-door.mjs";
const loading = "with-a-door.mjs";

test.skipIf(!startsAtAnyEntryPoint)(
  "a global that goes nowhere but into reads by written names brings no built-in module into the executable",
  async () => {
    using dir = tempDir("where-a-global-goes", {
      [plain]: `console.log("run");`,
      ...withoutADoor,
      ...withADoor,
      [harmless]: oneAfterTheOther(withoutADoor),
      [loading]: oneAfterTheOther(withADoor),
    });
    const ran = await compileEachAlone(String(dir), [plain, harmless, loading]);
    expect(ran).toEqual({
      [plain]: { stdout: "run\n", exitCode: 0, bytes: expect.any(Number) },
      [harmless]: { stdout: "run\n".repeat(Object.keys(withoutADoor).length), exitCode: 0, bytes: expect.any(Number) },
      [loading]: { stdout: "run\n".repeat(Object.keys(withADoor).length), exitCode: 0, bytes: expect.any(Number) },
    });
    expect(ran[harmless].bytes - ran[plain].bytes).toBeLessThan(1024 * 1024);
  },
  280_000,
);

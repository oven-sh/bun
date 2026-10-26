import assert from "assert";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isAndroid, isFreeBSD, nodeExeAtLeast } from "harness";
import { join } from "node:path";
import def, * as ns from "util/types";
const req = require("util/types");
const types = def;

function inspect(val) {
  return Bun.inspect(val);
}

for (const [value, _method] of [
  [new Date()],
  [
    (function () {
      return arguments;
    })(),
    "isArgumentsObject",
  ],
  [new Boolean(), "isBooleanObject"],
  [new Number(), "isNumberObject"],
  [new String(), "isStringObject"],
  [Object(Symbol()), "isSymbolObject"],
  [Object(BigInt(0)), "isBigIntObject"],
  [new Error(), "isNativeError"],
  [new RegExp()],
  [(function* () {})(), "isGeneratorObject"],
  [(async function* () {})(), "isGeneratorObject"],
  [Promise.resolve()],
  [new Map()],
  [new Set()],
  [new Map()[Symbol.iterator](), "isMapIterator"],
  [new Set()[Symbol.iterator](), "isSetIterator"],
  [new WeakMap()],
  [new WeakSet()],
  [new ArrayBuffer()],
  [new Uint8Array()],
  [new Uint8ClampedArray()],
  [new Uint16Array()],
  [new Uint32Array()],
  [new Int8Array()],
  [new Int16Array()],
  [new Int32Array()],
  [new Float32Array()],
  [new Float64Array()],
  [new BigInt64Array()],
  [new BigUint64Array()],
  [new DataView(new ArrayBuffer())],
  [new SharedArrayBuffer()],
  [new Proxy({}, {}), "isProxy"],
  [new EventTarget()],
]) {
  const method = _method || `is${value.constructor.name}`;
  test(method, () => {
    assert(method in types, `Missing ${method} for ${inspect(value)}`);
    assert(types[method](value), `Want ${inspect(value)} to match ${method}`);

    for (const [types, label] of [
      [def, "default import"],
      [ns, "ns import"],
      [req, "require esm"],
    ]) {
      for (const key of Object.keys(types).filter(x => x !== "default")) {
        if (
          ((types.isArrayBufferView(value) || types.isAnyArrayBuffer(value)) && key.includes("Array")) ||
          key === "isBoxedPrimitive"
        ) {
          continue;
        }

        expect(types[key](value)).toBe(key === method);
      }
    }
  });
}

// Check boxed primitives.
test("isBoxedPrimitive", () => {
  [new Boolean(), new Number(), new String(), Object(Symbol()), Object(BigInt(0))].forEach(entry =>
    assert(types.isBoxedPrimitive(entry)),
  );
});

test("isBigIntObject/isSymbolObject/isBoxedPrimitive survive structure and prototype changes", () => {
  const cases = [
    ["isBigIntObject", () => Object(1n)],
    ["isSymbolObject", () => Object(Symbol())],
  ];
  for (const [method, make] of cases) {
    const withProp = make();
    withProp.foo = "bar";
    const nullProto = Object.setPrototypeOf(make(), null);
    const arrayProto = Object.setPrototypeOf(make(), Array.prototype);

    expect({
      [method]: {
        plain: types[method](make()),
        withProp: types[method](withProp),
        nullProto: types[method](nullProto),
        arrayProto: types[method](arrayProto),
        primitive: types[method](make().valueOf()),
        plainObject: types[method]({}),
      },
      isBoxedPrimitive: {
        plain: types.isBoxedPrimitive(make()),
        withProp: types.isBoxedPrimitive(withProp),
        nullProto: types.isBoxedPrimitive(nullProto),
        arrayProto: types.isBoxedPrimitive(arrayProto),
      },
    }).toEqual({
      [method]: {
        plain: true,
        withProp: true,
        nullProto: true,
        arrayProto: true,
        primitive: false,
        plainObject: false,
      },
      isBoxedPrimitive: {
        plain: true,
        withProp: true,
        nullProto: true,
        arrayProto: true,
      },
    });
  }
});

{
  const primitive = true;
  const arrayBuffer = new ArrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const dataView = new DataView(arrayBuffer);
  const uint8Array = new Uint8Array(arrayBuffer);
  const uint8ClampedArray = new Uint8ClampedArray(arrayBuffer);
  const uint16Array = new Uint16Array(arrayBuffer);
  const uint32Array = new Uint32Array(arrayBuffer);
  const int8Array = new Int8Array(arrayBuffer);
  const int16Array = new Int16Array(arrayBuffer);
  const int32Array = new Int32Array(arrayBuffer);
  const float32Array = new Float32Array(arrayBuffer);
  const float64Array = new Float64Array(arrayBuffer);
  const bigInt64Array = new BigInt64Array(arrayBuffer);
  const bigUint64Array = new BigUint64Array(arrayBuffer);

  const fakeBuffer = Object.create(Buffer.prototype);
  const fakeDataView = Object.create(DataView.prototype);
  const fakeUint8Array = Object.create(Uint8Array.prototype);
  const fakeUint8ClampedArray = Object.create(Uint8ClampedArray.prototype);
  const fakeUint16Array = Object.create(Uint16Array.prototype);
  const fakeUint32Array = Object.create(Uint32Array.prototype);
  const fakeInt8Array = Object.create(Int8Array.prototype);
  const fakeInt16Array = Object.create(Int16Array.prototype);
  const fakeInt32Array = Object.create(Int32Array.prototype);
  const fakeFloat32Array = Object.create(Float32Array.prototype);
  const fakeFloat64Array = Object.create(Float64Array.prototype);
  const fakeBigInt64Array = Object.create(BigInt64Array.prototype);
  const fakeBigUint64Array = Object.create(BigUint64Array.prototype);

  const stealthyDataView = Object.setPrototypeOf(new DataView(arrayBuffer), Uint8Array.prototype);
  const stealthyUint8Array = Object.setPrototypeOf(new Uint8Array(arrayBuffer), ArrayBuffer.prototype);
  const stealthyUint8ClampedArray = Object.setPrototypeOf(new Uint8ClampedArray(arrayBuffer), ArrayBuffer.prototype);
  const stealthyUint16Array = Object.setPrototypeOf(new Uint16Array(arrayBuffer), Uint16Array.prototype);
  const stealthyUint32Array = Object.setPrototypeOf(new Uint32Array(arrayBuffer), Uint32Array.prototype);
  const stealthyInt8Array = Object.setPrototypeOf(new Int8Array(arrayBuffer), Int8Array.prototype);
  const stealthyInt16Array = Object.setPrototypeOf(new Int16Array(arrayBuffer), Int16Array.prototype);
  const stealthyInt32Array = Object.setPrototypeOf(new Int32Array(arrayBuffer), Int32Array.prototype);
  const stealthyFloat32Array = Object.setPrototypeOf(new Float32Array(arrayBuffer), Float32Array.prototype);
  const stealthyFloat64Array = Object.setPrototypeOf(new Float64Array(arrayBuffer), Float64Array.prototype);
  const stealthyBigInt64Array = Object.setPrototypeOf(new BigInt64Array(arrayBuffer), BigInt64Array.prototype);
  const stealthyBigUint64Array = Object.setPrototypeOf(new BigUint64Array(arrayBuffer), BigUint64Array.prototype);

  const all = [
    primitive,
    arrayBuffer,
    buffer,
    fakeBuffer,
    dataView,
    fakeDataView,
    stealthyDataView,
    uint8Array,
    fakeUint8Array,
    stealthyUint8Array,
    uint8ClampedArray,
    fakeUint8ClampedArray,
    stealthyUint8ClampedArray,
    uint16Array,
    fakeUint16Array,
    stealthyUint16Array,
    uint32Array,
    fakeUint32Array,
    stealthyUint32Array,
    int8Array,
    fakeInt8Array,
    stealthyInt8Array,
    int16Array,
    fakeInt16Array,
    stealthyInt16Array,
    int32Array,
    fakeInt32Array,
    stealthyInt32Array,
    float32Array,
    fakeFloat32Array,
    stealthyFloat32Array,
    float64Array,
    fakeFloat64Array,
    stealthyFloat64Array,
    bigInt64Array,
    fakeBigInt64Array,
    stealthyBigInt64Array,
    bigUint64Array,
    fakeBigUint64Array,
    stealthyBigUint64Array,
  ];

  const expected = {
    isArrayBufferView: [
      buffer,
      dataView,
      stealthyDataView,
      uint8Array,
      stealthyUint8Array,
      uint8ClampedArray,
      stealthyUint8ClampedArray,
      uint16Array,
      stealthyUint16Array,
      uint32Array,
      stealthyUint32Array,
      int8Array,
      stealthyInt8Array,
      int16Array,
      stealthyInt16Array,
      int32Array,
      stealthyInt32Array,
      float32Array,
      stealthyFloat32Array,
      float64Array,
      stealthyFloat64Array,
      bigInt64Array,
      stealthyBigInt64Array,
      bigUint64Array,
      stealthyBigUint64Array,
    ],
    isTypedArray: [
      buffer,
      uint8Array,
      stealthyUint8Array,
      uint8ClampedArray,
      stealthyUint8ClampedArray,
      uint16Array,
      stealthyUint16Array,
      uint32Array,
      stealthyUint32Array,
      int8Array,
      stealthyInt8Array,
      int16Array,
      stealthyInt16Array,
      int32Array,
      stealthyInt32Array,
      float32Array,
      stealthyFloat32Array,
      float64Array,
      stealthyFloat64Array,
      bigInt64Array,
      stealthyBigInt64Array,
      bigUint64Array,
      stealthyBigUint64Array,
    ],
    isUint8Array: [buffer, uint8Array, stealthyUint8Array],
    isUint8ClampedArray: [uint8ClampedArray, stealthyUint8ClampedArray],
    isUint16Array: [uint16Array, stealthyUint16Array],
    isUint32Array: [uint32Array, stealthyUint32Array],
    isInt8Array: [int8Array, stealthyInt8Array],
    isInt16Array: [int16Array, stealthyInt16Array],
    isInt32Array: [int32Array, stealthyInt32Array],
    isFloat32Array: [float32Array, stealthyFloat32Array],
    isFloat64Array: [float64Array, stealthyFloat64Array],
    isBigInt64Array: [bigInt64Array, stealthyBigInt64Array],
    isBigUint64Array: [bigUint64Array, stealthyBigUint64Array],
  };

  for (const testedFunc of Object.keys(expected)) {
    test(testedFunc, () => {
      const func = types[testedFunc];
      const yup = [];
      for (const value of all) {
        if (func(value)) {
          yup.push(value);
        }
      }
      expect(yup).toEqual(expected[testedFunc]);
    });
  }
}
// */

test("isAsyncFunction", () => {
  for (let fn of [async function asyncFn() {}, async function* asyncGeneratorFn() {}]) {
    expect(types.isAsyncFunction(fn)).toBeTrue();
  }

  for (let fn of [
    function normal() {},
    function* generatorFn() {},
    function bound() {}.bind(),
    Bun.sleep, // host function
    Promise.resolve, // builtin function
    async function asyncBound() {}.bind(), // node also returns false
  ]) {
    expect(types.isAsyncFunction(fn)).toBeFalse();
  }
});
test("isGeneratorFunction", () => {
  for (let fn of [function* generator() {}, async function* asyncGenerator() {}]) {
    expect(types.isGeneratorFunction(fn)).toBeTrue();
  }

  for (let fn of [
    function normal() {},
    async function asyncFn() {},
    function bound() {}.bind(),
    Bun.sleep, // host function
    Promise.resolve, // builtin function
    function* boundGenerator() {}.bind(), // node also returns false
    async function* boundAsyncGenerator() {}.bind(), // node also returns false
  ]) {
    expect(types.isGeneratorFunction(fn)).toBeFalse();
  }
});

test("isKeyObject", () => {
  const { generateKeyPairSync } = require("crypto");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  expect(types.isKeyObject(privateKey)).toBeTrue();
  expect(types.isKeyObject(publicKey)).toBeTrue();
  expect(types.isKeyObject({})).toBeFalse();
  expect(types.isKeyObject(null)).toBeFalse();
  expect(types.isKeyObject(undefined)).toBeFalse();
});

test("#11780", () => {
  let resolveError;
  try {
    resolveError = require("OOGA_BOOGA");
  } catch (e) {
    resolveError = e;
  }
  expect(resolveError.constructor.name).toBe("ResolveMessage");
  expect(types.isNativeError(resolveError)).toBeTrue();

  const badCode = `
export default /BADD~!!!!;

  `;
  const blob = new Blob([badCode], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  let buildError;
  try {
    require(url);
  } catch (e) {
    buildError = e;
  }
  expect(types.isNativeError(buildError)).toBeTrue();
  expect(buildError.constructor.name).toBe("BuildMessage");
});

test("util/types functions aren't constructors", () => {
  for (const [name, fn] of Object.entries(types)) {
    if (typeof fn !== "function") continue;
    expect(() => Reflect.construct(fn, [new Date()])).toThrow(TypeError);
    // isArrayBufferView is ArrayBuffer.isView itself, as in Node.
    expect(Bun.inspect(fn)).toBe(`[Function: ${name === "isArrayBufferView" ? "isView" : name}]`);
  }
  expect(Array.of.call(types.isDate, 1, 2, 3)).toEqual([1, 2, 3]);
});

// As in Node, isArrayBufferView is ArrayBuffer.isView itself:
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/util/types.js#L67
//
// Not concurrent: five debug children that start together take about 2 s each. One at a time, each
// takes less than 1 s.
describe("isArrayBufferView", () => {
  async function run(cmd, env = {}) {
    await using proc = Bun.spawn({
      cmd,
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  const everyWayToLoadIt = `
    (async () => {
      const esm = await import("node:util/types");
      const loaded = {
        "require('node:util/types')": require("node:util/types").isArrayBufferView,
        "require('util/types')": require("util/types").isArrayBufferView,
        "require('node:util').types": require("node:util").types.isArrayBufferView,
        "import named": esm.isArrayBufferView,
        "import default": esm.default.isArrayBufferView,
        "process.getBuiltinModule": process.getBuiltinModule("node:util/types").isArrayBufferView,
        "process.binding('util')": process.binding("util").isArrayBufferView,
        "require('node:stream')._isArrayBufferView": require("node:stream")._isArrayBufferView,
      };
      const result = { name: esm.isArrayBufferView.name };
      for (const [loader, fn] of Object.entries(loaded)) result[loader] = fn === ArrayBuffer.isView;
      console.log(JSON.stringify(result));
    })();
  `;
  const isArrayBufferIsView = {
    name: "isView",
    "require('node:util/types')": true,
    "require('util/types')": true,
    "require('node:util').types": true,
    "import named": true,
    "import default": true,
    "process.getBuiltinModule": true,
    "process.binding('util')": true,
    "require('node:stream')._isArrayBufferView": true,
  };

  // With the JIT off, JSC records no intrinsic on ArrayBuffer.isView. The export is still that function.
  test.each([
    ["on", {}],
    ["off", { BUN_JSC_useJIT: "0" }],
  ])("is ArrayBuffer.isView through every way to load it, JIT %s", async (_, env) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "-e", everyWayToLoadIt], env);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(isArrayBufferIsView);
    expect(exitCode).toBe(0);
  });

  // process.getBuiltinModule is in Node.js from v22.3.0.
  const node = nodeExeAtLeast("22.3.0");
  test.skipIf(!node)("is ArrayBuffer.isView through every way to load it, in Node.js", async () => {
    const { stdout, stderr, exitCode } = await run([node, "-e", everyWayToLoadIt]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(isArrayBufferIsView);
    expect(exitCode).toBe(0);
  });

  // The module is generated the first time anything in the realm loads it, and a script can
  // replace ArrayBuffer.isView before that. The export is never the replacement and never calls it.
  // isOriginal is false where the property did not hold the engine's function at that time: Node
  // exports the original it saved at startup, Bun a function of its own. If such a row turns true,
  // either Bun saves the original now, or the module loads before the row's code runs and the row
  // no longer reaches Bun's own function.
  test("is never what a script put in place of ArrayBuffer.isView", async () => {
    const { stdout, stderr, exitCode } = await run([
      bunExe(),
      join(import.meta.dir, "test-util-types-isArrayBufferView-fixture.js"),
    ]);
    const row = isOriginal => ({
      name: "isView",
      views: ["Uint8Array", "Buffer", "DataView"],
      replacementCalls: 0,
      isReplacement: false,
      isOriginal,
    });
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      "untouched": row(true),
      "a JS function, before the first load": row(false),
      "deleted, before the first load": row(false),
      "an accessor, before the first load": row(false),
      "Array.isArray, before the first load": row(false),
      "the ArrayBuffer.isView of another realm, before the first load": row(false),
      "a replaced globalThis.ArrayBuffer, before the first load": row(true),
      "a JS function, after the first load": row(true),
      // bun:ffi needs TinyCC, which these two targets do not have.
      ...(!isFreeBSD && !isAndroid && { "a bun:ffi function named isView, before the first load": row(false) }),
    });
    expect(exitCode).toBe(0);
  });

  // The DFG compiles a call of the export to a type check. This holds for ArrayBuffer.isView and
  // for the function that Bun exports in its place.
  test.each([
    ["ArrayBuffer.isView", "", true],
    ["Bun's own function", `ArrayBuffer.isView = function isView() { return true; };`, false],
  ])("optimized calls of %s give the results of its first calls", async (_, beforeFirstLoad, isOriginal) => {
    const { stdout, stderr, exitCode } = await run(
      [
        bunExe(),
        "-e",
        `
        const original = ArrayBuffer.isView;
        ${beforeFirstLoad}
        const { isArrayBufferView } = require("node:util/types");
        const { numberOfDFGCompiles, noInline } = require("bun:jsc");
        const values = {
          Uint8Array: new Uint8Array(1),
          Buffer: Buffer.alloc(1),
          Float64Array: new Float64Array(1),
          DataView: new DataView(new ArrayBuffer(1)),
          ArrayBuffer: new ArrayBuffer(1),
          object: {},
          array: [],
          string: "view",
          number: 1,
          bigint: 1n,
          symbol: Symbol(),
          boolean: true,
          null: null,
          undefined: undefined,
        };
        const names = Object.keys(values);
        const list = Object.values(values);
        const first = list.map(value => isArrayBufferView(value));
        function one(value) { return isArrayBufferView(value); }
        function none() { return isArrayBufferView(); }
        noInline(one);
        noInline(none);
        let mismatches = 0;
        for (let i = 0; i < 20000; i++) {
          const j = i % list.length;
          if (one(list[j]) !== first[j]) mismatches++;
          if (none() !== false) mismatches++;
        }
        console.log(JSON.stringify({
          name: isArrayBufferView.name,
          isOriginal: isArrayBufferView === original,
          views: names.filter((name, i) => first[i]),
          mismatches,
          optimized: numberOfDFGCompiles(one) > 0,
        }));
        `,
      ],
      // The DFG compiles one() on the main thread after a few calls, as in test/js/node/buffer-jit.test.ts.
      { BUN_JSC_useConcurrentJIT: "0", BUN_JSC_jitPolicyScale: "0.05", BUN_JSC_useFTLJIT: "0" },
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      name: "isView",
      isOriginal,
      views: ["Uint8Array", "Buffer", "Float64Array", "DataView"],
      mismatches: 0,
      optimized: true,
    });
    expect(exitCode).toBe(0);
  });
});

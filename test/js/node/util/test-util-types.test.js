import assert from "assert";
import { describe, test, expect } from "bun:test";
import def from "util/types";
import * as ns from "util/types";
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

  for (let fn of [function normal() {}, function* generatorFn() {}]) {
    expect(types.isAsyncFunction(fn)).toBeFalse();
  }
});
test("isGeneratorFunction", () => {
  for (let fn of [function* generator() {}, async function* asyncGenerator() {}]) {
    expect(types.isGeneratorFunction(fn)).toBeTrue();
  }

  for (let fn of [function normal() {}, async function asyncFn() {}]) {
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

import { describe, it } from 'bun:test';
import { types } from 'util';
import { expect } from 'bun:test';

import crypto from 'node:crypto';

import * as ns from './module.js';

describe("util.types.isAnyArrayBuffer", () => {
  it("should pass base cases", () => {
    expect(types.isAnyArrayBuffer(new ArrayBuffer())).toBe(true);
    expect(types.isAnyArrayBuffer(new SharedArrayBuffer())).toBe(true);
    expect(types.isAnyArrayBuffer({})).toBe(false);
  })
})

describe("util.types.isArrayBufferView", () => {
  it("should pass base cases", () => {
    expect(types.isArrayBufferView(new Int8Array())).toBe(true);
    expect(types.isArrayBufferView(Buffer.from('hello world'))).toBe(true);
    expect(types.isArrayBufferView(new DataView(new ArrayBuffer(16)))).toBe(true);
    expect(types.isArrayBufferView(new ArrayBuffer())).toBe(false);
  })
})

describe("util.types.isArgumentsObject", () => {
  it.skip("should pass base cases", () => {
    // TODO: arguments not implemented?
    // https://nodejs.org/api/util.html#utiltypesisargumentsobjectvalue
    expect(types.isArgumentsObject(arguments)).toBe(true);
    expect(types.isArrayBuffer(new SharedArrayBuffer())).toBe(false);
  })
})

describe("util.types.isArrayBuffer", () => {
  it("should pass base cases", () => {
    expect(types.isArrayBuffer(new ArrayBuffer())).toBe(true);
    expect(types.isArrayBuffer(new SharedArrayBuffer())).toBe(false);
  })
})

describe("util.types.isAsyncFunction", () => {
  it("should pass base cases", () => {
    expect(types.isAsyncFunction(function foo() { })).toBe(false);
    expect(types.isAsyncFunction(async function foo() { })).toBe(true);

    const aPromised = async () => { }
    expect(types.isAsyncFunction(aPromised)).toBe(true);

    expect(types.isAsyncFunction(new BigInt64Array())).toBe(false);
  })
})

describe("util.types.isBigInt64Array", () => {
  it("should pass base cases", () => {
    expect(types.isBigInt64Array(new BigInt64Array())).toBe(true);
    expect(types.isBigInt64Array(new BigUint64Array())).toBe(false);
  })
})


describe("util.types.isBigUint64Array", () => {
  it("should pass base cases", () => {
    expect(types.isBigUint64Array(new BigInt64Array())).toBe(false);
    expect(types.isBigUint64Array(new BigUint64Array())).toBe(true);
  })
})

describe("util.types.isBooleanObject", () => {
  it("should pass base cases", () => {
    expect(types.isBooleanObject(false)).toBe(false);
    expect(types.isBooleanObject(true)).toBe(false);
    expect(types.isBooleanObject(new Boolean(false))).toBe(true);
    expect(types.isBooleanObject(new Boolean(true))).toBe(true);
    expect(types.isBooleanObject(Boolean(false))).toBe(false);
    expect(types.isBooleanObject(Boolean(true))).toBe(false);
    expect(types.isBooleanObject({})).toBe(false);
    expect(types.isBooleanObject('')).toBe(false);
    expect(types.isBooleanObject(!!{})).toBe(false);
  })
})

describe("util.types.isBoxedPrimitive", () => {
  it("should return correct base cases", () => {
    expect(types.isBoxedPrimitive(false)).toBe(false);
    expect(types.isBoxedPrimitive(new Boolean(false))).toBe(true);
    expect(types.isBoxedPrimitive(Symbol('foo'))).toBe(false);
    expect(types.isBoxedPrimitive(Object(Symbol('foo')))).toBe(true);
    expect(types.isBoxedPrimitive(Object(BigInt(5)))).toBe(true);
  })
})

describe("util.types.isCryptoKey", () => {
  it("should return correct base cases", () => {
    // TODO: what is cryptoKey? how do we use it?
  })
})

describe("util.types.isDataView", () => {
  it("should return correct base cases", () => {
    const ab = new ArrayBuffer(20);
    expect(types.isDataView(new DataView(ab))).toBe(true);
    expect(types.isDataView(new Float64Array())).toBe(false);
  })
})

describe("util.types.isDate", () => {
  it("should pass base cases", () => {
    expect(types.isDate(new Date())).toBe(true);
    expect(types.isDate("")).toBe(false);
    expect(types.isDate([])).toBe(false);
    expect(types.isDate(undefined)).toBe(false);
    expect(types.isDate(null)).toBe(false);
  })
})

describe("util.types.isExternal", () => {
  it.skip("should pass base cases", () => {
    // TODO: napi_addon ??
    const data = "some-external-data"
    expect(types.isExternal(data)).toBe(true);
    expect(types.isExternal(0)).toBe(false);
    expect(types.isExternal(new String('foo'))).toBe(false);
  })
})

describe("util.types.isFloat32Array", () => {
  it("should pass base cases", () => {
    expect(types.isFloat32Array(new ArrayBuffer())).toBe(false);
    expect(types.isFloat32Array(new Float32Array())).toBe(true);
    expect(types.isFloat32Array(new Float64Array())).toBe(false);
  })
})

describe("util.types.isFloat64Array", () => {
  it("should pass base cases", () => {
    expect(types.isFloat64Array(new ArrayBuffer())).toBe(false);
    expect(types.isFloat64Array(new Float32Array())).toBe(false);
    expect(types.isFloat64Array(new Float64Array())).toBe(true);
  })
})

describe("util.types.isGeneratorFunction", () => {
  it("should pass base cases", () => {
    expect(types.isGeneratorFunction(function foo() { })).toBe(false);
    expect(types.isGeneratorFunction(function* foo() { })).toBe(true);
  })
})

describe("util.types.isGeneratorObject", () => {
  it("should pass base cases", () => {
    function* foo() { }
    const generator = foo();
    expect(types.isGeneratorObject(generator)).toBe(true);
    expect(types.isGeneratorFunction(function foo() { })).toBe(false);
  })
})

describe("util.types.isInt8Array", () => {
  it("should pass base cases", () => {
    expect(types.isInt8Array(new ArrayBuffer())).toBe(false);
    expect(types.isInt8Array(new Int8Array())).toBe(true);
    expect(types.isInt8Array(new Float64Array())).toBe(false);
  })
})

describe("util.types.isInt16Array", () => {
  it("should pass base cases", () => {
    expect(types.isInt16Array(new ArrayBuffer())).toBe(false);
    expect(types.isInt16Array(new Int16Array())).toBe(true);
    expect(types.isInt16Array(new Int32Array())).toBe(false);
  })
})

describe("util.types.isInt32Array", () => {
  it("should pass base cases", () => {
    expect(types.isInt32Array(new ArrayBuffer())).toBe(false);
    expect(types.isInt32Array(new Int16Array())).toBe(false);
    expect(types.isInt32Array(new Int32Array())).toBe(true);
  })
})

describe("util.types.isKeyObject", () => {
  it.skip("should pass base cases", () => {
    // TODO: need this to be implemented.
    const key = crypto.createPrivateKey('some-key');
    expect(types.isKeyObject(key)).toBe(true);
    expect(types.isKeyObject(new Int16Array())).toBe(false);
    expect(types.isKeyObject(new Int32Array())).toBe(false);
  })
})

describe("util.types.isMap", () => {
  it("should pass base cases", () => {
    const map = new Map();
    expect(types.isMap(map)).toBe(true);
    expect(types.isMap(new WeakMap())).toBe(false);
    expect(types.isMap(map.keys())).toBe(false);
  })
})

describe("util.types.isMapIterator", () => {
  it("should pass base cases", () => {
    const map = new Map();
    expect(types.isMapIterator(map)).toBe(false);
    expect(types.isMapIterator(new WeakMap())).toBe(false);
    expect(types.isMapIterator(map.keys())).toBe(true);
    expect(types.isMapIterator(map.entries())).toBe(true);
    expect(types.isMapIterator(map.values())).toBe(true);
    expect(types.isMapIterator(map[Symbol.iterator]())).toBe(true);
  })
})

describe("util.types.isModuleNamespaceObject", () => {
  it.skip("should pass base cases", () => {
    // TODO: error: isModuleNamespaceObject is not supported in userland
    expect(types.isModuleNamespaceObject(ns)).toBe(true);
    expect(types.isModuleNamespaceObject(new WeakMap())).toBe(false);
    expect(types.isModuleNamespaceObject(map.keys())).toBe(false);
  })
})

describe("util.types.isNativeError", () => {
  it("should pass base cases", () => {
    expect(types.isNativeError(new Error())).toBe(true);
    expect(types.isNativeError(new TypeError())).toBe(true);
    expect(types.isNativeError(new RangeError())).toBe(true);
    expect(types.isNativeError({})).toBe(false);
  })
})

describe("util.types.isNumberObject", () => {
  it("should pass base cases", () => {
    expect(types.isNumberObject(0)).toBe(false);
    expect(types.isNumberObject(new Number(0))).toBe(true);
    expect(types.isNumberObject(new RangeError())).toBe(false);
    expect(types.isNumberObject({})).toBe(false);
  })
})

describe("util.types.isPromise", () => {
  it("should pass base cases", () => {
    expect(types.isPromise(Promise.resolve(42))).toBe(true);
    expect(types.isPromise(new Number(0))).toBe(false);
    expect(types.isPromise(Promise.reject(42))).toBe(true);
    expect(types.isPromise({})).toBe(false);
  })
})

describe("util.types.isProxy", () => {
  it.skip("should pass base cases", () => {
    // TODO: error: isProxy is not supported in userland
    const target = {};
    const proxy = new Proxy(target, {});
    expect(types.isProxy(proxy).toBe(true);
    expect(types.isProxy(new Number(0))).toBe(false);
    expect(types.isProxy(Promise.reject(42))).toBe(false);
    expect(types.isProxy({})).toBe(false);
  })
})

describe("util.types.isRegExp", () => {
  it("should pass base cases", () => {
    expect(types.isRegExp(/abc/)).toBe(true);
    expect(types.isRegExp(new RegExp('abc'))).toBe(true);
    expect(types.isRegExp(Promise.reject(42))).toBe(false);
    expect(types.isRegExp({})).toBe(false);
  })
})

describe("util.types.isSet", () => {
  it("should pass base cases", () => {
    expect(types.isSet(new Set())).toBe(true);
    expect(types.isSet(new RegExp('abc'))).toBe(false);
    expect(types.isSet(Promise.reject(42))).toBe(false);
    expect(types.isSet({})).toBe(false);
  })
})

describe("util.types.isSetIterator", () => {
  it("should pass base cases", () => {
    const set = new Set();
    expect(types.isSetIterator(set.keys())).toBe(true);
    expect(types.isSetIterator(set.values())).toBe(true);
    expect(types.isSetIterator(set.entries())).toBe(true);
    expect(types.isSetIterator(set[Symbol.iterator]())).toBe(true);
  })
})

describe("util.types.isSharedArrayBuffer", () => {
  it("should pass base cases", () => {
    expect(types.isSharedArrayBuffer(new ArrayBuffer())).toBe(false);
    expect(types.isSharedArrayBuffer(new SharedArrayBuffer())).toBe(true);
  })
})

describe("util.types.isStringObject", () => {
  it("should pass base cases", () => {
    expect(types.isStringObject('somestring')).toBe(false);
    expect(types.isStringObject(new String('somestring'))).toBe(true);
    expect(types.isStringObject(new SharedArrayBuffer())).toBe(false);
  })
})

describe("util.types.isSymbolObject", () => {
  it("should pass base cases", () => {
    const symbol = Symbol('foo');
    expect(types.isSymbolObject(symbol)).toBe(false);
    expect(types.isSymbolObject(Object(symbol))).toBe(true);
  })
})

describe("util.types.isTypedArray", () => {
  it("should pass base cases", () => {
    expect(types.isTypedArray(new ArrayBuffer())).toBe(false);
    expect(types.isTypedArray(new Uint8Array())).toBe(true);
    expect(types.isTypedArray(new Float64Array())).toBe(true);
  })
})

describe("util.types.isUint8Array", () => {
  it("should pass base cases", () => {
    expect(types.isUint8Array(new ArrayBuffer())).toBe(false);
    expect(types.isUint8Array(new Uint8Array())).toBe(true);
    expect(types.isUint8Array(new Float64Array())).toBe(false);
  })
})

describe("util.types.isUint8ClampedArray", () => {
  it("should pass base cases", () => {
    expect(types.isUint8ClampedArray(new ArrayBuffer())).toBe(false);
    expect(types.isUint8ClampedArray(new Uint8ClampedArray())).toBe(true);
    expect(types.isUint8ClampedArray(new Float64Array())).toBe(false);
  })
})

describe("util.types.isUint16Array", () => {
  it("should pass base cases", () => {
    expect(types.isUint16Array(new ArrayBuffer())).toBe(false);
    expect(types.isUint16Array(new Uint16Array())).toBe(true);
    expect(types.isUint16Array(new Float64Array())).toBe(false);
  })
})

describe("util.types.isUint32Array", () => {
  it("should pass base cases", () => {
    expect(types.isUint32Array(new ArrayBuffer())).toBe(false);
    expect(types.isUint32Array(new Uint16Array())).toBe(false);
    expect(types.isUint32Array(new Uint32Array())).toBe(true);
    expect(types.isUint32Array(new Float64Array())).toBe(false);
  })
})


describe("util.types.isWeakMap", () => {
  it("should pass base cases", () => {
    expect(types.isWeakMap(new ArrayBuffer())).toBe(false);
    expect(types.isWeakMap(new Uint16Array())).toBe(false);
    expect(types.isWeakMap(new WeakMap())).toBe(true);
    expect(types.isWeakMap(new Map())).toBe(false);
    expect(types.isWeakMap(new Float64Array())).toBe(false);
  })
})

describe("util.types.isWeakSet", () => {
  it("should pass base cases", () => {
    expect(types.isWeakSet(new ArrayBuffer())).toBe(false);
    expect(types.isWeakSet(new Uint16Array())).toBe(false);
    expect(types.isWeakSet(new WeakSet())).toBe(true);
    expect(types.isWeakSet(new WeakMap())).toBe(false);
    expect(types.isWeakSet(new Map())).toBe(false);
    expect(types.isWeakSet(new Float64Array())).toBe(false);
  })
})

'use strict';
require('../common');
const assert = require('assert');
const util = require('util');

const utilBinding = process.binding('util');
assert.deepStrictEqual(
  Object.keys(utilBinding).sort(),
  [
    'isAnyArrayBuffer',
    'isArgumentsObject',
    'isArrayBuffer',
    'isArrayBufferView',
    'isAsyncFunction',
    'isBigInt64Array',
    'isBigIntObject',
    'isBigUint64Array',
    'isBooleanObject',
    'isBoxedPrimitive',
    'isCryptoKey',
    'isDataView',
    'isDate',
    'isEventTarget',
    'isExternal',
    'isFloat16Array',
    'isFloat32Array',
    'isFloat64Array',
    'isGeneratorFunction',
    'isGeneratorObject',
    'isInt16Array',
    'isInt32Array',
    'isInt8Array',
    'isKeyObject',
    'isMap',
    'isMapIterator',
    'isModuleNamespaceObject',
    'isNativeError',
    'isNumberObject',
    'isPromise',
    'isProxy',
    'isRegExp',
    'isSet',
    'isSetIterator',
    'isSharedArrayBuffer',
    'isStringObject',
    'isSymbolObject',
    'isTypedArray',
    'isUint16Array',
    'isUint32Array',
    'isUint8Array',
    'isUint8ClampedArray',
    'isWeakMap',
    'isWeakSet',
  ]);

for (const k of Object.keys(utilBinding)) {
  assert.strictEqual(utilBinding[k], util.types[k]);
}

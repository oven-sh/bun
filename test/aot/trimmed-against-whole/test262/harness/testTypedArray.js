// Copyright (C) 2015 André Bargull. All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.
/*---
description: |
    Collection of functions used to assert the correctness of TypedArray objects.
defines:
  - floatArrayConstructors
  - nonClampedIntArrayConstructors
  - intArrayConstructors
  - typedArrayConstructors
  - TypedArray
  - testWithAllTypedArrayConstructors
  - testWithTypedArrayConstructors
  - testWithBigIntTypedArrayConstructors
  - nonAtomicsFriendlyTypedArrayConstructors
  - testWithAtomicsFriendlyTypedArrayConstructors
  - testWithNonAtomicsFriendlyTypedArrayConstructors
  - testTypedArrayConversions
---*/

var floatArrayConstructors = [
  Float64Array,
  Float32Array
];

var nonClampedIntArrayConstructors = [
  Int32Array,
  Int16Array,
  Int8Array,
  Uint32Array,
  Uint16Array,
  Uint8Array
];

var intArrayConstructors = nonClampedIntArrayConstructors.concat([Uint8ClampedArray]);

// Float16Array is a newer feature
// adding it to this list unconditionally would cause implementations lacking it to fail every test which uses it
if (typeof Float16Array !== "undefined") {
  floatArrayConstructors.push(Float16Array);
}

var bigIntArrayConstructors = [];
if (typeof BigInt64Array !== "undefined") {
  bigIntArrayConstructors.push(BigInt64Array);
}
if (typeof BigUint64Array !== "undefined") {
  bigIntArrayConstructors.push(BigUint64Array);
}

/**
 * Array containing every non-bigint typed array constructor.
 */
var typedArrayConstructors = floatArrayConstructors.concat(intArrayConstructors);

/**
 * Array containing every typed array constructor, including those with bigint values.
 */
var allTypedArrayConstructors = typedArrayConstructors.concat(bigIntArrayConstructors);

/**
 * The %TypedArray% intrinsic constructor function.
 */
var TypedArray = Object.getPrototypeOf(Int8Array);

function makePassthrough(TA, primitiveOrIterable) {
  return primitiveOrIterable;
}

function makeArray(TA, primitiveOrIterable) {
  if (isPrimitive(primitiveOrIterable)) {
    var n = Number(primitiveOrIterable);
    // Only values between 0 and 2**53 - 1 inclusive can get mapped into TA contents.
    if (!(n >= 0 && n < 9007199254740992)) return primitiveOrIterable;
    return Array.from({ length: n }, function() { return "0"; });
  }
  return Array.from(primitiveOrIterable);
}

function makeArrayLike(TA, primitiveOrIterable) {
  var arr = makeArray(TA, primitiveOrIterable);
  if (isPrimitive(arr)) return arr;
  var obj = { length: arr.length };
  for (var i = 0; i < obj.length; i++) obj[i] = arr[i];
  return obj;
}

var makeIterable;
if (typeof Symbol !== "undefined" && Symbol.iterator) {
  makeIterable = function makeIterable(TA, primitiveOrIterable) {
    var src = makeArray(TA, primitiveOrIterable);
    if (isPrimitive(src)) return src;
    var obj = {};
    obj[Symbol.iterator] = function() { return src[Symbol.iterator](); };
    return obj;
  };
}

function makeArrayBuffer(TA, primitiveOrIterable) {
  var arr = makeArray(TA, primitiveOrIterable);
  if (isPrimitive(arr)) return arr;
  return new TA(arr).buffer;
}

var makeResizableArrayBuffer, makeGrownArrayBuffer, makeShrunkArrayBuffer, makeImmutableArrayBuffer;
if (ArrayBuffer.prototype.resize) {
  var copyIntoArrayBuffer = function(destBuffer, srcBuffer) {
    var destView = new Uint8Array(destBuffer);
    var srcView = new Uint8Array(srcBuffer);
    for (var i = 0; i < srcView.length; i++) destView[i] = srcView[i];
    return destBuffer;
  };

  makeResizableArrayBuffer = function makeResizableArrayBuffer(TA, primitiveOrIterable) {
    if (isPrimitive(primitiveOrIterable)) {
      var n = Number(primitiveOrIterable) * TA.BYTES_PER_ELEMENT;
      if (!(n >= 0 && n < 9007199254740992)) return primitiveOrIterable;
      return new ArrayBuffer(n, { maxByteLength: n * 2 });
    }
    var fixed = makeArrayBuffer(TA, primitiveOrIterable);
    var byteLength = fixed.byteLength;
    var resizable = new ArrayBuffer(byteLength, { maxByteLength: byteLength * 2 });
    return copyIntoArrayBuffer(resizable, fixed);
  };

  makeGrownArrayBuffer = function makeGrownArrayBuffer(TA, primitiveOrIterable) {
    if (isPrimitive(primitiveOrIterable)) {
      var n = Number(primitiveOrIterable) * TA.BYTES_PER_ELEMENT;
      if (!(n >= 0 && n < 9007199254740992)) return primitiveOrIterable;
      var grown = new ArrayBuffer(Math.floor(n / 2), { maxByteLength: n });
      grown.resize(n);
    }
    var fixed = makeArrayBuffer(TA, primitiveOrIterable);
    var byteLength = fixed.byteLength;
    var grown = new ArrayBuffer(Math.floor(byteLength / 2), { maxByteLength: byteLength });
    grown.resize(byteLength);
    return copyIntoArrayBuffer(grown, fixed);
  };

  makeShrunkArrayBuffer = function makeShrunkArrayBuffer(TA, primitiveOrIterable) {
    if (isPrimitive(primitiveOrIterable)) {
      var n = Number(primitiveOrIterable) * TA.BYTES_PER_ELEMENT;
      if (!(n >= 0 && n < 9007199254740992)) return primitiveOrIterable;
      var shrunk = new ArrayBuffer(n * 2, { maxByteLength: n * 2 });
      shrunk.resize(n);
    }
    var fixed = makeArrayBuffer(TA, primitiveOrIterable);
    var byteLength = fixed.byteLength;
    var shrunk = new ArrayBuffer(byteLength * 2, { maxByteLength: byteLength * 2 });
    copyIntoArrayBuffer(shrunk, fixed);
    shrunk.resize(byteLength);
    return shrunk;
  };
}
if (ArrayBuffer.prototype.transferToImmutable) {
  makeImmutableArrayBuffer = function makeImmutableArrayBuffer(TA, primitiveOrIterable) {
    if (isPrimitive(primitiveOrIterable)) {
      var n = Number(primitiveOrIterable) * TA.BYTES_PER_ELEMENT;
      if (!(n >= 0 && n < 9007199254740992)) return primitiveOrIterable;
      return (new ArrayBuffer(n)).transferToImmutable();
    }
    var mutable = makeArrayBuffer(TA, primitiveOrIterable);
    return mutable.transferToImmutable();
  };
}

var typedArrayCtorArgFactories = [makePassthrough, makeArray, makeArrayLike];
if (makeIterable) typedArrayCtorArgFactories.push(makeIterable);
typedArrayCtorArgFactories.push(makeArrayBuffer);
if (makeResizableArrayBuffer) typedArrayCtorArgFactories.push(makeResizableArrayBuffer);
if (makeGrownArrayBuffer) typedArrayCtorArgFactories.push(makeGrownArrayBuffer);
if (makeShrunkArrayBuffer) typedArrayCtorArgFactories.push(makeShrunkArrayBuffer);
if (makeImmutableArrayBuffer) typedArrayCtorArgFactories.push(makeImmutableArrayBuffer);

/**
 * @typedef {"passthrough" | "arraylike" | "iterable" | "arraybuffer" | "resizable" | "immutable"} typedArrayArgFactoryFeature
 */

/**
 * A predicate for testing whether a TypedArray argument factory from this file
 * matches any of the provided features.
 *
 * @param {Function} argFactory
 * @param {typedArrayArgFactoryFeature[]} features
 * @returns {boolean}
 */
function ctorArgFactoryMatchesSome(argFactory, features) {
  for (var i = 0; i < features.length; ++i) {
    switch (features[i]) {
      case "passthrough":
        if (argFactory === makePassthrough) return true;
        break;
      case "arraylike":
        if (argFactory === makeArray || argFactory === makeArrayLike) return true;
        break;
      case "iterable":
        if (argFactory === makeIterable) return true;
        break;
      case "arraybuffer":
        if (
          argFactory === makeArrayBuffer ||
          argFactory === makeResizableArrayBuffer ||
          argFactory === makeGrownArrayBuffer ||
          argFactory === makeShrunkArrayBuffer ||
          argFactory === makeImmutableArrayBuffer
        ) {
          return true;
        }
        break;
      case "resizable":
        if (
          argFactory === makeResizableArrayBuffer ||
          argFactory === makeGrownArrayBuffer ||
          argFactory === makeShrunkArrayBuffer
        ) {
          return true;
        }
        break;
      case "immutable":
        if (argFactory === makeImmutableArrayBuffer) return true;
        break;
      default:
        throw Test262Error("unknown feature: " + features[i]);
    }
  }
  return false;
}

/**
 * Callback for testing a typed array constructor.
 *
 * @callback typedArrayConstructorCallback
 * @param {Function} TypedArrayConstructor the constructor object to test with
 * @param {Function} [TypedArrayConstructorArgFactory] a function for making
 *   a TypedArrayConstructor argument from a primitive (usually a number) or
 *   iterable (usually an array)
 */

/**
 * Calls the provided function with (typedArrayCtor, typedArrayCtorArgFactory)
 * pairs, where typedArrayCtor is Uint8Array/Int8Array/BigInt64Array/etc. and
 * typedArrayCtorArgFactory is a function for mapping a primitive (usually a
 * number) or iterable (usually an array) into a value suitable as the first
 * argument of typedArrayCtor (an Array, arraylike, iterable, or ArrayBuffer).
 *
 * @param {typedArrayConstructorCallback} f - the function to call
 * @param {Array} [constructors] - an explicit list of TypedArray constructors
 * @param {typedArrayArgFactoryFeature[]} [includeArgFactories] - for selecting
 *   initial constructor argument factory functions, rather than starting with
 *   all argument factories
 * @param {typedArrayArgFactoryFeature[]} [excludeArgFactories] - for excluding
 *   constructor argument factory functions, after an initial selection
 */
function testWithAllTypedArrayConstructors(f, constructors, includeArgFactories, excludeArgFactories) {
  var ctors = constructors || allTypedArrayConstructors;
  var ctorArgFactories = typedArrayCtorArgFactories;
  if (includeArgFactories) {
    ctorArgFactories = [];
    for (var i = 0; i < typedArrayCtorArgFactories.length; ++i) {
      if (ctorArgFactoryMatchesSome(typedArrayCtorArgFactories[i], includeArgFactories)) {
        ctorArgFactories.push(typedArrayCtorArgFactories[i]);
      }
    }
  }
  if (excludeArgFactories) {
    ctorArgFactories = ctorArgFactories.slice();
    for (var i = ctorArgFactories.length - 1; i >= 0; --i) {
      if (ctorArgFactoryMatchesSome(ctorArgFactories[i], excludeArgFactories)) {
        ctorArgFactories.splice(i, 1);
      }
    }
  }
  if (ctorArgFactories.length === 0) {
    throw Test262Error("no arg factories match include " + includeArgFactories + " and exclude " + excludeArgFactories);
  }
  for (var k = 0; k < ctorArgFactories.length; ++k) {
    var argFactory = ctorArgFactories[k];
    for (var i = 0; i < ctors.length; ++i) {
      var constructor = ctors[i];
      var boundArgFactory = argFactory.bind(undefined, constructor);
      try {
        f(constructor, boundArgFactory);
      } catch (e) {
        e.message += " (Testing with " + constructor.name + " and " + argFactory.name + ".)";
        throw e;
      }
    }
  }
}

/**
 * Calls the provided function with (typedArrayCtor, typedArrayCtorArgFactory)
 * pairs, where typedArrayCtor is Uint8Array/Int8Array/BigInt64Array/etc. and
 * typedArrayCtorArgFactory is a function for mapping a primitive (usually a
 * number) or iterable (usually an array) into a value suitable as the first
 * argument of typedArrayCtor (an Array, arraylike, iterable, or ArrayBuffer).
 *
 * typedArrayCtor will not be BigInt64Array or BigUint64Array unless one or both
 * of those are explicitly provided.
 *
 * @param {typedArrayConstructorCallback} f - the function to call
 * @param {Array} [constructors] - an explicit list of TypedArray constructors
 * @param {typedArrayArgFactoryFeature[]} [includeArgFactories] - for selecting
 *   initial constructor argument factory functions, rather than starting with
 *   all argument factories
 * @param {typedArrayArgFactoryFeature[]} [excludeArgFactories] - for excluding
 *   constructor argument factory functions, after an initial selection
 */
function testWithTypedArrayConstructors(f, constructors, includeArgFactories, excludeArgFactories) {
  var ctors = constructors || typedArrayConstructors;
  testWithAllTypedArrayConstructors(f, ctors, includeArgFactories, excludeArgFactories);
}

/**
 * Calls the provided function for every BigInt typed array constructor.
 *
 * @param {typedArrayConstructorCallback} f - the function to call
 * @param {Array} [constructors] - an explicit list of TypedArray constructors
 * @param {typedArrayArgFactoryFeature[]} [includeArgFactories] - for selecting
 *   initial constructor argument factory functions, rather than starting with
 *   all argument factories
 * @param {typedArrayArgFactoryFeature[]} [excludeArgFactories] - for excluding
 *   constructor argument factory functions, after an initial selection
 */
function testWithBigIntTypedArrayConstructors(f, constructors, includeArgFactories, excludeArgFactories) {
  var ctors = constructors || [BigInt64Array, BigUint64Array];
  testWithAllTypedArrayConstructors(f, ctors, includeArgFactories, excludeArgFactories);
}

var nonAtomicsFriendlyTypedArrayConstructors = floatArrayConstructors.concat([Uint8ClampedArray]);
/**
 * Calls the provided function for every non-"Atomics Friendly" typed array constructor.
 *
 * @param {typedArrayConstructorCallback} f - the function to call for each typed array constructor.
 * @param {Array} selected - An optional Array with filtered typed arrays
 * @param {typedArrayArgFactoryFeature[]} [includeArgFactories] - for selecting
 *   initial constructor argument factory functions, rather than starting with
 *   all argument factories
 * @param {typedArrayArgFactoryFeature[]} [excludeArgFactories] - for excluding
 *   constructor argument factory functions, after an initial selection
 */
function testWithNonAtomicsFriendlyTypedArrayConstructors(f, includeArgFactories, excludeArgFactories) {
  testWithAllTypedArrayConstructors(
    f,
    nonAtomicsFriendlyTypedArrayConstructors,
    includeArgFactories,
    excludeArgFactories
  );
}

/**
 * Calls the provided function for every "Atomics Friendly" typed array constructor.
 *
 * @param {typedArrayConstructorCallback} f - the function to call for each typed array constructor.
 * @param {Array} selected - An optional Array with filtered typed arrays
 * @param {typedArrayArgFactoryFeature[]} [includeArgFactories] - for selecting
 *   initial constructor argument factory functions, rather than starting with
 *   all argument factories
 * @param {typedArrayArgFactoryFeature[]} [excludeArgFactories] - for excluding
 *   constructor argument factory functions, after an initial selection
 */
function testWithAtomicsFriendlyTypedArrayConstructors(f, includeArgFactories, excludeArgFactories) {
  testWithAllTypedArrayConstructors(
    f,
    [
      Int32Array,
      Int16Array,
      Int8Array,
      Uint32Array,
      Uint16Array,
      Uint8Array,
    ],
    includeArgFactories,
    excludeArgFactories
  );
}

/**
 * Helper for conversion operations on TypedArrays, the expected values
 * properties are indexed in order to match the respective value for each
 * TypedArray constructor
 * @param  {Function} fn - the function to call for each constructor and value.
 *                         will be called with the constructor, value, expected
 *                         value, and a initial value that can be used to avoid
 *                         a false positive with an equivalent expected value.
 */
function testTypedArrayConversions(byteConversionValues, fn) {
  var values = byteConversionValues.values;
  var expected = byteConversionValues.expected;

  testWithTypedArrayConstructors(function(TA) {
    var name = TA.name.slice(0, -5);

    return values.forEach(function(value, index) {
      var exp = expected[name][index];
      var initial = 0;
      if (exp === 0) {
        initial = 1;
      }
      fn(TA, value, exp, initial);
    });
  }, null, ["passthrough"]);
}

/**
 * Checks if the given argument is one of the float-based TypedArray constructors.
 *
 * @param {constructor} ctor - the value to check
 * @returns {boolean}
 */
function isFloatTypedArrayConstructor(arg) {
  return floatArrayConstructors.indexOf(arg) !== -1;
}

/**
 * Determines the precision of the given float-based TypedArray constructor.
 *
 * @param {constructor} ctor - the value to check
 * @returns {string} "half", "single", or "double" for Float16Array, Float32Array, and Float64Array respectively.
 */
function floatTypedArrayConstructorPrecision(FA) {
  if (typeof Float16Array !== "undefined" && FA === Float16Array) {
    return "half";
  } else if (FA === Float32Array) {
    return "single";
  } else if (FA === Float64Array) {
    return "double";
  } else {
    throw new Error("Malformed test - floatTypedArrayConstructorPrecision called with non-float TypedArray");
  }
}

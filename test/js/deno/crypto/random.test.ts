// GENERATED - DO NOT EDIT
// Copyright 2018+ the Deno authors. All rights reserved. MIT license.
// https://raw.githubusercontent.com/denoland/deno/main/cli/tests/unit/get_random_values_test.ts
import { createDenoTest } from "deno:harness";
const { test, assertNotEquals, assertStrictEquals } = createDenoTest(import.meta.path);
test(function getRandomValuesInt8Array() {
    const arr = new Int8Array(32);
    crypto.getRandomValues(arr);
    assertNotEquals(arr, new Int8Array(32));
});
test(function getRandomValuesUint8Array() {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    assertNotEquals(arr, new Uint8Array(32));
});
test(function getRandomValuesUint8ClampedArray() {
    const arr = new Uint8ClampedArray(32);
    crypto.getRandomValues(arr);
    assertNotEquals(arr, new Uint8ClampedArray(32));
});
test(function getRandomValuesInt16Array() {
    const arr = new Int16Array(4);
    crypto.getRandomValues(arr);
    assertNotEquals(arr, new Int16Array(4));
});
test(function getRandomValuesUint16Array() {
    const arr = new Uint16Array(4);
    crypto.getRandomValues(arr);
    assertNotEquals(arr, new Uint16Array(4));
});
test(function getRandomValuesInt32Array() {
    const arr = new Int32Array(8);
    crypto.getRandomValues(arr);
    assertNotEquals(arr, new Int32Array(8));
});
test(function getRandomValuesBigInt64Array() {
    const arr = new BigInt64Array(8);
    crypto.getRandomValues(arr);
    assertNotEquals(arr, new BigInt64Array(8));
});
test(function getRandomValuesUint32Array() {
    const arr = new Uint32Array(8);
    crypto.getRandomValues(arr);
    assertNotEquals(arr, new Uint32Array(8));
});
test(function getRandomValuesBigUint64Array() {
    const arr = new BigUint64Array(8);
    crypto.getRandomValues(arr);
    assertNotEquals(arr, new BigUint64Array(8));
});
test(function getRandomValuesReturnValue() {
    const arr = new Uint32Array(8);
    const rtn = crypto.getRandomValues(arr);
    assertNotEquals(arr, new Uint32Array(8));
    assertStrictEquals(rtn, arr);
});

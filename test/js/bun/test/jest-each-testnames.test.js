// @ts-check

/** This file is meant to be runnable in Jest, Vitest, and Bun:
 *  `bun test test/js/bun/test/jest-each-names.test.js`
 *  `bunx vitest test/js/bun/test/jest-each-names.test.js`
 *  `NODE_OPTIONS=--experimental-vm-modules npx jest test/js/bun/test/jest-each-names.test.js`
 */

// Meta-test that checks that only the tests marked with ".only" run

import test_interop from "./test-interop.js";
var { test, describe, expect } = await test_interop();

test.each([
  { a: 1, b: 2 },
  { a: 3, b: 4 },
])("test: $a | $b", ({ a, b }) => {
  expect(expect.getState?.()?.currentTestName).toBe(`test: ${a} | ${b}`);
});

test.each([{ a: { b: 3 } }])("test: $a.b", ({ a }) => {
  expect(expect.getState?.()?.currentTestName).toBe(`test: ${a.b}`);
});

test.each([{ a: 1 }])("test: $ $$ $.a", _ => {
  expect(expect.getState?.()?.currentTestName).toBe("test: $ $$ $.a");
});

// test string interpolation
// FIXME
//test.each([["a", 42, true, { b: 1 }, ["c"]]])("test: %s | %s | %s | %s | %s", _ => {
//  expect(expect.getState?.()?.currentTestName).toBe("test: a | 42 | true | { b: 1 } | [ 'c' ]");
//});

let expectedIndex = 0;
test.each([{}, {}, {}])("test index: %#", () => {
  expect(expect.getState?.()?.currentTestName).toBe(`test index: ${expectedIndex++}`);
});

// ensure test index resets for each .each execution
let expectedIndexB = 0;
test.each([{}, {}])("test index: %#", () => {
  expect(expect.getState?.()?.currentTestName).toBe(`test index: ${expectedIndexB++}`);
});

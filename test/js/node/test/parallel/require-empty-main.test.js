//#FILE: test-require-empty-main.js
//#SHA1: 1c03cef0482df2bd119e42f418f54123675b532d
//-----------------
"use strict";

const path = require("path");
const fixtures = require("../common/fixtures");

const where = fixtures.path("require-empty-main");
const expected = path.join(where, "index.js");

const testRequireResolve = () => {
  expect(require.resolve(where)).toBe(expected);
  expect(require(where)).toBe(42);
  expect(require.resolve(where)).toBe(expected);
};

test('A package.json with an empty "main" property should use index.js if present', testRequireResolve);

test("require.resolve() should resolve to index.js for the same reason", testRequireResolve);

test('Any "main" property that doesn\'t resolve to a file should result in index.js being used', testRequireResolve);

test("Asynchronous test execution", done => {
  setImmediate(() => {
    testRequireResolve();
    done();
  });
});

//<#END_FILE: test-require-empty-main.js

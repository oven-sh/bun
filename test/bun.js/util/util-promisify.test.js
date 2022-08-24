// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

// Tests adapted from https://github.com/nodejs/node/blob/main/test/parallel/test-util-promisify.js
import { describe, it } from "bun:test";
import fs from 'node:fs';
import { promisify } from 'util';
import assert from "assert";

const stat = promisify(fs.stat);

describe("util.promisify", () => {
  describe("promisify fs calls", () => {
    // TODO: common.mustCall is not implemented here yet
    // https://github.com/nodejs/node/blob/main/test/common/index.js#L398
    it.skip("all cases", () => {
      const promise = stat(__filename);
      assert.equal(promise instanceof Promise, true);
      promise.then(common.mustCall((value) => {
        assert.deepStrictEqual(value, fs.statSync(__filename));
      }));


      const promiseFileDontExist = stat('/dontexist');
      promiseFileDontExist.catch(common.mustCall((error) => {
        assert(error.message.includes('ENOENT: no such file or directory, stat'));
      }));
    })
  })
  
  describe("promisify.custom", () => {
    it("double promisify", () => {
      function fn() {}

      function promisifedFn() {}
      fn[promisify.custom] = promisifedFn;
      assert.strictEqual(promisify(fn), promisifedFn);
      assert.strictEqual(promisify(promisify(fn)), promisifedFn);
    })

    // TODO: remove skip when shared symbol is test-able
    it.skip("should register shared promisify symbol", () => {
      function fn() {}

      function promisifiedFn() {}

      // TODO: register shared symbol promisify.custom
      // util.promisify.custom is a shared symbol which can be accessed
      // as `Symbol.for("nodejs.util.promisify.custom")`.
      const kCustomPromisifiedSymbol = Symbol.for('nodejs.util.promisify.custom');
      fn[kCustomPromisifiedSymbol] = promisifiedFn;

      assert.strictEqual(kCustomPromisifiedSymbol, promisify.custom);
      assert.strictEqual(promisify(fn), promisifiedFn);
      assert.strictEqual(promisify(promisify(fn)), promisifiedFn);
    })
  })

  it("should fail when type is not a function", () => {
    function fn() {}
    fn[promisify.custom] = 42;
    assert.throws(
      () => promisify(fn),
      // TODO: error code is not the same as node's.
      // { code: 'ERR_INVALID_ARG_TYPE', name: 'TypeError' }
      { name: 'TypeError' }
    );
  })
  
  // TODO: common.mustCall
  it.skip("should call custom promised promised function with proper args", () => {
    const firstValue = 5;
    const secondValue = 17;

    function fn(callback) {
      callback(null, firstValue, secondValue);
    }

    fn[customPromisifyArgs] = ['first', 'second'];

    promisify(fn)().then(common.mustCall((obj) => {
      assert.deepStrictEqual(obj, { first: firstValue, second: secondValue });
    }));
  })
});

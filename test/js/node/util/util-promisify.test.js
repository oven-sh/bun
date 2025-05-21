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
import fs from "node:fs";
// TODO: vm module not implemented by bun yet
// import vm from 'node:vm';
import assert from "assert";
import { inspect, promisify } from "util";

const stat = promisify(fs.stat);

// A helper function to simplify checking for ERR_INVALID_ARG_TYPE output.
function invalidArgTypeHelper(input) {
  if (input == null) {
    return ` Received ${input}`;
  }
  if (typeof input === "function" && input.name) {
    return ` Received function ${input.name}`;
  }
  if (typeof input === "object") {
    if (input.constructor?.name) {
      return ` Received an instance of ${input.constructor.name}`;
    }
    return ` Received ${inspect(input, { depth: -1 })}`;
  }

  let inspected = inspect(input, { colors: false });
  if (inspected.length > 28) {
    inspected = `${inspected.slice(inspected, 0, 25)}...`;
  }

  return ` Received type ${typeof input} (${inspected})`;
}

describe("util.promisify", () => {
  describe("promisify fs calls", () => {
    // TODO: common.mustCall is not implemented here yet
    // https://github.com/nodejs/node/blob/main/test/common/index.js#L398
    it.skip("all cases", () => {
      const promise = stat(__filename);
      assert.equal(promise instanceof Promise, true);
      promise.then(
        common.mustCall(value => {
          assert.deepStrictEqual(value, fs.statSync(__filename));
        }),
      );

      const promiseFileDontExist = stat("/dontexist");
      promiseFileDontExist.catch(
        common.mustCall(error => {
          assert(error.message.includes("ENOENT: no such file or directory, stat"));
        }),
      );
    });
  });

  describe("promisify.custom", () => {
    it("double promisify", () => {
      function fn() {}

      function promisifedFn() {}
      fn[promisify.custom] = promisifedFn;
      assert.strictEqual(promisify(fn), promisifedFn);
      assert.strictEqual(promisify(promisify(fn)), promisifedFn);
    });

    it("should register shared promisify symbol", () => {
      function fn() {}

      function promisifiedFn() {}

      // util.promisify.custom is a shared symbol which can be accessed
      // as `Symbol.for("nodejs.util.promisify.custom")`.
      const kCustomPromisifiedSymbol = Symbol.for("nodejs.util.promisify.custom");
      fn[kCustomPromisifiedSymbol] = promisifiedFn;

      assert.strictEqual(kCustomPromisifiedSymbol, promisify.custom);
      assert.strictEqual(promisify(fn), promisifiedFn);
      assert.strictEqual(promisify(promisify(fn)), promisifiedFn);
    });
  });

  it("should fail when type is not a function", () => {
    function fn() {}
    fn[promisify.custom] = 42;
    assert.throws(
      () => promisify(fn),
      // TODO: error code is not the same as node's.
      // { code: 'ERR_INVALID_ARG_TYPE', name: 'TypeError' }
      { name: "TypeError" },
    );
  });

  it("should call custom promised promised function with proper args", async done => {
    const firstValue = 5;
    const secondValue = 17;
    var called = false;

    function fn(callback) {
      called = true;
      callback(null, { firstValue, secondValue });
    }

    fn[Symbol("customPromisifyArgs")] = ["first", "second"];

    promisify(fn)().then(data => {
      expect(called).toBe(true);
      expect(data.firstValue).toBe(5);
      expect(data.secondValue).toBe(17);
      done();
    });
  });

  // TODO: unable to test since vm module not implemented
  // it("should run in new vm context", () => {
  //   const fn = vm.runInNewContext('(function() {})');
  //   assert.notStrictEqual(Object.getPrototypeOf(promisify(fn)),Function.prototype);
  // });

  describe("callback cases", () => {
    it("should run basic callback", async () => {
      var called = false;
      function fn(callback) {
        called = true;
        callback(null, "foo", "bar");
      }
      await promisify(fn)().then(value => {
        assert.strictEqual(value, "foo");
        assert.strictEqual(called, true);
      });
    });

    it("should not require value to be returned in callback", async () => {
      var called = false;
      function fn(callback) {
        called = true;
        callback(null);
      }
      await promisify(fn)().then(value => {
        assert.strictEqual(value, undefined);
        assert.strictEqual(called, true);
      });
    });

    it("should not require error to be passed", async () => {
      var called = false;
      function fn(callback) {
        called = true;
        callback();
      }
      await promisify(fn)().then(value => {
        assert.strictEqual(value, undefined);
        assert.strictEqual(called, true);
      });
    });

    it("custom callback", async () => {
      var called = false;
      function fn(err, val, callback) {
        called = true;
        callback(err, val);
      }
      await promisify(fn)(null, 42).then(value => {
        assert.strictEqual(value, 42);
        assert.strictEqual(called, true);
      });
    });

    it("should catch error", async () => {
      var called = false;
      function fn(err, val, callback) {
        called = true;
        callback(err, val);
      }
      await promisify(fn)(new Error("oops"), null).catch(err => {
        assert.strictEqual(err.message, "oops");
        assert.strictEqual(called, true);
      });
    });

    it("should call promisify properly inside async block", async () => {
      var called = false;
      function fn(err, val, callback) {
        called = true;
        callback(err, val);
      }

      await (async () => {
        const value = await promisify(fn)(null, 42);
        assert.strictEqual(value, 42);
      })().then(() => {
        assert.strictEqual(called, true);
      });
    });

    it("should not break this reference", async () => {
      const o = {};
      var called = false;
      const fn = promisify(function (cb) {
        called = true;
        cb(null, this === o);
      });

      o.fn = fn;

      await o.fn().then(val => {
        assert.strictEqual(called, true);
        assert.strictEqual(val, true);
      });
    });

    it("should not have called callback with error", async () => {
      const err = new Error("Should not have called the callback with the error.");
      const stack = err.stack;
      var called = false;

      const fn = promisify(function (cb) {
        called = true;
        cb(null);
        cb(err);
      });

      await (async () => {
        await fn();
        await Promise.resolve();
        return assert.strictEqual(stack, err.stack);
      })().then(() => {
        assert.strictEqual(called, true);
      });
    });

    it("should compare promised objects properly", () => {
      function c() {}
      const a = promisify(function () {});
      const b = promisify(a);
      assert.notStrictEqual(c, a);
      assert.strictEqual(a, b);
    });

    it("should throw error", async () => {
      let errToThrow;
      const thrower = promisify(function (a, b, c, cb) {
        errToThrow = new Error();
        throw errToThrow;
      });
      await thrower(1, 2, 3)
        .then(assert.fail)
        .then(assert.fail, e => assert.strictEqual(e, errToThrow));
    });

    it("should also throw error inside Promise.all", async () => {
      const err = new Error();

      const a = promisify(cb => cb(err))();
      const b = promisify(() => {
        throw err;
      })();

      await Promise.all([
        a.then(assert.fail, function (e) {
          assert.strictEqual(err, e);
        }),
        b.then(assert.fail, function (e) {
          assert.strictEqual(err, e);
        }),
      ]);
    });
  });

  describe("invalid input", () => {
    // This test is failing because 'code' property
    // is not thrown in the error. does it have different
    // throw error implementation in bun?
    it("should throw on invalid inputs for promisify", () => {
      [undefined, null, true, 0, "str", {}, [], Symbol()].forEach(input => {
        expect(() => {
          promisify(input);
        }).toThrow('The "original" argument must be of type function.' + invalidArgTypeHelper(input));
      });
    });
  });
});

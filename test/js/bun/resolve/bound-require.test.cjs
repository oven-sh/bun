"use strict";
var toPass, toFail;

if (process.versions.bun) {
  const jest = Bun.jest(__filename);
  toPass = (fn) => {
    const string = fn.toString().slice(2).trim().slice(2).trim();
    jest.test(string, () => {
      expect(() => fn()).not.toThrow();
    });
  };
  toFail = (fn) => {
    const string = fn.toString().slice(2).trim().slice(2).trim();
    jest.test(string, () => {
      expect(() => fn()).toThrow();
    });
  };
} else {
  toPass = function toPass(fn) {
    const string = fn.toString().slice(2).trim().slice(2).trim();
    try {
      fn();
      console.log(`PASS: ${string} resolves`);
    } catch (e) {
      console.log(`X FAIL: ${string} (expected this to work)`);
      console.log(e);
    }
  }
  toFail = function toFail(fn) {
    const string = fn.toString().slice(2).trim().slice(2).trim();
    try {
      fn();
      console.log(`X FAIL: ${string} (expected this to break)`);
    } catch (e) {
      console.log(`PASS: ${string} errors`);
    }
  }
}

toPass(() => require('./baz-common.cjs'));
toPass(() => require.call(null, './baz-common.cjs'));
toPass(() => module.require('./baz-common.cjs'));

toFail(() => module.require.call(null, './baz-common.cjs'));

toPass(() => require.resolve('./baz-common.cjs'));
toPass(() => require.resolve.call('./baz-common.cjs'));

toFail(() => module.require.resolve('./baz-common.cjs'));

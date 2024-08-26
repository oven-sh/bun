//#FILE: test-querystring-maxKeys-non-finite.js
//#SHA1: a1b76b45daad6e46e5504d52e5931d9e4a6d745d
//-----------------
"use strict";

// This test was originally written to test a regression
// that was introduced by
// https://github.com/nodejs/node/pull/2288#issuecomment-179543894

const querystring = require("querystring");

// Taken from express-js/body-parser
// https://github.com/expressjs/body-parser/blob/ed25264fb494cf0c8bc992b8257092cd4f694d5e/test/urlencoded.js#L636-L651
function createManyParams(count) {
  let str = "";

  if (count === 0) {
    return str;
  }

  str += "0=0";

  for (let i = 1; i < count; i++) {
    const n = i.toString(36);
    str += `&${n}=${n}`;
  }

  return str;
}

const count = 10000;
const originalMaxLength = 1000;
const params = createManyParams(count);

// thealphanerd
// 27def4f introduced a change to parse that would cause Infinity
// to be passed to String.prototype.split as an argument for limit
// In this instance split will always return an empty array
// this test confirms that the output of parse is the expected length
// when passed Infinity as the argument for maxKeys
describe("querystring.parse with non-finite maxKeys", () => {
  test("Infinity maxKeys should return the length of input", () => {
    const resultInfinity = querystring.parse(params, undefined, undefined, {
      maxKeys: Infinity,
    });
    expect(Object.keys(resultInfinity)).toHaveLength(count);
  });

  test("NaN maxKeys should return the length of input", () => {
    const resultNaN = querystring.parse(params, undefined, undefined, {
      maxKeys: NaN,
    });
    expect(Object.keys(resultNaN)).toHaveLength(count);
  });

  test('String "Infinity" maxKeys should return the maxLength defined by parse internals', () => {
    const resultInfinityString = querystring.parse(params, undefined, undefined, {
      maxKeys: "Infinity",
    });
    expect(Object.keys(resultInfinityString)).toHaveLength(originalMaxLength);
  });

  test('String "NaN" maxKeys should return the maxLength defined by parse internals', () => {
    const resultNaNString = querystring.parse(params, undefined, undefined, {
      maxKeys: "NaN",
    });
    expect(Object.keys(resultNaNString)).toHaveLength(originalMaxLength);
  });
});

//<#END_FILE: test-querystring-maxKeys-non-finite.js

import { expect, test } from "bun:test";

test("indexed property diff", () => {
  var obj = {};
  var objB = {};
  for (let i = 0; i < 16; i++) {
    obj[i] = i;
    objB[i] = 123;
  }

  expect(obj).toEqual(objB);
});

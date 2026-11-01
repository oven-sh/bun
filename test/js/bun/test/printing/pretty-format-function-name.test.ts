import { expect, test } from "bun:test";

test("toEqual diff prints the own name of async and generator functions", () => {
  async function asyncFn() {}
  function* genFn() {}
  async function* asyncGenFn() {}
  let message = "";
  try {
    expect({ a: asyncFn, b: genFn, c: asyncGenFn, d: function plain() {} }).toEqual({ a: 1 });
  } catch (e: any) {
    message = e.message;
  }
  expect(message).toContain('+   "a": [Function: asyncFn],');
  expect(message).toContain('+   "b": [Function: genFn],');
  expect(message).toContain('+   "c": [Function: asyncGenFn],');
  expect(message).toContain('+   "d": [Function: plain],');
});

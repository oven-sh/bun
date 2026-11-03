// Bun 1.4.4 wrote the inline snapshots of this file. To add a case, run it under that version. Never update them with a later Bun.
import { expect, test } from "bun:test";

function args() {
  return arguments;
}

test("Proxy of an object", () => {
  expect(new Proxy({ a: 1, b: "x" }, {})).toMatchInlineSnapshot(`{"a":1,"b":"x"}`);
});
test("Proxy in an object", () => {
  expect({ x: new Proxy({ s: "hi", n: [1, { z: 1 }] }, {}), y: 1 }).toMatchInlineSnapshot(`
    {
      "x": {
     "s": "hi",
     "n": [
      1,
      {
       "z": 1
      }
     ]
    },
      "y": 1,
    }
  `);
});
test("Proxy of an array", () => {
  expect(new Proxy([1, 2, 3], {})).toMatchInlineSnapshot(`[1,2,3]`);
});
test("Proxy of a function", () => {
  expect(new Proxy(function foo() {}, {})).toMatchInlineSnapshot(`[class ProxyObject]`);
});
test("arguments", () => {
  expect(args(1, 2)).toMatchInlineSnapshot(`{"0":1,"1":2}`);
});
test("generator", () => {
  expect((function* () {})()).toMatchInlineSnapshot(`{}`);
});
test("Proxy beside a property matcher", () => {
  expect({ id: 7, p: new Proxy({ a: 1 }, {}) }).toMatchInlineSnapshot({ id: expect.any(Number) }, `
    {
      "id": Any<Number>,
      "p": {
     "a": 1
    },
    }
  `);
});

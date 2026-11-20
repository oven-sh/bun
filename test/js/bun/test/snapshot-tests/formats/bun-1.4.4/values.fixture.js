// Bun 1.4.4 wrote the snapshots of this file. To add a case, run it under that version. Never update them with a later Bun.
import { expect, test } from "bun:test";

class Foo {
  a = 1;
}
function args() {
  return arguments;
}

const cases = {
  "Proxy of an object": () => new Proxy({ a: 1, b: "x" }, {}),
  "Proxy in an object": () => ({ x: new Proxy({ s: "hi", n: [1, { z: 1 }] }, {}), y: 1 }),
  "Proxy three levels down": () => ({ l1: { l2: { p: new Proxy({ a: 1, b: [1, 2] }, {}) } } }),
  "Proxy of an array": () => new Proxy([1, 2, 3], {}),
  "Proxy in an array": () => [new Proxy({ a: 1 }, {}), 2],
  "Proxy in a Map and a Set": () => ({
    m: new Map([["k", new Proxy({ a: 1 }, {})]]),
    s: new Set([new Proxy([1], {})]),
  }),
  "Proxy of a function": () => new Proxy(function foo() {}, {}),
  "Proxy of a class": () => new Proxy(class K {}, {}),
  "Proxy of a function in an object": () => ({ f: new Proxy(function foo() {}, {}) }),
  "Proxy of a class instance": () => new Proxy(new Foo(), {}),
  "Proxy with traps": () =>
    new Proxy(
      { a: 1, hidden: 2 },
      {
        ownKeys: () => ["a", "virtual"],
        getOwnPropertyDescriptor: (target, key) => ({
          value: key === "virtual" ? 42 : target[key],
          enumerable: true,
          configurable: true,
          writable: true,
        }),
        get: (target, key, receiver) => (key === "virtual" ? 42 : Reflect.get(target, key, receiver)),
      },
    ),
  "Proxy of a Map": () => new Proxy(new Map([[1, 2]]), {}),
  "Proxy of a Set": () => new Proxy(new Set([1]), {}),
  "Proxy of an Error": () => new Proxy(new Error("boom"), {}),
  "Proxy of a RegExp": () => new Proxy(/x/g, {}),
  "Proxy of a Promise": () => new Proxy(Promise.resolve(1), {}),
  "Proxy of a typed array": () => new Proxy(new Uint8Array([1, 2]), {}),
  "Proxy of an object with no prototype": () => new Proxy(Object.assign(Object.create(null), { a: 1 }), {}),
  "Proxy with undefined, a method, a symbol, null and a Date": () =>
    new Proxy({ u: undefined, f() {}, s: Symbol("x"), n: null, d: new Date(0) }, {}),
  "Proxy with toJSON()": () =>
    new Proxy(
      {
        a: 1,
        toJSON() {
          return { json: true };
        },
      },
      {},
    ),
  "Proxy of a Proxy": () => new Proxy(new Proxy({ a: 1 }, {}), {}),
  "Proxy whose get trap accepts only a string key": () =>
    new Proxy({ a: 1, [Symbol("key")]: 2 }, { get: (target, key) => (key.startsWith("_") ? 0 : target[key]) }),
  "Proxy with a symbol key that throws": () =>
    new Proxy(
      {
        a: 1,
        get [Symbol("key")]() {
          throw new Error("from the getter");
        },
      },
      {},
    ),
  "Proxy of an empty object": () => new Proxy({}, {}),
  "Proxy of an empty array": () => new Proxy([], {}),
  "arguments": () => args(1, 2),
  "arguments in an object": () => ({ a: args("x", { y: 1 }) }),
  "arguments with no items": () => args(),
  "generator": () => (function* () {})(),
  "generator with a property": () => Object.assign((function* () {})(), { tag: "g" }),
  "array iterator": () => [1][Symbol.iterator](),
  "Map iterator in an object": () => ({ it: new Map([[1, 2]]).entries() }),
  "iterator helper": () => [1].values().map(x => x),
  "multi-line string beside a Proxy": () => ({ s: "a\nb", p: new Proxy({ a: 1 }, {}) }),
};

for (const [name, make] of Object.entries(cases)) {
  test(name, () => {
    expect(make()).toMatchSnapshot();
  });
}

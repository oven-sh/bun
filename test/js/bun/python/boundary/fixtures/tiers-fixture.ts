// Prints what a table of small functions gives for values of Python's. Each function is first made hot with values of JavaScript
// alone, so that whatever the optimizing compilers assumed of it is wrong when the values of Python come.
import { float, kwargs } from "bun:python";
import { dict, int, tuple } from "python:builtins";
import { Base, NeverEqual, V, gen, half, ident, kw } from "./tiers.py";

const rounds = Number(process.env.ROUNDS);
// "1/2": the second half of the table.
const [part, parts] = (process.env.PART ?? "0/1").split("/").map(Number);

type Pair = [any, any];
const table: Record<string, [(a: any, b: any) => unknown, Pair[], Pair[]]> = {
  eq: [(a, b) => a == b, [[{}, {}], [[], []]], [[V(1), V(1)], [V(1), V(2)], [NeverEqual(), {}], [{}, V(1)], [tuple([1]), tuple([1])]]], // prettier-ignore
  eqItself: [
    (a, b) => a == a,
    [[{}, 0]],
    [
      [NeverEqual(), 0],
      [V(1), 0],
      [[float(NaN)][0], 0],
    ],
  ],
  notEq: [
    (a, b) => a != b,
    [[{}, {}]],
    [
      [V(1), V(1)],
      [V(1), V(2)],
    ],
  ],
  strictEq: [(a, b) => a === b, [[{}, {}]], [[V(1), V(1)]]],
  add: [(a, b) => String(a + b), [[1, 2], [1.5, 2]], [[V(1), V(2)], [1, V(2)], [V(1), 2], [tuple([1]), tuple([2])]]], // prettier-ignore
  addObjects: [
    (a, b) => String(a + b),
    [
      [{}, {}],
      [[], 1],
    ],
    [
      [V(1), V(2)],
      [tuple([1]), tuple([2])],
    ],
  ],
  sub: [
    (a, b) => String(a - b),
    [[3, 2]],
    [
      [V(3), V(2)],
      [V(3), 1],
    ],
  ],
  mul: [
    (a, b) => String(a * b),
    [[3, 2]],
    [
      [V(3), V(2)],
      [tuple([1]), 2],
      [2, tuple([1])],
    ],
  ],
  negate: [(a, b) => String(-a), [[3, 0]], [[V(3), 0]]],
  less: [
    (a, b) => a < b,
    [
      [1, 2],
      [2, 1],
    ],
    [
      [V(1), V(2)],
      [V(2), V(1)],
      [tuple([1, 2]), tuple([1, 3])],
    ],
  ],
  lessObjects: [
    (a, b) => a < b,
    [[{}, {}]],
    [
      [V(1), V(2)],
      [V(2), V(1)],
    ],
  ],
  increment: [(a, b) => String(++a), [[1, 0]], [[V(1), 0]]],
  addAssign: [(a, b) => String((a += b)), [[1, 2]], [[V(1), V(2)]]],
  typeOf: [
    (a, b) => typeof a,
    [
      [{}, 0],
      [() => 1, 0],
    ],
    [
      [V(1), 0],
      [V, 0],
      [kw, 0],
      [tuple([]), 0],
    ],
  ],
  instanceOf: [
    (a, b) => a instanceof b,
    [
      [{}, Object],
      [[], Array],
    ],
    [
      [V(1), V],
      [1, int],
      [V(1), Base],
      [{}, V],
    ],
  ],
  property: [
    (a, b) => a.x,
    [
      [{ x: 1 }, 0],
      [{ y: 0, x: 2 }, 0],
    ],
    [
      [V(7), 0],
      [dict([["x", 8]]), 0],
      [tuple([]), 0],
    ],
  ],
  index: [
    (a, b) => a[b],
    [[[1, 2], 1]],
    [
      [tuple([5, 6]), 1],
      [dict([[1, "one"]]), 1],
      [tuple([5]), 3],
    ],
  ],
  length: [
    (a, b) => a.length,
    [
      [[1, 2], 0],
      ["abc", 0],
    ],
    [
      [tuple([5, 6, 7]), 0],
      [dict([[1, 1]]), 0],
    ],
  ],
  call: [
    (a, b) => String(a(b)),
    [[(x: number) => x + 1, 1]],
    [
      [kw, 1],
      [V, 3],
      [int, "12"],
      [half, 4],
      [half, 5],
    ],
  ],
  callKeywords: [
    (a, b) => a(1, b),
    [[(x: number, y: any) => x + y.c, { c: 1 }]],
    [
      [kw, kwargs({ c: 2 })],
      [kw, 3],
    ],
  ],
  construct: [
    (a, b) => String(new a(b)),
    [
      [Number, 1],
      [String, 1],
    ],
    [
      [V, 3],
      [int, "12"],
      [tuple, [1]],
    ],
  ],
  spread: [(a, b) => [...a()].length, [[() => [1, 2], 0]], [[() => tuple([1, 2, 3]), 0], [() => gen(4), 0], [() => dict([[1, 2]]), 0]]], // prettier-ignore
  forOf: [(a, b) => { let sum = 0; for (const x of a()) sum += x; return sum; }, [[() => [1, 2], 0]], [[() => tuple([1, 2, 3]), 0], [() => gen(4), 0]]], // prettier-ignore
  has: [
    (a, b) => b in a,
    [[{ x: 1 }, "x"]],
    [
      [dict([["x", 1]]), "x"],
      [dict(), "x"],
      [V(1), "x"],
      [tuple([1]), 0],
    ],
  ],
  template: [(a, b) => `${a}-${b}`, [[1, "a"]], [[V(1), tuple([1])]]],
  truth: [
    (a, b) => (a ? 1 : 0),
    [
      [{}, 0],
      [0, 0],
    ],
    [
      [tuple([]), 0],
      [dict(), 0],
      [V(0), 0],
    ],
  ],
  keys: [
    (a, b) => Object.keys(a).join(),
    [[{ a: 1, b: 2 }, 0]],
    [
      [dict([["k", 1]]), 0],
      [Base(1), 0],
    ],
  ],
  destructure: [
    (a, b) => (({ x }) => x)(a),
    [[{ x: 1 }, 0]],
    [
      [V(9), 0],
      [dict([["x", 3]]), 0],
    ],
  ],
  destructureArray: [(a, b) => (([x, ...rest]) => x + rest.length)(a), [[[1, 2], 0]], [[tuple([5, 6, 7]), 0]]],
  json: [(a, b) => JSON.stringify(a), [[{ a: 1 }, 0], [[1], 0]], [[tuple([1, 2]), 0], [dict([["a", tuple([1])]]), 0], [[float(2)], 0]]], // prettier-ignore
  extend: [
    (a, b) => {
      class Derived extends a {
        m() {
          return "derived+" + super.m?.(2);
        }
      }
      return [typeof Derived, Derived.name, new Derived(b).m()].join();
    },
    [[Object, 0], [Map, undefined], [class Plain {}, 0]], // prettier-ignore
    [
      [Base, 3],
      [Map, undefined],
      [Base, 4],
    ],
  ],
  floatInList: [(a, b) => [typeof a[0], a[0] + 1, a[0] == b, a[0] === b].join(), [[[2], 2]], [[ident([float(2)]), 2]]],
  bigInt: [(a, b) => String(a + b), [[1n, 2n]], [[ident(2n ** 70n), 1n]]],
};

const results: Record<string, unknown[]> = {};
for (const [name, [f, ofJavaScript, ofPython]] of Object.entries(table).filter((_, index) => index % parts === part)) {
  for (let i = 0; i < rounds; i++) f(...ofJavaScript[i % ofJavaScript.length]);
  const result: unknown[] = (results[name] = []);
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const pair of ofPython) {
      try {
        result.push(f(...pair));
      } catch (error: any) {
        result.push("throws " + error.name);
      }
    }
    // Hot again, now with both.
    for (let i = 0; i < rounds; i++)
      f(...(i % 3 ? ofJavaScript[i % ofJavaScript.length] : ofPython[i % ofPython.length]));
  }
}
for (const [name, result] of Object.entries(results)) console.log(name, JSON.stringify(result));

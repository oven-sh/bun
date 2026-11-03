// JavaScript calls what Python gives it, and Python calls JavaScript.
import { program } from "./helpers";

const group = program();

const setup = `
import js, functools
call = js.eval("(f, ...a) => f(...a)")
def two(a, b): return (a, b)
def opt(a, b=5): return (a, b)
def var(*a): return a
def kw(a, *, k=1): return (a, k)
def kws(**k): return k
class C:
    def m(self, a): return ("m", a)
    @staticmethod
    def s(a): return ("s", a)
    @classmethod
    def c(cls, a): return (cls.__name__, a)
    def __call__(self, a): return ("call", a)
`;

group("JavaScript calls functions of Python", { setup }, [
  ["call(two, 1, 2), call(opt, 1), call(var, 1, 2, 3), call(lambda: 'none')", "((1, 2), (1, 5), (1, 2, 3), 'none')"],
  // JavaScript passes callbacks more than they ask for: array.map(f) is f(item, index, array).
  [
    "call(two, 1, 2, 3), call(lambda x: x + 1, 1, 2, 3), call(C().m, 1, 2), call(C.s, 1, 2), call(C.c, 1, 2)",
    "((1, 2), 2, ('m', 1), ('s', 1), ('C', 1))",
  ],
  ["call(C(), 1)", "('call', 1)"],
  ["call(C(), 1, 2)", "('call', 1)", "what is dropped for a function is not for an object with __call__"],
  [
    "call(functools.partial(two, 1), 2), call(functools.partial(two, 1), 2, 3)",
    "((1, 2), (1, 2))",
    "nor for a functools.partial",
  ],
  ["js.eval('(a, f) => a.map(f)')([1, 2], str)", "['1', '2']", "nor for a class: str(item, index, array)"],
  ["js.eval('(a, f) => a.map(f)')(['1', '2'], int)", "[1, 2]", "int(item, index, array)"],
  ["js.eval('(a, f) => a.filter(f)')([0, 1, '', 'a'], bool)", "[1, 'a']", "bool(item, index, array)"],
  ["js.eval('(a, f) => a.map(f)')([[1], [1, 2]], len)", "[1, 2]"],
  // Too few are an error, as ever in Python.
  ["call(two, 1)", "!TypeError: two() missing 1 required positional argument: 'b'"],
  ["call(len, [1, 2]), call(str, 5), call(int, '12'), call(sorted, [2, 1])", "(2, '5', 12, [1, 2])"],
  [
    "js.eval('f => typeof f')(two), js.eval('f => typeof f')(C), js.eval('f => typeof f')(C().m), js.eval('f => typeof f')(C()), js.eval('f => typeof f')(len)",
    "('function', 'function', 'function', 'function', 'function')",
  ],
  [
    "js.eval('f => [f.name, f.length]')(two), js.eval('f => [f.name, f.length]')(lambda a: a), js.eval('f => f.name')(len), js.eval('f => f.name')(C)",
    "(['two', 2], ['<lambda>', 1], 'len', 'C')",
  ],
  ["js.eval('f => [f.name, f.length]')(C().m)", "['m', 1]", "a bound method has neither"],
  [
    "js.eval('f => f.bind(null, 1)(2)')(two), js.eval('f => f.apply(null, [1, 2])')(two), js.eval('f => f.call(null, 1, 2)')(two), js.eval('f => Reflect.apply(f, null, [1, 2])')(two)",
    "((1, 2), (1, 2), (1, 2), (1, 2))",
  ],
  ["js.eval('f => new f()')(C).m(1), js.eval('(f, o) => o instanceof f')(C, C())", "(('m', 1), True)"],
  ["js.eval('f => new f()')(two)", "!JSError: TypeError: function is not a constructor (evaluating 'new f()')"],
  // An object as the last argument is an argument. (kwargs() of bun:python makes keyword arguments.)
  ["call(var, js.eval('({ k: 2 })'))[0].k, call(kws)", "(2, {})"],
  // `this` is not handed to a function of Python.
  ["js.eval('(f, self) => f.call(self, 1)')(var, 7)", "(1,)"],
  // What a function returns is what JavaScript gets.
  [
    "js.eval('f => f() === undefined')(lambda: None), js.eval('f => typeof f()')(lambda: 2.0), js.eval('f => f().length')(lambda: (1, 2))",
    "(True, 'number', 2)",
  ],
  // To JavaScript every object is true, an empty list too.
  ["js.eval('(a, f) => a.filter(f)')([[], [1]], lambda x: x)", "[[], [1]]"],
]);

group("Python calls functions of JavaScript", { setup: setup + `f = js.eval("(...a) => JSON.stringify(a)")\n` }, [
  ["f(), f(1, 'a', None, [1], True, 1.5)", `('[]', '[1,"a",null,[1],true,1.5]')`],
  [
    "f(1, a=2, b=[3]), f(a=1), f(*[1, 2], **{'z': 1}), f(**{'x-y': 1})",
    `('[1,{"a":2,"b":[3]}]', '[{"a":1}]', '[1,2,{"z":1}]', '[{"x-y":1}]')`,
  ],
  ["f(1, {'a': 2}), f({'a': 1}, b=2)", `('[1,{"a":2}]', '[{"a":1},{"b":2}]')`],
  [
    "js.eval('(a, b) => [a, b]')(1), js.eval('(a) => a')(1, 2, 3), js.eval('(a, b = 2) => a + b')(1)",
    "([1, None], 1, 3)",
  ],
  [
    "js.eval('({ a = 1, b = 2 } = {}) => [a, b]')(b=5), js.eval('(x, { a = 1 } = {}) => [x, a]')(0, a=7)",
    "([1, 5], [0, 7])",
  ],
  [
    "js.eval('(function () { return this === undefined; })')(), js.eval('(function () { \"use strict\"; return typeof this; })')()",
    "(False, 'undefined')",
  ],
  [
    "list(map(js.eval('x => x * 2'), [1, 2])), sorted([3, 1, 2], key=js.eval('x => -x')), list(filter(js.eval('x => x > 1'), [1, 2]))",
    "([2, 4], [3, 2, 1], [2])",
  ],
  [
    "functools.reduce(js.eval('(a, b) => a + b'), [1, 2, 3]), functools.partial(js.eval('(a, b) => a - b'), 5)(3)",
    "(6, 2)",
  ],
  [
    "g = js.eval('(function named(a, b) {})')\ng.__name__, g.name, g.length, callable(g), type(g).__name__",
    "('named', 'named', 2, True, 'JSFunction')",
  ],
  ["js.Function('a', 'b', 'return a + b')(1, 2)", "3"],
  ["o = js.eval('({ n: 5, get() { return this.n; } })')\nm = o.get\nm(), o.get()", "(5, 5)"],
  ["o = js.eval('({ n: 5, f() {} })')\no.f is o.f", "True", "a method is bound anew each time it is read"],
  [
    "o = js.eval('({ f() {} })')\njs.eval('(o, f) => o.f === f')(o, o.f)",
    "True",
    "and what goes back to JavaScript is not the function that was there",
  ],
  ["js.eval('({ f: function named() {} })').f.name", "'named'", "it is called 'bound named'"],
]);

group(
  "iterators and generators of Python in JavaScript",
  {
    setup: `
import js
def gen():
    yield 1
    yield 2
closed = []
def closing():
    try:
        yield 1
        yield 2
    finally:
        closed.append(True)
class Countdown:
    def __init__(self, n): self.n = n
    def __iter__(self): return self
    def __next__(self):
        if self.n == 0: raise StopIteration
        self.n -= 1
        return self.n
class Seq:
    def __len__(self): return 2
    def __getitem__(self, i):
        if i > 1: raise IndexError(i)
        return i * 10
`,
  },
  [
    [
      "js.eval('g => [...g]')(gen()), js.eval('g => Array.from(g, x => x * 2)')(gen()), js.eval('g => new Set(g).size')(gen()), js.eval('g => Math.max(...g)')(range(5))",
      "([1, 2], [2, 4], 2, 4)",
    ],
    ["js.eval('g => { const [a] = g; return a; }')(closing()), closed", "(1, [True])"],
    ["js.eval('g => { for (const x of g) return x; }')(closing()), len(closed)", "(1, 2)"],
    [
      "js.eval('g => [g.next(), g.next(), g.next()].map(r => [r.value, r.done])')(gen())",
      "[[1, False], [2, False], [None, True]]",
    ],
    [
      "js.eval('c => [...c]')(Countdown(3)), js.eval('s => [[...s], s.length, s[1], s[5]]')(Seq())",
      "([2, 1, 0], [[0, 10], 2, 10, None])",
    ],
    [
      "js.eval('d => [...d.keys()]')({'a': 1}), js.eval('d => [...d.items()].map(t => [...t])')({'a': 1}), js.eval('d => Object.fromEntries(d.items()).a')({'a': 1})",
      "(['a'], [['a', 1]], 1)",
    ],
    [
      "js.eval('e => [...e].map(t => [...t])')(enumerate('ab')), js.eval('z => [...z].length')(zip('ab', 'cd'))",
      "([[0, 'a'], [1, 'b']], 2)",
    ],
    [
      "js.eval('g => g[Symbol.iterator]()[Symbol.iterator] !== undefined')(gen()), js.eval('g => typeof g.map')(gen())",
      "(True, 'undefined')",
    ],
    ["js.eval('g => g[Symbol.iterator]().map(x => x * 2).toArray()')(gen())", "[2, 4]"],
    [
      "def failing():\n    yield 1\n    raise ValueError('in the generator')\njs.eval('g => [...g]')(failing())",
      "!ValueError: in the generator",
    ],
  ],
);

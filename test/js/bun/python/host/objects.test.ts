// The objects of JavaScript in Python, and those of Python in the functions of JavaScript.
import { program } from "./helpers";

const group = program();

const lib = `
export class Temp {
  #c = 0;
  static count = 0;
  static create(c) { const t = new this(); t.celsius = c; Temp.count++; return t; }
  static get zero() { return -273.15; }
  get celsius() { return this.#c; }
  set celsius(v) { if (typeof v !== "number") throw new TypeError("number expected"); this.#c = v; }
  get fahrenheit() { return this.#c * 9 / 5 + 32; }
  toString() { return this.#c + "C"; }
  [Symbol.toPrimitive](hint) { return hint === "number" ? this.#c : this.toString(); }
  *[Symbol.iterator]() { yield this.#c; yield this.fahrenheit; }
  who() { return this; }
}
export class Sub extends Temp { who() { return "sub of " + super.who().celsius; } }
export const frozen = Object.freeze({ a: 1 });
export const proxy = new Proxy({ real: 1 }, {
  get(t, k, r) { return typeof k === "string" && k.startsWith("v_") ? "virtual:" + k : Reflect.get(t, k, r); },
  has(t, k) { return k === "magic" || k in t; },
  set(t, k, v) { t[k] = v * 2; return true; },
  ownKeys(t) { return [...Reflect.ownKeys(t), "extra"]; },
  getOwnPropertyDescriptor(t, k) { return k === "extra" ? { value: 0, enumerable: true, configurable: true } : Reflect.getOwnPropertyDescriptor(t, k); },
});
export const callable = new Proxy(function f(a) { return a + 1; }, { apply(t, self, args) { return t(...args) * 10; }, construct(t, args) { return { made: args }; } });
export const sym = Symbol("mine");
export const withSym = { [sym]: "by symbol", [Symbol.for("shared")]: "registered", plain: 1, [Symbol.for("method")]() { return this.plain; } };
export const bare = Object.assign(Object.create(null), { x: 1 });
export const lazy = { get next() { return (this.n = (this.n ?? 0) + 1); } };
export function Old(x) { this.x = x; }
Old.prototype.get = function () { return this.x; };
export const withProps = Object.assign(function f() { return "called"; }, { version: "1.0", sub: { k: 1 } });
export const arrayLike = { length: 2, 0: "a", 1: "b" };
export const keywords = { from: 1, class: 2, in: 3, None: 4, def: 5, import: 6, lambda: 7 };
export const shadows = { __class__: "mine", keys: "not a method", items: 3 };
`;

const setup = `
import js
import lib
from lib import Temp, Sub, frozen, proxy, callable as callable_proxy, sym, withSym, bare, lazy, Old, withProps, arrayLike, keywords, shadows
`;

group("classes, accessors and methods", { setup, files: { "lib.js": lib } }, [
  ["x = Temp()\nx.celsius, x.fahrenheit", "(0, 32)"],
  ["x = Temp()\nx.celsius = 100\nx.celsius, x.fahrenheit, x['celsius']", "(100, 212, 100)"],
  ["Temp().celsius = 'hot'\n0", "!JSError: TypeError: number expected"],
  ["Temp().fahrenheit = 1\n0", "!JSError: TypeError: Attempted to assign to readonly property."],
  ["Temp.count, Temp.create(5).celsius, Temp.count, Temp.zero, Sub.create(1).who()", "(0, 5, 1, -273.15, 'sub of 1')"],
  [
    "x = Temp.create(100)\nstr(x), f'{x}', '%s' % x, repr(x).split(' at ')[0]",
    "('100C', '100C', '100C', '<JavaScript Temp')",
  ],
  [
    "x = Temp()\nx.who() is x, x.constructor is Temp, isinstance(x, Temp), isinstance(Sub(), Temp), isinstance(x, Sub), isinstance(1, Temp)",
    "(True, True, True, True, False, False)",
  ],
  [
    "a, b = Temp.create(100)\na, b, list(Temp()), [*Temp()], dict(zip('ab', Temp()))",
    "(100, 212, [0, 32], [0, 32], {'a': 0, 'b': 32})",
  ],
  [
    "x = Temp()\nx == x, x == Temp(), x != Temp(), hash(x) == hash(x), {x: 1}[x], x in [x], [Temp(), x].index(x)",
    "(True, False, True, True, 1, True, 1)",
  ],
  [
    "type(Temp()).__name__, type(Temp).__name__, callable(Temp), Temp.name, Temp.__name__",
    "('JSObject', 'JSFunction', True, 'Temp', 'Temp')",
  ],
  [
    "sorted(set(n for n in dir(Temp()) if n in ('celsius', 'fahrenheit', 'who', 'toString', 'count')))",
    "['celsius', 'fahrenheit', 'toString', 'who']",
  ],
  [
    "names = dir(Temp())\nlen(names) == len(set(names))",
    "True",
    "dir() lists `constructor` and the like once for each prototype",
  ],
  ["Old.new(5).get(), Old.new(5).x, isinstance(Old.new(1), Old)", "(5, 5, True)"],
  // A constructor written as a function, as those of Node's older modules are (EventEmitter, Readable), cannot be told from a function.
  ["Old(5).x", "5", "a plain function is called, not constructed"],
  ["withProps(), withProps.version, withProps.sub.k, withProps.__name__", "('called', '1.0', 1, 'f')"],
  ["lazy.next, lazy.next, lazy.n", "(1, 2, 2)"],
  [
    "float(Temp.create(1.5)), int(Temp.create(3))",
    "(1.5, 3)",
    "float() and int() do not ask Symbol.toPrimitive or valueOf()",
  ],
  [
    "Temp.create(1) + 1, Temp.create(1) < Temp.create(2)",
    "(2, True)",
    "the operators of Python know no object of JavaScript",
  ],
  ["js.Date(5) - js.Date(3), js.Date(3) < js.Date(5)", "(2, True)", "the same for dates"],
]);

group("truth", { setup: "import js\n" }, [
  [
    "[bool(js.eval(s)) for s in ('[]', '[0]', '\"\"', '\"a\"', '0', '1', 'null', 'undefined', '0n', 'NaN')]",
    "[False, True, False, True, False, True, False, False, False, True]",
  ],
  [
    "bool(js.Map()), bool(js.Map([[1, 2]])), bool(js.Set()), bool(js.Set([1])), bool(js.Uint8Array(0)), bool(js.Uint8Array(1))",
    "(False, True, False, True, False, True)",
  ],
  ["bool(js.Symbol('s')), bool(js.globalThis)", "(True, True)"],
  // bool() is len() != 0, and len() counts the properties an object has of its own.
  [
    "bool(js.eval('(function () {})')), bool(js.eval('() => 1')), bool(js.eval('class A {}'))",
    "(True, True, True)",
    "a function is as true as it has parameters",
  ],
  [
    "bool(js.Response('x')), bool(js.URL('http://a.example')), bool(js.AbortController()), bool(js.Date()), bool(js.RegExp('a'))",
    "(True, True, True, True, True)",
    "an object without properties of its own is false",
  ],
  [
    "bool(js.Error('x')), bool(js.Promise.resolve(1)), bool(js.eval('new (class A { #x = 1 })')), bool(js.Math), bool(js.WeakMap())",
    "(True, True, True, True, True)",
    "so `if error:` in a callback of Node's never runs",
  ],
  ["bool(js.ArrayBuffer(4)), len(js.ArrayBuffer(4))", "(True, 4)", "an ArrayBuffer has no length, and no properties"],
  ["bool(js.eval('(function* () {})()'))", "True", "TypeError: it has no len()"],
  [
    "bool(js.Headers({'a': '1'})), bool(js.URLSearchParams('a=1').keys())",
    "(True, True)",
    "TypeError: what can be iterated over and has no size has no len()",
  ],
]);

group("proxies, symbols, unusual objects", { setup, files: { "lib.js": lib } }, [
  [
    "proxy.real, proxy.v_x, 'magic' in proxy, 'none' in proxy, list(proxy), len(proxy)",
    "(1, 'virtual:v_x', True, False, ['real', 'extra'], 2)",
  ],
  ["proxy.n = 4\nproxy.n", "8"],
  ["callable_proxy(1), type(callable_proxy).__name__", "(20, 'JSFunction')"],
  ["callable_proxy.new(1, 2).made", "[1, 2]", "a proxy has every property, `new` too, which is undefined"],
  [
    "p = js.Proxy([1, 2], js.Object())\ntype(p).__name__, len(p), p[0], list(p), js.Array.isArray(p)",
    "('JSObject', 2, 1, [1, 2], True)",
  ],
  [
    "withSym[sym], withSym[js.Symbol['for']('shared')], list(withSym), sym in withSym, js.Symbol.iterator in withSym",
    "('by symbol', 'registered', ['plain'], True, False)",
  ],
  [
    "type(sym).__name__, repr(sym), str(sym), sym.description, sym == lib.sym, sym is lib.sym, {sym: 1}[sym], js.Symbol('a') == js.Symbol('a')",
    "('JSSymbol', 'Symbol(mine)', 'Symbol(mine)', 'mine', True, True, 1, False)",
  ],
  [
    "withSym[js.Symbol['for']('method')]()",
    "1",
    "a method read as an item is not bound, and a symbol cannot name an attribute",
  ],
  ["getattr(withSym, sym)", "!TypeError: attribute name must be string, not '_js.JSSymbol'"],
  ["frozen.a = 2\n0", "!JSError: TypeError: Attempted to assign to readonly property."],
  ["frozen.b = 2\n0", "!JSError: TypeError: Attempting to define property on object that is not extensible."],
  ["del frozen.a\n0", "!JSError: TypeError: Unable to delete property.", "nothing is raised, and nothing deleted"],
  ["bare.x, list(bare), dict(bare), repr(bare).split(' at ')[0]", "(1, ['x'], {'x': 1}, '<JavaScript Object')"],
  ["str(bare)", "'[object Object]'", "str() of an object without toString() raises, so print() does"],
  ["str(lib).startswith('[object Module')", "True", "so for the module itself"],
  ["len(arrayLike), arrayLike[0], js.Array['from'](arrayLike)", "(2, 'a', ['a', 'b'])"],
  ["a = js.eval('(function () { return arguments; })(1, 2)')\nlen(a), list(a), a[0]", "(2, [1, 2], 1)"],
  // Names that are keywords in Python.
  [
    "getattr(keywords, 'from'), getattr(keywords, 'class'), keywords['in'], keywords['None'], keywords['def'], keywords['lambda']",
    "(1, 2, 3, 4, 5, 7)",
  ],
  [
    "keywords.from_, keywords.class_, js.Array.from_('ab')",
    "(1, 2, ['a', 'b'])",
    "there is no spelling for them as attributes: Array.from, promise.finally, import",
  ],
  ["shadows.__class__, shadows.keys, shadows.items, type(shadows).__name__", "('mine', 'not a method', 3, 'JSObject')"],
  ["js.globalThis is js, type(js).__name__", "(True, 'JSObject')"],
  [
    "js.fromPython = {'a': 1}\njs.eval('fromPython.a'), js.eval('var fromEval = 5; fromEval'), js.fromEval",
    "(1, 5, 5)",
  ],
  ["js.noSuchGlobal", "!AttributeError: 'JSObject' object has no attribute 'noSuchGlobal'"],
  ["js.eval('syntax error here')", "!JSError: SyntaxError: Unexpected identifier 'error'"],
]);

group("Date, RegExp, Map, Set, weak references", { setup: "import js, datetime, gc, weakref\nclass K: pass\n" }, [
  [
    "d = js.Date(js.Date.UTC(2020, 0, 2, 3, 4, 5, 678))\nd.getTime(), d.toISOString(), d.getUTCFullYear(), type(d).__name__",
    "(1577934245678, '2020-01-02T03:04:05.678Z', 2020, 'JSObject')",
  ],
  [
    "d = js.Date(1577934245678)\ndatetime.datetime.fromtimestamp(d.getTime() / 1000, datetime.UTC), datetime.datetime.fromisoformat(d.toISOString())",
    "(datetime.datetime(2020, 1, 2, 3, 4, 5, 678000, tzinfo=datetime.timezone.utc), datetime.datetime(2020, 1, 2, 3, 4, 5, 678000, tzinfo=datetime.timezone.utc))",
  ],
  [
    "js.Date(datetime.datetime(2020, 1, 2, tzinfo=datetime.UTC).timestamp() * 1000).toISOString(), js.Date(datetime.datetime(2020, 1, 2, tzinfo=datetime.UTC).isoformat()).getTime()",
    "('2020-01-02T00:00:00.000Z', 1577923200000)",
  ],
  [
    "js.Date(2020, 0, 2).getFullYear(), js.Date('2020-01-02').getTime(), js.isNaN(js.Date('nonsense').getTime())",
    "(2020, 1577923200000, True)",
  ],
  ["js.Intl.DateTimeFormat('en-US', timeZone='UTC').format(js.Date(0))", "'1/1/1970'"],
  [
    "r = js.RegExp('(\\\\d+)-(\\\\d+)', 'g')\nr.source, r.flags, r.test('1-2'), r.lastIndex, list(r.exec('1-2 3-4'))",
    "('(\\\\d+)-(\\\\d+)', 'g', True, 3, ['3-4', '3', '4'])",
  ],
  [
    "js.eval('(s, r) => s.replace(r, (m, a) => a.toUpperCase())')('abc', js.RegExp('(b)')), js.eval('(s, r, f) => s.replace(r, f)')('abc', js.RegExp('(b)'), lambda m, a, *rest: a * 2)",
    "('aBc', 'abbc')",
  ],
  [
    "[list(m) for m in js.eval('(s, r) => s.matchAll(r)')('a1b2', js.RegExp('[a-z](\\\\d)', 'g'))]",
    "[['a1', '1'], ['b2', '2']]",
  ],
  [
    "m = js.Map()\nk = K()\nm.set(k, 1).set('s', 2).set(1, 'int').set(2**64, 'big')\nm.get(k), m[k], m.get('s'), m.get(1), m.get(1.0), m.get(2**64), m.size, len(m), k in m, K() in m",
    "(1, 1, 2, 'int', 'int', 'big', 4, 4, True, False)",
  ],
  // The keys of a Map are compared as JavaScript compares them: two equal tuples are two keys.
  ["m = js.Map([[(1, 2), 'tuple']])\nm.get((1, 2))", "None"],
  [
    "dict(js.Map([['a', 1]])), [list(e) for e in js.Map([['a', 1]])], list(js.Map([['a', 1]]).keys()), list(js.Map([['a', 1]]).values())",
    "({'a': 1}, [['a', 1]], ['a'], [1])",
  ],
  [
    "dict(js.Map([['a', 1]]).entries())",
    "{'a': 1}",
    "an iterator of JavaScript has keys(), as every object has, so dict() takes it for a mapping, an empty one",
  ],
  [
    "js.Map({'a': 1}).get('a'), js.Map({'a': 1}.items()).get('a'), js.Map([('a', 1)]).get('a'), js.Object.fromEntries(js.Map([('a', 1)])).a",
    "(1, 1, 1, 1)",
  ],
  [
    "s = js.Set([1, 1, 'a', 'a'])\ns.size, len(s), list(s), 1 in s, 2 in s, set(s) | {3} == {1, 'a', 3}, sorted(js.Set({1, 2}))",
    "(2, 2, [1, 'a'], True, False, True, [1, 2])",
  ],
  ["js.Set([1, 2]).union(js.Set([3])).size, js.Set([1, 2]).isSubsetOf(js.Set([1, 2, 3]))", "(3, True)"],
  [
    "js.Set([1, 2]).union({3}).size",
    "3",
    "a set of Python has no size, has() and keys() for the set methods of JavaScript",
  ],
  // A whole float in a list is an object to JavaScript.
  ["js.Set([1, 1.0]).size, js.Set([1.5, 1.5]).size", "(2, 1)"],
  ["js.Object.groupBy([1, 2, 3], lambda x, i: 'odd' if x % 2 else 'even').odd", "[1, 3]"],
  [
    "w = js.WeakMap()\no = K()\nw.set(o, 'v')\nw.get(o), w.has(o), w.has(K()), w.set((1, 2), 1) is w, w.set([1], 1) is w",
    "('v', True, False, True, True)",
  ],
  ["js.WeakMap().set('str', 1)", "!JSError: TypeError: WeakMap keys must be objects or non-registered symbols"],
  ["o = K()\nr = js.WeakRef(o)\nr.deref() is o", "True"],
  ["o = js.Object()\nweakref.ref(o)() is o", "True", "no weak reference to an object of JavaScript"],
  ["o = js.Object()\nweakref.WeakValueDictionary({'a': o})['a'] is o", "True", "the same"],
]);

group(
  "objects of Python in the functions of JavaScript",
  {
    setup: `
import js, dataclasses, decimal, fractions, enum, datetime, collections, types, math
@dataclasses.dataclass
class Pt:
    x: int
    y: float = 1.5
    @property
    def norm(self): return self.x + self.y
    def double(self): return Pt(self.x * 2, self.y * 2)
class Color(enum.Enum):
    RED = 1
    GREEN = 2
class Num(enum.IntEnum):
    ONE = 1
`,
  },
  [
    [
      "p = Pt(1)\njs.JSON.stringify(p), js.Object.keys(p), js.Object.entries(p), js.eval('p => p.norm')(p), js.eval('({ x, y }) => x + y')(p), js.eval('p => ({ ...p })')(p).x",
      `('{"x":1,"y":1.5}', ['x', 'y'], [['x', 1], ['y', 1.5]], 2.5, 2.5, 1)`,
    ],
    [
      'p = Pt(1)\njs.eval(\'p => { p.x = 10; p.z = 3; delete p.y; return ["x" in p, "y" in p, "q" in p]; }\')(p), vars(p)',
      "([True, True, False], {'x': 10, 'z': 3})",
    ],
    [
      "js.eval('p => [typeof p, p instanceof Object, p.constructor.name, String(p), `${p}`, p + \"\"]')(Pt(1))",
      "['object', True, 'Pt', 'Pt(x=1, y=1.5)', 'Pt(x=1, y=1.5)', 'Pt(x=1, y=1.5)']",
    ],
    [
      "js.eval('p => p.double().x')(Pt(2)), js.eval('p => { const f = p.double; return f().x; }')(Pt(2)), js.eval('(p, P) => [p instanceof P, new P(7).x, P(8).x]')(Pt(1), Pt)",
      "(4, 4, [True, 7, 8])",
    ],
    [
      "js.eval('(a, b) => [a + b, a * 2, a < b, a == b, -a, String(a)]')(decimal.Decimal('1.5'), decimal.Decimal('2'))",
      "[Decimal('3.5'), Decimal('3.0'), True, False, Decimal('-1.5'), '1.5']",
    ],
    [
      "js.eval('a => [Number(a), +a, Math.max(a, 1), isNaN(a)]')(decimal.Decimal('1.5')), js.eval('a => [Number(a), Math.round(a)]')(fractions.Fraction(3, 2))",
      "([1.5, 1.5, 1.5, False], [1.5, 2])",
    ],
    ["js.Intl.NumberFormat('en-US').format(decimal.Decimal('1.5'))", "'1.5'"],
    ["js.JSON.stringify(decimal.Decimal('1.5'))", "'1.5'", "JSON.stringify shows the slots of the object"],
    ["js.JSON.stringify(datetime.date(2020, 1, 2))", `'"2020-01-02"'`, "{}: a date has nothing JSON.stringify can see"],
    [
      "js.eval('d => [String(d), d.year, d.isoformat(), new Date(d.isoformat()).getTime()]')(datetime.date(2020, 1, 2))",
      "['2020-01-02', 2020, '2020-01-02', 1577923200000]",
    ],
    [
      "js.eval('(c, C) => [c.name, c.value, c === C.RED, String(c), [...C].length, c instanceof C, C[\"GREEN\"].value]')(Color.RED, Color)",
      "['RED', 1, True, 'Color.RED', 2, True, 2]",
    ],
    ["js.JSON.stringify(Color.RED)", "'1'", "TypeError: JSON.stringify cannot serialize cyclic structures"],
    [
      "js.eval('n => [n + 1, n == 1, n === 1, typeof n, JSON.stringify(n), [10, 20][n]]')(Num.ONE)",
      "[2, True, False, 'object', '1', 20]",
    ],
    [
      "js.eval('d => [JSON.stringify(d), d.a, Object.keys(d)]')(collections.OrderedDict(a=1)), js.eval('d => [JSON.stringify(d), d.a, Object.keys(d)]')(types.SimpleNamespace(a=1, b=[2]))",
      `(['{"a":1}', 1, ['a']], ['{"a":1,"b":[2]}', 1, ['a', 'b']])`,
    ],
    [
      "js.eval('d => [JSON.stringify(d), d.a, d[0], d.length, [...d]]')(collections.namedtuple('NT', 'a b')(1, 2)), js.eval('d => [JSON.stringify(d), d.a, d.most_common(1).length]')(collections.Counter('aab'))",
      `(['[1,2]', 1, 1, 2, [1, 2]], ['{"a":2,"b":1}', 2, 1])`,
    ],
    [
      "js.eval('c => [c.real, c.imag, String(c), String(c + c)]')(1 + 2j), js.eval('s => [s.start, s.stop, s.step]')(slice(1, 2))",
      "([1, 2, '(1+2j)', '(2+4j)'], [1, 2, None])",
    ],
    [
      "js.eval('m => [typeof m, m.sqrt(4), m.pi.toFixed(2), Object.keys(m).includes(\"floor\")]')(math)",
      "['object', 2, '3.14', True]",
    ],
    [
      "js.eval('l => l.toSorted((a, b) => a < b ? -1 : a > b ? 1 : 0).map(String)')([decimal.Decimal(10), decimal.Decimal(9)])",
      "['9', '10']",
    ],
    [
      "js.Bun.inspect({'a': [1, (2, 3)], 'b': None}), js.Bun.inspect([1, 'a', None, 2.0]), js.Bun.inspect(Pt(1))",
      `("{'a': [1, (2, 3)], 'b': None}", '[ 1, "a", undefined, 2.0 ]', 'Pt(x=1, y=1.5)')`,
    ],
    [
      "js.Bun.deepEquals([1, {'a': 1}], [1, {'a': 1}]), js.Bun.deepEquals({'a': 1}, js.eval('({ a: 1 })')), js.Bun.deepEquals((1, 2), [1, 2]), js.Bun.deepEquals({'a': 1}, {'a': 2})",
      "(True, True, True, False)",
    ],
  ],
);

group(
  "classes of Python derived from classes of JavaScript",
  {
    setup: `
import js
Base = js.eval("(class Base { constructor(x) { this.x = x; } hello() { return 'hello ' + this.name(); } name() { return 'base'; } static make() { return new this(1); } })")
`,
  },
  [
    [
      "class D(Base):\n    def name(self): return 'derived'\nD(1).hello()",
      "'hello derived'",
      "TypeError: cannot create 'JSFunction' instances",
    ],
    [
      "class D(Base):\n    def __init__(self): super().__init__(5)\nD().x, isinstance(D(), Base), isinstance(D(), D)",
      "(5, True, True)",
      "the same",
    ],
    [
      "class D(Base):\n    def name(self): return 'derived and ' + super().name()\nD.make().hello()",
      "'hello derived and base'",
      "the same",
    ],
    [
      "isinstance(Base, type), issubclass(js.eval('class A extends Object {}'), object)",
      "(True, True)",
      "a class of JavaScript is no type",
    ],
    // What can be done today: the class is made in JavaScript, with functions of Python that take the object first.
    [
      "derive = js.eval('(B, methods) => { class D extends B {} for (const [k, f] of Object.entries(methods)) D.prototype[k] = function (...a) { return f(this, ...a); }; return D; }')\nD = derive(Base, name=lambda self: 'derived ' + str(self.x))\nD(5).hello(), isinstance(D(5), Base), D.make().hello()",
      "('hello derived 5', True, 'hello derived 1')",
    ],
  ],
);

group(
  "what Python takes an object of JavaScript for",
  {
    setup: `
import collections.abc as abc, inspect, functools
def which(value, *names): return [n for n in names if isinstance(value, getattr(abc, n))]
def matched(v):
    match v:
        case {"a": x, **rest}: return ("mapping", x, rest)
        case [x, y]: return ("sequence", x, y)
        case str(s): return ("str", s)
        case _: return "other"
`,
  },
  [
    [
      "isinstance([], js.Array), isinstance({}, js.Object), isinstance(js.Object(), js.Object), isinstance(print, js.Function), isinstance(js.eval('() => 1'), js.Function), isinstance(ValueError(), js.Error), isinstance('s', js.String), isinstance(1, js.Number)",
      "(True, True, True, True, True, True, False, False)",
    ],
    [
      "matched(js.eval('[1, 2]')), matched(js.eval(\"'s'\")), matched(js.Uint8Array([1, 2]))",
      "(('sequence', 1, 2), ('str', 's'), 'other')",
    ],
    [
      "matched(js.eval('({ a: 1, b: 2 })')), matched(js.Map([['a', 1]]))",
      "(('mapping', 1, {'b': 2}), ('mapping', 1, {}))",
      "neither an object nor a Map is a mapping to `match`",
    ],
    [
      "which(js.Object(), 'Mapping', 'Sequence', 'Callable', 'Awaitable', 'Iterator', 'Hashable', 'Container')",
      "['Hashable', 'Container']",
    ],
    [
      "which(js.eval('(function* () {})()'), 'Iterable', 'Iterator', 'Generator'), which(js.Promise.resolve(1), 'Awaitable', 'Callable'), which(js.eval('() => 1'), 'Callable')",
      "(['Iterable', 'Iterator', 'Generator'], ['Awaitable'], ['Callable'])",
    ],
    [
      "which(js.Promise.resolve(1), 'Sized', 'AsyncIterable'), which(js.eval('(function* () {})()'), 'Sized')",
      "([], [])",
      "every object has __len__ and __aiter__, whether or not they work for it",
    ],
    ["which(js.Uint8Array(1), 'Buffer')", "['Buffer']", "a typed array has the buffer protocol but no __buffer__"],
    [
      "f = js.eval('(function f(a, b = 1, ...c) {})')\ninspect.isroutine(f), callable(f), inspect.isawaitable(js.Promise.resolve(1)), functools.wraps(f)(lambda *a: 1).__name__, functools.lru_cache(js.eval('(a, b) => a + b'))(1, 2)",
      "(True, True, True, 'f', 3)",
    ],
    [
      "inspect.iscoroutinefunction(js.eval('async () => 1')), inspect.isclass(js.Map), inspect.isgeneratorfunction(js.eval('(function* () {})'))",
      "(True, True, True)",
      "inspect knows none of them",
    ],
    ["str(inspect.signature(js.eval('(function f(a, b) {})')))", "'(a, b, /)'", "ValueError: no signature found"],
  ],
);

group(
  "special methods that raise, called by JavaScript",
  {
    setup: `
class Bad:
    def __repr__(self): raise ValueError("repr")
    def __str__(self): raise ValueError("str")
    def __len__(self): raise ValueError("len")
    def __iter__(self): raise ValueError("iter")
    def __getattr__(self, name):
        if name == "boom": raise RuntimeError("getattr")
        raise AttributeError(name)
    def __eq__(self, other): raise ValueError("eq")
    def __hash__(self): raise ValueError("hash")
    def __bool__(self): raise ValueError("bool")
    def __add__(self, other): raise ValueError("add")
    def __lt__(self, other): raise ValueError("lt")
    def __getitem__(self, key): raise ValueError("getitem")
    def __call__(self): raise ValueError("call")
    def __float__(self): raise ValueError("float")
def outcome(source):
    try:
        return js.eval(source)(Bad())
    except Exception as e:
        return type(e).__name__ + " " + str(e)
`,
  },
  [
    [
      "[outcome(s) for s in ('b => String(b)', 'b => b.length', 'b => [...b]', 'b => b.boom', 'b => b == 1', 'b => b + 1', 'b => b < 1', 'b => b[0]', 'b => b()', 'b => Number(b)')]",
      "['ValueError str', 'ValueError len', 'ValueError iter', 'RuntimeError getattr', 'ValueError eq', 'ValueError add', 'ValueError lt', 'ValueError getitem', 'ValueError call', 'ValueError float']",
    ],
    [
      "[outcome(s) for s in ('b => JSON.stringify(b)', 'b => Object.keys(b)', 'b => ({ ...b })', 'b => Bun.inspect(b)', 'b => { for (const k in b) return k; }', 'b => Array.from(b)')]",
      "['ValueError iter', 'ValueError len', 'ValueError len', 'ValueError repr', 'ValueError len', 'ValueError iter']",
    ],
    // What JavaScript decides by itself.
    [
      "[outcome(s) for s in ('b => b.other', 'b => b === b', 'b => new Map([[b, 1]]).get(b)', 'b => !b', 'b => typeof b', 'b => b instanceof Object', 'b => delete b.none', 'b => { b.x = 1; return b.x; }')]",
      "[None, True, 1, False, 'function', True, True, 1]",
    ],
    [
      "outcome('b => Object.setPrototypeOf(b, null)'), outcome('b => Object.defineProperty(b, \"z\", { get() { return 1; } })'), outcome('b => Object.defineProperty(b, \"y\", { value: 2 }).y')",
      "('JSError TypeError: Cannot set prototype of immutable prototype object', 'JSError TypeError: A Python object cannot be given an accessor property', 2)",
    ],
  ],
);

group(
  "properties, class attributes, `this`",
  {
    setup: `
class P:
    shared = "of the class"
    def __init__(self):
        self._v = 1
        self.public = 2
    @property
    def v(self): return self._v
    @v.setter
    def v(self, x):
        if x < 0: raise ValueError("negative")
        self._v = x
    @property
    def fixed(self): return "read only"
    @staticmethod
    def static(a): return a
    @classmethod
    def of_class(cls): return cls.__name__
`,
  },
  [
    ["p = P()\njs.eval('p => { p.v = 5; return [p.v, p._v]; }')(p)", "[5, 5]"],
    ["js.eval('p => { p.v = -1; }')(P())", "!ValueError: negative"],
    [
      "js.eval('p => { \"use strict\"; p.fixed = 1; }')(P())",
      "!AttributeError: property 'fixed' of 'P' object has no setter",
    ],
    ["js.eval('p => { p.fixed = 1; return p.fixed; }')(P())", "'read only'"],
    [
      "js.eval('(p, P) => [p.shared, P.shared, p.static(1), P.static(2), p.of_class(), P.of_class(), P.name]')(P(), P)",
      "['of the class', 'of the class', 1, 2, 'P', 'P', 'P']",
    ],
    [
      "js.eval('p => [Object.keys(p), Object.entries(p), Object.getOwnPropertyNames(p).filter(n => !n.startsWith(\"__\")).sort()]')(P())",
      "[['_v', 'public'], [['_v', 1], ['public', 2]], ['_v', 'fixed', 'of_class', 'public', 'shared', 'static', 'v']]",
    ],
    [
      "dict(js.Object.getOwnPropertyDescriptor(P(), 'public'))",
      "{'value': 2, 'writable': True, 'enumerable': True, 'configurable': True}",
    ],
    [
      "p = P()\nf = js.eval('(function (a) { return [this, a]; })')\njs.Reflect.apply(f, p, [1])[0] is p, f.call(p, 1)[0] is p, f.bind(p)(1)[0] is p, f.apply(p, [1])[1], f.apply(p, (1,))[1]",
      "(True, True, True, 1, 1)",
    ],
  ],
);

group(
  "a Proxy of JavaScript around an object of Python",
  {
    setup: `
import fractions
log = []
class Handler:
    def get(self, target, key, receiver):
        log.append(("get", key))
        return js.Reflect.get(target, key, receiver)
    def set(self, target, key, value, receiver):
        log.append(("set", key, value))
        return js.Reflect.set(target, key, value)
    def has(self, target, key): return True
class Named:
    def me(self): return self
    def __str__(self): return "named"
`,
  },
  [
    [
      "p = P()\nx = js.Proxy(p, Handler())\nx.public = 9\nx.public, p.public, 'anything' in x, type(x).__name__, log",
      "(9, 9, True, 'JSObject', [('set', 'public', 9), ('get', 'public')])",
    ],
    [
      "js.Proxy(js.Object(), {'get': lambda target, key, receiver: 'got ' + key}).anything, js.Proxy(lambda x: x + 1, {'apply': lambda target, this, args: target(*args) * 10})(1)",
      "('got anything', 20)",
    ],
    [
      "x = js.Proxy({'a': 1}, js.Object())\nx.a, x['a'], 'a' in x, len(x), dict(x), js.Object.keys(x), js.JSON.stringify(x)",
      `(1, 1, True, 1, {'a': 1}, ['a'], '{"a":1}')`,
    ],
    [
      "n = Named()\njs.eval('p => new Proxy(p, {}).me() === p')(n), js.eval('p => new Proxy(p, {}).length')((1, 2)), js.eval('p => Object.create(p).a')({'a': 1})",
      "(True, 2, 1)",
    ],
    // What the view of a Python object lends JavaScript takes `this` for that object, and a proxy for an object of JavaScript,
    // whose method it then calls: itself.
    [
      "js.eval('p => [...new Proxy(p, {})]')((1, 2)), list(js.Proxy((1, 2), js.Object()))",
      "([1, 2], [1, 2])",
      "RecursionError",
    ],
    [
      "js.eval('p => String(new Proxy(p, {}))')(Named()), str(js.Proxy(Named(), js.Object()))",
      "('named', 'named')",
      "RecursionError",
    ],
    ["js.eval('p => JSON.stringify(new Proxy(p, {}))')((1, 2))", "'[1,2]'", "RecursionError"],
    ["js.eval('p => String(new Proxy(p, {}) + 1)')(fractions.Fraction(1, 2))", "'3/2'", "RecursionError"],
    ["js.eval('p => [...Object.create(p)]')((1, 2))", "[1, 2]", "RecursionError"],
  ],
);

group(
  "the functions of Python on values of JavaScript",
  {
    setup: "import statistics, heapq, bisect, itertools, operator, json, pickle, copy, array, struct, re, functools\n",
  },
  [
    [
      "sorted(js.eval('[3, 1, 2]')), max(js.Set([1, 5])), sum(js.Uint8Array([1, 2])), any(js.eval('[0, 1]')), list(enumerate(js.Set(['a']))), list(zip(js.eval('[1, 2]'), js.Set(['a', 'b']))), list(reversed(js.eval('[1, 2]'))), tuple(js.Map([[1, 2]]).keys()), set(js.eval('[1, 1]'))",
      "([1, 2, 3], 5, 3, True, [(0, 'a')], [(1, 'a'), (2, 'b')], [2, 1], (1,), {1})",
    ],
    [
      "[*js.Set([1]), *js.eval('[2]')], {**js.eval('({ a: 1 })'), 'b': 2}, (lambda *a, **k: (a, k))(*js.Set([1, 2]), **js.eval('({ x: 1 })')), (lambda **k: k)(**js.Map([['x', 1]]))",
      "([1, 2], {'a': 1, 'b': 2}, ((1, 2), {'x': 1}), {'x': 1})",
    ],
    [
      "'%s %r %d' % (js.eval(\"'s'\"), js.eval(\"'r'\"), js.eval('5')), '{0.a} {0[b]}'.format(js.eval('({ a: 1, b: 2 })')), f\"{js.eval('1.5'):.2f} {js.eval('255'):x} {js.eval('2n ** 70n'):,}\"",
      `("s 'r' 5", '1 2', '1.50 ff 1,180,591,620,717,411,303,424')`,
    ],
    [
      "str(js.eval(\"({ toString() { return 'custom'; } })\")), repr([js.eval('null'), js.eval('1n'), js.eval(\"'x'\"), js.eval('[1, [2]]')]), js.eval('true') is True",
      "('custom', \"[None, 1, 'x', [1, [2]]]\", True)",
    ],
    [
      "a = js.eval('[5, 3, 8, 1]')\nstatistics.mean(a), heapq.nsmallest(2, a), bisect.bisect(sorted(a), 4), list(itertools.accumulate(a)), operator.itemgetter(1)(a)",
      "(4.25, [1, 3], 2, [5, 8, 16, 17], 3)",
    ],
    ["heapq.heapify(a)\na, js.eval('a => a[0]')(a)", "([1, 3, 8, 5], 1)"],
    [
      "json.dumps(js.eval(\"[1, 'a', null, [true, 1.5]]\")), pickle.loads(pickle.dumps(js.eval(\"[1, 'a', null, [2n ** 70n]]\"))), copy.deepcopy(js.eval('[[1]]'))",
      `('[1, "a", null, [true, 1.5]]', [1, 'a', None, [1180591620717411303424]], [[1]])`,
    ],
    [
      "array.array('i', js.eval('[1, 2]')), struct.pack('<2h', *js.eval('[1, 2]')), bytes(js.eval('[65, 66]')), bytearray(js.Set([65]))",
      "(array('i', [1, 2]), b'\\x01\\x00\\x02\\x00', b'AB', bytearray(b'A'))",
    ],
    [
      "re.findall(r'\\d', js.eval(\"'a1b2'\")), re.sub('a', js.eval(\"m => 'X'\"), 'aba'), re.sub('a', js.eval('m => m.group(0).toUpperCase()'), 'aba')",
      "(['1', '2'], 'XbX', 'AbA')",
    ],
    [
      "sorted([3, 1, 2], key=functools.cmp_to_key(js.eval('(a, b) => b - a'))), sorted(['b', 'a'], key=js.eval('s => s'))",
      "([3, 2, 1], ['a', 'b'])",
    ],
  ],
);

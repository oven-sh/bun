// What Python sees of the values of JavaScript.
import { kwargs } from "bun:python";
import { describe, expect, jest, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { EventEmitter } from "node:events";
import path from "node:path";
import _js from "python:_js";
import {
  KeyError,
  RuntimeError,
  StopIteration,
  TypeError as PyTypeError,
  ValueError,
  bool,
  callable,
  delattr,
  dict,
  dir,
  exec,
  getattr,
  hasattr,
  isinstance,
  iter,
  len,
  list,
  next,
  setattr,
  sorted,
  str,
  sum,
  tuple,
  type,
  vars,
} from "python:builtins";
import abc from "python:collections.abc";
import copy from "python:copy";
import functools from "python:functools";
import gc from "python:gc";
import heapq from "python:heapq";
import inspect from "python:inspect";
import { contains, delitem, getitem, setitem } from "python:operator";
import mock from "python:unittest.mock";
import weakref from "python:weakref";
import * as namespace from "./js-values-fixture";

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(60_000);

/** The globals of a piece of Python. */
function python(code: string) {
  const globals = dict();
  exec(code, globals);
  return globals;
}

describe("len()", () => {
  test("is length or size", () => {
    expect(len(new Set([1, 2]))).toBe(2);
    expect(len(new Map([[1, 2]]))).toBe(1);
    expect(len(new Uint8Array(3))).toBe(3);
    expect(len({ length: 4 })).toBe(4);
  });

  test("is the number of properties of an object", () => {
    expect(len({ a: 1, b: 2 })).toBe(2);
    expect(len({})).toBe(0);
  });

  test("of what can only be iterated over is an error", () => {
    function* three() {
      yield* [1, 2, 3];
    }
    expect(() => len(three())).toThrow(PyTypeError);
    expect(() => len(three())).toThrow("object of type '_js.JSGenerator' has no len()");
    expect(() => len([1][Symbol.iterator]())).toThrow(PyTypeError);
    expect(() => len({ [Symbol.iterator]: three })).toThrow(PyTypeError);
    // which is how heapq finds out that it has to count for itself
    expect(heapq.nlargest(2, three())).toEqual([3, 2]);
    expect(heapq.nsmallest(2, three())).toEqual([1, 2]);
  });
});

describe("truth", () => {
  test("what is no container is true", () => {
    function* generator() {}
    const all = [
      () => 1,
      function () {},
      class {},
      Map,
      Math.max,
      Promise.resolve(1),
      new Error("x"),
      new Date(0),
      new Response(""),
      new URL("http://localhost/"),
      new (class Point {})(),
      generator(),
      [][Symbol.iterator](),
      new Headers({ a: "1" }),
      new Blob([]),
      new WeakMap(),
      /x/,
      Symbol("s"),
      Math,
      globalThis,
    ];
    expect(all.filter(value => !bool(value))).toEqual([]);
    expect(python("def choose(callback): return 'called' if callback else 'skipped'").choose(() => 1)).toBe("called");
  });

  test("a container is false when it is empty", () => {
    const empty = [
      new Map(),
      new Set(),
      new Uint8Array(0),
      Buffer.alloc(0),
      {},
      Object.create(null),
      { length: 0 },
      new Headers(),
    ];
    const full = [new Map([[1, 2]]), new Set([0]), new Uint8Array(1), Buffer.alloc(1), { a: undefined }, { length: 1 }];
    expect(empty.map(value => bool(value))).toEqual(empty.map(() => false));
    expect(full.map(value => bool(value))).toEqual(full.map(() => true));
  });
});

describe("an object is a mapping of its properties", () => {
  const methodsOf = python(`
def get(o, *args): return o.get(*args)
def pop(o, *args): return o.pop(*args)
def popitem(o): return o.popitem()
def setdefault(o, *args): return o.setdefault(*args)
def update(o, *args, **kwargs): return o.update(*args, **kwargs)
def clear(o): return o.clear()
def has(o, name): return hasattr(o, name)
`);

  test("with the methods of one", () => {
    const object: Record<string, unknown> = { a: 1 };
    expect([methodsOf.get(object, "a"), methodsOf.get(object, "z"), methodsOf.get(object, "z", 5)]).toEqual([
      1,
      undefined,
      5,
    ]);
    expect(methodsOf.setdefault(object, "b", 2)).toBe(2);
    expect(methodsOf.pop(object, "a")).toBe(1);
    expect(() => methodsOf.pop(object, "a")).toThrow(KeyError);
    methodsOf.update(object, dict([["c", 3]]), kwargs({ d: 4 }));
    methodsOf.update(object, { e: 5 });
    expect(object).toEqual({ b: 2, c: 3, d: 4, e: 5 });
    expect(Array.from(methodsOf.popitem(object))).toEqual(["b", 2]);
    methodsOf.clear(object);
    expect(object).toEqual({});
  });

  test("its own properties come first", () => {
    expect(methodsOf.get({ get: () => "mine" })).toBe("mine");
  });

  test("a plain one says so", () => {
    class Point {}
    const plain = [{}, { a: 1 }, Object.create(null), JSON.parse("{}"), new Object()];
    const others = [new Point(), Object.create({}), new Date(0), new Map(), [], () => 1, Math, namespace, globalThis];
    expect(plain.map(value => type(value))).toEqual(plain.map(() => _js.JSPlainObject));
    expect(plain.map(value => isinstance(value, abc.MutableMapping))).toEqual(plain.map(() => true));
    expect(others.map(value => isinstance(value, abc.Mapping))).toEqual(others.map(() => false));
    expect(isinstance({}, _js.JSObject)).toBe(true);
    expect(isinstance({}, dict)).toBe(false);
    // What it is goes by its prototype, now.
    const object = {};
    Object.setPrototypeOf(object, Point.prototype);
    expect(type(object)).toBe(_js.JSObject);
    const { kind } = python(`
def kind(value):
    match value:
        case {"type": "circle", "r": r}: return ("circle", r)
        case {"type": str(name), **rest}: return (name, rest)
        case {}: return "a mapping"
        case _: return "something else"
`);
    expect(Array.from(kind({ type: "circle", r: 2 }))).toEqual(["circle", 2]);
    expect(Array.from(kind({ type: "square", side: 1 }))).toEqual(["square", dict([["side", 1]])]);
    expect([kind({}), kind(new Point()), kind(new Map())]).toEqual(["a mapping", "something else", "something else"]);
  });

  test("what has get(), has() and keys() and is iterated over is a mapping by those", () => {
    const headers = new Headers({ a: "1", B: "2" });
    expect(getitem(headers, "b")).toBe("2");
    expect(() => getitem(headers, "z")).toThrow(KeyError);
    expect([contains(headers, "A"), contains(headers, "z"), len(headers)]).toEqual([true, false, 2]);
    expect(list(headers)).toEqual(["a", "b"]);
    expect(dict(headers)).toEqual(dict([["a", "1"], ["b", "2"]])); // prettier-ignore
    setitem(headers, "c", "3");
    delitem(headers, "a");
    expect([...headers]).toEqual([["b", "2"], ["c", "3"]]); // prettier-ignore
    expect(methodsOf.pop(headers, "c")).toBe("3");
    expect(methodsOf.has(headers, "items")).toBe(true);
    // As it was: a Map iterates by pairs, a Set has no items.
    expect(list(new Map([[1, 2]]))).toEqual([[1, 2]]);
    expect(methodsOf.has(new Map(), "items")).toBe(false);
  });

  test("what JavaScript iterates over otherwise is none", () => {
    const map = new Map([[1, 2], [3, 4]]); // prettier-ignore
    expect(dict(map.entries())).toEqual(dict([[1, 2], [3, 4]])); // prettier-ignore
    expect(dict([["a", 1]][Symbol.iterator]())).toEqual(dict([["a", 1]]));
    expect(["keys", "get", "update"].map(name => methodsOf.has(map.entries(), name))).toEqual([false, false, false]);
    expect(methodsOf.has(new Set(), "update")).toBe(false);
  });

  test("vars() is the object", () => {
    const object = { a: 1 };
    expect(vars(object)).toBe(object);
    expect(getattr(object, "__dict__")).toBe(object);
    // inspect goes past __getattribute__, and finds no dict.
    expect(inspect.getattr_static(object, "a", "none")).toBe("none");
  });

  test("what is frozen stays as it is", () => {
    const frozen = Object.freeze({ a: 1 });
    expect(() => delattr(frozen, "a")).toThrow(TypeError);
    expect(() => delitem(frozen, "a")).toThrow(TypeError);
    expect(() => setattr(frozen, "a", 2)).toThrow(TypeError);
    expect(() => methodsOf.clear(frozen)).toThrow(TypeError);
    expect(frozen).toEqual({ a: 1 });
  });
});

describe("a method read off its object", () => {
  const { same, read, name, unbound, listen } = python(`
def same(o): return (o.method is o.method, o.method == o.method, hash(o.method) == hash(o.method))
def read(o): return o.method
def name(o): return o.method.__name__
def unbound(prototype, text): return prototype.toUpperCase.call(text)
def listen(emitter, o):
    emitter.on("event", o.method)
    emitter.emit("event")
    emitter.off("event", o.method)
    emitter.emit("event")
`);

  test("is bound, and is one thing however often it is read", () => {
    const object = { value: 1, method() { return this?.value; } }; // prettier-ignore
    expect(Array.from(same(object))).toEqual([true, true, true]);
    expect(read(object)()).toBe(1);
    expect(read(object)).toBe(read(object));
    expect(read(object)).not.toBe(read({ ...object }));
    expect(name(object)).toBe("method");
    const before = read(object);
    object.method = function () { return 2; }; // prettier-ignore
    expect(read(object)).not.toBe(before);
    expect(read(object)()).toBe(2);
  });

  test("so what was added can be removed", () => {
    let calls = 0;
    listen(new EventEmitter(), { method: () => calls++ });
    expect(calls).toBe(1);
  });

  test("off a prototype it is not bound", () => {
    expect(unbound(String.prototype, "abc")).toBe("ABC");
  });

  test("does not keep the object alive", () => {
    const registry: WeakRef<object>[] = [];
    (function make() {
      for (let i = 0; i < 100; i++) {
        const object = { method() {} };
        read(object);
        registry.push(new WeakRef(object));
      }
    })();
    Bun.gc(true);
    expect(registry.filter(reference => reference.deref() === undefined).length).toBeGreaterThan(90);
  });
});

describe("a weak reference", () => {
  test("to an object or a function", () => {
    const object = { a: 1 };
    const named = () => 1;
    expect(weakref.ref(object)()).toBe(object);
    expect(weakref.ref(object)).toBe(weakref.ref(object));
    expect(weakref.ref(named)()).toBe(named);
    expect(weakref.getweakrefcount(object)).toBe(1);
    expect(weakref.proxy(object).a).toBe(1);
    const keyed = weakref.WeakKeyDictionary();
    setitem(keyed, object, "value");
    expect(getitem(keyed, object)).toBe("value");
    const values = weakref.WeakValueDictionary();
    values.key = object;
    expect(values.key).toBe(object);
  });

  test("does not keep it alive, and tells when it is gone", () => {
    const called: string[] = [];
    function make() {
      const references = [];
      for (let i = 0; i < 100; i++) {
        const object = { i };
        references.push(weakref.ref(object, () => called.push("ref")));
        weakref.finalize(object, () => called.push("finalize"));
      }
      return references;
    }
    const references = make();
    Bun.gc(true);
    gc.collect();
    const gone = references.filter(reference => reference() === undefined).length;
    expect(gone).toBeGreaterThan(90);
    expect(called.filter(kind => kind === "ref").length).toBe(gone);
    expect(called.filter(kind => kind === "finalize").length).toBe(gone);
  });
});

test("str() of what JavaScript makes no string of is repr()", () => {
  expect(str(Object.create(null))).toStartWith("<JavaScript ");
  expect(str(namespace)).toStartWith("<JavaScript ");
  expect(str({})).toBe("[object Object]");
  expect(str({ toString: () => "mine" })).toBe("mine");
});

describe("an array that JavaScript has made unusual", () => {
  const sparse = () => {
    const array = [3, 1, 2];
    array[100000] = 4;
    return array;
  };

  test("reads as what it holds", () => {
    for (const array of [Object.freeze([3, 1, 2]), Object.seal([3, 1, 2]), Object.preventExtensions([3, 1, 2])]) {
      expect(list(array)).toEqual([3, 1, 2]);
      expect(getitem(array, -1)).toBe(2);
      expect([list.index(array, 2), list.count(array, 1), contains(array, 2), sum(array)]).toEqual([2, 1, true, 6]);
      expect(Array.from(tuple(array))).toEqual([3, 1, 2]);
      expect(sorted(array)).toEqual([1, 2, 3]);
    }
    expect([len(sparse()), getitem(sparse(), 100000), getitem(sparse(), -1), getitem(sparse(), 3)]).toEqual([
      100001,
      4,
      4,
      undefined,
    ]);
    expect(getitem([1, , 3], 1)).toBeUndefined(); // prettier-ignore
  });

  test("refuses what JavaScript has forbidden, as strict code is refused it", () => {
    const changes: ((array: number[]) => void)[] = [
      array => setitem(array, 0, 9),
      array => list.append(array, 9),
      array => delitem(array, 0),
      array => list.pop(array),
      array => list.insert(array, 0, 9),
      array => list.sort(array),
      array => list.reverse(array),
      array => list.clear(array),
      array => list.extend(array, [9]),
    ];
    for (const change of changes) {
      const frozen = Object.freeze([3, 1, 2]) as number[];
      expect(() => change(frozen)).toThrow(TypeError);
      expect(frozen).toEqual([3, 1, 2]);
    }
    const allowed = (array: number[]) =>
      changes.map(change => {
        const copy = Object.isSealed(array) ? Object.seal([...array]) : Object.preventExtensions([...array]);
        try {
          change(copy);
        } catch (error) {
          expect(error).toBeInstanceOf(TypeError);
          return "TypeError";
        }
        return copy;
      });
    expect(allowed(Object.seal([3, 1, 2]))).toEqual([
      [9, 1, 2],
      "TypeError",
      "TypeError",
      "TypeError",
      "TypeError",
      [1, 2, 3],
      [2, 1, 3],
      "TypeError",
      "TypeError",
    ]);
    expect(allowed(Object.preventExtensions([3, 1, 2]))).toEqual([
      [9, 1, 2],
      "TypeError",
      [1, 2],
      [3, 1],
      "TypeError",
      [1, 2, 3],
      [2, 1, 3],
      [],
      "TypeError",
    ]);
  });

  test("changes as any list, if it is only sparse", () => {
    const array = sparse();
    list.append(array, 5);
    expect([array.length, array[100001]]).toEqual([100002, 5]);
    expect(list.pop(array)).toBe(5);
    list.insert(array, 0, 7);
    expect([array.slice(0, 4), array[100001]]).toEqual([[7, 3, 1, 2], 4]);
    list.reverse(array);
    expect([array[0], array.slice(-4)]).toEqual([4, [2, 1, 3, 7]]);
  });
});

describe("a Map", () => {
  const key = tuple([1, 2]);

  test("has its entries for items", () => {
    const map = new Map<any, any>([
      ["a", 1],
      [key, "b"],
    ]);
    expect(getitem(map, "a")).toBe(1);
    expect(getitem(map, key)).toBe("b");
    expect(() => getitem(map, "size")).toThrow(KeyError);
    expect(contains(map, "a")).toBe(true);
    expect(contains(map, "get")).toBe(false);
    setitem(map, "c", 3);
    expect(map.get("c")).toBe(3);
    delitem(map, "a");
    expect(map.has("a")).toBe(false);
    expect(() => delitem(map, "a")).toThrow(KeyError);
  });

  test("makes a dict", () => {
    const made = dict(
      new Map<any, any>([
        ["a", 1],
        [key, "b"],
      ]),
    );
    expect(len(made)).toBe(2);
    expect(getitem(made, "a")).toBe(1);
    expect(getitem(made, key)).toBe("b");
  });

  test("keeps its methods", () => {
    expect(python("def size(m): return m.size, m.get('a'), m.has('b')").size(new Map([["a", 1]]))).toEqual(
      tuple([1, 1, false]),
    );
  });
});

test("`in` asks a Set", () => {
  expect(contains(new Set([1, "a"]), "a")).toBe(true);
  expect(contains(new Set([1, "a"]), "add")).toBe(false);
});

describe("an iterator", () => {
  test("is one", () => {
    const iterator = [1, 2][Symbol.iterator]();
    expect(type(iterator)).toBe(_js.JSIterator);
    expect(isinstance(iterator, _js.JSObject)).toBe(true);
    expect(isinstance(iterator, abc.Iterator)).toBe(true);
    expect(iter(iterator)).toBe(iterator);
    expect(next(iterator)).toBe(1);
    expect(next(iterator)).toBe(2);
    expect(() => next(iterator)).toThrow(StopIteration);
    expect(next(iterator, "end")).toBe("end");
  });

  test.each([
    ["of a Map", () => new Map([[1, 2]]).keys()],
    ["of a Set", () => new Set([1]).values()],
    ["of a string", () => "1"[Symbol.iterator]()],
    ["of matches", () => "1".matchAll(/1/g)],
    ["made by a helper", () => [0].values().map(x => x + 1)],
    ["wrapped", () => Iterator.from({ next: () => ({ done: false, value: 1 }) })],
  ])("%s", (_, make) => {
    expect(type(make())).toBe(_js.JSIterator);
    expect(String(next(make()))).toBe("1");
  });

  test("can be what __iter__ returns", () => {
    const { Numbers } = python(`
class Numbers:
    def __init__(self, make): self.make = make
    def __iter__(self): return self.make()
`);
    expect(list(Numbers(() => [1, 2].values()))).toEqual([1, 2]);
    expect(
      list(
        Numbers(function* () {
          yield 3;
        }),
      ),
    ).toEqual([3]);
  });
});

describe("a generator", () => {
  test("is one", () => {
    function* empty() {}
    expect(type(empty())).toBe(_js.JSGenerator);
    expect(isinstance(empty(), _js.JSIterator)).toBe(true);
    expect(isinstance(empty(), abc.Generator)).toBe(true);
  });

  test("send()", () => {
    function* echo(): Generator<string, string, string> {
      let said = yield "ready";
      while (said != "stop") said = yield `${said}!`;
      return "stopped";
    }
    const { drive } = python(`
def drive(g):
    heard = [next(g), g.send("a"), g.send("b")]
    try:
        g.send("stop")
    except StopIteration as stop:
        heard.append(stop.value)
    return heard
`);
    expect(drive(echo())).toEqual(["ready", "a!", "b!", "stopped"]);
  });

  test("throw()", () => {
    const caught: unknown[] = [];
    function* catches() {
      try {
        yield 1;
      } catch (error) {
        caught.push(error);
        yield 2;
      }
      yield 3;
    }
    const { throws } = python(`
def throws(g, exception):
    next(g)
    return g.throw(exception)
`);
    const error = ValueError("thrown in");
    expect(throws(catches(), error)).toBe(2);
    expect(caught).toEqual([error]);
    expect(caught[0]).toBe(error);

    function* lets() {
      yield 1;
    }
    let thrown;
    try {
      throws(lets(), error);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBe(error);
    // A class is instantiated, as by `raise`.
    expect(() => throws(lets(), ValueError)).toThrow(ValueError);
  });

  test("close()", () => {
    const log: string[] = [];
    function* cleans() {
      try {
        yield 1;
      } finally {
        log.push("closed");
      }
    }
    const { close } = python(`
def close(g):
    next(g)
    return g.close()
`);
    expect(close(cleans())).toBeUndefined();
    expect(log).toEqual(["closed"]);

    function* goesOn() {
      try {
        yield 1;
      } finally {
        yield 2;
      }
    }
    expect(() => close(goesOn())).toThrow(RuntimeError);
    expect(() => close(goesOn())).toThrow("generator ignored GeneratorExit");
  });

  test("yield from", () => {
    function* inner(): Generator<number, string, number> {
      const sent = yield 1;
      yield sent * 2;
      return "result";
    }
    const { outer } = python(`
def outer(g, results):
    results.append((yield from g))
`);
    const results: string[] = [];
    const generator = outer(inner(), results);
    expect(generator.next().value).toBe(1);
    expect(generator.next(21).value).toBe(42);
    expect(generator.next().done).toBe(true);
    expect(results).toEqual(["result"]);
  });
});

describe("a function", () => {
  function named() {}

  test("has a name", () => {
    expect(getattr(named, "__name__")).toBe("named");
    expect(getattr(named, "__qualname__")).toBe("named");
    expect(getattr(() => {}, "__name__")).toBe("");
    expect(functools.wraps(named)(python("def other(): pass").other).__name__).toBe("named");
    expect(functools.lru_cache(named).__name__).toBe("named");
  });

  test("has a signature, made of its parameters", () => {
    class Point {
      constructor(x: number, y = 2) {}
      method(a: unknown, { b }: any, [c]: any, ...rest: unknown[]) {}
    }
    class Derived extends Point {}
    const signatures = (
      [
        function (a: unknown, b: unknown) {},
        (a: unknown) => a,
        async (x: unknown, y = 1, z?: unknown) => {},
        (...args: unknown[]) => 0,
        () => 0,
        function* (n = Math.max(1, 2), m = "a,b)") {},
        ({ a, b } = {} as any, [c] = [] as any, d?: unknown) => 0,
        // What is no name to Python has none.
        function ($x: unknown, from: unknown, ok: unknown /* , no */) {},
        (a = (b: unknown, c: unknown) => b, d?: unknown) => 0,
        Point,
        Derived,
        class {},
        new Point(1).method,
        function (a: unknown, b: unknown, c: unknown) {}.bind(null, 1),
      ] as unknown[]
    ).map(value => str(inspect.signature(value)));
    expect(signatures).toEqual([
      "(a, b, /)",
      "(a, /)",
      "(x, y=None, z=None, /)",
      "(*args)",
      "()",
      "(n=None, m=None, /)",
      "(arg0=None, arg1=None, d=None, /)",
      "(arg0, arg1, ok, /)",
      "(a=None, d=None, /)",
      "(x, y=None, /)",
      "(*args)",
      "()",
      "(a, arg1, arg2, /, *rest)",
      "(b, c, /)",
    ]);
    expect(() => inspect.signature(Math.max)).toThrow(ValueError);
  });

  test("an async function is a coroutine function", () => {
    expect(
      [async () => 1, async function () {}, () => 1, async function* () {}].map(f => inspect.iscoroutinefunction(f)),
    ).toEqual([true, true, false, false]);
  });

  test("is of the module js, and has no docstring", () => {
    expect([getattr(named, "__module__"), getattr(named, "__doc__")]).toEqual(["js", undefined]);
  });

  test("can be the wrapper of functools.wraps()", () => {
    const wrapper = functools.wraps(python("def wrapped():\n    'doc'\nwrapped.mark = 1").wrapped)(() => "called");
    expect([wrapper.__name__, wrapper.__doc__, wrapper.mark, wrapper.__wrapped__.__name__, wrapper()]).toEqual([
      "wrapped",
      "doc",
      1,
      "wrapped",
      "called",
    ]);
  });

  test("dir() lists what can be had, once", () => {
    const names: string[] = dir(named);
    expect(names.filter(name => ["arguments", "caller", "name", "length", "call"].includes(name))).toEqual([
      "call",
      "length",
      "name",
    ]);
    expect(names.filter(name => !hasattr(named, name))).toEqual([]);
    expect(callable(mock.create_autospec(named))).toBe(true);
  });

  test("a mock function is called, not constructed", () => {
    const key = jest.fn((x: number) => -x);
    expect(sorted([1, 3, 2], kwargs({ key }))).toEqual([3, 2, 1]);
    expect(key).toHaveBeenCalledTimes(3);
    expect(key.mock.instances.every((instance: unknown) => instance === undefined)).toBe(true);
  });

  test("is copied as a function of Python is: not at all", () => {
    expect(copy.copy(named)).toBe(named);
    expect(copy.deepcopy(named)).toBe(named);
    const deep = copy.deepcopy(dict([["key", [named]]]));
    expect(deep.key[0]).toBe(named);
  });
});

test.concurrent("os.chdir() moves JavaScript too", async () => {
  using dir = tempDir("python-chdir", {
    "sub/data.txt": "here",
    "sub/found.js": "module.exports = 'found';",
    "main.js": `
      const os = require("python:os");
      const path = require("node:path");
      process.cwd();
      os.chdir("sub");
      console.log(path.basename(process.cwd()), process.cwd() === os.getcwd());
      console.log(require("node:fs").readFileSync("data.txt", "utf8"));
      console.log(path.relative(process.cwd(), Bun.resolveSync("./found.js", process.cwd())));
      const fd = os.open("..", os.O_RDONLY);
      os.fchdir(fd);
      os.close(fd);
      console.log(process.cwd() === os.getcwd(), require("node:fs").existsSync("main.js"));
      process.chdir("sub");
      console.log(path.basename(os.getcwd()));
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.js"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("sub true\nhere\nfound.js\ntrue true\nsub\n");
  expect(exitCode).toBe(0);
});

test.concurrent("os.chdir() in another thread moves JavaScript too", async () => {
  using dir = tempDir("python-chdir-thread", {
    "sub/found.js": "module.exports = 'found';",
    "main.py": `
import os, threading, js
js.process.cwd()
def move(to):
    os.chdir(to)
    print(os.path.basename(os.getcwd()))
for to in ("sub", os.open(".", os.O_RDONLY)):
    thread = threading.Thread(target=move, args=(to,))
    thread.start()
    thread.join()
    print(js.process.cwd() == os.getcwd(), os.path.relpath(js.Bun.resolveSync("./sub/found.js" if to != "sub" else "./found.js", js.process.cwd())))
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.py"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe(`sub\nTrue found.js\n${path.basename(String(dir))}\nTrue sub/found.js\n`);
  expect(exitCode).toBe(0);
});

// macOS refuses such names, and Windows has none.
test.concurrent.skipIf(!isLinux)("os.chdir() into a directory whose name JavaScript cannot spell", async () => {
  using dir = tempDir("python-chdir-bytes", {
    "main.py": String.raw`
import os, sys, js
from node import fs
for name in ("\u00e6".encode(), b"\xe7w\xf0"):
    os.mkdir(name)
    with open(name + b"/data.txt", "w") as f:
        f.write("here")
    os.chdir(name)
    print(os.getcwdb()[-len(name):], js.process.cwd().rpartition("/")[2].encode("utf-8"), fs.readFileSync("data.txt", "utf8"))
    sys.modules.pop("colorsys", None)
    import colorsys
    try:
        import nothing_of_that_name
    except ModuleNotFoundError as e:
        print(e)
    os.chdir("..")
    print(js.process.cwd() == os.getcwd(), fs.existsSync("main.py"))
`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "main.py"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.split("\n")).toEqual([
    String.raw`b'\xc3\xa6' b'\xc3\xa6' here`,
    "No module named 'nothing_of_that_name'",
    "True True",
    String.raw`b'\xe7w\xf0' b'\xef\xbf\xbdw\xef\xbf\xbd' here`,
    "No module named 'nothing_of_that_name'",
    "True True",
    "",
  ]);
  expect(exitCode).toBe(0);
});

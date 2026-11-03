// The collector is one for both languages: what is garbage across the boundary is collected, and finalized.
import { heapStats } from "bun:jsc";
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { isASAN, isDebug } from "harness";
import { TypeError as PyTypeError, dict, exec, object } from "python:builtins";
import gc from "python:gc";
import weakref from "python:weakref";

// These builds take seconds to start Python.
if (isDebug || isASAN) setDefaultTimeout(60_000);

const globals = dict([["__name__", "fixture"]]);
exec(
  `
log = []
kept = []

class Node:
    def __init__(self, name):
        self.name = name
    def __del__(self):
        log.append("del " + self.name)

class Plain:
    pass

class Lazarus:
    def __del__(self):
        log.append("lazarus")
        kept.append(self)

def generator(name):
    try:
        yield 1
        yield 2
    finally:
        log.append("finally " + name)

def take():
    taken = list(log)
    log.clear()
    return taken
`,
  globals,
);
const { Node, Plain, Lazarus, generator, take, log, kept } = globals;

/** Collects, and lets the event loop turn, until the condition holds. */
async function collectUntil(condition: () => boolean) {
  for (let i = 0; i < 100 && !condition(); i++) {
    Bun.gc(true);
    await new Promise(resolve => setImmediate(resolve));
  }
  return condition();
}

describe("cycles through both languages are collected", () => {
  test("an object of JavaScript, one of Python's, a closure", async () => {
    const [js, python, reference] = (() => {
      const js: any = { name: "js" };
      const python = Node("closure");
      js.python = python;
      python.callback = () => js;
      return [new WeakRef(js), new WeakRef(python), weakref.ref(python)];
    })();
    expect(await collectUntil(() => log.length > 0)).toBe(true);
    expect(take()).toEqual(["del closure"]);
    expect(await collectUntil(() => js.deref() === undefined && python.deref() === undefined)).toBe(true);
    expect(reference()).toBeUndefined();
  });

  test("a list that holds an object that holds the list", async () => {
    const object = (() => {
      const list: unknown[] = [];
      const object = { list };
      list.push(object, Node("list"));
      return new WeakRef(object);
    })();
    expect(await collectUntil(() => log.length > 0 && object.deref() === undefined)).toBe(true);
    expect(take()).toEqual(["del list"]);
  });

  test("an instance of a class derived in JavaScript that holds its own methods", async () => {
    class Derived extends Node {
      constructor(name: string) {
        super(name);
        this.bound = this.describe;
        this.arrow = () => this;
      }
      describe() {
        return this.name;
      }
    }
    const [js, python] = (() => {
      const derived = new Derived("derived");
      return [new WeakRef(derived), weakref.ref(derived)];
    })();
    expect(await collectUntil(() => log.length > 0 && js.deref() === undefined)).toBe(true);
    expect(take()).toEqual(["del derived"]);
    expect(python()).toBeUndefined();
  });
});

describe("finalizers", () => {
  test("run in a program that runs no Python code any more", async () => {
    (() => void Node("only JavaScript held it"))();
    expect(await collectUntil(() => log.length > 0)).toBe(true);
    expect(take()).toEqual(["del only JavaScript held it"]);
  });

  test("do not run inside Bun.gc()", () => {
    (() => void Node("later"))();
    Bun.gc(true);
    expect([...log]).toEqual([]);
    gc.collect();
    expect(take()).toEqual(["del later"]);
  });

  test("gc.collect() called by JavaScript runs them before it returns", () => {
    (() => void Node("at once"))();
    gc.collect();
    expect(take()).toEqual(["del at once"]);
  });

  test("__del__ written in JavaScript", async () => {
    class Finalized extends object {
      __del__() {
        log.push("del in JavaScript");
      }
    }
    (() => void new Finalized())();
    expect(await collectUntil(() => log.length > 0)).toBe(true);
    expect(take()).toEqual(["del in JavaScript"]);
  });

  test("may resurrect, and run once", async () => {
    (() => void Lazarus())();
    expect(await collectUntil(() => kept.length > 0)).toBe(true);
    expect(take()).toEqual(["lazarus"]);
    const again = new WeakRef(kept.pop());
    expect(await collectUntil(() => again.deref() === undefined)).toBe(true);
    expect(take()).toEqual([]);
  });

  test("weakref.finalize() on an instance of a class derived in JavaScript", async () => {
    class Derived extends Plain {}
    (() => void weakref.finalize(new Derived(), () => log.push("finalize")))();
    expect(await collectUntil(() => log.length > 0)).toBe(true);
    expect(take()).toEqual(["finalize"]);
  });

  test("FinalizationRegistry and WeakRef take objects of Python's", async () => {
    const seen: string[] = [];
    const registry = new FinalizationRegistry((held: string) => seen.push(held));
    (() => {
      registry.register(Plain(), "instance");
      registry.register(Node("registered"), "with __del__");
      registry.register(dict(), "dict");
    })();
    expect(await collectUntil(() => seen.length === 3)).toBe(true);
    expect(seen.sort()).toEqual(["dict", "instance", "with __del__"]);
    expect(take()).toEqual(["del registered"]);
  });

  test("a timer keeps what its callback holds", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    const node = (() => {
      const node = Node("timer");
      setTimeout(() => resolve(node.name), 1);
      return new WeakRef(node);
    })();
    Bun.gc(true);
    expect(node.deref()).toBeDefined();
    await promise;
    expect(await collectUntil(() => log.length > 0)).toBe(true);
    expect(take()).toEqual(["del timer"]);
  });
});

describe("a generator that JavaScript leaves half way", () => {
  test("is closed by break and by destructuring", () => {
    for (const _ of generator("break")) break;
    expect(take()).toEqual(["finally break"]);
    const [first] = generator("destructuring");
    expect(first).toBe(1);
    expect(take()).toEqual(["finally destructuring"]);
  });

  test("is closed when it is collected", async () => {
    (() => void generator("dropped")[Symbol.iterator]().next())();
    expect(await collectUntil(() => log.length > 0)).toBe(true);
    expect(take()).toEqual(["finally dropped"]);
  });
});

test("the heap statistics count the cells of Python", () => {
  const nodes = Array.from({ length: 100 }, (_, i) => Plain());
  const { objectTypeCounts } = heapStats();
  expect(objectTypeCounts.PyInstance).toBeGreaterThanOrEqual(nodes.length);
  expect(objectTypeCounts.PyType).toBeGreaterThan(50);
});

// Python has no weak references to the objects of JavaScript, which has them itself (WeakRef).
test.failing("weakref.ref() takes an object of JavaScript", () => {
  const object = {};
  expect(weakref.ref(object)()).toBe(object);
});
test("weakref.ref() of an object of JavaScript is a TypeError", () => {
  expect(() => weakref.ref({})).toThrow(PyTypeError);
});

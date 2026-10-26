import { describe, expect, test } from "bun:test";
import vm from "node:vm";

// https://github.com/tc39/proposal-structs: shared structs, Atomics, Mutex and Condition, step by step.

describe("one shared object is one JS object per realm", () => {
  test("a struct reached through two parents is the same object", () => {
    shared struct Node {
      child;
    }
    const leaf = new Node();
    const a = new Node();
    const b = new Node();
    a.child = leaf;
    b.child = leaf;
    expect(a.child).toBe(leaf);
    expect(b.child).toBe(leaf);
    expect(a.child).toBe(b.child);
    expect(Atomics.load(b, "child")).toBe(leaf);
  });

  test("a structured clone of a shared struct is the same object in the same realm", () => {
    shared struct Box {
      value;
    }
    const box = new Box();
    expect(structuredClone(box)).toBe(box);
    expect(structuredClone({ box }).box).toBe(box);
    const array = new SharedArray(2);
    array[0] = box;
    expect(structuredClone(array)).toBe(array);
    expect(array[0]).toBe(box);
  });

  test("a mutex and a condition are one object too", () => {
    shared struct Holder {
      mutex;
      condition;
    }
    const mutex = new Atomics.Mutex();
    const condition = new Atomics.Condition();
    const one = new Holder();
    const two = new Holder();
    one.mutex = mutex;
    two.mutex = mutex;
    one.condition = condition;
    two.condition = condition;
    expect(one.mutex).toBe(mutex);
    expect(two.mutex).toBe(mutex);
    expect(two.condition).toBe(condition);
    expect(structuredClone(mutex)).toBe(mutex);
  });

  test("a struct nobody references any more can be made again, and it still reads the same block", () => {
    shared struct Cell {
      v;
    }
    const outer = new Cell();
    for (let i = 0; i < 500; i++) {
      const inner = new Cell();
      inner.v = i;
      outer.v = inner;
      expect(outer.v.v).toBe(i);
    }
  });
});

describe("symbols are shareable values", () => {
  test("unique, registered and well-known symbols round trip in one realm", () => {
    shared struct Box {
      v;
    }
    const box = new Box();
    for (const symbol of [Symbol("u"), Symbol(), Symbol(""), Symbol.for("registered"), Symbol.iterator]) {
      expect(Reflect.canBeShared(symbol)).toBe(true);
      box.v = symbol;
      expect(box.v).toBe(symbol);
      expect(Atomics.load(box, "v")).toBe(symbol);
    }
    const symbol = Symbol("same");
    box.v = symbol;
    // Another symbol with the same description is another symbol.
    expect(Atomics.compareExchange(box, "v", Symbol("same"), 1)).toBe(symbol);
    expect(box.v).toBe(symbol);
    expect(Atomics.compareExchange(box, "v", symbol, 1)).toBe(symbol);
    expect(box.v).toBe(1);
  });

  test("another agent gets symbols that are the same across agents", async () => {
    shared struct Box {
      a;
      b;
      c;
    }
    const box = new Box();
    const unique = Symbol("unique");
    const registered = Symbol.for("shared.registered");
    box.a = unique;
    box.b = registered;
    const src = `
      self.onmessage = ({ data: box }) => {
        const a = box.a;
        const b = box.b;
        box.c = a;
        postMessage([
          typeof a,
          a.description,
          b === Symbol.for("shared.registered"),
          Symbol.keyFor(b),
          Symbol.keyFor(a),
          box.a === a,
          Atomics.load(box, "a") === a,
        ]);
      };
    `;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const worker = new Worker(url);
    const result = new Promise<unknown[]>((resolve, reject) => {
      worker.onmessage = e => resolve(e.data);
      worker.onerror = e => reject(e.error ?? e);
    });
    worker.postMessage(box);
    expect(await result).toEqual(["symbol", "unique", true, "shared.registered", undefined, true, true]);
    worker.terminate();
    // The symbol the worker stored back is the one this agent made.
    expect(box.c).toBe(unique);
  });
});

describe("Atomics in a realm that only received a struct", () => {
  test("a worker uses Atomics on a struct before it reads any of the structs names", async () => {
    shared struct Box {
      v;
    }
    const box = new Box();
    box.v = 41;
    const src = `
      self.onmessage = ({ data }) => {
        const before = Atomics.load(data, "v");
        const old = Atomics.exchange(data, "v", 42);
        postMessage([before, old, Atomics.compareExchange(data, "v", 42, 43), Atomics.load(data, "v")]);
      };
    `;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const worker = new Worker(url);
    const result = new Promise<unknown[]>((resolve, reject) => {
      worker.onmessage = e => resolve(e.data);
      worker.onerror = e => reject(e.error ?? e);
    });
    worker.postMessage(box);
    expect(await result).toEqual([41, 41, 42, 43]);
    worker.terminate();
    expect(box.v).toBe(43);
  });

  test("a worker uses Atomics on a shared array it was sent", async () => {
    const array = new SharedArray(1);
    array[0] = 5;
    const src = `self.onmessage = ({ data }) => postMessage(Atomics.store(data, "0", 6) + Atomics.load(data, "0"));`;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const worker = new Worker(url);
    const result = new Promise<number>((resolve, reject) => {
      worker.onmessage = e => resolve(e.data);
      worker.onerror = e => reject(e.error ?? e);
    });
    worker.postMessage(array);
    expect(await result).toBe(12);
    worker.terminate();
  });
});

describe("the native structs cannot be replaced by a script", () => {
  test("defining the hook that the lowering used to read does not change what shared structs are", () => {
    const key = Symbol.for("bun.structs.native");
    Object.defineProperty(globalThis, key, {
      value: { create: () => ({ fake: true }) },
      configurable: true,
    });
    try {
      shared struct Box {
        v;
      }
      const box = new Box() as any;
      expect(box.fake).toBeUndefined();
      expect(Object.getPrototypeOf(box)).toBeNull();
      box.v = 1;
      expect(Atomics.load(box, "v")).toBe(1);
      expect(Reflect.canBeShared(box)).toBe(true);
    } finally {
      delete (globalThis as any)[key];
    }
  });
});

describe("huge and long structures", () => {
  test("a SharedArray longer than the memory is a RangeError, not a crash", () => {
    expect(() => new SharedArray(2 ** 32 - 1)).toThrow(RangeError);
    expect(() => new SharedArray(2 ** 31)).toThrow(RangeError);
    expect(new SharedArray(1000).length).toBe(1000);
  });

  test("dropping a long chain of shared structs does not overflow the stack", () => {
    shared struct Link {
      next;
    }
    let head: any = new Link();
    let tail = head;
    for (let i = 0; i < 100_000; i++) {
      const link = new Link();
      tail.next = link;
      tail = link;
    }
    expect(tail.next).toBeUndefined();
    head = tail = undefined;
    Bun.gc(true);
  });
});

describe("timeouts and notifications", () => {
  test("a timeout longer than the clock can count waits for ever instead of crashing", async () => {
    const m = new Atomics.Mutex();
    const c = new Atomics.Condition();
    const free = Atomics.Mutex.lockIfAvailable(m, 1e22);
    expect(free).not.toBeNull();
    free!.unlock();
    using token = Atomics.Mutex.lock(m);
    expect(Atomics.Condition.waitFor(c, token, 1e22, () => true)).toBe(true);
    const src = `
      self.onmessage = ({ data: { m, c } }) => {
        const token = Atomics.Mutex.lock(m);
        Atomics.Condition.notify(c);
        token.unlock();
        postMessage("notified");
      };
    `;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const worker = new Worker(url);
    const done = new Promise<string>(resolve => (worker.onmessage = e => resolve(e.data)));
    worker.postMessage({ m, c });
    // The worker gets the lock when this wait gives it up, and then notifies the condition.
    expect(Atomics.Condition.waitFor(c, token, 1e22)).toBe(true);
    expect(await done).toBe("notified");
    worker.terminate();
  });

  test("a notification is not kept for a waiter that arrives later", () => {
    const m = new Atomics.Mutex();
    const c = new Atomics.Condition();
    expect(Atomics.Condition.notify(c, 1)).toBe(0);
    using token = Atomics.Mutex.lock(m);
    expect(Atomics.Condition.waitFor(c, token, 30)).toBe(false);
  });

  test("a worker that waits to take a mutex back can still be terminated", async () => {
    shared struct State {
      waiting;
    }
    const state = new State();
    state.waiting = 0;
    const m = new Atomics.Mutex();
    const c = new Atomics.Condition();
    const src = `
      self.onmessage = ({ data: { state, m, c } }) => {
        const token = Atomics.Mutex.lock(m);
        state.waiting = 1;
        Atomics.Condition.wait(c, token);
        postMessage("woke");
      };
    `;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const worker = new Worker(url);
    worker.postMessage({ state, m, c });
    while (state.waiting === 0) await Bun.sleep(1);
    // This thread gets the lock once the worker waits, and keeps it, so the worker cannot take it back after the notification.
    using token = Atomics.Mutex.lock(m);
    expect(Atomics.Condition.notify(c)).toBe(1);
    const closed = new Promise<void>(resolve => worker.addEventListener("close", () => resolve()));
    await Bun.sleep(30);
    worker.terminate();
    await closed;
    expect(token.locked).toBe(true);
  });
});

describe("shared struct exotic object", () => {
  test("[[Delete]] is false for every key and [[Set]] ignores the receiver", () => {
    shared struct S {
      x;
    }
    const s = new S();
    expect(Reflect.deleteProperty(s, "x")).toBe(false);
    expect(Reflect.deleteProperty(s, "nope")).toBe(false);
    expect(() => {
      "use strict";
      delete (s as any).nope;
    }).toThrow(TypeError);
    const receiver = {};
    expect(Reflect.set(s, "x", 5, receiver)).toBe(true);
    expect(s.x).toBe(5);
    expect("x" in receiver).toBe(false);
    expect(Reflect.set(s, "nope", 5, receiver)).toBe(false);
    expect("nope" in receiver).toBe(false);
    expect(() => {
      "use strict";
      (s as any).nope = 1;
    }).toThrow(TypeError);
  });

  test("a shared array can be sealed and a harmless descriptor of its length is accepted", () => {
    const a = new SharedArray(2);
    a[0] = 1;
    expect(Object.seal(a)).toBe(a);
    expect(Object.isSealed(a)).toBe(true);
    expect(Reflect.defineProperty(a, "length", {})).toBe(true);
    expect(Reflect.defineProperty(a, "length", { value: 2, writable: false, enumerable: false, configurable: false })).toBe(true);
    expect(Reflect.defineProperty(a, "length", { value: 3 })).toBe(false);
    expect(Reflect.defineProperty(a, "length", { writable: true })).toBe(false);
    expect(Reflect.defineProperty(a, "length", { enumerable: true })).toBe(false);
    expect(Reflect.defineProperty(a, "length", { configurable: true })).toBe(false);
    expect(Reflect.defineProperty(a, "length", { get: () => 2 })).toBe(false);
    expect(Object.isFrozen(a)).toBe(false);
    expect(() => Object.freeze(a)).toThrow(TypeError);
  });

  test("the same for a shared array", () => {
    const a = new SharedArray(2);
    for (const key of ["0", "1", "2", "length", "foo"]) expect(Reflect.deleteProperty(a, key)).toBe(false);
    const receiver = {};
    expect(Reflect.set(a, "0", 7, receiver)).toBe(true);
    expect(a[0]).toBe(7);
    expect(Object.keys(receiver)).toEqual([]);
    expect(Reflect.set(a, "5", 1, receiver)).toBe(false);
    expect(Reflect.set(a, "length", 5, receiver)).toBe(false);
    expect(Object.keys(receiver)).toEqual([]);
  });

  test("a write through an object that inherits from a shared struct is the struct's own write", () => {
    shared struct S {
      x;
    }
    const s = new S();
    const child = Object.create(s);
    child.x = 7;
    expect(s.x).toBe(7);
    expect(Object.hasOwn(child, "x")).toBe(false);
  });

  test("own property descriptors, and an accessor descriptor that changes nothing", () => {
    shared struct S {
      x;
    }
    const s = new S();
    s.x = 5;
    expect(Object.getOwnPropertyDescriptor(s, "x")).toEqual({
      value: 5,
      writable: true,
      enumerable: true,
      configurable: false,
    });
    expect(Reflect.defineProperty(s, "x", { value: 6 })).toBe(true);
    expect(s.x).toBe(6);
    expect(Reflect.defineProperty(s, "x", { enumerable: false })).toBe(false);
    expect(Reflect.defineProperty(s, "x", { configurable: true })).toBe(false);
    expect(Reflect.defineProperty(s, "x", { writable: false })).toBe(false);
    // [[DefineOwnProperty]] only reads [[Value]] and the three flags, so this is accepted and does nothing.
    expect(Reflect.defineProperty(s, "x", { get: () => 1 })).toBe(true);
    expect(s.x).toBe(6);
    expect(Reflect.defineProperty(s, "y", { value: 1 })).toBe(false);
  });
});

describe("symbols across agents and realms", () => {
  test("well-known symbols are the same in another agent", async () => {
    shared struct Box {
      a;
      b;
    }
    const box = new Box();
    box.a = Symbol.iterator;
    box.b = Symbol.asyncIterator;
    const src = `
      self.onmessage = ({ data: box }) => {
        postMessage([box.a === Symbol.iterator, box.b === Symbol.asyncIterator, box.a === box.b, box.a.description]);
      };
    `;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const worker = new Worker(url);
    const result = new Promise<unknown[]>((resolve, reject) => {
      worker.onmessage = e => resolve(e.data);
      worker.onerror = e => reject(e.error ?? e);
    });
    worker.postMessage(box);
    expect(await result).toEqual([true, true, false, "Symbol.iterator"]);
    worker.terminate();
  });

  test("a vm context on the same thread gets the very symbol that another realm stored", () => {
    shared struct Box {
      v;
      w;
    }
    const box = new Box();
    const inContext = vm.runInNewContext(`const s = Symbol("ctx"); box.v = s; s`, { box });
    expect(typeof inContext).toBe("symbol");
    // The symbol of the context is what this realm gets too, so it can be compared, stored again and found again.
    expect(box.v).toBe(inContext);
    expect(Atomics.compareExchange(box, "v", inContext, 1)).toBe(inContext);
    expect(box.v).toBe(1);
    box.w = inContext;
    expect(vm.runInNewContext(`box.w === s2`, { box, s2: inContext })).toBe(true);
    expect(Atomics.compareExchange(box, "w", Symbol("ctx"), 2)).toBe(inContext);
  });
});

describe("shared struct field names", () => {
  test("a field can be named by a symbol", async () => {
    const sym = Symbol("field");
    const registered = Symbol.for("registered.field");
    shared struct S {
      [sym] = 1;
      a = 2;
      [registered] = 3;
    }
    const s = new S();
    expect(Reflect.ownKeys(s)).toEqual(["a", sym, registered]);
    expect(Object.keys(s)).toEqual(["a"]);
    expect(Object.getOwnPropertySymbols(s)).toEqual([sym, registered]);
    expect([s[sym], s.a, s[registered]]).toEqual([1, 2, 3]);
    s[sym] = 5;
    expect(Atomics.load(s, sym as any)).toBe(5);
    expect(Atomics.exchange(s, registered as any, 9)).toBe(3);
    expect(sym in s).toBe(true);
    expect(Symbol("field") in s).toBe(false);
    expect(() => Atomics.load(s, Symbol("field") as any)).toThrow(RangeError);
    const src = `
      self.onmessage = ({ data: s }) => {
        const [first, second] = Object.getOwnPropertySymbols(s);
        const before = s[first];
        s[first] = before + 1;
        postMessage([before, first.description, Symbol.keyFor(second), s[second]]);
      };
    `;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const worker = new Worker(url);
    const result = new Promise<unknown[]>((resolve, reject) => {
      worker.onmessage = e => resolve(e.data);
      worker.onerror = e => reject(e.error ?? e);
    });
    worker.postMessage(s);
    expect(await result).toEqual([5, "field", "registered.field", 9]);
    worker.terminate();
    expect(s[sym]).toBe(6);
  });

  test("a field can be named by an array index or by a computed name", () => {
    const key = "k";
    shared struct S {
      7 = "seven";
      [key] = 1;
      0 = "zero";
      a = 2;
    }
    const s = new S();
    // Array indices first in ascending order, then the other names in declaration order.
    expect(Reflect.ownKeys(s)).toEqual(["0", "7", "k", "a"]);
    expect(Object.keys(s)).toEqual(["0", "7", "k", "a"]);
    expect([s[7], s["7"], s[0], s.k, s.a]).toEqual(["seven", "seven", "zero", 1, 2]);
    s[0] = "z";
    expect(s[0]).toBe("z");
    expect(Atomics.load(s, "7")).toBe("seven");
    expect(Atomics.exchange(s, "0", "x")).toBe("z");
    expect(7 in s).toBe(true);
    expect(8 in s).toBe(false);
    expect(Reflect.deleteProperty(s, "7")).toBe(false);
    expect(Reflect.deleteProperty(s, "8")).toBe(false);
    expect(Object.getOwnPropertyDescriptor(s, "7")).toEqual({
      value: "seven",
      writable: true,
      enumerable: true,
      configurable: false,
    });
    expect(() => {
      "use strict";
      (s as any)[8] = 1;
    }).toThrow(TypeError);
  });
});

describe("Atomics on shared structs follows the order of the proposal", () => {
  test("the key has to be a property key, then the value shareable, then the field there", () => {
    shared struct S {
      x;
    }
    const s = new S();
    const keyLike = { toString: () => "x" };
    expect(() => Atomics.load(s, 0 as any)).toThrow(TypeError);
    expect(() => Atomics.load(s, keyLike as any)).toThrow(TypeError);
    expect(() => Atomics.load(s, "nope")).toThrow(RangeError);
    expect(() => Atomics.load(s, Symbol("nope") as any)).toThrow(RangeError);
    expect(() => Atomics.store(s, keyLike as any, 1)).toThrow(TypeError);
    // The value is checked before the field.
    expect(() => Atomics.store(s, "nope", {} as any)).toThrow(TypeError);
    expect(() => Atomics.store(s, "nope", 1)).toThrow(RangeError);
    expect(() => Atomics.exchange(s, "nope", {} as any)).toThrow(TypeError);
    expect(() => Atomics.exchange(s, "nope", 1)).toThrow(RangeError);
    expect(() => Atomics.compareExchange(s, "nope", 1, {} as any)).toThrow(TypeError);
    expect(() => Atomics.compareExchange(s, "nope", 1, 2)).toThrow(RangeError);
    expect(Atomics.store(s, "x", "ok")).toBe("ok");
  });

  test("a shared array: property keys only, `length` is a field, anything else is missing", () => {
    const a = new SharedArray(1);
    expect(() => Atomics.load(a, 0 as any)).toThrow(TypeError);
    expect(() => Atomics.load(a, "foo")).toThrow(RangeError);
    expect(() => Atomics.load(a, "1")).toThrow(RangeError);
    expect(() => Atomics.load(a, "-0" as any)).toThrow(RangeError);
    expect(Atomics.load(a, "length")).toBe(1);
    expect(Atomics.load(a, "0")).toBeUndefined();
    expect(Atomics.load(a, "length")).not.toBe(Atomics.load(a, "0"));
  });

  test("a Mutex and a Condition are shared structs without fields", () => {
    const m = new Atomics.Mutex();
    const c = new Atomics.Condition();
    expect(() => Atomics.load(m, "x")).toThrow(RangeError);
    expect(() => Atomics.store(c, "x", 1)).toThrow(RangeError);
    expect(() => Atomics.load(m, 1 as any)).toThrow(TypeError);
  });

  test("anything that is not a shared struct or a typed array is the engine's TypeError", () => {
    expect(() => Atomics.load({} as any, "x")).toThrow(TypeError);
    expect(() => Atomics.store([] as any, "0", 1)).toThrow(TypeError);
  });

  test("the overloads keep the names and lengths of the originals", () => {
    expect([Atomics.load.length, Atomics.store.length, Atomics.exchange.length, Atomics.compareExchange.length]).toEqual([
      2, 3, 3, 4,
    ]);
    expect([Atomics.load.name, Atomics.store.name, Atomics.exchange.name, Atomics.compareExchange.name]).toEqual([
      "load",
      "store",
      "exchange",
      "compareExchange",
    ]);
  });
});

describe("Atomics.Mutex and Atomics.Condition objects", () => {
  test("they are sealed shared structs without a prototype or methods", () => {
    for (const make of [() => new Atomics.Mutex(), () => new Atomics.Condition()]) {
      const object = make();
      expect(Object.getPrototypeOf(object)).toBeNull();
      expect(Object.isExtensible(object)).toBe(false);
      expect(Reflect.ownKeys(object)).toEqual([]);
      for (const name of ["lock", "unlock", "wait", "notify", "tryLock", "constructor"]) {
        expect(name in object).toBe(false);
      }
      expect(Reflect.canBeShared(object)).toBe(true);
      expect(() => {
        "use strict";
        (object as any).extra = 1;
      }).toThrow(TypeError);
      // [[Delete]] is false for every key.
      expect(Reflect.deleteProperty(object, "x")).toBe(false);
      expect(() => {
        "use strict";
        delete (object as any).x;
      }).toThrow(TypeError);
      expect(Object.isSealed(object)).toBe(true);
    }
  });

  test("their constructors have no prototype and need new", () => {
    for (const Constructor of [Atomics.Mutex, Atomics.Condition]) {
      expect(Object.hasOwn(Constructor, "prototype")).toBe(false);
      expect(Constructor.length).toBe(0);
      expect(() => (Constructor as any)()).toThrow(TypeError);
    }
    expect(Atomics.Mutex.name).toBe("Mutex");
    expect(Atomics.Condition.name).toBe("Condition");
  });

  test("the unlock token prototype has the proposal's members and nothing else", () => {
    const prototype = Atomics.Mutex.UnlockToken.prototype;
    expect(Reflect.ownKeys(prototype).map(String).sort()).toEqual(["Symbol(Symbol.dispose)", "locked", "unlock"]);
    expect(Object.getPrototypeOf(prototype)).toBe(Object.prototype);
    expect(prototype.unlock.length).toBe(0);
    expect(Object.getOwnPropertyDescriptor(Atomics.Mutex.UnlockToken, "prototype")).toMatchObject({
      writable: false,
      enumerable: false,
      configurable: false,
    });
  });

  test("lock and lockIfAvailable: a mutex this thread holds is a TypeError, whatever the timeout", () => {
    const m = new Atomics.Mutex();
    const token = Atomics.Mutex.lock(m);
    expect(() => Atomics.Mutex.lock(m)).toThrow(TypeError);
    for (const timeout of [0, 10, -1, -Infinity, NaN, Infinity]) {
      expect(() => Atomics.Mutex.lockIfAvailable(m, timeout)).toThrow(TypeError);
    }
    token.unlock();
    const again = Atomics.Mutex.lockIfAvailable(m, -Infinity);
    expect(again).not.toBeNull();
    again!.unlock();
    const infinite = Atomics.Mutex.lockIfAvailable(m, NaN);
    expect(infinite).not.toBeNull();
    infinite!.unlock();
  });

  test("lockIfAvailable needs a Number timeout, after the mutex and the token are checked", () => {
    const m = new Atomics.Mutex();
    expect(() => (Atomics.Mutex.lockIfAvailable as any)(m)).toThrow(TypeError);
    expect(() => Atomics.Mutex.lockIfAvailable(m, "0" as any)).toThrow(TypeError);
    expect(() => Atomics.Mutex.lockIfAvailable(m, { valueOf: () => 0 } as any)).toThrow(TypeError);
    expect(() => Atomics.Mutex.lockIfAvailable({} as any, 0)).toThrow(TypeError);
    expect(() => Atomics.Mutex.lockIfAvailable(m, 0, {} as any)).toThrow(TypeError);
    // The timeout is not touched when the mutex is wrong.
    let read = 0;
    const timeout = {
      get valueOf() {
        read++;
        return () => 0;
      },
    };
    expect(() => Atomics.Mutex.lockIfAvailable({} as any, timeout as any)).toThrow(TypeError);
    expect(read).toBe(0);
  });

  test("a mutex that another thread holds gives null after the timeout", async () => {
    const m = new Atomics.Mutex();
    const src = `
      self.onmessage = ({ data: { mutex, release } }) => {
        if (mutex) {
          self.token = Atomics.Mutex.lock(mutex);
          postMessage("locked");
        } else {
          self.token.unlock();
          postMessage("released");
        }
      };
    `;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const worker = new Worker(url);
    const next = () => new Promise<string>(resolve => (worker.onmessage = e => resolve(e.data)));
    let message = next();
    worker.postMessage({ mutex: m });
    expect(await message).toBe("locked");
    expect(Atomics.Mutex.lockIfAvailable(m, 0)).toBeNull();
    expect(Atomics.Mutex.lockIfAvailable(m, 20)).toBeNull();
    message = next();
    worker.postMessage({ release: true });
    expect(await message).toBe("released");
    const token = Atomics.Mutex.lockIfAvailable(m, 0);
    expect(token).not.toBeNull();
    token!.unlock();
    worker.terminate();
  });

  test("waitFor checks its arguments in the order of the proposal", () => {
    const m = new Atomics.Mutex();
    const c = new Atomics.Condition();
    using token = Atomics.Mutex.lock(m);
    expect(() => Atomics.Condition.waitFor({} as any, token, 10)).toThrow(TypeError);
    expect(() => Atomics.Condition.waitFor(c, {} as any, 10)).toThrow(TypeError);
    expect(() => Atomics.Condition.waitFor(c, new Atomics.Mutex.UnlockToken(), 10)).toThrow(TypeError);
    expect(() => (Atomics.Condition.waitFor as any)(c, token)).toThrow(TypeError);
    expect(() => Atomics.Condition.waitFor(c, token, "10" as any)).toThrow(TypeError);
    expect(() => Atomics.Condition.waitFor(c, token, 10, "no" as any)).toThrow(TypeError);
    expect(token.locked).toBe(true);
  });

  test("waitFor with no time left reports false and keeps the mutex", () => {
    const m = new Atomics.Mutex();
    const c = new Atomics.Condition();
    using token = Atomics.Mutex.lock(m);
    expect(Atomics.Condition.waitFor(c, token, 0)).toBe(false);
    expect(Atomics.Condition.waitFor(c, token, -Infinity)).toBe(false);
    let calls = 0;
    expect(Atomics.Condition.waitFor(c, token, 0, () => (calls++, false))).toBe(false);
    expect(calls).toBe(1);
    expect(Atomics.Condition.waitFor(c, token, 0, () => true)).toBe(true);
    expect(token.locked).toBe(true);
  });

  test("notify takes an integral Number or Infinity", () => {
    const c = new Atomics.Condition();
    expect(Atomics.Condition.notify(c)).toBe(0);
    expect(Atomics.Condition.notify(c, Infinity)).toBe(0);
    expect(Atomics.Condition.notify(c, 1)).toBe(0);
    expect(Atomics.Condition.notify(c, 0)).toBe(0);
    expect(Atomics.Condition.notify(c, -1)).toBe(0);
    for (const bad of ["1", 1.5, NaN, -Infinity, null, 1n, {}]) {
      expect(() => Atomics.Condition.notify(c, bad as any)).toThrow(TypeError);
    }
    expect(() => Atomics.Condition.notify({} as any)).toThrow(TypeError);
  });

  test("notify counts the waiters it wakes", async () => {
    const m = new Atomics.Mutex();
    const c = new Atomics.Condition();
    shared struct State {
      waiting;
    }
    const state = new State();
    state.waiting = 0;
    const src = `
      self.onmessage = ({ data: { state, m, c } }) => {
        const token = Atomics.Mutex.lock(m);
        state.waiting = state.waiting + 1;
        Atomics.Condition.wait(c, token);
        token.unlock();
        postMessage("woke");
      };
    `;
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const workers = Array.from({ length: 2 }, () => new Worker(url));
    const woke = workers.map(w => new Promise<void>(resolve => (w.onmessage = () => resolve())));
    for (const w of workers) w.postMessage({ state, m, c });
    while (state.waiting < 2) await Bun.sleep(1);
    // Both wait on c with m released; notifying one wakes exactly one, then the other.
    {
      using _token = Atomics.Mutex.lock(m);
      expect(Atomics.Condition.notify(c, 1)).toBe(1);
    }
    await Promise.race(woke);
    {
      using _token = Atomics.Mutex.lock(m);
      expect(Atomics.Condition.notify(c)).toBe(1);
    }
    await Promise.all(woke);
    for (const w of workers) w.terminate();
  });

  test("the static functions have the lengths of the proposal", () => {
    expect(Atomics.Mutex.lock.length).toBe(1);
    expect(Atomics.Mutex.lockIfAvailable.length).toBe(2);
    expect(Atomics.Condition.wait.length).toBe(2);
    expect(Atomics.Condition.waitFor.length).toBe(3);
    expect(Atomics.Condition.notify.length).toBe(1);
    expect(Atomics.Mutex.lock.name).toBe("lock");
    expect(Atomics.Condition.waitFor.name).toBe("waitFor");
  });

  test("[Symbol.dispose] releases without going through unlock", () => {
    const m = new Atomics.Mutex();
    const token = Atomics.Mutex.lock(m);
    (token as any).unlock = () => {
      throw new Error("patched");
    };
    expect(token[Symbol.dispose]()).toBeUndefined();
    expect(token.locked).toBe(false);
    const again = Atomics.Mutex.lock(m);
    again.unlock();
  });

  test("the token methods check their receiver", () => {
    const { unlock } = Atomics.Mutex.UnlockToken.prototype;
    const lockedGetter = Object.getOwnPropertyDescriptor(Atomics.Mutex.UnlockToken.prototype, "locked")!.get!;
    expect(() => unlock.call({})).toThrow(TypeError);
    expect(() => lockedGetter.call({})).toThrow(TypeError);
    expect(() => Atomics.Mutex.UnlockToken.prototype[Symbol.dispose].call(1)).toThrow(TypeError);
  });
});

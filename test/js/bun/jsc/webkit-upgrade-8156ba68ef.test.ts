import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import vm from "node:vm";

// Coverage for the WebKit 8156ba68ef sync. The first six cases, and the one about SharedArrayBuffer, pin an observable
// difference between the old and the new JavaScriptCore. The others pin what had to stay the same in code that the
// sync rewrote: the microtask dispatcher, the cache of proxy traps, a store through a proxy onto a property with a
// native setter, Object.freeze() and Object.seal() of arrays, the string cache of JSON.parse, calls with a spread
// argument, what `bun build --bytecode` makes of such a call, the fast paths of JSON.stringify, Float16 numbers in
// compiled code, and the hash tables behind sparse arrays, maps and sets.
// The sources that depend on how JavaScriptCore compiles run in a process of their own, so that Bun's transpiler and
// the other tests leave them alone.

describe.concurrent("WebKit 8156ba68ef upgrade", () => {
  // The default value of a parameter named a variable of a function two levels out, and the body declared the same
  // name. The name was looked for no further than the body (419e6e4204), so the call threw a ReferenceError.
  test("the default value of a parameter reads an outer variable that the body declares again", () => {
    const run = new Function(`
      function outer() {
        var x = "outer";
        function middle() {
          function inner(a = x) { var x = "body"; return a; }
          return inner();
        }
        return middle();
      }
      var y = "top";
      const throughArrows = (function () {
        return (function () {
          return ((a = () => y) => { var y = "body"; return a(); })();
        })();
      })();
      return [outer(), throughArrows];
    `);
    expect(run()).toEqual(["outer", "top"]);
  });

  // A typed array in the prototype chain decides a store to an index, whoever the receiver is, and ignores an index
  // that it does not have (890b90dce3). The receiver got an own property before.
  test("a store to an index that a typed array in the prototype chain does not have is ignored", () => {
    const object = Object.create(new Uint8Array(4));
    object[10] = 99;
    expect(Reflect.set(object, 11, 1)).toBe(true);
    (function (this: any) {
      "use strict";
      this[12] = 1;
    }).call(object);
    expect({ keys: Reflect.ownKeys(object), read: object[10] }).toEqual({ keys: [], read: undefined });

    // An index that the typed array has becomes a property of the receiver, as before.
    const prototype = new Uint8Array(4);
    const inside = Object.create(prototype);
    inside[1] = 7;
    expect({ keys: Reflect.ownKeys(inside), read: inside[1], ofPrototype: prototype[1] }).toEqual({
      keys: ["1"],
      read: 7,
      ofPrototype: 0,
    });
  });

  // new WebAssembly.Suspending(f) marks an import and is no function (a2bc1ad990). It was a function, and a call of
  // it from JavaScript threw a SuspendError.
  test("a WebAssembly.Suspending object is not callable", () => {
    const Suspending = (WebAssembly as any).Suspending;
    const marker = new Suspending(() => 1);
    expect(typeof marker).toBe("object");
    expect(marker instanceof Suspending).toBe(true);
    expect(() => marker()).toThrow(TypeError);
  });

  // The replacer's first result is kept while the other matches run. Its characters were read again at the end with
  // the width they had at the start (61b3aecb0c). A property write in between can swap them for an atom of the other
  // width. The result was then the 16-bit characters read as bytes.
  test("String.prototype.replace copies a kept replacement with the width it has at the end", () => {
    const flat8Bit = (content: string) => content.split("").join("");
    const flat16Bit = (content: string) => {
      const flat = String.fromCharCode(0x3042) + content;
      Symbol(flat);
      const wide = flat.slice(1);
      Symbol(wide);
      return wide;
    };
    const table: Record<string, number> = {};
    const filler = Buffer.alloc(2048, ".").toString();
    const run = (
      regExp: RegExp,
      name: string,
      makeAtom: (content: string) => string,
      makeReplacement: (content: string) => string,
    ) => {
      table[makeAtom(name)] = 1;
      const replacement = makeReplacement(name);
      let count = 0;
      const result = flat8Bit("x" + filler + "x" + filler + "x").replace(regExp, () => {
        if (++count === 1) return replacement;
        table[replacement] = 2;
        return String(count);
      });
      return { count, result: result === name + filler + "2" + filler + "3" };
    };
    const results = [/x/g, /(x)/g].flatMap((regExp, index) => [
      run(regExp, `property-name-${index}-a`, flat16Bit, flat8Bit),
      run(regExp, `property-name-${index}-b`, flat8Bit, flat16Bit),
    ]);
    expect(results).toEqual([
      { count: 3, result: true },
      { count: 3, result: true },
      { count: 3, result: true },
      { count: 3, result: true },
    ]);
  });

  // A registration whose target died is kept under its unregister token. The token's address stayed a key after the
  // token died (838aedbe79), so unregister() of a new object at that address matched and dropped the registrations.
  test("FinalizationRegistry.prototype.unregister does not match an object that was never a token", () => {
    const registry = new FinalizationRegistry(() => {});
    (function () {
      const token = {};
      (function () {
        for (let i = 0; i < 8; ++i) registry.register({}, "holdings-" + i, token);
      })();
      Bun.gc(true);
    })();
    Bun.gc(true);
    let matched = 0;
    for (let i = 0; i < 10000; ++i) if (registry.unregister({})) matched++;
    expect(matched).toBe(0);
  });

  // The DFG turns `o[k]` into `o.name` when it knows the value of `k`. It dropped the check that `k` still has that
  // value (c1c0965989), and with it the reason to leave the compiled code. The thresholds keep the function in the
  // DFG, as the test of JavaScriptCore does.
  test("the DFG keeps the check of the key when it turns o[k] into a named access", async () => {
    // The program is the one of JavaScriptCore's test, as the shape of its functions is what the compiler sees.
    const source = `
      const { noInline } = require("bun:jsc");
      const symbols = [Symbol("s0"), Symbol("s1"), Symbol("s2"), Symbol("s3")];

      const holderA = { k: symbols[0] };
      function readA(holder) { return holder.k; }
      function readA2(holder) { return holder.k; }
      noInline(readA2);
      function targetA(o, useOriginalShape, warmupOnly) {
        if (warmupOnly)
          return 0;
        let obj = { x: 1, b: 2 };
        let result = 0;
        for (let i = 0; i < 2; i++) {
          result = obj.b;
          if (useOriginalShape)
            obj = { x: 1, b: 2 };
          else {
            obj = { b: 3, x: 4 };
            o[readA(holderA)];
          }
        }
        return result;
      }
      noInline(targetA);
      const shapesA = [];
      for (let i = 0; i < 64; i++) {
        const shape = {};
        shape["u" + i] = i;
        shape.k = symbols[i % symbols.length];
        shapesA.push(shape);
      }
      for (let i = 0; i < 3000; i++)
        readA(shapesA[i % shapesA.length]);
      const receiverA = { a: 1 };
      for (let i = 0; i < 60; i++) {
        Reflect.set(holderA, "k", symbols[i % symbols.length]);
        targetA(receiverA, true, false);
        targetA(receiverA, false, false);
      }
      Reflect.set(holderA, "k", "foo");
      for (let i = 0; i < 3000; i++)
        readA2(holderA);
      for (let i = 0; i < 200000; i++)
        targetA(receiverA, true, true);
      const get = targetA(receiverA, false, false);

      const holderB = { m: symbols[0] };
      function readB(holder) { return holder.m; }
      function readB2(holder) { return holder.m; }
      noInline(readB2);
      function targetB(o, useOriginalShape, warmupOnly) {
        if (warmupOnly)
          return 0;
        let obj = { x: 1, b: 2 };
        let result = 0;
        for (let i = 0; i < 2; i++) {
          result = obj.b;
          if (useOriginalShape)
            obj = { x: 1, b: 2 };
          else {
            obj = { b: 3, x: 4 };
            (readB(holderB) in o);
          }
        }
        return result;
      }
      noInline(targetB);
      const shapesB = [];
      for (let i = 0; i < 64; i++) {
        const shape = {};
        shape["w" + i] = i;
        shape.m = symbols[i % symbols.length];
        shapesB.push(shape);
      }
      for (let i = 0; i < 3000; i++)
        readB(shapesB[i % shapesB.length]);
      const receiverB = { a: 1 };
      for (let i = 0; i < 60; i++) {
        Reflect.set(holderB, "m", symbols[i % symbols.length]);
        targetB(receiverB, true, false);
        targetB(shapesB[i % shapesB.length], false, false);
      }
      Reflect.set(holderB, "m", "foo");
      for (let i = 0; i < 3000; i++)
        readB2(holderB);
      for (let i = 0; i < 200000; i++)
        targetB(receiverB, true, true);
      const has = targetB(receiverB, false, false);

      console.log(JSON.stringify({ get, in: has }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: {
        ...bunEnv,
        BUN_JSC_useConcurrentJIT: "false",
        BUN_JSC_thresholdForJITAfterWarmUp: "20",
        BUN_JSC_thresholdForOptimizeAfterWarmUp: "20000",
        BUN_JSC_thresholdForOptimizeAfterLongWarmUp: "20000",
        BUN_JSC_thresholdForFTLOptimizeAfterWarmUp: "100000000",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // 3 is the value of `b` in the object that the second turn of the loop reads. 4 is the value of `x`, read through
    // the offset that `b` has in the other shape.
    expect(stdout).toBe('{"get":3,"in":3}\n');
    expect(exitCode).toBe(0);
  });

  // The dispatcher of internal microtasks is one function per job now (9fadb87996). Each job that runs user code
  // enters the async context that was current when it was queued.
  test("every promise job runs in the async context it was queued in", async () => {
    const storage = new AsyncLocalStorage<string>();
    const seen: Record<string, string | undefined> = {};
    const note = (name: string) => {
      seen[name] = storage.getStore();
    };
    const gates: PromiseWithResolvers<number>[] = [];
    const gate = () => {
      const created = Promise.withResolvers<number>();
      gates.push(created);
      return created.promise;
    };
    const pending: Promise<unknown>[] = [];
    class Subclass<T> extends Promise<T> {}

    storage.run("reaction", () => void pending.push(gate().then(() => note("then"))));
    storage.run("rejection", () => {
      pending.push(
        gate()
          .then(() => {
            throw new Error("rejected");
          })
          .catch(() => note("catch")),
      );
    });
    storage.run("finally", () => void pending.push(gate().finally(() => note("finally"))));
    storage.run("after finally", () => {
      pending.push(
        gate()
          .finally(() => {})
          .then(() => note("then after finally")),
      );
    });
    storage.run("await", () => {
      pending.push(
        (async () => {
          await gate();
          note("after await");
          await 0;
          note("after second await");
        })(),
      );
    });
    storage.run("thenable", () => {
      pending.push(
        (async () => {
          await {
            then(resolve: () => void) {
              note("then of an awaited thenable");
              resolve();
            },
          };
          note("after await of a thenable");
        })(),
      );
    });
    storage.run("resolved with a thenable", () => {
      pending.push(
        new Promise<void>(resolve =>
          resolve({
            then(settle: () => void) {
              note("then of a thenable a promise is resolved with");
              settle();
            },
          } as PromiseLike<void>),
        ).then(() => note("then after a thenable")),
      );
    });
    storage.run("resolved with a promise", () => {
      pending.push(new Promise(resolve => resolve(gate())).then(() => note("then after a promise")));
    });
    storage.run("subclass", () => {
      pending.push(Subclass.resolve(gate()).then(() => note("then of a subclass")));
      pending.push(
        (async () => {
          await new Subclass(resolve => gate().then(resolve));
          note("after await of a subclass");
        })(),
      );
    });
    storage.run("microtask", () => {
      pending.push(
        new Promise<void>(resolve =>
          queueMicrotask(() => {
            note("queueMicrotask");
            resolve();
          }),
        ),
      );
    });
    storage.run("combinators", () => {
      pending.push(Promise.all([gate(), gate()]).then(() => note("all")));
      pending.push(Promise.allSettled([gate()]).then(() => note("allSettled")));
      pending.push(Promise.any([gate()]).then(() => note("any")));
      pending.push(Promise.race([gate()]).then(() => note("race")));
    });
    storage.run("async generator", () => {
      async function* generator() {
        note("generator start");
        await gate();
        note("generator after await");
        yield 1;
        note("generator after yield");
        yield* [2];
        note("generator after yield*");
        return 3;
      }
      pending.push(
        (async () => {
          for await (const value of generator()) note("for await body " + value);
          note("after for await");
        })(),
      );
    });
    storage.run("async generator return", () => {
      async function* generator() {
        try {
          yield 1;
        } finally {
          note("generator finally");
          await 0;
          note("generator finally after await");
        }
      }
      pending.push(
        (async () => {
          const iterator = generator();
          await iterator.next();
          await iterator.return(gate());
          note("after return()");
        })(),
      );
    });
    storage.run("sync iterator", () => {
      const iterable = {
        [Symbol.iterator]() {
          let index = 0;
          return {
            next() {
              note("next of a sync iterator " + index);
              return index < 2 ? { value: gate(), done: false, index: index++ } : { value: undefined, done: true };
            },
          };
        },
      };
      pending.push(
        (async () => {
          for await (const _ of iterable) note("for await over a sync iterator");
          note("after for await over a sync iterator");
        })(),
      );
    });

    // Everything settles from here, outside of every run(). The generators and the iterator make more gates as they
    // go on, so this repeats, one turn of the event loop at a time, until every job is done.
    let settled = false;
    const all = Promise.all(pending).then(() => {
      settled = true;
    });
    while (!settled) {
      for (const { resolve } of gates.splice(0)) resolve(0);
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    await all;

    expect(seen).toEqual({
      "then": "reaction",
      "catch": "rejection",
      "finally": "finally",
      "then after finally": "after finally",
      "after await": "await",
      "after second await": "await",
      "then of an awaited thenable": "thenable",
      "after await of a thenable": "thenable",
      "then of a thenable a promise is resolved with": "resolved with a thenable",
      "then after a thenable": "resolved with a thenable",
      "then after a promise": "resolved with a promise",
      "then of a subclass": "subclass",
      "after await of a subclass": "subclass",
      "queueMicrotask": "microtask",
      "all": "combinators",
      "allSettled": "combinators",
      "any": "combinators",
      "race": "combinators",
      "generator start": "async generator",
      "generator after await": "async generator",
      "for await body 1": "async generator",
      "generator after yield": "async generator",
      "for await body 2": "async generator",
      "generator after yield*": "async generator",
      "after for await": "async generator",
      "generator finally": "async generator return",
      "generator finally after await": "async generator return",
      "after return()": "async generator return",
      "next of a sync iterator 0": "sync iterator",
      "next of a sync iterator 1": "sync iterator",
      "next of a sync iterator 2": "sync iterator",
      "for await over a sync iterator": "sync iterator",
      "after for await over a sync iterator": "sync iterator",
    });
    expect(storage.getStore()).toBeUndefined();
  });

  // A proxy remembers where each trap is in its handler (23777f3b79: all thirteen traps, one byte each). A handler
  // that changes has to be looked at again.
  test("a proxy sees a trap that is added, replaced, removed, inherited or read through a getter", () => {
    const operations: Record<string, (proxy: any) => unknown> = {
      get: proxy => proxy.a,
      set: proxy => ((proxy.a = 2), proxy.a),
      has: proxy => "a" in proxy,
      deleteProperty: proxy => delete proxy.missing,
      ownKeys: proxy => Reflect.ownKeys(proxy).includes("a"),
      getOwnPropertyDescriptor: proxy => Object.getOwnPropertyDescriptor(proxy, "a")!.enumerable,
      defineProperty: proxy => Reflect.defineProperty(proxy, "defined", { value: 1, configurable: true }),
      getPrototypeOf: proxy => Object.getPrototypeOf(proxy) !== null,
      setPrototypeOf: proxy => Reflect.setPrototypeOf(proxy, Object.getPrototypeOf(proxy)),
      isExtensible: proxy => Object.isExtensible(proxy),
      preventExtensions: proxy => Reflect.preventExtensions(proxy),
      apply: proxy => proxy(1, 2),
      construct: proxy => new proxy() instanceof Object,
    };
    const expected: Record<string, unknown> = {
      get: 1,
      set: 2,
      has: true,
      deleteProperty: true,
      ownKeys: true,
      getOwnPropertyDescriptor: true,
      defineProperty: true,
      getPrototypeOf: true,
      setPrototypeOf: true,
      isExtensible: true,
      preventExtensions: true,
      apply: 3,
      construct: true,
    };
    expect(Object.keys(operations)).toHaveLength(13);
    for (const [trap, operation] of Object.entries(operations)) {
      const makeTarget = () =>
        Object.assign(
          function (a: number, b: number) {
            return a + b;
          },
          { a: 1 },
        );
      const calls: string[] = [];
      const forward =
        (name: string) =>
        (...args: unknown[]) => {
          calls.push(name);
          return (Reflect as any)[trap](...args);
        };
      const handler: Record<string, unknown> = {};
      const proxy = new Proxy(makeTarget(), handler);
      const steps: Record<string, string> = {};
      const step = (name: string) => {
        let result: unknown;
        try {
          result = operation(proxy);
        } catch (error) {
          result = (error as Error).constructor.name;
        }
        // preventExtensions is the one operation whose first call changes the answer of the later ones.
        steps[name] =
          (result === expected[trap] || (trap === "isExtensible" && result === false) ? "ok" : String(result)) +
          ":" +
          calls.splice(0).join("+");
      };
      step("absent");
      step("absent again");
      handler[trap] = forward("first");
      step("added");
      step("added again");
      handler[trap] = forward("second");
      step("replaced");
      delete handler[trap];
      step("removed");
      Object.setPrototypeOf(handler, { [trap]: forward("inherited") });
      step("inherited");
      handler[trap] = undefined;
      step("own undefined");
      handler[trap] = null;
      step("own null");
      handler[trap] = 1;
      step("not callable");
      delete handler[trap];
      Object.setPrototypeOf(handler, Object.prototype);
      step("absent at the end");
      Object.defineProperty(handler, trap, {
        get() {
          calls.push("getter");
          return forward("from getter");
        },
        configurable: true,
      });
      step("getter");
      step("getter again");
      expect({ trap, steps }).toEqual({
        trap,
        steps: {
          "absent": "ok:",
          "absent again": "ok:",
          "added": "ok:first",
          "added again": "ok:first",
          "replaced": "ok:second",
          "removed": "ok:",
          "inherited": "ok:inherited",
          "own undefined": "ok:",
          "own null": "ok:",
          "not callable": "TypeError:",
          "absent at the end": "ok:",
          "getter": "ok:getter+from getter",
          "getter again": "ok:getter+from getter",
        },
      });

      // Handlers of other shapes keep the trap at other offsets.
      for (let padding = 0; padding < 3; padding++) {
        const padded: Record<string, unknown> = {};
        for (let i = 0; i < padding; i++) padded["padding" + i] = i;
        padded[trap] = forward("padded");
        expect({ trap, padding, result: operation(new Proxy(makeTarget(), padded)), calls: calls.splice(0) }).toEqual({
          trap,
          padding,
          result: expected[trap],
          calls: ["padded"],
        });
      }
    }

    // A handler that is a proxy is asked for the trap every time.
    const lookups: string[] = [];
    const asked = new Proxy({ a: 1 }, new Proxy({}, { get: (_, key) => void lookups.push(String(key)) }));
    expect([asked.a, asked.a, "a" in asked, Object.keys(asked), Object.isExtensible(asked)]).toEqual([
      1,
      1,
      true,
      ["a"],
      true,
    ]);
    expect(lookups).toEqual(["get", "get", "has", "ownKeys", "getOwnPropertyDescriptor", "isExtensible"]);
  });

  // A [[Set]] whose receiver is a proxy defines the property on the receiver. Without a defineProperty and a
  // getOwnPropertyDescriptor trap that is now done on the target directly (23777f3b79).
  test("Reflect.set with a proxy as receiver defines on it, through its traps when it has them", () => {
    const attempt = (run: () => unknown) => {
      try {
        return run();
      } catch (error) {
        return (error as Error).constructor.name;
      }
    };
    const data = (value: unknown) => ({ value, writable: true, enumerable: true, configurable: true });
    const receivers: Record<string, () => object> = {
      empty: () => ({}),
      writable: () => ({ k: 0 }),
      readOnly: () => Object.defineProperty({}, "k", { value: 0, writable: false, configurable: true }),
      accessor: () => Object.defineProperty({}, "k", { get: () => 0, set() {}, configurable: true }),
      nonExtensible: () => Object.preventExtensions({}),
      frozen: () => Object.freeze({ k: 0 }),
      array: () => [],
      nullPrototype: () => Object.create(null),
    };
    const results: Record<string, unknown> = {};
    for (const [name, make] of Object.entries(receivers)) {
      for (const traps of ["none", "defineProperty", "getOwnPropertyDescriptor", "both", "set"]) {
        const target = make();
        const calls: string[] = [];
        const handler: ProxyHandler<object> = {};
        if (traps === "defineProperty" || traps === "both")
          handler.defineProperty = (object, key, descriptor) => {
            calls.push("define " + Object.keys(descriptor).join());
            return Reflect.defineProperty(object, key, descriptor);
          };
        if (traps === "getOwnPropertyDescriptor" || traps === "both")
          handler.getOwnPropertyDescriptor = (object, key) => {
            calls.push("describe");
            return Reflect.getOwnPropertyDescriptor(object, key);
          };
        // The receiver's set trap is not part of a [[Set]] on another object.
        if (traps === "set") handler.set = () => (calls.push("set"), true);
        const result = attempt(() => Reflect.set({}, "k", 7, new Proxy(target, handler)));
        const own = Object.getOwnPropertyDescriptor(target, "k");
        results[`${name} ${traps}`] = [result, own && "value" in own ? own.value : own ? "accessor" : own, calls];
      }
    }
    // What each kind of handler is asked, given what its defineProperty trap is asked.
    const callsOf = (define: string[]) => ({
      none: [],
      defineProperty: define,
      getOwnPropertyDescriptor: ["describe"],
      both: ["describe", ...define],
      set: [],
    });
    const expectedResults: Record<string, unknown> = {};
    const expectCase = (name: string, result: unknown, own: unknown, define: string[]) => {
      for (const [traps, calls] of Object.entries(callsOf(define)))
        expectedResults[`${name} ${traps}`] = [result, own, calls];
    };
    const whole = ["define value,writable,enumerable,configurable"];
    expectCase("empty", true, 7, whole);
    // An existing data property only gets the value.
    expectCase("writable", true, 7, ["define value"]);
    expectCase("readOnly", false, 0, []);
    expectCase("accessor", false, "accessor", []);
    expectCase("nonExtensible", false, undefined, whole);
    expectCase("frozen", false, 0, []);
    expectCase("array", true, 7, whole);
    expectCase("nullPrototype", true, 7, whole);
    expect(results).toEqual(expectedResults);

    // A setter on the holder gets the proxy as `this`, and nothing is defined.
    const receiverTarget = {};
    const receiver = new Proxy(receiverTarget, {});
    let setterThis: unknown;
    const holder = {
      set k(_: number) {
        setterThis = this;
      },
    };
    expect(Reflect.set(holder, "k", 1, receiver)).toBe(true);
    expect(setterThis).toBe(receiver);
    expect(Object.getOwnPropertyDescriptor(receiverTarget, "k")).toBeUndefined();

    // A proxy on a proxy: the inner handler's trap is still called.
    const innerTarget: Record<string, unknown> = {};
    const innerCalls: PropertyKey[] = [];
    const nested = new Proxy(
      new Proxy(innerTarget, {
        defineProperty(object, key, descriptor) {
          innerCalls.push(key);
          return Reflect.defineProperty(object, key, descriptor);
        },
      }),
      {},
    );
    expect(Reflect.set({}, "n", 1, nested)).toBe(true);
    expect(innerCalls).toEqual(["n"]);
    expect(Object.getOwnPropertyDescriptor(innerTarget, "n")).toEqual(data(1));

    // A handler that gets a trap between two sets, and loses it again.
    const lateTarget: Record<string, unknown> = {};
    const lateHandler: ProxyHandler<object> = {};
    const late = new Proxy(lateTarget, lateHandler);
    const lateCalls: string[] = [];
    expect(Reflect.set({}, "a", 1, late)).toBe(true);
    lateHandler.defineProperty = (object, key, descriptor) => {
      lateCalls.push("define " + String(key));
      return Reflect.defineProperty(object, key, descriptor);
    };
    expect(Reflect.set({}, "b", 2, late)).toBe(true);
    delete lateHandler.defineProperty;
    lateHandler.getOwnPropertyDescriptor = (object, key) => {
      lateCalls.push("describe " + String(key));
      return Reflect.getOwnPropertyDescriptor(object, key);
    };
    expect(Reflect.set({}, "c", 3, late)).toBe(true);
    delete lateHandler.getOwnPropertyDescriptor;
    expect(Reflect.set({}, "d", 4, late)).toBe(true);
    expect(lateCalls).toEqual(["define b", "describe c"]);
    expect(lateTarget).toEqual({ a: 1, b: 2, c: 3, d: 4 });

    // An assignment through an object that inherits from a proxy without a set trap defines on that object.
    const child = Object.create(new Proxy({}, {}));
    child.x = 1;
    expect(Object.getOwnPropertyDescriptor(child, "x")).toEqual(data(1));

    const { proxy: revoked, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => Reflect.set({}, "k", 1, revoked)).toThrow(TypeError);
  });

  // A store through a proxy without a set trap ends in a definition on the target (23777f3b79), and a definition puts
  // a plain value in the place of a property that native code stands behind. Bun has such properties that a script sees
  // as data properties: Error.prepareStackTrace here, and onmessage, onerror and Module.prototype.require in the tests
  // of those. Bun's JavaScriptCore gives the value of the definition to the native setter, as it did with the store.
  // The proxy's handler is asked the same three things for every store.
  test("a store through a proxy reaches the native setter behind a data property", async () => {
    const source = `
      const formatter = who => error => who + " formats " + error.message;

      const asked = [];
      const handler = new Proxy({}, { get: (_, trap) => (asked.push(trap), undefined) });
      const proxy = new Proxy(Error, handler);
      const stores = [];
      for (const who of ["a", "b", "c"]) {
        asked.length = 0;
        proxy.prepareStackTrace = formatter(who);
        stores.push([asked.join(), new Error(who).stack]);
      }

      // The same store from one place in the code, often enough for that place to remember what it found.
      function store(proxy, value) {
        proxy.prepareStackTrace = value;
      }
      const plain = new Proxy(Error, {});
      const formatters = [formatter("x"), formatter("y"), formatter("z")];
      let notInstalled = 0;
      for (let i = 0; i < 3000; i++) {
        store(plain, formatters[i % 3]);
        if (Error.prepareStackTrace !== formatters[i % 3] || new Error(i).stack !== "xyz"[i % 3] + " formats " + i)
          notInstalled++;
      }

      let defined = 0;
      const forwarding = new Proxy(Error, {
        defineProperty: (target, key, descriptor) => (defined++, Reflect.defineProperty(target, key, descriptor)),
      });
      for (const who of ["d", "e"]) forwarding.prepareStackTrace = formatter(who);
      const forwarded = new Error("forwarded").stack;

      console.log(JSON.stringify({ stores, notInstalled, defined, forwarded }));
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", source], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: stdout && JSON.parse(stdout), stderr }).toEqual({
      stdout: {
        stores: [
          ["set,getOwnPropertyDescriptor,defineProperty", "a formats a"],
          ["set,getOwnPropertyDescriptor,defineProperty", "b formats b"],
          ["set,getOwnPropertyDescriptor,defineProperty", "c formats c"],
        ],
        notInstalled: 0,
        defined: 2,
        forwarded: "e formats forwarded",
      },
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // Object.freeze() and Object.seal() change the elements of an array in one step (7e80df541f), and
  // Object.isFrozen() and Object.isSealed() answer for an array without a walk over its elements.
  test("Object.freeze and Object.seal of arrays and of objects with indexed properties", () => {
    const describe = (object: object, key: PropertyKey) => {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      return descriptor ? `${+!!descriptor.writable}${+!!descriptor.enumerable}${+!!descriptor.configurable}` : "none";
    };
    const report = (object: any) => {
      "use strict";
      let written: unknown;
      try {
        object[0] = 99;
        written = object[0];
      } catch (error) {
        written = (error as Error).constructor.name;
      }
      return [
        Object.isFrozen(object),
        Object.isSealed(object),
        Object.isExtensible(object),
        describe(object, 0),
        describe(object, "length"),
        written,
      ];
    };
    class Subclass extends Array {}
    const named: any = [1, 2];
    named.name = 1;
    const sealedThenFrozen = Object.seal([1, 2]);
    Object.freeze(sealedThenFrozen);
    const frozenThenSealed = Object.freeze([1, 2]);
    Object.seal(frozenThenSealed);
    expect({
      plain: report([1, 2, 3]),
      frozen: report(Object.freeze([1, 2, 3])),
      frozenDoubles: report(Object.freeze([1.5, 2.5])),
      frozenObjects: report(Object.freeze(["a", {}])),
      frozenEmpty: report(Object.freeze([])),
      frozenHoley: report(Object.freeze([1, , 3])),
      sealed: report(Object.seal([1, 2, 3])),
      sealedHoley: report(Object.seal([1, , 3])),
      nonExtensible: report(Object.preventExtensions([1, 2, 3])),
      frozenObject: report(Object.freeze({ 0: 1, 1: 2, a: 3 })),
      sealedObject: report(Object.seal({ 0: 1, a: 3 })),
      sealedThenFrozen: report(sealedThenFrozen),
      frozenThenSealed: report(frozenThenSealed),
      frozenSubclass: report(Object.freeze(Subclass.from([1, 2]))),
      frozenNamed: [...report(Object.freeze(named)), describe(named, "name")],
    }).toEqual({
      plain: [false, false, true, "111", "100", 99],
      frozen: [true, true, false, "010", "000", "TypeError"],
      frozenDoubles: [true, true, false, "010", "000", "TypeError"],
      frozenObjects: [true, true, false, "010", "000", "TypeError"],
      frozenEmpty: [true, true, false, "none", "000", "TypeError"],
      frozenHoley: [true, true, false, "010", "000", "TypeError"],
      sealed: [false, true, false, "110", "100", 99],
      sealedHoley: [false, true, false, "110", "100", 99],
      nonExtensible: [false, false, false, "111", "100", 99],
      frozenObject: [true, true, false, "010", "none", "TypeError"],
      sealedObject: [false, true, false, "110", "none", 99],
      sealedThenFrozen: [true, true, false, "010", "000", "TypeError"],
      frozenThenSealed: [true, true, false, "010", "000", "TypeError"],
      frozenSubclass: [true, true, false, "010", "000", "TypeError"],
      frozenNamed: [true, true, false, "010", "000", "TypeError", "010"],
    });

    // A frozen array is still read by everything, and refuses every change.
    const frozen = Object.freeze([1, 2, 3]);
    expect([[...frozen], frozen.map(value => value * 2), frozen.slice(1), Math.max(...frozen)]).toEqual([
      [1, 2, 3],
      [2, 4, 6],
      [2, 3],
      3,
    ]);
    expect(JSON.stringify(frozen)).toBe("[1,2,3]");
    expect(() => (frozen as number[]).push(4)).toThrow(TypeError);
    expect(() => (frozen as number[]).pop()).toThrow(TypeError);
    expect(() => ((frozen as number[]).length = 0)).toThrow(TypeError);
    expect(() => Object.defineProperty(frozen, 0, { value: 9 })).toThrow(TypeError);
    expect(frozen).toEqual([1, 2, 3]);
    // The holes of a sealed array cannot be filled, and its elements cannot be deleted.
    const sealed = Object.seal([1, , 3]);
    expect(Reflect.defineProperty(sealed, 1, { value: 2 })).toBe(false);
    expect(Reflect.deleteProperty(sealed, 0)).toBe(false);
    expect(1 in sealed).toBe(false);
    // A typed array with elements can be neither frozen nor sealed: its elements stay configurable.
    expect(() => Object.freeze(new Uint8Array(1))).toThrow(TypeError);
    expect(() => Object.seal(new Uint8Array(1))).toThrow(TypeError);
    expect(Object.isFrozen(Object.freeze(new Uint8Array(0)))).toBe(true);
    expect(Object.isSealed(Object.seal(new Uint8Array(0)))).toBe(true);
  });

  // JSON.parse keeps the string values it has made and gives a repeated one again. Values of 17 to 256 characters
  // are new in that cache (609fc1ce23), and are found by the bytes of the source text.
  test("JSON.parse does not mix up repeated string values", () => {
    const results: Record<string, boolean> = {};
    for (const wide of [false, true]) {
      const mark = wide ? "\u3042" : "";
      for (const length of [1, 2, 15, 16, 17, 18, 31, 32, 33, 64, 65, 128, 255, 256, 257, 300]) {
        const base =
          ("https://example.com/a/long/prefix/" + Buffer.alloc(300, "x").toString()).slice(0, length - mark.length) +
          mark;
        const lastDiffers = base.slice(0, -1) + (base.at(-1) === "y" ? "z" : "y");
        const firstDiffers = (base[0] === "q" ? "r" : "q") + base.slice(1);
        const value = [
          base,
          base,
          lastDiffers,
          base,
          firstDiffers,
          lastDiffers,
          { k: base, [base]: lastDiffers },
          [base, [base]],
        ];
        const text = JSON.stringify(value);
        // Twice: the second parse finds what the first one put in the cache.
        results[`${wide ? "16-bit" : "8-bit"} ${length}`] =
          Bun.deepEquals(JSON.parse(text), value, true) && Bun.deepEquals(JSON.parse(text), value, true);
      }
    }
    expect(Object.entries(results).filter(([, same]) => !same)).toEqual([]);
    expect(Object.keys(results)).toHaveLength(32);

    // A value with an escape is not the text between its quotes.
    const plain = "abcdefghijklmnopqrstuvwxyz";
    expect(
      JSON.parse(
        `["${plain}","abcdefghijklmnopqrstuvwx\\u0079z","abcdefghijklmnopqrstuvwx\\"yz","${plain}","abcdefghijklmnopqrstuvwx\\u0079z","abcdefghijklmnopqrstuvwx\\\\u0079z"]`,
      ),
    ).toEqual([plain, plain, 'abcdefghijklmnopqrstuvwx"yz', plain, plain, "abcdefghijklmnopqrstuvwx\\u0079z"]);
    expect(
      JSON.parse(
        '["line one of a long enough string\\nline two","line one of a long enough string\\nline two","line one of a long enough string\\\\nline two"]',
      ),
    ).toEqual([
      "line one of a long enough string\nline two",
      "line one of a long enough string\nline two",
      "line one of a long enough string\\nline two",
    ]);
  });

  // JSON.parse fills the storage of a new array itself (5eb574b25c).
  test("JSON.parse makes arrays of every kind of element", () => {
    const values: unknown[][] = [
      [],
      [1],
      [1, 2, 3],
      [1.5, 2.5],
      [1, 2.5],
      ["a", 1],
      [1, "a"],
      [null, 1],
      [true, false],
      [{}, []],
      [[1, [2, [3, [4]]]]],
      Array.from({ length: 100 }, (_, i) => i),
      Array.from({ length: 100 }, (_, i) => i + 0.5),
      Array.from({ length: 100 }, (_, i) => (i === 99 ? "s" : i)),
      Array.from({ length: 1000 }, (_, i) => ({ i })),
      [1e21, 0, 2147483647, 2147483648, -2147483648, -2147483649, 9007199254740993],
    ];
    for (const value of values) {
      const text = JSON.stringify(value);
      const parsed = JSON.parse(text);
      expect(parsed).toEqual(value);
      expect(JSON.parse(text.replaceAll(",", " ,\n\t ").replaceAll("[", "[ ").replaceAll("]", " ]"))).toEqual(value);
      // The array is an ordinary one: it grows.
      expect(Object.isExtensible(parsed)).toBe(true);
      expect(parsed.push("more")).toBe(value.length + 1);
      expect(parsed.at(-1)).toBe("more");
    }
    expect(Object.is(JSON.parse("[0, -0, -0.0]")[1], -0)).toBe(true);
    expect(Object.is(JSON.parse("[0, -0, -0.0]")[2], -0)).toBe(true);
    for (const text of ["[", "[1", "[1,", "[1,]", "[,1]", "[1 2]", "[1,,2]", '["a" "b"]', "[1]]", "[[1]"])
      expect(() => JSON.parse(text)).toThrow(SyntaxError);

    // An element is defined on the array. A setter on Array.prototype is not called. In a realm of its own, because
    // an indexed accessor on Array.prototype changes how every array of its realm is stored from then on.
    expect(
      vm.runInNewContext(`
        let setterCalls = 0;
        Object.defineProperty(Array.prototype, 3, { set() { setterCalls++; }, configurable: true });
        const parsed = JSON.parse("[1,2,3,4,5]");
        JSON.stringify({ parsed, own: Object.hasOwn(parsed, 3), setterCalls });
      `),
    ).toBe('{"parsed":[1,2,3,4,5],"own":true,"setterCalls":0}');
    expect(JSON.parse('[1,[2,3],{"a":[4]}]', (_, value) => (typeof value === "number" ? value * 2 : value))).toEqual([
      2,
      [4, 6],
      { a: [8] },
    ]);
  });

  // Bun.JSONL reads UTF-8 with the parser and the string cache of JSON.parse. The bytes of a UTF-8 text are not the
  // characters of the string, so a cached string is only taken for them when its text is ASCII.
  test("Bun.JSONL and JSON.parse do not take each other's strings for the same bytes", () => {
    const encoder = new TextEncoder();
    // 24 Latin-1 characters whose bytes are the UTF-8 text of twelve "é".
    const latin1Twin = Buffer.alloc(24, "\u00c3\u00a9", "latin1").toString("latin1");
    const utf8Text = Buffer.alloc(24, "\u00e9", "utf8").toString("utf8");
    expect(latin1Twin).toHaveLength(24);
    expect(utf8Text).toHaveLength(12);
    const fromJSON = () => JSON.parse(JSON.stringify([latin1Twin, latin1Twin]));
    const fromJSONL = () => Bun.JSONL.parse(encoder.encode(JSON.stringify([utf8Text, utf8Text]) + "\n"))[0];
    for (const order of [
      [fromJSON, fromJSONL, fromJSON],
      [fromJSONL, fromJSON, fromJSONL],
    ]) {
      for (const parse of order)
        expect(parse()).toEqual(parse === fromJSON ? [latin1Twin, latin1Twin] : [utf8Text, utf8Text]);
    }

    const units = {
      ascii: ["a", "b"],
      latin1: ["\u00e9", "\u00e8"],
      wide: ["\u3042", "\u3043"],
      astral: ["\u{1F600}", "\u{1F601}"],
    };
    const failures: string[] = [];
    for (const length of [1, 8, 16, 17, 24, 64, 256, 257]) {
      for (const [content, [unit, otherUnit]] of Object.entries(units)) {
        const count = Math.max(1, Math.floor(length / unit.length));
        const repeated = Array.from({ length: count }, () => unit).join("");
        const other = repeated.slice(0, -unit.length) + otherUnit;
        const value = { a: repeated, b: repeated, c: other, d: [repeated, other, repeated] };
        const line = JSON.stringify(value);
        const text = line + "\n" + line + "\n";
        const same =
          Bun.deepEquals(Bun.JSONL.parse(encoder.encode(text)), [value, value], true) &&
          Bun.deepEquals(Bun.JSONL.parse(text), [value, value], true) &&
          Bun.deepEquals(JSON.parse(line), value, true);
        if (!same) failures.push(`${content} ${length}`);
      }
    }
    expect(failures).toEqual([]);
  });

  // `f(a, ...b, c)` is one instruction that builds the callee's frame from the operands (c3b920b487). It made an
  // array of the arguments first. In a process of its own: the program replaces Array.prototype[Symbol.iterator].
  test("a call with a spread argument among other arguments", async () => {
    const source = `
      "use strict";
      const results = {};
      function collect() { return Array.prototype.slice.call(arguments).join(); }
      function sum() { let total = 0; for (let i = 0; i < arguments.length; i++) total += arguments[i]; return total; }
      function thisAndCount() { return (this === undefined ? "undefined" : this.tag) + ":" + arguments.length; }
      const holder = { tag: "holder", method: thisAndCount, collect };
      const shapes = {
        middle: (a, b, c) => collect(a, ...b, c),
        leading: (a, b, c) => collect(...b, a, c),
        two: (a, b, c) => collect(...b, a, ...b, c),
        trailing: (a, b) => collect(a, ...b),
        method: (a, b, c) => holder.method(a, ...b, c),
        computed: (a, b, c) => holder["col" + "lect"](a, ...b, c),
        nested: (a, b, c) => collect(a, ...[c, ...b, a], c),
        optional: (a, b, c) => holder.method?.(a, ...b, c),
      };
      const inputs = {
        int32: [1, 2, 3],
        double: [1.5, 2.5],
        contiguous: ["x", "y"],
        empty: [],
        holey: [1, , 3],
        long: Array.from({ length: 60 }, (_, i) => i),
        args: (function () { return arguments; })(7, 8),
        set: new Set([4, 5]),
        string: "ab",
        typed: new Uint8Array([9, 8]),
        generator: () => (function* () { yield 1; yield 2; })(),
        subclass: new (class extends Array {})(2).fill(6),
        iterator: { [Symbol.iterator]() { let i = 0; return { next: () => (i < 2 ? { value: "c" + i++, done: false } : { done: true }) }; } },
        frozen: Object.freeze([1, 2]),
        sparse: (() => { const a = [1, 2]; a[1000] = 3; a.length = 3; return a; })(),
        getter: Object.defineProperty([1, 2, 3], 1, { get() { return "g"; } }),
      };
      for (const [shapeName, shape] of Object.entries(shapes)) {
        results[shapeName] = {};
        for (const [inputName, input] of Object.entries(inputs)) {
          // Enough calls with a plain array for the optimizing compiler to take the function.
          const iterations = inputName === "int32" ? 1500 : 40;
          for (let i = 0; i < iterations; i++)
            results[shapeName][inputName] = shape("A", typeof input === "function" ? input() : input, "C");
        }
      }
      // What is not iterable throws where it is spread, before the arguments behind it are evaluated.
      const order = [];
      const note = (name, value) => { order.push(name); return value; };
      for (const bad of [undefined, null, 1, {}, { [Symbol.iterator]: 1 }, { [Symbol.iterator]() { return { next() { throw new RangeError("next"); } }; } }]) {
        try { collect(note("first", 1), ...note("spread", bad), note("last", 3)); order.push("no error"); } catch (error) { order.push(error.constructor.name); }
      }
      results.order = order;
      // An array that changes while the arguments behind it are evaluated is spread as it was.
      const changing = [1, 2, 3];
      results.changing = collect(0, ...changing, (changing.push(4), 5), ...changing);
      // More arguments than a frame can hold.
      const many = new Array(200000).fill(0);
      try { results.many = sum(1, ...many, 2); } catch (error) { results.many = error.constructor.name; }
      try { results.tooMany = sum(1, ...many, ...many, ...many, ...many, ...many, ...many, ...many, ...many, 2); } catch (error) { results.tooMany = error.constructor.name; }
      // new and super() keep their own instructions.
      class Base { constructor(...args) { this.args = args.join(); } }
      class Derived extends Base { constructor(a, b, c) { super(a, ...b, c); } }
      results.construct = [new Base(1, ...[2, 3], 4).args, new Derived(1, [2, 3], 4).args];
      // A call in tail position.
      function tail(a, b, c) { return collect(a, ...b, c); }
      for (let i = 0; i < 1500; i++) results.tail = tail(1, [2, 3], 4);
      // The next() of array iterators replaced, then Array.prototype[Symbol.iterator] replaced, and both restored.
      const arrayIteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]());
      const originalNext = arrayIteratorPrototype.next;
      let nextCalls = 0;
      arrayIteratorPrototype.next = function () { nextCalls++; return originalNext.call(this); };
      results.replacedNext = [shapes.middle("A", [1, 2], "C"), nextCalls];
      arrayIteratorPrototype.next = originalNext;
      const originalIterator = Array.prototype[Symbol.iterator];
      Array.prototype[Symbol.iterator] = function* () { yield "replaced"; };
      results.replacedIterator = shapes.middle("A", [1, 2], "C");
      Array.prototype[Symbol.iterator] = originalIterator;
      results.restored = shapes.middle("A", [1, 2], "C");
      console.log(JSON.stringify(results));
    `;
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", source], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");

    // What each input spreads to, as collect() joins it: a hole is undefined, which join() writes as nothing.
    const spreads: Record<string, string[]> = {
      int32: ["1", "2", "3"],
      double: ["1.5", "2.5"],
      contiguous: ["x", "y"],
      empty: [],
      holey: ["1", "", "3"],
      long: Array.from({ length: 60 }, (_, i) => String(i)),
      args: ["7", "8"],
      set: ["4", "5"],
      string: ["a", "b"],
      typed: ["9", "8"],
      generator: ["1", "2"],
      subclass: ["6", "6"],
      iterator: ["c0", "c1"],
      frozen: ["1", "2"],
      sparse: ["1", "2", ""],
      getter: ["1", "g", "3"],
    };
    const forEveryInput = (format: (spread: string[]) => string) =>
      Object.fromEntries(Object.entries(spreads).map(([name, spread]) => [name, format(spread)]));
    expect(JSON.parse(stdout)).toEqual({
      middle: forEveryInput(spread => ["A", ...spread, "C"].join()),
      leading: forEveryInput(spread => [...spread, "A", "C"].join()),
      // A generator is done after the first time it is spread.
      two: { ...forEveryInput(spread => [...spread, "A", ...spread, "C"].join()), generator: "1,2,A,C" },
      trailing: forEveryInput(spread => ["A", ...spread].join()),
      method: forEveryInput(spread => `holder:${spread.length + 2}`),
      computed: forEveryInput(spread => ["A", ...spread, "C"].join()),
      nested: forEveryInput(spread => ["A", "C", ...spread, "A", "C"].join()),
      optional: forEveryInput(spread => `holder:${spread.length + 2}`),
      order: [
        ...["first", "spread", "TypeError"],
        ...["first", "spread", "TypeError"],
        ...["first", "spread", "TypeError"],
        ...["first", "spread", "TypeError"],
        ...["first", "spread", "TypeError"],
        ...["first", "spread", "RangeError"],
      ],
      changing: "0,1,2,3,5,1,2,3,4",
      many: 3,
      tooMany: "RangeError",
      construct: ["1,2,3,4", "1,2,3,4"],
      tail: "1,2,3,4",
      replacedNext: ["A,1,2,C", 3],
      replacedIterator: "A,replaced,C",
      restored: "A,1,2,C",
    });
    expect(exitCode).toBe(0);
  });

  // `bun build --bytecode` runs JavaScriptCore's bytecode optimizer, which has to know that the new instruction builds
  // the callee's frame over the registers behind its operands. A value that was live across the call was read back
  // from an argument of the callee.
  test("bun build --bytecode keeps a value that is live across a call with a spread argument", async () => {
    using dir = tempDir("webkit-upgrade-bytecode-spread", {
      "entry.js": `
        function count() { return arguments.length; }
        function first(t) { return t; }
        function readsAfterCall(object, callee, args, start, number) {
          switch (start) {
            case 0:
              let x;
            case 1: {
              const r = callee(1, ...args, number + (number + (x = object.p)));
              return x;
            }
          }
        }
        function passesOnAfterCall(object, callee, args, next) {
          const t = object.b;
          callee(1, ...args);
          return next(t, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
        }
        const results = [];
        for (let n = 0; n < 8; n++) {
          const args = [];
          for (let i = 0; i < n; i++) args.push(7000 + i);
          results.push(readsAfterCall({ p: 1000 }, count, args, 0, 7), passesOnAfterCall({ b: 1000 }, count, args, first));
        }
        console.log(JSON.stringify(results));
      `,
    });
    const run = async (...cmd: string[]) => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), ...cmd],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const expected = JSON.stringify(Array.from({ length: 16 }, () => 1000)) + "\n";
    expect(await run("entry.js")).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
    const built = await run("build", "--bytecode", "--target=bun", "--outdir", "out", "entry.js");
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(await Bun.file(path.join(String(dir), "out", "entry.js.jsc")).exists()).toBe(true);
    expect(await run(path.join("out", "entry.js"))).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
  });

  // Options::useSharedArrayBuffer is Options::alwaysUseSharedArrayBuffer now (9e3f76240a), so the name of the
  // environment variable changed with it.
  test("BUN_JSC_alwaysUseSharedArrayBuffer=0 takes SharedArrayBuffer away", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log(typeof SharedArrayBuffer)"],
      env: { ...bunEnv, BUN_JSC_alwaysUseSharedArrayBuffer: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ stdout, exitCode }).toEqual({ stdout: "undefined\n", exitCode: 0 });
    expect(typeof SharedArrayBuffer).toBe("function");
  });
});

// These keep the thread for a while in a debug build, so they run one at a time, after the tests above.
describe("WebKit 8156ba68ef upgrade, in loops", () => {
  // JSON.stringify keeps the keys of the structures it has written and copies them for the next object of the same
  // structure (aeca1a989f). That code is new beside Bun's own fast paths. A replacer function takes the general path,
  // which must write the same text.
  test("JSON.stringify writes lists of objects of one shape as the general path does", () => {
    let seed = 20261108;
    const random = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    const pick = <T>(list: T[]): T => list[(random() * list.length) | 0];
    const names = ["id", "name", "value", "x", "y", "kind", "flag", "list", "k9", "aLongerNameOfAProperty", 'q"uote'];
    const strings = [
      "",
      "a",
      "plain",
      'with "quotes"',
      "line\nbreak",
      "caf\u00e9",
      "\u4e2d\u6587",
      "\ud800",
      "y".repeat(300),
    ];
    const leaf = () =>
      pick<() => unknown>([
        () => (random() * 2000 - 1000) | 0,
        () => random() * 1e6,
        () => pick([NaN, -0, 1e21, 1e-7, 2147483648]),
        () => random() < 0.5,
        () => null,
        () => undefined,
        () => pick(strings),
        () => "s" + ((random() * 100) | 0),
      ])();
    const shape = (count: number) => {
      const keys: string[] = [];
      while (keys.length < count) {
        const key = pick(names);
        if (!keys.includes(key)) keys.push(key);
      }
      return keys;
    };
    const objectOf = (keys: string[], depth: number) => {
      const object: Record<string, unknown> = {};
      for (const key of keys) object[key] = depth > 0 && random() < 0.15 ? listOf(depth - 1, 6) : leaf();
      return object;
    };
    const listOf = (depth: number, longest: number): unknown[] => {
      const shapes = [shape(1 + ((random() * 7) | 0)), shape((random() * 4) | 0)];
      const list: unknown[] = [];
      const length = (random() * longest) | 0;
      for (let i = 0; i < length; i++)
        list.push(random() < 0.85 ? objectOf(shapes[0], depth) : objectOf(shapes[1], depth));
      return list;
    };
    const identity = (_key: string, value: unknown) => value;
    let longest = 0;
    for (let round = 0; round < 16; round++) {
      // Every eighth list outgrows the buffer on the stack.
      const value = listOf(2, round % 8 === 7 ? 150 : 8);
      const gap = pick([undefined, undefined, 2, "\t"]);
      const text = JSON.stringify(value, null, gap);
      expect(text).toBe(JSON.stringify(value, identity, gap));
      longest = Math.max(longest, text.length);
    }
    expect(longest).toBeGreaterThan(8192);

    // A member that is undefined is left out, also when it is the first and when it is the only one.
    const members = [
      { a: 1, b: 2 },
      { a: undefined, b: 3 },
      { a: 4, b: undefined },
      { a: undefined, b: undefined },
    ];
    expect(JSON.stringify(members)).toBe('[{"a":1,"b":2},{"b":3},{"a":4},{}]');
    expect(JSON.stringify(members, null, 1)).toBe(
      '[\n {\n  "a": 1,\n  "b": 2\n },\n {\n  "b": 3\n },\n {\n  "a": 4\n },\n {}\n]',
    );

    // Two results of 8-bit characters that are longer than 128 KB, then one with a 16-bit character near its end, then
    // 8-bit again.
    const rows = Array.from({ length: 3000 }, (_, i) => ({ id: i, name: "row" + i, tags: ["a", "b"] }));
    const row = (i: number, name: string) => `{"id":${i},"name":"${name}","tags":["a","b"]}`;
    const plain = JSON.stringify(rows);
    expect(plain.length).toBeGreaterThan(128 * 1024);
    expect(plain.startsWith("[" + row(0, "row0") + "," + row(1, "row1") + ",")).toBe(true);
    expect(plain.endsWith("," + row(2999, "row2999") + "]")).toBe(true);
    expect(JSON.stringify(rows) === plain).toBe(true);
    rows[2990].name = "\u4e2d\u6587";
    const wide = JSON.stringify(rows);
    expect(wide.length).toBe(plain.length - "row2990".length + 2);
    expect(wide.slice(wide.indexOf(row(2989, "row2989")))).toBe(
      Array.from({ length: 11 }, (_, i) => row(2989 + i, i === 1 ? "\u4e2d\u6587" : "row" + (2989 + i))).join(",") +
        "]",
    );
    rows[2990].name = "row2990";
    expect(JSON.stringify(rows) === plain).toBe(true);
  });

  // x86-64 converts Float16 numbers with F16C instructions now (60af4b364c), where the CPU has them. The loops run
  // often enough for the optimizing compilers.
  test("Float16Array and DataView round to the nearest Float16 in compiled code", () => {
    const values = [
      0,
      -0,
      1.5,
      0.1,
      -0.1,
      65504,
      65519.99,
      65520,
      -65520,
      5.960464477539063e-8,
      2.980232238769531e-8,
      1e-10,
      NaN,
      Infinity,
    ];
    const store = new Function(
      "array",
      "values",
      `
      for (let i = 0; i < values.length; i++) array[i] = values[i];
      let sum = 0;
      for (let i = 0; i < values.length; i++) sum += array[i] === array[i] ? 1 : 0;
      return sum;
    `,
    );
    const view = new Function(
      "data",
      "values",
      `
      for (let i = 0; i < values.length; i++) data.setFloat16(i * 2, values[i], true);
      let same = 0;
      for (let i = 0; i < values.length; i++) same += Object.is(data.getFloat16(i * 2, true), Math.f16round(values[i])) ? 1 : 0;
      return same;
    `,
    );
    const array = new Float16Array(values.length);
    const data = new DataView(new ArrayBuffer(values.length * 2));
    for (let i = 0; i < 6000; i++) {
      store(array, values);
      view(data, values);
    }
    expect(store(array, values)).toBe(values.length - 1);
    expect(view(data, values)).toBe(values.length);
    expect(Array.from(array)).toEqual(values.map(value => Math.f16round(value)));
    expect(Array.from(array).slice(0, 11)).toEqual([
      0,
      -0,
      1.5,
      0.0999755859375,
      -0.0999755859375,
      65504,
      65504,
      Infinity,
      -Infinity,
      5.960464477539063e-8,
      0,
    ]);
  });

  // WTF::HashTable keeps a status byte for each slot and no empty or deleted values in the slots (53bedf6450).
  // Bun's engine grows such a table in its own way where memory may run out, and reads the table of a sparse array
  // without a call in compiled programs.
  test("sparse arrays, maps, sets and weak maps keep their members through growth and deletes", () => {
    const sparse: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < 600; i++) {
      const index = 100000 + i * 7919;
      sparse[index] = i;
      indices.push(index);
    }
    for (let i = 0; i < indices.length; i += 3) delete sparse[indices[i]];
    for (let i = 0; i < 100; i++) sparse[4000000000 + i] = -i;
    let sum = 0;
    for (let i = 0; i < indices.length; i++)
      sum += i % 3 ? (sparse[indices[i]] === i ? 1 : 0) : sparse[indices[i]] === undefined ? 1 : 0;
    expect(sum).toBe(indices.length);
    expect(Object.keys(sparse).length).toBe(400 + 100);
    expect(sparse[4000000099]).toBe(-99);
    expect(sparse[99999]).toBeUndefined();

    const map = new Map<unknown, number>();
    const set = new Set<unknown>();
    const weak = new WeakMap<object, number>();
    const keys: object[] = [];
    const count = 1000;
    for (let i = 0; i < count; i++) {
      const key = { i };
      keys.push(key);
      map.set("k" + i, i);
      map.set(i + 0.5, i);
      set.add(key);
      weak.set(key, i);
    }
    for (let i = 0; i < count; i += 2) {
      map.delete("k" + i);
      set.delete(keys[i]);
      weak.delete(keys[i]);
    }
    Bun.gc(true);
    expect([map.size, set.size]).toEqual([count * 1.5, count / 2]);
    let found = 0;
    for (let i = 1; i < count; i += 2)
      found += map.get("k" + i) === i && set.has(keys[i]) && weak.get(keys[i]) === i ? 1 : 0;
    for (let i = 0; i < count; i += 2) found += !map.has("k" + i) && !set.has(keys[i]) && !weak.has(keys[i]) ? 1 : 0;
    expect(found).toBe(count);

    // Property names go through the table of atoms, symbols through the registry.
    const names: Record<string, number> = {};
    for (let i = 0; i < 3000; i++) names["name" + i] = i;
    expect(names.name2999 + Object.keys(names).length).toBe(5999);
    expect(Symbol.for("webkit-upgrade-8156ba68ef")).toBe(Symbol.for("webkit-upgrade-" + "8156ba68ef"));
  });
});

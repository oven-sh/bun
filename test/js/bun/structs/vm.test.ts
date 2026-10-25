import { describe, expect, test } from "bun:test";
import vm from "node:vm";

// The structs surface in `node:vm` contexts. Raw vm scripts go to JavaScriptCore without passing through Bun's
// transpiler, so `struct` syntax is only available to a script that was transpiled first; the helper it calls,
// `__structBase`, is handed to the context as a global.
const wrap = await import("bun:wrap");
const transpiler = new Bun.Transpiler({ loader: "js" });

/** Transpiles `source` (which may use struct syntax), then runs it in a new context with `sandbox` plus the runtime helpers. */
function runStructsInNewContext(source: string, sandbox: Record<string, unknown> = {}) {
  const helpers: Record<string, unknown> = { __structBase: wrap.__structBase };
  const code = transpiler.transformSync(source).replace(/import\s*\{([^}]*)\}\s*from\s*["']bun:wrap["'];?/g, (_, names) => {
    for (const part of names.split(",")) {
      const [name, alias = name] = part.trim().split(/\s+as\s+/);
      if (name) helpers[alias] = (wrap as Record<string, unknown>)[name];
    }
    return "";
  });
  return vm.runInNewContext(code, { ...helpers, ...sandbox });
}

describe("structs in node:vm contexts", () => {
  test("every global is present in a new context", () => {
    expect(vm.runInNewContext("typeof Atomics.Mutex")).toBe("function");
    expect(vm.runInNewContext("typeof Atomics.Condition")).toBe("function");
    expect(vm.runInNewContext("typeof Reflect.canBeShared")).toBe("function");
    expect(vm.runInNewContext("typeof SharedArray")).toBe("function");
  });

  test("reading one name installs all of them in that context", () => {
    const context = vm.createContext({});
    expect(vm.runInContext("typeof SharedArray", context)).toBe("function");
    expect(
      vm.runInContext(
        "[typeof Atomics.Mutex, typeof Atomics.Condition, typeof Reflect.canBeShared, typeof Atomics.load].join()",
        context,
      ),
    ).toBe("function,function,function,function");
    // A second read gets the installed values.
    expect(vm.runInContext("SharedArray === SharedArray && Atomics.Mutex === Atomics.Mutex", context)).toBe(true);
  });

  test("the properties are not enumerable", () => {
    const context = vm.createContext({});
    expect(vm.runInContext("typeof Atomics.Mutex; Object.keys(Atomics).join()", context)).toBe("");
  });

  test("a sandbox can shadow a global", () => {
    expect(vm.runInNewContext("SharedArray", { SharedArray: 5 })).toBe(5);
    expect(vm.runInNewContext("typeof Atomics.Mutex", { SharedArray: 5 })).toBe("function");
  });

  test("contexts install independently", () => {
    const first = vm.createContext({});
    const second = vm.createContext({});
    expect(vm.runInContext("typeof SharedArray", first)).toBe("function");
    expect(vm.runInContext("typeof Reflect.canBeShared", second)).toBe("function");
    expect(vm.runInContext("typeof SharedArray", second)).toBe("function");
  });

  test("the main realm is not changed by a context", () => {
    vm.runInNewContext("Atomics.Mutex; SharedArray");
    expect(typeof Atomics.Mutex).toBe("function");
    expect(typeof SharedArray).toBe("function");
    expect(Object.keys(Atomics)).toEqual([]);
  });

  test("the classes work inside a context", () => {
    const result = vm.runInNewContext(`
      const array = new SharedArray(2);
      array[0] = 1;
      array[1] = "two";
      const mutex = new Atomics.Mutex();
      const token = Atomics.Mutex.lock(mutex);
      const second = Atomics.Mutex.lockIfAvailable(mutex, 0);
      token.unlock();
      [array.length, array[0], array[1], second === null, Reflect.canBeShared(array)].join();
    `);
    expect(result).toBe("2,1,two,true,true");
  });

  test("Atomics on typed arrays still work inside a context", () => {
    const result = vm.runInNewContext(`
      const view = new Int32Array(new SharedArrayBuffer(8));
      Atomics.store(view, 0, 5);
      Atomics.add(view, 0, 2);
      [Atomics.load(view, 0), Atomics.exchange(view, 0, 9), Atomics.compareExchange(view, 0, 9, 1), view[0]].join();
    `);
    expect(result).toBe("7,7,9,1");
  });

  test("a shared struct from the main realm works in a context", () => {
    shared struct Box {
      value;
    }
    const box = new Box();
    Atomics.store(box, "value", 1);
    const result = vm.runInNewContext(
      `[
        Reflect.canBeShared(box),
        Atomics.load(box, "value"),
        Atomics.exchange(box, "value", 2),
        Atomics.compareExchange(box, "value", 2, 3),
        Atomics.load(box, "value"),
      ].join()`,
      { box },
    );
    expect(result).toBe("true,1,1,2,3");
    expect(Atomics.load(box, "value")).toBe(3);
    expect(Reflect.canBeShared(box)).toBe(true);
  });

  test("a write in a context is seen in the main realm", () => {
    shared struct Counter {
      n;
    }
    const counter = new Counter();
    vm.runInNewContext(`Atomics.store(counter, "n", 41)`, { counter });
    expect(Atomics.load(counter, "n")).toBe(41);
    vm.runInNewContext(`Atomics.store(counter, "n", Atomics.load(counter, "n") + 1)`, { counter });
    expect(counter.n).toBe(42);
  });

  test("a shared array from the main realm works in a context", () => {
    const array = new SharedArray(2);
    array[0] = 7;
    const result = vm.runInNewContext(
      `[Reflect.canBeShared(array), array.length, array[0], (array[1] = "x", array[1])].join()`,
      { array },
    );
    expect(result).toBe("true,2,7,x");
    expect(array[1]).toBe("x");
  });

  test("a mutex from the main realm is the same lock in a context", () => {
    const mutex = new Atomics.Mutex();
    const token = Atomics.Mutex.lock(mutex);
    expect(vm.runInNewContext("Atomics.Mutex.lockIfAvailable(mutex, 0) === null", { mutex })).toBe(true);
    token.unlock();
    expect(vm.runInNewContext("Atomics.Mutex.lockIfAvailable(mutex, 0) !== null", { mutex })).toBe(true);
  });

  test("a shared struct can hold another one across realms", () => {
    shared struct Box {
      value;
    }
    const inner = new Box();
    const outer = new Box();
    const result = vm.runInNewContext(`outer.value = inner; [Reflect.canBeShared(outer.value), outer.value === inner].join()`, {
      outer,
      inner,
    });
    expect(result).toBe("true,true");
    expect(outer.value).toBe(inner);
  });

  test("a struct declared in a context", () => {
    const sandbox: Record<string, unknown> = {};
    runStructsInNewContext(
      `
      struct Point {
        x;
        y;
      }
      struct Point3 extends Point {
        z;
        sum() {
          return this.x + this.y + this.z;
        }
      }
      const p = new Point3();
      p.x = 1;
      p.y = 2;
      p.z = 3;
      globalThis.out = JSON.stringify({
        keys: Object.keys(p),
        extensible: Object.isExtensible(p),
        isPoint: p instanceof Point,
        sum: p.sum(),
        canBeShared: Reflect.canBeShared(p),
      });
      `,
      sandbox,
    );
    expect(JSON.parse(sandbox.out as string)).toEqual({
      keys: ["x", "y", "z"],
      extensible: false,
      isPoint: true,
      sum: 6,
      canBeShared: false,
    });
  });

  test("a shared struct declared in a context is usable in both realms", () => {
    const sandbox: Record<string, unknown> = {};
    runStructsInNewContext(
      `
      shared struct Box {
        value;
      }
      const box = new Box();
      Atomics.store(box, "value", 7);
      globalThis.box = box;
      globalThis.out = JSON.stringify({
        proto: Object.getPrototypeOf(box),
        canBeShared: Reflect.canBeShared(box),
        value: Atomics.load(box, "value"),
      });
      `,
      sandbox,
    );
    expect(JSON.parse(sandbox.out as string)).toEqual({ proto: null, canBeShared: true, value: 7 });
    const box = sandbox.box as object;
    expect(Reflect.canBeShared(box)).toBe(true);
    expect(Atomics.load(box, "value")).toBe(7);
    Atomics.store(box, "value", 8);
    expect(vm.runInNewContext(`Atomics.load(box, "value")`, { box })).toBe(8);
  });
});

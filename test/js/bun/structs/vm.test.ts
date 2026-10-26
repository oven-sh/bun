import { describe, expect, test } from "bun:test";
import vm from "node:vm";

// The structs surface in `node:vm` contexts, and `struct` / `shared struct` declarations in the sources vm compiles.
// Those sources do not pass through Bun's transpiler, so vm lowers a source that has a struct declaration first
// (src/js/internal/structs.ts); the helper the lowered code calls, `__structBase`, is installed in the realm that runs it.

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

  test("struct syntax in vm.runInNewContext", () => {
    const sandbox: Record<string, unknown> = {};
    vm.runInNewContext(
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

  test("a new Script with struct syntax runs in several contexts, and a later script sees its declarations", () => {
    const script = new vm.Script(`struct Point { x; }
const p = new Point();
p.x = 5;
p.x`);
    const first = vm.createContext({});
    const second = vm.createContext({});
    expect(script.runInContext(first)).toBe(5);
    expect(script.runInContext(second)).toBe(5);
    // Point is a global lexical declaration of the first context.
    expect(vm.runInContext(`const q = new Point(); q.x = 6; [q.x, Object.isExtensible(q), q instanceof Point].join()`, first)).toBe(
      "6,false,true",
    );
    expect(() => vm.runInContext("new Point()", vm.createContext({}))).toThrow(/Point/);
  });

  test("vm.runInContext with struct syntax", () => {
    const context = vm.createContext({ seen: [] as unknown[] });
    vm.runInContext("shared struct Cell { value; }
const cell = new Cell();
cell.value = 3;
seen.push(cell);", context);
    const cell = (context as { seen: object[] }).seen[0];
    expect(Reflect.canBeShared(cell)).toBe(true);
    expect(Atomics.load(cell, "value")).toBe(3);
  });

  test("a shared struct declared in one context is the same object in another and in the main realm", () => {
    const sandbox: Record<string, unknown> = {};
    vm.runInNewContext(
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
    // A second context declares its own struct with the same shape and also reads and writes the first one's instance.
    expect(
      vm.runInNewContext(
        `
        shared struct Other { value; }
        const other = new Other();
        Atomics.store(box, "value", Atomics.load(box, "value") + 1);
        Atomics.store(other, "value", 1);
        [Atomics.load(box, "value"), Atomics.load(other, "value"), Reflect.canBeShared(other)].join()
        `,
        { box },
      ),
    ).toBe("9,1,true");
    expect(Atomics.load(box, "value")).toBe(9);
  });

  test("vm.compileFunction with struct syntax", () => {
    const fn = vm.compileFunction(
      `struct Pair { a; b; }
      const pair = new Pair();
      pair.a = first;
      pair.b = second;
      return pair.a + pair.b;`,
      ["first", "second"],
    );
    expect(fn(2, 3)).toBe(5);
    expect(() => vm.compileFunction("struct Bad { a = 1; }")).toThrow(SyntaxError);
  });

  test("struct syntax in a vm.SourceTextModule", async () => {
    const { SourceTextModule } = vm as unknown as { SourceTextModule: new (code: string, options: object) => any };
    const module = new SourceTextModule(
      `struct Point { x; }
      const point = new Point();
      point.x = 4;
      export const x = point.x;
      export const frozen = !Object.isExtensible(point);`,
      { context: vm.createContext({}) },
    );
    await module.link(() => {
      throw new Error("no imports");
    });
    await module.evaluate();
    expect(module.namespace.x).toBe(4);
    expect(module.namespace.frozen).toBe(true);
  });

  test("an invalid struct declaration is a SyntaxError", () => {
    expect(() => vm.runInNewContext("struct S { x = 1; }")).toThrow(SyntaxError);
    expect(() => vm.runInNewContext("struct S { [name]; }")).toThrow(SyntaxError);
    expect(() => new vm.Script("shared struct S { x = 1; }")).toThrow(SyntaxError);
    // Not struct syntax at all, still raised by the engine.
    expect(() => vm.runInNewContext("struct S {")).toThrow(SyntaxError);
  });

  test("a source that only mentions the word runs unchanged", () => {
    expect(vm.runInNewContext("const struct = 1; struct + 1")).toBe(2);
    expect(vm.runInNewContext("var struct = { shared: 2 }; struct.shared")).toBe(2);
    expect(vm.runInNewContext(`"struct S { x; }"`)).toBe("struct S { x; }");
    expect(vm.runInNewContext("`
struct S { x; }`")).toBe("
struct S { x; }");
    expect(vm.runInNewContext("// struct S { x; }
3")).toBe(3);
    expect(vm.runInNewContext("/* struct S { x; } */ 4")).toBe(4);
    expect(vm.runInNewContext("function struct() { return 5 }
struct()")).toBe(5);
    // Nothing was added to the context for a source that was not lowered.
    expect(vm.runInNewContext(`typeof __structBase`)).toBe("undefined");
    expect(vm.runInNewContext(`const struct = 1; typeof __structBase`)).toBe("undefined");
  });
});

import { numberOfDFGCompiles } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import vm from "node:vm";

// An array with a hole reads the hole through `array[i]` from any prototype, but the array fast
// paths ask `Structure::holesMustForwardToPrototype()` first, and its walk of the prototype chain
// counted a prototype only when it had indexed storage or the `MayHaveIndexedAccessors` bit. A
// typed array, an arguments object, a module namespace and a global proxy (so every realm's
// `globalThis`, including a `node:vm` context's) have neither: each answers an indexed read inside
// its class. The walk now counts such a prototype too (oven-sh/WebKit#875).

// `[0, , 2, 3]` with the hole at index 1, in one indexing shape. The allocation profile of an array
// literal follows what the earlier arrays of that literal became, so each comes from its own source.
let literals = 0;
const literal = (source: string) => new Function(`return ${source}; // ${literals++}`)() as any[];
const shapes = {
  Int32: () => literal("[0, , 2, 3]"),
  Double: () => literal("[0.5, , 2.5, 3.5]"),
  Contiguous: () => literal('["a", , "c", "d"]'),
};

const ownOrHole = (array: any[], index: number) => (Object.hasOwn(array, index) ? array[index] : "<hole>");

// What each operation read for the hole at index 1.
const reads = {
  index: (a: any[]) => a[1],
  at: (a: any[]) => Array.prototype.at.call(a, 1),
  join: (a: any[]) => Array.prototype.join.call(a, "|").split("|")[1],
  concat: (a: any[]) => {
    (a as any)[Symbol.isConcatSpreadable] = true;
    return ownOrHole(Array.prototype.concat.call([], a), 1);
  },
  sort: (a: any[]) => ownOrHole(Array.prototype.sort.call(a, () => 0), 1),
  reverse: (a: any[]) => ownOrHole(Array.prototype.reverse.call(a), 2),
  toReversed: (a: any[]) => Array.prototype.toReversed.call(a)[2],
  with: (a: any[]) => Array.prototype.with.call(a, 0, 9)[1],
  toSorted: (a: any[]) => Array.prototype.toSorted.call(a, () => 0)[1],
  shift: (a: any[]) => {
    Array.prototype.shift.call(a);
    return ownOrHole(a, 0);
  },
  unshift: (a: any[]) => {
    Array.prototype.unshift.call(a, 7);
    return ownOrHole(a, 2);
  },
  copyWithin: (a: any[]) => ownOrHole(Array.prototype.copyWithin.call(a, 0, 1, 2), 0),
  map: (a: any[]) => ownOrHole(Array.prototype.map.call(a, x => x), 1),
  indexOf: (a: any[]) => Array.prototype.indexOf.call(a, a[1]),
};

// These build their result with ArraySpeciesCreate, which takes `constructor` from the prototype.
// Over a typed array that is `Uint8Array`, and writing `length` on the result throws, in Node too.
const speciesReads = {
  slice: (a: any[]) => ownOrHole(Array.prototype.slice.call(a), 1),
  splice: (a: any[]) => ownOrHole(Array.prototype.splice.call(a, 0, 3), 1),
  flat: (a: any[]) => Array.prototype.flat.call(a)[1],
};

function readHole(prototype: object, makeArray: () => any[], species: boolean) {
  const applicable = species ? { ...reads, ...speciesReads } : reads;
  return Object.fromEntries(
    Object.entries(applicable).map(([name, read]) => [
      name,
      String(read(Object.setPrototypeOf(makeArray(), prototype))),
    ]),
  );
}

// Every read of the hole answers with the prototype's element, as it does for an ordinary object
// with the same key. The values differ per producer, so each case compares against that control.
function expectEveryReadToSeeTheElement(prototype: object, element: string, species = true) {
  for (const [shapeName, makeArray] of Object.entries(shapes)) {
    const control = readHole({ 1: element }, makeArray, species);
    expect({ shape: shapeName, ...readHole(prototype, makeArray, species) }).toEqual({ shape: shapeName, ...control });
  }
}

describe.concurrent("an array hole over a prototype whose class answers indexed reads", () => {
  test("a node:vm context's global object", () => {
    const context = vm.createContext({ 1: "inherited" });
    expectEveryReadToSeeTheElement(vm.runInContext("globalThis", context), "inherited");
    expectEveryReadToSeeTheElement(vm.runInContext("this", context), "inherited");
  });

  test("a key put on the sandbox after the context was made", () => {
    const sandbox: any = {};
    const contextGlobal = vm.runInContext("globalThis", vm.createContext(sandbox));
    sandbox[1] = "inherited";
    expectEveryReadToSeeTheElement(contextGlobal, "inherited");
  });

  test("a key put on the global object from inside the context", () => {
    const context = vm.createContext({});
    vm.runInContext("globalThis[1] = 'inherited'", context);
    expectEveryReadToSeeTheElement(vm.runInContext("globalThis", context), "inherited");
  });

  test("the global object of a DONT_CONTEXTIFY context", () => {
    const context = vm.createContext(vm.constants.DONT_CONTEXTIFY);
    vm.runInContext("this[1] = 'inherited'", context);
    expectEveryReadToSeeTheElement(vm.runInContext("this", context), "inherited");
  });

  test("an array linked and read wholly inside the context", () => {
    const context = vm.createContext({ 1: "inherited" });
    expect(
      vm.runInContext(
        `const array = Object.setPrototypeOf([0, , 2], globalThis);
         [array[1], Array.prototype.join.call(array), Array.prototype.slice.call(array)[1]].join("/")`,
        context,
      ),
    ).toBe("inherited/0,inherited,2/inherited");
  });

  test("a sandbox getter runs once for each read of the hole", () => {
    let calls = 0;
    const sandbox = {
      get 1() {
        calls++;
        return "inherited";
      },
    };
    const contextGlobal = vm.runInContext("globalThis", vm.createContext(sandbox));
    const array = Object.setPrototypeOf([0, , 2], contextGlobal);
    expect(Array.prototype.join.call(array)).toBe("0,inherited,2");
    expect(calls).toBe(1);
  });

  test("the main thread's globalThis", () => {
    // Deleted at the end: a later indexed key on globalThis would change what other tests read.
    try {
      (globalThis as any)[1] = "inherited";
      expectEveryReadToSeeTheElement(globalThis, "inherited");
    } finally {
      delete (globalThis as any)[1];
    }
  });

  test("a typed array, a Buffer and an arguments object", () => {
    expectEveryReadToSeeTheElement(new Uint8Array([7, 8, 9, 10]), "8", false);
    expectEveryReadToSeeTheElement(Buffer.from([7, 8, 9, 10]), "8", false);
    // A function declared in a module is strict, and its `arguments` has real indexed storage.
    const sloppyArguments = new Function("return arguments;") as (...args: unknown[]) => IArguments;
    expectEveryReadToSeeTheElement(sloppyArguments(7, 8, 9, 10), "8");
  });

  test("the compiled read of an ArrayStorage array", () => {
    const contextGlobal = vm.runInContext("globalThis", vm.createContext({ 1: "inherited" }));
    const read = new Function("array", "return array[1];") as (array: any[]) => unknown;
    // An array with an index far past its length keeps its elements in ArrayStorage.
    const array: any[] = [0, , 2];
    array[1 << 20] = 1;
    array.length = 3;
    Object.setPrototypeOf(array, contextGlobal);

    let wrong = 0;
    for (let i = 0; i < 200_000 && (numberOfDFGCompiles(read) === 0 || i < 1000); i++) {
      if (read(array) !== "inherited") wrong++;
    }
    expect({ wrong, last: read(array) }).toEqual({ wrong: 0, last: "inherited" });
  });

  // The DFG parks the arguments of a multi-argument unshift in a scratch buffer, and the hole read
  // runs the sandbox getter, which reaches that buffer through a DFG operation of its own. Its own
  // process: without the engine fix this is a SEGV in Heap::writeBarrier on a debug build.
  test("a compiled unshift of three whose hole read re-enters the JIT", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const vm = require("node:vm");
         const unshift = Array.prototype.unshift;
         let armed = false, reentered = 0;
         const sandbox = { get 1() {
           if (armed) { armed = false; reentered++; for (let i = 0; i < 3; i++) inner([5, 6, 7], 11, 22, 33); }
           return "inherited";
         } };
         const contextGlobal = vm.runInContext("globalThis", vm.createContext(sandbox));
         function inner(a, x, y, z) { return unshift.call(a, x, y, z); }
         function outer(a, x, y, z) { return unshift.call(a, x, y, z); }
         const make = () => Object.setPrototypeOf([0, , 2, 3], contextGlobal);
         for (let i = 0; i < 20000; i++) { inner([1, 2, 3], 4, 5, 6); outer(make(), 7, 8, 9); }
         armed = true;
         const array = make();
         const length = outer(array, 7, 8, 9);
         console.log(JSON.stringify({ reentered, length, stored: [array[0], array[1], array[2]], movedHole: array[4] }));`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ parsed: stdout ? JSON.parse(stdout) : stdout, stderr, exitCode }).toEqual({
      parsed: { reentered: 1, length: 7, stored: [7, 8, 9], movedHole: "inherited" },
      stderr: "",
      exitCode: 0,
    });
  });

  test("a splice whose result is unused still reads the holes it removes", () => {
    const readIndices: number[] = [];
    const sandbox: any = {};
    for (const index of [0, 1, 2]) {
      Object.defineProperty(sandbox, index, {
        get() {
          readIndices.push(index);
          return "g" + index;
        },
        enumerable: true,
        configurable: true,
      });
    }
    const contextGlobal = vm.runInContext("globalThis", vm.createContext(sandbox));
    const spliceAndDrop = (array: any[]) => {
      Array.prototype.splice.call(array, 0, 3);
    };

    // Every element of `new Array(3)` is a hole, so all three reads go to the sandbox. The DFG used
    // to skip the whole operation once it compiled this loop.
    let iterationsThatSkippedAread = 0;
    for (let i = 0; i < 3000; i++) {
      readIndices.length = 0;
      spliceAndDrop(Object.setPrototypeOf(new Array(3), contextGlobal));
      if (readIndices.length !== 3) iterationsThatSkippedAread++;
    }
    expect(iterationsThatSkippedAread).toBe(0);
  });
});

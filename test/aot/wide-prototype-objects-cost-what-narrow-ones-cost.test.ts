// A prototype object with more names than a chain of Structures holds is a dictionary. The run time flattens it at a lookup by name
// that no cache serves. That moves no name and no parent, so it may cost the class nothing: no guard of the class or of a class below
// it is cleared, no call of a method and no store to a field goes by name each round because of it, and none asks the run time's C++.
// Each idiom is measured with 200 names on the prototype object and with 20, and the two must agree.
//
//   AOT_WIDE_PROTOTYPES=<text>    only the idioms whose name contains the text
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, spawned } from "./run-programs";
import { describe, test } from "./supported";

const fillers = `
  function storeByKey(prototype, count) {
    for (let i = 0; i < count; i++) prototype["m" + i] = function () { return i; };
  }
  function define(prototype, count) {
    for (let i = 0; i < count; i++) Object.defineProperty(prototype, "m" + i, { value: function () { return i; }, writable: true, configurable: true });
  }
  // Each lookup comes more than once: the first miss of a name files nothing.
  function poke(o) {
    let sum = 0;
    for (let j = 0; j < 9; j++) sum += o["m" + (j % 3)]() + o.m5();
    return sum;
  }`;

// `prepare(count)` fills the prototype object, `round(i)` answers a number.
const idioms: Record<string, string> = {
  "a method of a constructor function, names stored by key": `
    function Shape() { this.a = 1; }
    Shape.prototype.hot = function () { return this.a; };
    let o;
    const prepare = count => { storeByKey(Shape.prototype, count); o = new Shape(); return poke(o); };
    const round = i => o.hot();`,
  "a method of a constructor function, names defined": `
    function Shape() { this.a = 1; }
    Shape.prototype.hot = function () { return this.a; };
    let o;
    const prepare = count => { define(Shape.prototype, count); o = new Shape(); return poke(o); };
    const round = i => o.hot();`,
  "methods of a class and of the class below it": `
    class Shape { constructor() { this.a = 1; } hot() { return this.a; } }
    class Circle extends Shape { warm() { return this.a + 1; } }
    let o;
    const prepare = count => { define(Shape.prototype, count); o = new Circle(); return poke(o); };
    const round = i => o.hot() + o.warm();`,
  "objects are made behind the lookups": `
    function Shape(a) { this.a = a; }
    Shape.prototype.hot = function () { return this.a; };
    const prepare = count => { define(Shape.prototype, count); return poke(new Shape(1)); };
    const round = i => new Shape(i).hot();`,
  "a store creates a field whose name has a default on the prototype object": `
    function Shape() { this.a = 1; }
    Shape.prototype.late = 0;
    const prepare = count => { define(Shape.prototype, count); return 0; };
    const round = i => { const o = new Shape(); o.late = i; return o.late + o.a; };`,
  // One site has one set of guards for all the classes that may come to it. The class with the filled prototype object exists and makes no such store.
  "a store site of two classes, and only the other class comes to it": `
    function Shape() { this.a = 1; }
    Shape.prototype.late = 0;
    function Other() { this.a = 2; }
    Other.prototype.late = 0;
    const makers = [() => new Other(), () => new Shape()];
    const which = process.argv.length > 99 ? 1 : 0;
    const prepare = count => { define(Shape.prototype, count); return new Shape().a; };
    const round = i => { const o = makers[which](); o.late = i; return o.late + o.a; };`,
};

const program = (idiom: string) => `${fillers}${idiom}
    let sum = prepare(Number(process.argv[2]));
    const rounds = Number(process.argv[3]);
    for (let i = 0; i < rounds; i++) sum += round(i);
    console.log(sum > 0);
  `;

async function measure(folder: string, executable: string, names: number) {
  const counted = async (rounds: number) => {
    const path = join(folder, `counts-${names}-${rounds}`);
    const ran = await spawned([executable, String(names), String(rounds)], folder, {
      ...bunEnv,
      BUN_DESTRUCT_VM_ON_EXIT: "1",
      BUN_JSC_aotCountsPath: path,
    });
    expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });
    const operations = new Map<string, number>();
    const counters = new Map<string, number>();
    let byName = 0;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, what] = line.split("\t");
      if (what?.startsWith("operation:")) operations.set(what, Number(count));
      if (what?.startsWith("counter:")) counters.set(what.slice("counter:".length), Number(count));
      if (what?.startsWith("arrival:")) byName += Number(count);
    }
    return { operations, counters, byName };
  };
  const [few, many] = [await counted(500), await counted(4500)];
  return {
    memberGuardsCleared: many.counters.get("MemberGuardsCleared"),
    prototypeLinkGuardsCleared: many.counters.get("PrototypeLinkGuardsCleared"),
    byNameEachRound: Math.round((many.byName - few.byName) / 4000),
    askedEachRound: [...many.operations]
      .filter(([operation, count]) => count - (few.operations.get(operation) ?? 0) > 400)
      .map(([operation]) => operation)
      .sort(),
  };
}

const only = process.env.AOT_WIDE_PROTOTYPES;

describe.concurrent("a wide prototype object costs its class what a narrow one costs", () => {
  for (const [name, idiom] of Object.entries(idioms)) {
    if (only && !name.includes(only)) continue;
    test(
      name,
      async () => {
        using dir = tempDir("aot-wide-prototype-objects", { "main.mjs": program(idiom) });
        const folder = String(dir);
        const executable = join(folder, isWindows ? "main.exe" : "main");
        built(
          await spawned(
            [bunExe(), "build", "--compile", "--aot", "--aot-count-arrivals", "./main.mjs", "--outfile", executable],
            folder,
            bunEnv,
          ),
        );
        // A name that the program defines late clears the guard that speaks of that name, with 20 names as with 200.
        expect(await measure(folder, executable, 200)).toEqual(await measure(folder, executable, 20));
      },
      240_000,
    );
  }
});

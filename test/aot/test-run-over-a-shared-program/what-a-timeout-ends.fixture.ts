// The timeout of node:vm ends code that runs, and the program goes on: the one ending of this kind that a program outlives. Compiled code of both programs spins under the text, and
// whoever goes on behind it runs with the tables of its own program, as in ./the-image-of-whoever-catches-runs.fixture.ts.
import { expect, test } from "bun:test";
import * as vm from "node:vm";
import * as lib from "./numbered-by-image";
const rows: string[] = [];
const tag = (strings: TemplateStringsArray, ...values: unknown[]) => strings.raw.join("=") + values.length;
class Marked {
  #mine = 1;
  static has(o: object) {
    return #mine in o;
  }
}
let kept = 0;
function keep<T>(x: T): T {
  kept++;
  return x;
}
function probeMine() {
  return ["m.i.n.e".replace(/\./g, "/"), "mine abc".replace(/[a-c]+$/, "L"), /^m(..)e$/.exec("mine")?.[1], tag`my${1}own${2}template${3}`, Marked.has(new Marked()), "a1b22c".split(/\d+/).length].join(" ");
}
let turns = 0;
const mine = () => { turns++; return turns; };
function mineSpins(f: () => unknown): never {
  for (;;) f();
}
// What does not spin gets all the time that a slow machine may need.
const row = (label: string, f: () => unknown, timeout = 40) => {
  let answer: string;
  try {
    answer = "answers " + String(vm.runInNewContext("f()", { f }, { timeout }));
  } catch (e) {
    answer = "I caught " + (e as any).code;
  }
  rows.push(label + " | " + answer + " | " + probeMine() + " | " + lib.probeTheirs() + " | " + probeMine());
};
test("what is ended by a timeout leaves the image of whoever goes on", () => {
  row("nothing spins", () => 1, 60_000);
  row("the text itself spins", () => vm.runInNewContext("for (;;);", {}, { timeout: 20 }));
  row("they spin alone", () => lib.spinsAlone());
  row("they spin, calling me", () => lib.spins(mine));
  row("I spin, calling them", () => mineSpins(() => lib.calls(() => 1)));
  row("they spin, calling me, calling them", () => lib.spins(() => lib.calls(mine)));
  row("they spin under try and finally", () => lib.spinsUnderTry(mine));
  row("they spin inside my forEach", () => [1].forEach(() => lib.spins(mine)));
  row("I spin inside their catch", () => lib.catches(() => mineSpins(mine)));
  row("they spin under eight of their frames", () => { const deep = (n: number): unknown => keep(n ? lib.calls(() => deep(n - 1)) : lib.spins(mine)); return deep(8); });
  row("nothing spins, afterwards", () => lib.calls(() => 2), 60_000);
  expect(rows.filter(text => text.includes("ERR_SCRIPT_EXECUTION_TIMEOUT")).length).toBe(9);
  expect(rows).toMatchSnapshot();
});

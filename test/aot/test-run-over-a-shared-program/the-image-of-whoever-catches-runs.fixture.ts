// A throw may be carried by the engine and not by compiled code: through text made at run time, host functions, getters, traps, jobs. Whoever catches it, or goes on behind it, runs with the tables
// of its own program: regular expression literals, the objects of tagged templates and private names are numbered by program, so another program's would show at once.
import { expect, test } from "bun:test";
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
  return [
    "m.i.n.e".replace(/\./g, "/"),
    "mine abc".replace(/[a-c]+$/, "L"),
    /^m(..)e$/.exec("mine")?.[1],
    tag`my${1}own${2}template${3}`,
    Marked.has(new Marked()),
    "a1b22c".split(/\d+/).length,
    "x".padEnd(3, "y").replace(/y+/, "Y"),
  ].join(" ");
}
function mineFails(message: string): never {
  throw new lib.Failure(message);
}
const said = (e: unknown) => (e instanceof Error ? e.message : String(e));
const row = (label: string, run: () => unknown) => {
  let answer: string;
  try {
    answer = "answers " + String(run());
  } catch (e) {
    answer = "I caught " + said(e);
  }
  rows.push(label + " | " + answer + " | " + probeMine() + " | " + lib.probeTheirs() + " | " + probeMine());
};
test("the image of whoever catches runs", async () => {
  row("nothing thrown", () => lib.calls(() => 1));
  row("their throw", () => lib.calls(() => lib.fail("a")));
  row("a host function fails in their code", () => lib.hostFails());
  row("a host function fails in their code, under mine", () => lib.calls(() => keep(lib.hostFails())));
  row("their text throws", () => lib.textFails());
  row("their text throws, they catch", () => lib.catches(() => lib.textFails()));
  row("my text throws under theirs", () => lib.calls(() => keep(new Function("throw new RangeError('from my text')")())));
  row("my text throws, they catch", () => lib.catches(() => keep(new Function("throw new RangeError('from my text')")())));
  row("their text catches what I throw", () => lib.textThatCatches(() => mineFails("b")));
  row("their text catches what they throw", () => lib.textThatCatches(() => lib.fail("c")));
  row("my text catches what they throw", () => new Function("f", "try { f(); } catch (e) { return 'my text caught ' + e.message; }")(() => lib.fail("d")));
  row("my text catches what they throw under me", () => new Function("f", "try { f(); } catch (e) { return 'my text caught ' + e.message; }")(() => keep(lib.calls(() => [lib.fail("e")][0]))));
  row("my text between us, I catch", () => new Function("f", "return keep(f())")(() => keep(lib.fail("f"))));
  row("their getter", () => lib.holder.failing);
  row("their getter by a name", () => (lib.holder as any)[["fail", "ing"].join("")]);
  row("their getter through Reflect", () => Reflect.get(lib.holder, "failing"));
  row("their trap", () => lib.trapped.anything);
  row("their trap through Object.keys", () => Object.entries(new Proxy({ a: 1 }, { get: () => lib.fail("g") })));
  row("my reviver throws in their JSON.parse", () => lib.revive('{"a":1}', () => mineFails("h")));
  row("their function as reviver of mine", () => JSON.parse('{"a":1}', () => lib.fail("i")));
  row("my comparison throws in their sort", () => lib.sorts([3, 1, 2], () => mineFails("j")));
  row("their function in my forEach", () => [1, 2].forEach(() => lib.fail("k")));
  row("their function in my map, they catch", () => lib.catches(() => [1].map(() => lib.fail("l"))));
  row("their toString", () => `${lib.converts}`);
  row("their toString in a host function", () => [lib.converts].join());
  row("an executor that calls them", () => { new Promise(() => lib.fail("m")).catch(() => {}); return "went on"; });
  row("their generator", () => { const g = lib.generatorFails(); g.next(); return g.next(); });
  row("their generator in a spread", () => [...lib.generatorFails()]);
  row("their generator in Array.from", () => Array.from(lib.generatorFails()));
  row("a structured clone of their getter", () => structuredClone(lib.holder));
  row("JSON.stringify of their getter", () => JSON.stringify(lib.holder));
  row("Object.assign from their getter", () => Object.assign({}, lib.holder));
  const wait = async (label: string, run: () => Promise<unknown>) => {
    let answer: string;
    try {
      answer = "answers " + String(await run());
    } catch (e) {
      answer = "I caught " + said(e);
    }
    rows.push(label + " | " + answer + " | " + probeMine() + " | " + lib.probeTheirs() + " | " + probeMine());
  };
  await wait("their async function", () => lib.laterFails());
  await wait("their async generator", async () => { const g = lib.stepsThenFails(); await g.next(); return await g.next(); });
  await wait("their async generator in for await", async () => { for await (const x of lib.stepsThenFails()) void x; });
  await wait("their thenable", async () => await lib.thenable);
  await wait("their thenable resolved", () => Promise.resolve(lib.thenable));
  await wait("Promise.all over theirs", () => Promise.all([lib.laterFails(), 1]));
  await wait("a reaction that calls them", () => Promise.resolve(1).then(() => lib.fail("n")));
  await wait("their reaction to mine", () => Promise.reject(new Error("o")).catch(e => lib.catches(() => { throw e; })));
  await wait("a timer that calls them", () => new Promise((resolve, reject) => setTimeout(() => { try { lib.fail("p"); } catch (e) { reject(e); } }, 1)));
  await wait("a microtask that calls them", () => new Promise(resolve => queueMicrotask(() => resolve(lib.catches(() => mineFails("q"))))));
  expect(rows.length).toBeGreaterThan(40);
  expect(rows).toMatchSnapshot();
});

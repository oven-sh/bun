// What compiled functions of a module do by themselves: calls, loops, memory, globals, a jump table, numbers of all four types, and every trap.
/// <reference path="../wasm-files.d.ts" />
import path from "./module.wasm";

function outcomeOf(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    const kind = error instanceof WebAssembly.RuntimeError ? "WebAssembly.RuntimeError" : (error as Error).name;
    const message = (error as Error).message;
    const hint = message.indexOf(" (evaluating");
    return kind + ": " + (hint < 0 ? message : message.slice(0, hint));
  }
}

const instance = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer())), {});
const e = instance.exports as any;
console.log("fib", e.fib(0), e.fib(1), e.fib(20));
console.log("total of the data", e.total(16, 3));
for (let i = 0; i < 100; i++) e.store(1024 + i * 4, i * 3);
console.log("total of what was stored", e.total(1024, 100), new Int32Array(e.memory.buffer, 1024, 3).join());
console.log("div", e.div(7, 2), e.div(-7, 2), outcomeOf(() => e.div(1, 0)), outcomeOf(() => e.div(-2147483648, -1)));
console.log("rem", e.rem(7, 3), e.rem(-1, 10), outcomeOf(() => e.rem(1, 0)));
console.log("trap", outcomeOf(() => e.trap()));
console.log("forever", outcomeOf(() => e.forever()));
console.log("and after it", e.fib(10));
const chosen: number[] = [];
for (let i = -2; i < 15; i++) chosen.push(e.choose(i));
console.log("choose", chosen.join());
console.log("load", e.load(16), e.load(65532), outcomeOf(() => e.load(65533)), outcomeOf(() => e.load(65536)), outcomeOf(() => e.load(-4)));
console.log("far", e.far(0), outcomeOf(() => e.far(4)), outcomeOf(() => e.far(-1)));
console.log("size", e.size(), "grow", e.grow(2), e.size(), e.grow(5), e.size(), e.memory.buffer.byteLength);
console.log("behind the old end", e.load(65536), e.far(4), outcomeOf(() => e.load(65536 * 3)));
e.fill(2048, 7, 8);
e.copy(2052, 16, 4);
console.log("fill and copy", new Uint8Array(e.memory.buffer, 2046, 12).join());
console.log(outcomeOf(() => e.fill(65536 * 3 - 4, 1, 5)), outcomeOf(() => e.copy(0, 65536 * 3 - 4, 5)), outcomeOf(() => e.fill(65536 * 3, 1, 0)));
console.log("math", e.math(2), e.math(10.5), e.math(-0.5), e.math(NaN), e.math(1e300));
console.log("wide", String(e.wide(3n, 5n)), String(e.wide(-1n, 63n)), String(e.wide(0x7fffffffffffffffn, 2n)));
console.log("count", e.count(), e.count(), e.count());
console.log("trunc", e.trunc(3.99), e.trunc(-3.99), outcomeOf(() => e.trunc(NaN)), outcomeOf(() => e.trunc(2147483648)), outcomeOf(() => e.trunc(-2147483649)), e.trunc(2147483647.5));
console.log("bits", e.bits(0), e.bits(1), e.bits(-1), e.bits(0x00f0f000));

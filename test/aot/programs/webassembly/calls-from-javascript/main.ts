// Calls from JavaScript to exported functions: every kind of parameter and result, arguments that have to be converted, too few and too many, traps, and calls back and forth.
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

let depth = 0;
let e: any;
const env = { back: (n: number): number => (n > 0 ? e.through(n - 1) : depth++) };
e = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer())), { env }).exports;
console.log("sub", e.sub(7, 2), e.sub(-2147483648, 1), e.sub(1.9, -1.9), e.sub(4294967297, 0), e.sub("12", "5"), e.sub(null, true), e.sub(undefined, NaN), e.sub(), e.sub(1), e.sub(9, 4, "more", {}));
console.log("sub of objects", e.sub({ valueOf: () => 40 }, [2]), outcomeOf(() => e.sub({ valueOf() { throw new RangeError("from valueOf"); } }, 1)), outcomeOf(() => e.sub(1n, 1)), outcomeOf(() => e.sub(Symbol(), 1)));
console.log("mix", e.mix(1.5, 2), e.mix(3, 0.1), e.mix(-0, 1), Object.is(e.mix(-0, 1), -0), e.mix(NaN, 1), e.mix("2", "3"), e.mix(1e308, 10), e.mix());
console.log("tick", e.tick(), e.tick(1, 2, 3), e.ticks(0));
console.log("low", e.low(5n), e.low(-1n), e.low(0x1234567890n), e.low(1n << 70n), outcomeOf(() => e.low(5)), outcomeOf(() => e.low("5")), outcomeOf(() => e.low()));
console.log("wide", String(e.wide(3)), String(e.wide(-1)), typeof e.wide(0));
console.log("ten", e.ten(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), e.ten(1, 2, 3), e.ten("1", 2.5, null, undefined, true, [6], 7, 8, 9, 10));
console.log("tenDoubles", e.tenDoubles(1, 2, 3, 4, 5, 6, 7, 8, 9, 10), e.tenDoubles(0.5, 0.25, 1, 1, 1, 1, 1, 1, 1, 1), e.tenDoubles(1, 2));
console.log("half", e.half(3), e.half(0.1), e.half(1e39), e.half(-0));
console.log("four", e.four(1, 2.5, 3n, 4.25), outcomeOf(() => e.four(1, 2.5, 3, 4.25)));
console.log("divide", e.divide(7), outcomeOf(() => e.divide(0)), e.divide(-3), outcomeOf(() => e.divide()), e.divide(100));
console.log("through", e.through(5), depth, e.through(0), depth);
const { sub } = e;
console.log("otherwise", sub(3, 1), sub.call(null, 3, 1), sub.apply(undefined, [10, 4]), sub.bind(null, 20)(5), [1, 2, 3].map(e.divide).join(), Reflect.apply(sub, 0, [8, 8]), outcomeOf(() => new sub(1, 2)).slice(0, 9));
let sum = 0;
for (let i = 0; i < 300000; i++) sum = e.sub(sum, -i) | 0;
console.log("many", sum);
let doubles = 0;
for (let i = 0; i < 100000; i++) doubles += e.mix(i, 0.5);
console.log("many doubles", doubles);

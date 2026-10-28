// What compiled functions call outside their module: functions of JavaScript, functions of another module, and whatever stands in a table.
/// <reference path="../wasm-files.d.ts" />
import firstPath from "./first.wasm";
import secondPath from "./second.wasm";

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

const first = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(await Bun.file(firstPath).arrayBuffer())), {});
const logged: number[] = [];
let second: any;
const env = {
  log: (value: number) => { logged.push(value); },
  twice: (value: number) => value * 2,
  fails: () => { throw new TypeError("thrown by a function of JavaScript"); },
  back: (value: number) => second.square(value) + second.useInc(value),
  mixed: (a: number, b: bigint, c: number, d: number) => a + Number(b) + c + d,
};
second = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(await Bun.file(secondPath).arrayBuffer())), { env, first: first.exports }).exports;
second.logs(5);
console.log("logs", logged.join());
console.log("useTwice", second.useTwice(21), second.useTwice(-1));
console.log("callFails", outcomeOf(() => second.callFails()), outcomeOf(() => second.callFails()));
console.log("deep", outcomeOf(() => second.deep(50)), second.square(12));
console.log("useInc", second.useInc(4));
console.log("usePeek: the memory of each", second.usePeek(0), second.own(0));
console.log("useBack", second.useBack(6));
console.log("useMixed", second.useMixed(1.25, 10n, 0.5, 3));
const names = ["a function of JavaScript", "a function of the other module", "its own", "another signature", "of the other module, and reads memory", "nothing", "nothing", "nothing", "outside"];
for (let i = 0; i < names.length; i++) console.log("indirect", i, names[i], outcomeOf(() => second.indirect(i, i === 4 ? 0 : 9)));
second.table.set(5, second.useTwice);
second.table.set(6, first.exports.inc);
console.log("set from outside", second.indirect(5, 9), second.indirect(6, 9));
second.table.set(0, null);
console.log(outcomeOf(() => second.indirect(0, 9)));
console.log("its memory is its own again", second.own(0));

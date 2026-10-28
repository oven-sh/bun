// A function that cannot be compiled does not send its whole module to the interpreter: with crashIfInterpreterIsUsed, the compiled functions of ../partly-interpreted-module still run.
/// <reference path="../wasm-files.d.ts" />
import path from "../partly-interpreted-module/module.wasm";

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

const module = new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
const env = { fail: (n: number) => { if (n) throw new RangeError("thrown by JavaScript: " + n); } };
const e = new WebAssembly.Instance(module, { env }).exports as any;
console.log("sumOfTen", e.sumOfTen(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
console.log("triple", e.triple(5), e.viaTable(0, 5), outcomeOf(() => e.viaTable(9, 5)));
console.log("divide", e.divide(7, 2), e.divide(-7, 2), outcomeOf(() => e.divide(1, 0)));
console.log("callFail", e.callFail(0), outcomeOf(() => e.callFail(3)));

// br_on_cast and br_on_cast_fail behave as in plain Bun: functions that test reference types are interpreted, the rest of the module is compiled.
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

const module = new WebAssembly.Module(new Uint8Array(await Bun.file(path).arrayBuffer()));
const e = new WebAssembly.Instance(module, {}).exports as any;
const other = new WebAssembly.Instance(module, {}).exports as any;
const candidates: [string, unknown][] = [["add", e.add], ["subtract", e.subtract], ["negate", e.negate], ["null", null], ["add of another instance", other.add], ["negate of another instance", other.negate], ["isBinary", e.isBinary]];
for (const [name, candidate] of candidates) console.log(name, e.isBinary(candidate), e.isBinaryOrNull(candidate), e.isNotBinary(candidate), e.applyIfBinary(candidate, 7, 3));
console.log("not a function", outcomeOf(() => e.isBinary(() => 1)), outcomeOf(() => e.isBinary(1)), outcomeOf(() => e.isBinary(undefined)));
console.log("kindOf", [0, -1, 1073741823, 1073741824, 1.5, "text", null, undefined, {}, e.add].map(value => e.kindOf(value)).join());
for (let i = 0; i < 4; i++) console.log("classify", i, outcomeOf(() => e.classify(i)));
let sum = 0;
for (let i = 0; i < 100000; i++) sum += e.classify(i % 3) + e.isBinary(i & 1 ? e.add : e.negate) + e.applyIfBinary(other.subtract, i, 1);
console.log("many", sum);

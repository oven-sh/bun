// Functions of TypeScript for ../stacks.test.ts, which knows their lines.
import { call, raiser } from "./stacks.py";
type Dropped = { by: "the transpiler" };
interface AlsoDropped {}

export function thrower(): never {
  throw new RangeError("from JavaScript");
}

export function throughPython() {
  call(thrower); // Not `return call()`, which is a tail call: there would be no frame of this function.
  return "not reached";
}

export function middle() {
  call(raiser, "deep");
  return "not reached";
}

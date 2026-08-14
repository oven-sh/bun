import { deepEquals } from "bun";
import { deserialize, noDFG, noFTL, noInline, noOSRExitFuzzing, numberOfDFGCompiles, serialize } from "bun:jsc";
import { expectType } from "./utilities";
const obj = { a: 1, b: 2 };
const buffer = serialize(obj);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const clone = deserialize(buffer);

if (deepEquals(obj, clone)) {
  console.log("They are equal!");
}

function add(a: number, b: number) {
  return a + b;
}
expectType(noInline(add)).is<void>();
expectType(noDFG(add)).is<void>();
expectType(noFTL(add)).is<void>();
expectType(noOSRExitFuzzing(add)).is<void>();
expectType(numberOfDFGCompiles(add)).is<number>();

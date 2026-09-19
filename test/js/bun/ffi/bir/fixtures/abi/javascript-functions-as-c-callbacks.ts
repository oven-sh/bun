import { JSCallback } from "bun:ffi";
import { apply, call_kept, fold, keep } from "./javascript-functions-as-c-callbacks.c";

const twice = new JSCallback((x: number) => x * 2, { args: ["i32"], returns: "i32" });
const add = new JSCallback((a: number, b: number) => a + b, { args: ["f64", "f64"], returns: "f64" });
let calls = 0;
const counting = new JSCallback(
  (x: number) => {
    calls++;
    return x + 100;
  },
  { args: ["i32"], returns: "i32" },
);
console.log(apply(twice.ptr, 5), fold(add.ptr, new Float64Array([1.5, 2.5, 3, 4]), 4));
keep(counting.ptr);
console.log(call_kept(1), call_kept(2), calls);
twice.close();
add.close();
counting.close();

import { JSCallback } from "bun:ffi";
import * as c from "./narrow-parameters-past-the-registers.c";

console.log(String(c.mixed(1, 2, 3, 4, 5, 6, 7, 8, -1, 100, -300, 70000, 120, 2 ** 40, 20000, 1.5, -128)));
// (What does not fit a parameter's type is converted to it as C converts: 255 to a signed char is -1.)
console.log(String(c.bytes(1, 2, 3, 4, 5, 6, 7, 8, -1, 255, -128, 128, 127, 1, 254, 254, -3)));
console.log(String(c.shorts_and_bools(1, 2, 3, 4, 5, 6, 7, 8, -1, true, 65535, false, -32768, -5)));
console.log(String(c.after_the_doubles(1, 2, 3, 4, 5, 6, 7, 8, 0.5, -4, 1.5, -300)));
const callback = new JSCallback(
  (r1, r2, r3, r4, r5, r6, r7, r8, c1, s1, c2, i1, u1) =>
    BigInt(Number(r1) + Number(r8) + c1 * 3 + s1 * 5 + c2 * 7 + i1 * 11 + u1 * 13),
  {
    args: ["i64", "i64", "i64", "i64", "i64", "i64", "i64", "i64", "i8", "i16", "i8", "i32", "u8"],
    returns: "i64",
  },
);
console.log(String(c.through_a_callback(callback.ptr)));
callback.close();

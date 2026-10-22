// `(a + b) | 0` on `int32` values is a 32-bit addition: it wraps, as in plain Bun, and nothing is tested.
// SIZE< step 120
// IR- : (i32|int\S*) = Claim v\d+(?!.* isProven)
import type { int32 } from "bun";

function step(a: int32, b: int32, c: int32): int32 {
    a = (a + 1) | 0;
    b = (b - 1) | 0;
    c = (c + a) | 0;
    const sum: int32 = (c - b) | 0;
    return sum;
}

const given: number[] = JSON.parse("[-5, 7, 11]");
console.log(step(1, 2, 3), step(given[0] | 0, given[1] | 0, given[2] | 0), step(2147483646, -2147483647, -2147483647));
console.log(step(2147483647, 0, 0), step(0, -2147483648, 0), step(1, 0, 2147483646), step(0, -2147483647, 1));
console.log(step(-2147483648, 2147483647, 2147483647), step(2147483646, 1, 0), step(-2, 1, -2147483647), step(-2, 1, -2147483648));

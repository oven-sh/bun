// SIZE< step 120
import type { int32 } from "bun";

function step(a: int32, b: int32, c: int32): int32 {
    a++;
    b--;
    c += a;
    const sum: int32 = c - b;
    return sum;
}

function tryStep(a: int32, b: int32, c: int32): string {
    try {
        return String(step(a, b, c));
    } catch (error) {
        return (error as Error).constructor.name;
    }
}

const byName: { [name: string]: (...rest: any[]) => unknown } = { step };
console.log(step(1, 2, 3), byName.step(-5, 7, 11), tryStep(2147483646, -2147483647, -2147483647));
console.log(tryStep(2147483647, 0, 0), tryStep(0, -2147483648, 0), tryStep(1, 0, 2147483646), tryStep(0, -2147483647, 1));
console.log(tryStep(-2147483648, 2147483647, 2147483647), tryStep(2147483646, 1, 0), tryStep(-2, 1, -2147483647), tryStep(-2, 1, -2147483648));

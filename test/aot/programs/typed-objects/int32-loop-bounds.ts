// IRT= 1 countUp = Cast v\d+ As
// IRT= 1 countDown = Cast v\d+ As
// IRT= 0 scan = Cast v\d+ As
// IRT= 1 inclusive = Cast v\d+ As
import type { int32 } from "bun";

function countUp(bytes: Uint8Array, from: int32, to: int32): int32 {
    let written: int32 = 0;
    for (let i: int32 = from; i < to; i++) {
        bytes[i & 63] = i & 255;
        written++;
    }
    return written;
}

function countDown(bytes: Uint8Array, from: int32, to: int32): int32 {
    let written: int32 = 0;
    for (let i: int32 = to; i > from; i--) {
        bytes[i & 63] = i & 255;
        written++;
    }
    return written;
}

function scan(text: string, from: int32, end: int32): int32 {
    let at: int32 = from;
    while (at < end && text.charCodeAt(at) === 32)
        at++;
    return at;
}

function inclusive(from: int32, to: int32): number {
    let sum = 0;
    for (let i: int32 = from; i <= to; i++)
        sum += i;
    return sum;
}

function width(code: int32): int32 {
    return code > 127 ? 2 : 1;
}

function skipping(text: string, end: int32): int32 {
    let seen = 0;
    for (let i: int32 = 0; i < end; i++) {
        const code = text.charCodeAt(i);
        if (code > 127)
            i += width(code) - 1;
        seen++;
    }
    return seen;
}

function attempt(run: () => unknown): string {
    try {
        return String(run());
    } catch (error) {
        return (error as Error).constructor.name;
    }
}

const byName: { [name: string]: (...rest: any[]) => unknown } = { countUp, countDown, scan, inclusive, skipping };
const bytes = new Uint8Array(64);
console.log(countUp(bytes, 0, 10), byName.countUp(bytes, -3, 3), countUp(bytes, 5, 5), countUp(bytes, 7, -7));
console.log(countUp(bytes, 2147483644, 2147483647), countUp(bytes, -2147483648, -2147483645), Array.from(bytes.subarray(0, 4)).join(" "));
console.log(countDown(bytes, 0, 10), byName.countDown(bytes, -3, 3), countDown(bytes, -2147483648, -2147483645), countDown(bytes, 2147483644, 2147483647));
console.log(scan("   x", 0, 4), byName.scan("    ", 1, 4), scan("x", 0, 1), scan("  ", 0, 2147483647), scan("  ", -2, 2));
console.log(inclusive(1, 4), byName.inclusive(-2, 2), attempt(() => inclusive(2147483646, 2147483647)), inclusive(-2147483648, -2147483647));
console.log(skipping("aébc", 4), byName.skipping("ééé", 3), skipping("", 0), skipping("abc", 5));

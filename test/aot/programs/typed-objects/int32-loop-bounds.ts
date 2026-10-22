// IR- : (i32|int\S*) = Claim v\d+(?!.* isProven)
import type { int32 } from "bun";

function countUp(bytes: Uint8Array, from: int32, to: int32): int32 {
    let written: int32 = 0;
    for (let i: int32 = from; i < to; i++) {
        bytes[i & 63] = i & 255;
        written = (written + 1) | 0;
    }
    return written;
}

function countDown(bytes: Uint8Array, from: int32, to: int32): int32 {
    let written: int32 = 0;
    for (let i: int32 = to; i > from; i--) {
        bytes[i & 63] = i & 255;
        written = (written + 1) | 0;
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
    for (let i: int32 = from; i <= to; i = (i + 1) | 0) {
        sum += i;
        if (i === to)
            break;
    }
    return sum;
}

function width(code: int32): int32 {
    return code > 127 ? 2 : 1;
}

function skipping(text: string, end: int32): int32 {
    let seen: int32 = 0;
    let i: int32 = 0;
    while (i < end) {
        i = (i + width(text.charCodeAt(i) | 0)) | 0;
        seen = (seen + 1) | 0;
    }
    return seen;
}

const given: number[] = JSON.parse("[-3, 3, 1, 4, -2, 2]");
const bytes = new Uint8Array(64);
console.log(countUp(bytes, 0, 10), countUp(bytes, given[0] | 0, given[1] | 0), countUp(bytes, 5, 5), countUp(bytes, 7, -7));
console.log(countUp(bytes, 2147483644, 2147483647), countUp(bytes, -2147483648, -2147483645), Array.from(bytes.subarray(0, 4)).join(" "));
console.log(countDown(bytes, 0, 10), countDown(bytes, given[0] | 0, given[1] | 0), countDown(bytes, -2147483648, -2147483645), countDown(bytes, 2147483644, 2147483647));
console.log(scan("   x", 0, 4), scan("    ", given[2] | 0, given[3] | 0), scan("x", 0, 1), scan("  ", 0, 2147483647), scan("  ", -2, 2));
console.log(inclusive(1, 4), inclusive(given[4] | 0, given[5] | 0), inclusive(2147483646, 2147483647), inclusive(-2147483648, -2147483647));
console.log(skipping("aébc", 4), skipping("ééé", 3), skipping("", 0), skipping("abc", 5));

// IRT= 0 count : number = (Add|Sub|ToNumeric)
// IRT= 0 copy : number = (Add|Sub|ToNumeric)
// IRT= 0 skip : number = (Add|Sub|ToNumeric)
// IR- : (i32|int\S*) = Claim v\d+(?!.* isProven)
import type { int32 } from "bun";

class Cursor {
    at: int32 = 0;
    bytes = new Uint8Array(64);
}

function count(from: int32, times: int32): int32 {
    let total: int32 = from;
    for (let i: int32 = 0; i < times; i++)
        total = (total + 1) | 0;
    for (let i: int32 = times; i > 0; i--)
        total = (total - 2) | 0;
    return total;
}

function width(code: int32): int32 {
    return code > 127 ? 2 : 1;
}

function copy(cursor: Cursor, text: string): int32 {
    const bytes = cursor.bytes;
    const length: int32 = text.length;
    let at: int32 = cursor.at;
    let i: int32 = 0;
    while (i < length) {
        const code: int32 = text.charCodeAt(i) | 0;
        if (code < 128) {
            bytes[at] = code;
            at = (at + 1) | 0;
            i++;
        } else
            i = (i + width(code)) | 0;
    }
    cursor.at = at;
    return at;
}

function skip(cursor: Cursor, step: int32): int32 {
    cursor.at = (cursor.at + step) | 0;
    cursor.at = (cursor.at - 1) | 0;
    return (cursor.at + step - width(step)) | 0;
}

const given: number[] = JSON.parse("[5, 10, -3, 4, 2147483000, 600, 3, -200]");
const cursor = new Cursor();
console.log(count(given[0] | 0, given[1] | 0), count(given[2] | 0, given[3] | 0), count(given[4] | 0, given[5] | 0), count(2147483647, 1));
console.log(copy(cursor, "plain"), copy(cursor, "café au lait"), Array.from(cursor.bytes.subarray(0, cursor.at)).join(" "));
console.log(skip(cursor, given[6] | 0), skip(cursor, given[7] | 0), cursor.at);

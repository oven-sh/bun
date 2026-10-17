// IRT= 0 count : number = (Add|Sub|ToNumeric)
// IRT= 0 copy : number = (Add|Sub|ToNumeric)
// IRT= 0 skip : number = (Add|Sub|ToNumeric)
import type { int32 } from "bun";

class Cursor {
    at: int32 = 0;
    bytes = new Uint8Array(64);
}

function count(from: int32, times: int32): int32 {
    let total: int32 = from;
    for (let i: int32 = 0; i < times; i++)
        total++;
    for (let i: int32 = times; i > 0; i--)
        total -= 2;
    return total;
}

function width(code: int32): int32 {
    return code > 127 ? 2 : 1;
}

function copy(cursor: Cursor, text: string): int32 {
    const bytes = cursor.bytes;
    const length: int32 = text.length;
    let at: int32 = cursor.at;
    for (let i: int32 = 0; i < length; i++) {
        const code = text.charCodeAt(i);
        if (code < 128)
            bytes[at++] = code;
        else
            i += width(code) - 1;
    }
    cursor.at = at;
    return at;
}

function skip(cursor: Cursor, step: int32): int32 {
    cursor.at += step;
    cursor.at = cursor.at - 1;
    return cursor.at + step - width(step);
}

const table = { count, copy, skip };
const byName: { [name: string]: (...rest: any[]) => unknown } = table;
const cursor = new Cursor();
console.log(count(5, 10), byName.count(-3, 4), count(2147483000, 600));
console.log(copy(cursor, "plain"), byName.copy(cursor, "café au lait"), Array.from(cursor.bytes.subarray(0, cursor.at)).join(" "));
console.log(skip(cursor, 3), byName.skip(cursor, -200), cursor.at);

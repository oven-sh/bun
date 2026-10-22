// `i++` and `i--` on an `int32` are proven where a test on the way limits `i`. type-rules/int32-unproven-stores has the loops that are not.
// IR- : (i32|int\S*) = Claim v\d+(?!.* isProven)
import type { int32 } from "bun";

const MAX: int32 = 2147483647;
const MIN: int32 = -2147483648;

function upTo(from: int32, to: int32): number {
    let turns = 0;
    for (let i: int32 = from; i < to; i++)
        turns++;
    return turns;
}

function downTo(from: int32, to: int32): number {
    let turns = 0;
    for (let i: int32 = from; i > to; i--)
        turns++;
    return turns;
}

function boundOnLeft(from: int32, to: int32): number {
    let turns = 0;
    for (let i: int32 = from; to > i; i++)
        turns++;
    return turns;
}

function afterFailedTest(from: int32, to: int32): number {
    let turns = 0;
    let i: int32 = from;
    for (;;) {
        if (i >= to)
            break;
        turns++;
        i++;
    }
    return turns;
}

function underBranches(from: int32, to: int32): number {
    let odd = 0;
    for (let i: int32 = from; i < to; i++) {
        if (i & 1)
            odd++;
        else
            odd--;
    }
    return odd;
}

function refuseOdd(value: number): number {
    if (value & 1)
        throw new RangeError("odd");
    return 1;
}

function aroundTry(from: int32, to: int32): number {
    let turns = 0;
    for (let i: int32 = from; i < to; i++) {
        try {
            turns += refuseOdd(i);
        } catch {
            turns += 10;
        }
    }
    return turns;
}

function belowConstant(from: int32): int32 {
    return from < 1000 ? from + 1 : from;
}

function withinLength(text: string, from: int32): int32 {
    let at: int32 = from;
    if (at < text.length)
        at = at + 1;
    return at;
}

class Reader {
    limit: int32 = 10;
    advance(at: int32): int32 {
        const limit = this.limit;
        return at < limit ? at + 1 : at;
    }
}

const given: number[] = JSON.parse("[0, 5, -2, 2, 3, 7]");
const [zero, five, low, two, three, seven] = given;
console.log(upTo(0, 5), upTo(MAX - 3, MAX), upTo(MIN, MIN + 2), upTo(5, 0), upTo(low | 0, two | 0));
console.log(downTo(5, 0), downTo(MIN + 3, MIN), downTo(MAX, MAX - 2), downTo(0, 5), downTo(two | 0, low | 0));
console.log(boundOnLeft(0, 5), boundOnLeft(MAX - 3, MAX), boundOnLeft(three | 0, three | 0));
console.log(afterFailedTest(0, 5), afterFailedTest(MAX - 3, MAX), afterFailedTest(MAX, MAX), afterFailedTest(seven | 0, three | 0));
console.log(underBranches(0, 5), underBranches(MAX - 3, MAX), underBranches(zero | 0, zero | 0));
console.log(aroundTry(0, 4), aroundTry(MAX - 2, MAX), aroundTry(five | 0, five | 0));
console.log(belowConstant(999), belowConstant(1000), belowConstant(MIN), withinLength("abc", 2), withinLength("abc", 3), withinLength("abc", MIN), new Reader().advance(9), new Reader().advance(10));

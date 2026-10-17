// IRT= 0 upTo = Cast v\d+ As
// IRT= 0 downTo = Cast v\d+ As
// IRT= 0 boundOnLeft = Cast v\d+ As
// IRT= 0 afterFailedTest = Cast v\d+ As
// IRT= 0 underBranches = Cast v\d+ As
// IRT= 1 inclusive = Cast v\d+ As
// IRT= 1 otherVariable = Cast v\d+ As
// IRT= 1 testedAfter = Cast v\d+ As
// IRT= 1 byTwo = Cast v\d+ As
// IRT= 1 insideTry = Cast v\d+ As
import type { int32 } from "bun";

const MAX: int32 = 2147483647;
const MIN: int32 = -2147483648;

function attempt(run: () => unknown): string {
    try {
        return String(run());
    } catch (error) {
        return (error as Error).constructor.name;
    }
}

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

function inclusive(from: int32, to: int32): number {
    let turns = 0;
    for (let i: int32 = from; i <= to; i++)
        turns++;
    return turns;
}

function otherVariable(from: int32, to: int32, other: int32): number {
    let at: int32 = other;
    for (let i = from; i < to; i++)
        at++;
    return at;
}

function testedAfter(from: int32, to: int32): number {
    let i: int32 = from;
    do
        i++;
    while (i < to);
    return i;
}

function byTwo(from: int32, to: int32): number {
    let turns = 0;
    for (let i: int32 = from; i < to; i += 2)
        turns++;
    return turns;
}

function refuseOdd(value: number): number {
    if (value & 1)
        throw new RangeError("odd");
    return 1;
}

function insideTry(from: int32, to: int32): number {
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

function reassigned(from: int32, to: int32, jump: int32): number {
    let turns = 0;
    for (let i: int32 = from; i < to; i++) {
        if (i === 2)
            i = jump;
        turns++;
    }
    return turns;
}

const byName: { [name: string]: (...rest: any[]) => unknown } = { upTo, downTo, boundOnLeft, afterFailedTest, underBranches, inclusive, otherVariable, testedAfter, byTwo, insideTry, reassigned };
console.log(upTo(0, 5), upTo(MAX - 3, MAX), upTo(MIN, MIN + 2), upTo(5, 0), byName.upTo(-2, 2));
console.log(downTo(5, 0), downTo(MIN + 3, MIN), downTo(MAX, MAX - 2), downTo(0, 5), byName.downTo(2, -2));
console.log(boundOnLeft(0, 5), boundOnLeft(MAX - 3, MAX), byName.boundOnLeft(3, 3));
console.log(afterFailedTest(0, 5), afterFailedTest(MAX - 3, MAX), afterFailedTest(MAX, MAX), byName.afterFailedTest(7, 3));
console.log(underBranches(0, 5), underBranches(MAX - 3, MAX), byName.underBranches(0, 0));
console.log(inclusive(0, 5), attempt(() => inclusive(MAX - 3, MAX)), byName.inclusive(1, 0));
console.log(otherVariable(0, 3, 4), attempt(() => otherVariable(0, 3, MAX - 1)), byName.otherVariable(0, 0, MAX));
console.log(testedAfter(0, 5), attempt(() => testedAfter(MAX, 0)), byName.testedAfter(MAX - 1, 0));
console.log(byTwo(0, 5), attempt(() => byTwo(MAX - 3, MAX)), byName.byTwo(MAX - 4, MAX - 1));
console.log(insideTry(0, 4), insideTry(MAX - 2, MAX), byName.insideTry(1, 1));
console.log(reassigned(0, 2, 9), reassigned(0, 10, 7), attempt(() => reassigned(0, 10, MAX)), byName.reassigned(3, 5, MAX));

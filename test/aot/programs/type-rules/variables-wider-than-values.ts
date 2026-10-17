// A variable is declared with a wide type and holds narrower values on every path, or on all paths but one. What it holds must come out unchanged either way.
enum Flags {
    None = 0,
    A = 1,
    B = 2,
    C = 4,
    High = 1 << 30,
}
type Shape = { kind: string; size: number | string };
type Square = { kind: string; size: number; side: number };
type Circle = { kind: string; size: number; radius: number };

function attempt(label: string, run: () => unknown) {
    try {
        console.log(label, run());
    } catch (error) {
        console.log(label, error instanceof TypeError ? "TypeError" : String(error));
    }
}

function flagsOf(n: number): Flags {
    return n & 1 ? Flags.A : n & 2 ? Flags.B : Flags.None;
}

function combine(from: number, read: (n: number) => number): number {
    let flags = read(from);
    if (from > 1) flags |= read(from >> 1);
    if (from > 3) flags |= read(from >> 2);
    return flags;
}

function combinedFlags(from: number): Flags {
    return combine(from, flagsOf);
}

function half(n: number): number {
    return n / 2;
}

function combinedHalves(from: number): number {
    return combine(from, half);
}

function sometimesFraction(flag: boolean, n: number): Flags {
    let value: number = Flags.A;
    if (flag) value = n;
    return value;
}

function alwaysInteger(flag: boolean): Flags {
    let value: number = Flags.A;
    if (flag) value = Flags.C;
    return value;
}

function growsInLoop(rounds: number): number {
    let value: number = 1;
    for (let i = 0; i < rounds; i++) value = value * 4;
    return value;
}

function orsInLoop(rounds: number): Flags {
    let value: number = 0;
    for (let i = 0; i < rounds; i++) value |= 1 << i;
    return value;
}

function swapsInLoop(rounds: number, start: number): string {
    let a: number = 1;
    let b: number = start;
    for (let i = 0; i < rounds; i++) {
        const t = a;
        a = b;
        b = t;
    }
    return a + " " + b;
}

function negativeZero(flag: boolean): string {
    let value: number = 0;
    if (flag) value = -0;
    return Object.is(value, -0) ? "-0" : "0";
}

function assignedInTry(fail: boolean): number | string {
    let value: number | string = 1;
    try {
        value = 2;
        if (fail) throw new Error("stop");
        value = 3;
    } catch {
        return "caught with " + value;
    } finally {
        value = typeof value === "number" ? value + 10 : value;
    }
    return value;
}

function bySwitch(n: number): number | string | undefined {
    let value: number | string | undefined;
    switch (n) {
        case 0:
            value = 1;
        case 1:
            value = (value ?? 0) as number | string;
            break;
        case 2:
            value = "two";
            break;
    }
    return value;
}

function pickShape(flag: boolean, a: Square, b: Square): number {
    let shape: Shape = a;
    if (flag) shape = b;
    return (shape as Square).side;
}

function pickEither(flag: boolean, a: Square, b: Circle): string {
    let shape: Shape = a;
    if (flag) shape = b;
    return shape.kind + " " + shape.size;
}

function storeThroughWideType(flag: boolean, a: Square, b: Square, size: number | string): string {
    let shape: Shape = a;
    if (flag) shape = b;
    shape.size = size;
    return typeof a.size + " " + typeof b.size;
}

function maybeMissing(flag: boolean, a: Square): string {
    let shape: Shape | undefined = a;
    if (flag) shape = undefined;
    return shape ? shape.kind : "nothing";
}

function fromAny(flag: boolean, a: Square, other: any): number {
    let shape: Shape = a;
    if (flag) shape = other;
    return (shape as Square).side;
}

function lastOfChain(first: Square, hops: number): string {
    let current: Shape = first;
    let seen = 0;
    while (seen < hops) {
        current = seen & 1 ? first : { kind: "made " + seen, size: seen, side: seen * 2 };
        seen++;
    }
    return current.kind;
}

function textOrNumber(flag: boolean): string {
    let value: string | number = "text";
    if (flag) value = "other";
    return value.toString().toUpperCase();
}

const spare: unknown[] = [];
function opaque<T>(value: T): T {
    return spare.length > 0 ? (spare[0] as T) : value;
}

const square: Square = { kind: "square", size: 4, side: 2 };
const bigger: Square = { kind: "bigger", size: 9, side: 3 };
const circle: Circle = { kind: "circle", size: 3, radius: 1 };
for (let n = 0; n < 9; n++) attempt("combined flags " + n, () => combinedFlags(n));
for (let n = 0; n < 9; n += 3) attempt("combined halves " + n, () => combinedHalves(n));
attempt("sometimes a fraction: no", () => sometimesFraction(false, 0.5));
attempt("sometimes a fraction: an integer", () => sometimesFraction(true, 2));
attempt("sometimes a fraction: a fraction", () => sometimesFraction(true, 0.5));
attempt("sometimes a fraction: NaN", () => sometimesFraction(true, NaN));
attempt("sometimes a fraction: too large", () => sometimesFraction(true, 2 ** 40));
attempt("always an integer", () => alwaysInteger(false) + alwaysInteger(true));
attempt("grows in a loop", () => [growsInLoop(0), growsInLoop(3), growsInLoop(15), growsInLoop(16), growsInLoop(40)].join(" "));
attempt("ors in a loop", () => [orsInLoop(0), orsInLoop(3), orsInLoop(31), orsInLoop(32), orsInLoop(33)].join(" "));
attempt("swaps in a loop", () => [swapsInLoop(0, 2), swapsInLoop(1, 2), swapsInLoop(2, 0.5), swapsInLoop(3, 0.5), swapsInLoop(1, NaN)].join(" | "));
attempt("negative zero", () => negativeZero(false) + " " + negativeZero(true));
attempt("assigned in try", () => assignedInTry(false) + " | " + assignedInTry(true));
attempt("by switch", () => [bySwitch(0), bySwitch(1), bySwitch(2), bySwitch(3)].join(" | "));
attempt("pick a shape", () => pickShape(false, square, bigger) + pickShape(true, square, bigger));
attempt("pick either", () => pickEither(false, square, circle) + " | " + pickEither(true, square, circle));
attempt("store a number through the wide type", () => storeThroughWideType(true, { ...square }, { ...bigger }, 5));
attempt("store a string through the wide type", () => storeThroughWideType(true, { ...square }, { ...bigger }, "five"));
attempt("maybe missing", () => maybeMissing(false, square) + " " + maybeMissing(true, square));
attempt("from any: not taken", () => fromAny(false, square, 5));
attempt("from any: a square", () => fromAny(true, square, bigger));
attempt("from any: a literal", () => fromAny(true, square, { kind: "k", size: 1, side: 7 }));
attempt("from any: a number", () => fromAny(true, square, 5));
attempt("last of a chain", () => [lastOfChain(square, 0), lastOfChain(square, 1), lastOfChain(square, 2), lastOfChain(square, 3)].join(" | "));
attempt("text or number", () => textOrNumber(false) + textOrNumber(true));
for (const flag of [false, true]) {
    attempt("not known ahead: always an integer " + flag, () => alwaysInteger(opaque(flag)));
    attempt("not known ahead: a fraction " + flag, () => sometimesFraction(opaque(flag), opaque(1.5)));
    attempt("not known ahead: an integer " + flag, () => sometimesFraction(opaque(flag), opaque(4)));
    attempt("not known ahead: negative zero " + flag, () => negativeZero(opaque(flag)));
    attempt("not known ahead: pick a shape " + flag, () => pickShape(opaque(flag), opaque(square), opaque(bigger)));
    attempt("not known ahead: pick either " + flag, () => pickEither(opaque(flag), opaque(square), opaque(circle)));
    attempt("not known ahead: store a string " + flag, () => storeThroughWideType(opaque(flag), { ...square }, { ...bigger }, opaque("text")));
    attempt("not known ahead: maybe missing " + flag, () => maybeMissing(opaque(flag), opaque(square)));
    attempt("not known ahead: from any, a number " + flag, () => fromAny(opaque(flag), opaque(square), opaque(5)));
    attempt("not known ahead: text or number " + flag, () => textOrNumber(opaque(flag)));
    attempt("not known ahead: assigned in try " + flag, () => assignedInTry(opaque(flag)));
}
for (const rounds of [0, 1, 2, 3, 31, 32]) {
    attempt("not known ahead: ors in a loop " + rounds, () => orsInLoop(opaque(rounds)));
    attempt("not known ahead: grows in a loop " + rounds, () => growsInLoop(opaque(rounds)));
    attempt("not known ahead: swaps integers " + rounds, () => swapsInLoop(opaque(rounds), 2));
    attempt("not known ahead: swaps a fraction " + rounds, () => swapsInLoop(opaque(rounds), opaque(0.25)));
    attempt("not known ahead: last of a chain " + rounds, () => lastOfChain(opaque(square), opaque(rounds)));
    attempt("not known ahead: by switch " + rounds, () => bySwitch(opaque(rounds)));
}

function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function throwsTypeError(f, what) {
    try {
        f();
    } catch (error) {
        check(error instanceof TypeError, true, what + " throws a TypeError");
        return;
    }
    throw new Error(what + " did not throw");
}
function repeat(f) {
    for (let i = 0; i < 100; i++)
        f(i);
}

function andWithConstant(o) { return o.flags & 12; }
function constantAnd(o) { return 12 & o.flags; }
function orWithConstant(o) { return o.flags | 3; }
function xorWithConstant(o) { return o.flags ^ 5; }
function shiftLeftByConstant(o) { return o.flags << 2; }
function shiftRightByConstant(o) { return o.flags >> 1; }
function shiftConstant(o) { return 1 << o.flags; }
function testsFlag(o) { return o.flags & 4 ? "set" : "clear"; }
function testsTwoFlags(o) { return o.flags & 4 && o.more & 8 ? "both" : "not both"; }
function andOfUnknowns(o) { return o.flags & o.more; }
function andWithBigInt(o) { return o.flags & 12n; }
function andWithString(o) { return o.flags & "12"; }
function andOfInt32s(limit) {
    let result = 0;
    for (let i = 0; i < 100; i++) {
        if (i === limit)
            result = i & 12;
    }
    return result;
}
const bitFunctions = [andWithConstant, constantAnd, orWithConstant, xorWithConstant, shiftLeftByConstant, shiftRightByConstant, shiftConstant, testsFlag, testsTwoFlags, andOfUnknowns, andWithBigInt, andWithString, andOfInt32s];
for (const f of bitFunctions)
    noInline(f);

repeat(i => {
    check(andWithConstant({ flags: i }), i & 12, "an int32 and a constant");
    check(constantAnd({ flags: i }), i & 12, "a constant and an int32");
    check(orWithConstant({ flags: i }), i | 3, "or");
    check(xorWithConstant({ flags: i }), i ^ 5, "xor");
    check(shiftLeftByConstant({ flags: i }), i << 2, "a shift to the left");
    check(shiftRightByConstant({ flags: -i }), -i >> 1, "a shift to the right");
    check(shiftConstant({ flags: i }), 1 << i, "a constant that is shifted");
    check(testsFlag({ flags: i }), i & 4 ? "set" : "clear", "a flag");
    check(testsTwoFlags({ flags: i, more: i >> 1 }), (i & 4) && ((i >> 1) & 8) ? "both" : "not both", "two flags");
    check(andOfUnknowns({ flags: i, more: 6 }), i & 6, "two values that nothing is known of");
    check(andWithString({ flags: i }), i & 12, "a string");
    check(andOfInt32s(i), i & 12, "two int32s");
});

repeat(() => {
    check(andWithConstant({ flags: 13.75 }), 12, "a double");
    check(andWithConstant({ flags: -0 }), 0, "negative zero");
    check(andWithConstant({ flags: NaN }), 0, "NaN");
    check(andWithConstant({ flags: Infinity }), 0, "Infinity");
    check(andWithConstant({ flags: 2 ** 32 + 13 }), 12, "a number above the int32 range");
    check(andWithConstant({ flags: -1 }), 12, "minus one");
    check(andWithConstant({ flags: "13" }), 12, "a string that is a number");
    check(andWithConstant({ flags: "x" }), 0, "a string that is not a number");
    check(andWithConstant({ flags: undefined }), 0, "undefined");
    check(andWithConstant({}), 0, "a property that is not there");
    check(andWithConstant({ flags: null }), 0, "null");
    check(andWithConstant({ flags: true }), 0, "true");
    check(orWithConstant({ flags: true }), 3, "true, or");
    check(andWithConstant({ flags: [13] }), 12, "an array");
    check(andWithConstant({ flags: {} }), 0, "an object");
    check(testsFlag({ flags: undefined }), "clear", "a flag of undefined");
    check(testsFlag({ flags: 4.5 }), "set", "a flag of a double");
    check(testsFlag({ flags: "4" }), "set", "a flag of a string");
    check(shiftConstant({ flags: 33 }), 2, "a shift by more than 31");
    check(shiftConstant({ flags: -1 }), -2147483648, "a shift by a negative number");
    check(shiftLeftByConstant({ flags: 2 ** 30 }), 0, "a shift that overflows");
    check(andWithBigInt({ flags: 13n }), 12n, "two BigInts");
});

repeat(() => {
    throwsTypeError(() => andWithConstant({ flags: 13n }), "a BigInt and a number");
    throwsTypeError(() => constantAnd({ flags: 13n }), "a number and a BigInt");
    throwsTypeError(() => testsFlag({ flags: 4n }), "a flag of a BigInt");
    throwsTypeError(() => shiftConstant({ flags: 1n }), "a number shifted by a BigInt");
    throwsTypeError(() => andWithConstant({ flags: { valueOf() { return 13n; } } }), "an object that becomes a BigInt");
    throwsTypeError(() => andWithConstant({ flags: Symbol() }), "a symbol");
    throwsTypeError(() => andWithBigInt({ flags: 13 }), "a number and a BigInt constant");
});

{
    let calls = 0;
    const flags = { valueOf() { calls++; return 13; } };
    repeat(() => check(andWithConstant({ flags }), 12, "an object with valueOf"));
    check(calls, 100, "calls of valueOf");
    const failing = { valueOf() { throw new RangeError("no"); } };
    let caught = 0;
    repeat(() => {
        try {
            testsFlag({ flags: failing });
        } catch (error) {
            caught += error instanceof RangeError;
        }
    });
    check(caught, 100, "exceptions from valueOf");
}

function isFive(o) { return o.kind === 5; }
function fiveIs(o) { return 5 === o.kind; }
function isNotFive(o) { return o.kind !== 5; }
function isOneOf(o) { return o.kind === 1 || o.kind === 2 || o.kind === 3; }
function branchesOnFive(o) { return o.kind === 5 ? "five" : "other"; }
function isZero(o) { return o.kind === 0; }
function isSame(o) { return o.kind === o.other; }
function isLooselyFive(o) { return o.kind == 5; }
function isHalf(o) { return o.kind === 0.5; }
function isText(o) { return o.kind === "a text that is long enough"; }
function isUndefined(o) { return o.kind === undefined; }
const comparisons = [isFive, fiveIs, isNotFive, isOneOf, branchesOnFive, isZero, isSame, isLooselyFive, isHalf, isText, isUndefined];
for (const f of comparisons)
    noInline(f);

repeat(i => {
    check(isFive({ kind: i }), i === 5, "an int32");
    check(fiveIs({ kind: i }), i === 5, "an int32, on the right");
    check(isNotFive({ kind: i }), i !== 5, "an int32 that is not");
    check(isOneOf({ kind: i }), i >= 1 && i <= 3, "one of three");
    check(branchesOnFive({ kind: i }), i === 5 ? "five" : "other", "a branch");
    check(isSame({ kind: i, other: 7 }), i === 7, "two values that nothing is known of");
    check(isLooselyFive({ kind: i }), i === 5, "a loose comparison");
});

repeat(() => {
    const half = 2.5;
    check(isFive({ kind: half * 2 }), true, "a double that is the same number");
    check(isFive({ kind: half * 2 + 2 ** -40 }), false, "a double that is close");
    check(isFive({ kind: 5.5 }), false, "another double");
    check(isFive({ kind: NaN }), false, "NaN");
    check(isFive({ kind: Infinity }), false, "Infinity");
    check(isZero({ kind: -0 }), true, "negative zero is zero");
    check(isZero({ kind: 0 }), true, "zero is zero");
    check(isZero({ kind: NaN }), false, "NaN is not zero");
    check(isZero({ kind: false }), false, "false is not zero");
    check(isZero({ kind: null }), false, "null is not zero");
    check(isZero({ kind: undefined }), false, "undefined is not zero");
    check(isZero({ kind: "" }), false, "an empty string is not zero");
    check(isZero({ kind: 0n }), false, "a BigInt is not zero");
    check(isFive({ kind: "5" }), false, "a string");
    check(isFive({ kind: 5n }), false, "a BigInt");
    check(isFive({ kind: [5] }), false, "an array");
    check(isFive({ kind: { valueOf() { return 5; } } }), false, "an object with valueOf");
    check(isFive({ kind: Symbol() }), false, "a symbol");
    check(isFive({ kind: true }), false, "true");
    check(isFive({}), false, "a property that is not there");
    check(isNotFive({ kind: half * 2 }), false, "a double that is the same number, negated");
    check(isNotFive({ kind: "5" }), true, "a string, negated");
    check(isLooselyFive({ kind: "5" }), true, "a string, compared loosely");
    check(isHalf({ kind: 0.5 }), true, "a double constant");
    check(isUndefined({}), true, "undefined");
});
console.log("passed");

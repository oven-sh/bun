function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
    const functions = {
        orZero(x) { return x | 0; },
        zeroOr(x) { return 0 | x; },
        orFive(x) { return x | 5; },
        andMask(x) { return x & 0xff; },
        maskAnd(x) { return 0xff00 & x; },
        andMinusOne(x) { return x & -1; },
        xorZero(x) { return x ^ 0; },
        xorMinusOne(x) { return x ^ -1; },
        shiftLeftThree(x) { return x << 3; },
        shiftLeftThirtyFive(x) { return x << 35; },
        oneShiftedLeft(x) { return 1 << x; },
        shiftRightTwo(x) { return x >> 2; },
        shiftRightZero(x) { return x >> 0; },
        minusEightShiftedRight(x) { return -8 >> x; },
    };
    globalThis.escapedFunctions = functions;
    const toInt32 = x => {
        const number = Number(x);
        if (!Number.isFinite(number))
            return 0;
        const wrapped = ((Math.trunc(number) % 4294967296) + 4294967296) % 4294967296;
        return wrapped >= 2147483648 ? wrapped - 4294967296 : wrapped;
    };
    const bits = x => toInt32(x);
    const reference = {
        orZero: x => bits(x),
        zeroOr: x => bits(x),
        orFive: x => bits(bits(x) + (5 - (((bits(x) % 8) + 8) % 8 & 5))),
        andMask: x => ((bits(x) % 256) + 256) % 256,
        andMinusOne: x => bits(x),
        xorZero: x => bits(x),
        xorMinusOne: x => -bits(x) - 1,
        shiftLeftThree: x => bits(bits(x) * 8),
        shiftLeftThirtyFive: x => bits(bits(x) * 8),
        shiftRightTwo: x => Math.floor(bits(x) / 4),
        shiftRightZero: x => bits(x),
    };
    const withValueOf = { valueOf() { return 77; } };
    const values = [0, 1, -1, 5, 255, 256, 65535, 2147483647, -2147483648, 1.5, -1.5, 4294967296, 4294967301, -4294967301, 1e21, NaN, Infinity, -Infinity, -0,
        "12", "-3", "x", "", true, false, null, undefined, withValueOf, [9], [ ]];
    for (let round = 0; round < 30; ++round) {
        for (const value of values) {
            for (const name of Object.keys(reference))
                check(globalThis.escapedFunctions[name](value), reference[name](value) + 0 === 0 ? 0 : reference[name](value), name + " of " + String(value));
            check(globalThis.escapedFunctions.maskAnd(value), bits(value) & 0xff00, "maskAnd of " + String(value));
            check(globalThis.escapedFunctions.oneShiftedLeft(value), bits(2 ** (((bits(value) % 32) + 32) % 32)), "oneShiftedLeft of " + String(value));
            check(globalThis.escapedFunctions.minusEightShiftedRight(value), Math.floor(-8 / 2 ** (((bits(value) % 32) + 32) % 32)), "minusEightShiftedRight of " + String(value));
        }
    }
    let message = "none";
    try { globalThis.escapedFunctions.orZero(1n); } catch (error) { message = error.constructor.name; }
    check(message, "TypeError", "a BigInt and a number");
    message = "none";
    try { globalThis.escapedFunctions.orZero(Symbol()); } catch (error) { message = error.constructor.name; }
    check(message, "TypeError", "a symbol");
})();
console.log("passed");

// @bun
// Math.sumPrecise rounds a negative sum the same way as a positive one: to nearest, ties to even.
//
// The rounding step of the xsum port behind it (WTF::Xsum::XsumSmall::compute) used to round
// every negative sum whose discarded bits were all zero away from zero. Every exactly
// representable negative sum came out one ulp too large in magnitude (Math.sumPrecise([-1]) was
// -1.0000000000000002 and Math.sumPrecise([-Number.MAX_VALUE]) was -Infinity), and a negative
// sum just inside a power of two was rounded onto it.

function describe(input) {
    if (input.length > 8)
        return `[${input.slice(0, 4).join(", ")}, ... ${input.length} values]`;
    return `[${input.join(", ")}]`;
}

function shouldBe(actual, expected, input) {
    if (!Object.is(actual, expected))
        throw new Error(`Math.sumPrecise(${describe(input)}) returned ${actual}, expected ${expected}`);
}

const MAX = Number.MAX_VALUE;
const MIN_NORMAL = 2 ** -1022;
const MIN_SUBNORMAL = Number.MIN_VALUE;
const ULP = 2 ** -52; // The distance between consecutive doubles in [1, 2).

const cases = [
    // Exactly representable negative sums. Every expected value here is computed by double
    // arithmetic that is itself exact.
    [[-1], -1],
    [[-0.5], -0.5],
    [[-1, -1], -2],
    [[1, -2], -1],
    [[-3, 1], -2],
    [[-0.1], -0.1],
    [[-(2 ** 53)], -(2 ** 53)],
    [[-(2 ** 1000), -(2 ** 999)], -1.5 * 2 ** 1000],
    [[-(1 + ULP)], -(1 + ULP)],
    [[-1, -ULP], -(1 + ULP)],
    [[-1, ULP], -(1 - ULP)],
    [[-2, ULP], -(2 - ULP)],
    [[-2, 2 * ULP], -(2 - 2 * ULP)],
    [[-MAX], -MAX],
    [[-MAX, -MAX, MAX], -MAX],
    [[-MIN_NORMAL], -MIN_NORMAL],
    [[-MIN_NORMAL, -MIN_SUBNORMAL], -(MIN_NORMAL + MIN_SUBNORMAL)],
    [[-MIN_SUBNORMAL], -MIN_SUBNORMAL],
    [[-MIN_SUBNORMAL, -MIN_SUBNORMAL], -2 * MIN_SUBNORMAL],

    // Inexact negative sums were already right; keep them that way.
    [[-0.1, -0.2], -0.30000000000000004],
    [[-1, -1e-30], -1],

    // Less than half an ulp beyond a double: truncate towards it.
    [[-1, -ULP / 4], -1],
    [[-1, -ULP / 2, MIN_SUBNORMAL], -1],
    [[-(1 + ULP), -ULP / 2, MIN_SUBNORMAL], -(1 + ULP)],
    [[-MAX, -(2 ** 969)], -MAX],
    [[-MAX, -(2 ** 969), -(2 ** 968)], -MAX],
    [[-MAX, -(2 ** 970), 2 ** 900], -MAX],
    [[-MAX, 1], -MAX],

    // More than half an ulp beyond: round away from zero.
    [[-1, -ULP * 3 / 4], -(1 + ULP)],
    [[-1, -ULP / 2, -MIN_SUBNORMAL], -(1 + ULP)],
    [[-(1 + ULP), -ULP / 2, -MIN_SUBNORMAL], -(1 + 2 * ULP)],

    // Exactly half an ulp beyond: round to the neighbour with the even mantissa.
    [[-1, -ULP / 2], -1],
    [[-(1 + ULP), -ULP / 2], -(1 + 2 * ULP)],
    [[-MAX, -(2 ** 970)], -Infinity],

    // Sums whose magnitude is just inside a power of two, so the result has one more bit of
    // precision than the top of the accumulator suggests.
    [[-2, ULP / 2], -2],                                   // a tie between 2 - ULP (odd) and 2 (even)
    [[-2, ULP / 4], -2],
    [[-2, ULP * 3 / 4], -(2 - ULP)],
    [[-(2 ** 60), 1], -(2 ** 60)],                         // 2 ** 60 - 1 is not representable
    [[-(2 ** 60), 2 ** 7], -(2 ** 60 - 2 ** 7)],           // the double just below 2 ** 60
    [[-(2 ** 60), 2 ** 6], -(2 ** 60)],                    // a tie, and 2 ** 60 is the even neighbour
    [[-(2 ** 60), 2 ** 6, MIN_SUBNORMAL], -(2 ** 60 - 2 ** 7)],
    [[-(2 ** 60), 2 ** 6, -MIN_SUBNORMAL], -(2 ** 60)],

    // The positive mirror images, which were always right.
    [[1], 1],
    [[1, ULP / 4], 1],
    [[1, ULP * 3 / 4], 1 + ULP],
    [[1, ULP / 2], 1],
    [[1, ULP / 2, MIN_SUBNORMAL], 1 + ULP],
    [[1 + ULP, ULP / 2], 1 + 2 * ULP],
    [[1 + ULP, ULP / 2, -MIN_SUBNORMAL], 1 + ULP],
    [[2, -ULP / 2], 2],
    [[2, -ULP * 3 / 4], 2 - ULP],
    [[2 ** 60, -(2 ** 6)], 2 ** 60],
    [[2 ** 60, -(2 ** 6), -MIN_SUBNORMAL], 2 ** 60 - 2 ** 7],
    [[MAX], MAX],
    [[MAX, MAX, -MAX], MAX],
    [[MAX, 2 ** 969], MAX],
    [[MAX, 2 ** 970], Infinity],

    // A negative sum that cancels to zero is +0.
    [[-1, 1], 0],
];

// An array longer than 1000 elements is summed with the large accumulator, which is rounded through
// the same code. 500 cancelling pairs pad each case out to that length.
{
    const padding = [];
    for (let i = 0; i < 500; ++i)
        padding.push(2 ** 500, -(2 ** 500));

    for (const [input, expected] of cases.slice())
        cases.push([padding.concat(input), expected]);

    cases.push([new Array(1001).fill(-1), -1001]);
    cases.push([new Array(1001).fill(-0.25), -250.25]);
    cases.push([new Array(1001).fill(-MIN_SUBNORMAL), -1001 * MIN_SUBNORMAL]);
}

for (const [input, expected] of cases) {
    shouldBe(Math.sumPrecise(input), expected, input);
    // Any other iterable is summed with the small accumulator whatever its length.
    shouldBe(Math.sumPrecise((function* () { yield* input; })()), expected, input);
}

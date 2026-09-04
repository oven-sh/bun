// @bun
// ToInt32 on doubles outside the int32 range. The JIT fast path must agree with
// the interpreter for every magnitude, including the values that the 64 bit
// truncation cannot represent.

function shouldBe(actual, expected, input)
{
    if (actual !== expected)
        throw new Error(`bad value for ${input}: ${actual}, expected ${expected}`);
}

// Reference ToInt32 through BigInt, independent of the JIT.
function toInt32Reference(x)
{
    if (!Number.isFinite(x))
        return 0;
    return Number(BigInt.asIntN(32, BigInt(Math.trunc(x))));
}

const inputs = [
    0, -0, 1, -1, 0.5, -0.5, 2147483647, -2147483648, 2147483648, -2147483649,
    2147483647.9, -2147483648.9, 0xc66363a5, 0xffffffff, 0x100000000, 0x100000001,
    4294967295.5, -4294967296, 2 ** 52 + 1, -(2 ** 52 + 1), 2 ** 53, 2 ** 53 + 2,
    2 ** 62, -(2 ** 62), 2 ** 63 - 1024, -(2 ** 63 - 1024), 2 ** 63, -(2 ** 63),
    2 ** 63 + 2048, -(2 ** 63 + 2048), 2 ** 64, 2 ** 84, 2 ** 85, 2 ** 100,
    Number.MAX_VALUE, -Number.MAX_VALUE, Number.MIN_VALUE, Infinity, -Infinity, NaN,
];
const expected = inputs.map(toInt32Reference);

// A Float64Array load is DoubleRepUse for every input, NaN included.
const float64 = new Float64Array(inputs);

// A plain array keeps a double butterfly only without NaN, which forces a
// contiguous (JSValue) butterfly. The loads of this one are DoubleRepUse too.
const doubles = inputs.filter(x => x === x);
const expectedDoubles = doubles.map(toInt32Reference);

function bitOr(array, i)
{
    return array[i] | 0;
}
noInline(bitOr);

function xorWith(array, i, other)
{
    return array[i] ^ other;
}
noInline(xorWith);

function shiftRight(array, i)
{
    return array[i] >> 0;
}
noInline(shiftRight);

// Separate functions for the typed array, so each GetByVal stays monomorphic.
function bitOrTyped(array, i)
{
    return array[i] | 0;
}
noInline(bitOrTyped);

function xorWithTyped(array, i, other)
{
    return array[i] ^ other;
}
noInline(xorWithTyped);

function shiftRightTyped(array, i)
{
    return array[i] >> 0;
}
noInline(shiftRightTyped);

// A JSValue operand, so the conversion takes the NumberUse path.
function bitOrValue(object)
{
    return object.value | 0;
}
noInline(bitOrValue);

for (let iteration = 0; iteration < testLoopCount; ++iteration) {
    for (let i = 0; i < inputs.length; ++i) {
        shouldBe(bitOrTyped(float64, i), expected[i], inputs[i]);
        shouldBe(xorWithTyped(float64, i, 0x5a5a5a5a), expected[i] ^ 0x5a5a5a5a, inputs[i]);
        shouldBe(shiftRightTyped(float64, i), expected[i], inputs[i]);
        shouldBe(bitOrValue({ value: inputs[i] }), expected[i], inputs[i]);
    }
    for (let i = 0; i < doubles.length; ++i) {
        shouldBe(bitOr(doubles, i), expectedDoubles[i], doubles[i]);
        shouldBe(xorWith(doubles, i, 0x5a5a5a5a), expectedDoubles[i] ^ 0x5a5a5a5a, doubles[i]);
        shouldBe(shiftRight(doubles, i), expectedDoubles[i], doubles[i]);
    }
}

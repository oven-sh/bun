// @bun
//@ runDefault("--useConcurrentJIT=0")

// A parseInt result that does not fit in int32 must stay a double after the
// caller tiers up to the DFG or the FTL. The DFG's parseInt operations cast
// the double result to int before a round-trip check. That cast is undefined
// for such a value, so an optimizing compiler can drop the check and box the
// truncated value: parseInt("80000000", 16) === -2147483648 (oven-sh/WebKit#244).

function withRadix(string) {
    return parseInt(string, 16);
}
noInline(withRadix);

function withoutRadix(string) {
    return parseInt(string);
}
noInline(withoutRadix);

function ofNumber(number) {
    return parseInt(number);
}
noInline(ofNumber);

function shouldBe(actual, expected, what, iteration) {
    if (actual !== expected)
        throw new Error(what + " === " + actual + ", expected " + expected + ", at iteration " + iteration);
}

// Enough hex digits to overflow a double: the result is Infinity.
let hugeHex = "";
for (let i = 0; i < 300; ++i)
    hugeHex += "f";

for (let i = 0; i < testLoopCount; ++i) {
    shouldBe(withRadix("80000000"), 2147483648, 'parseInt("80000000", 16)', i);
    shouldBe(withRadix("ffffffff"), 4294967295, 'parseInt("ffffffff", 16)', i);
    shouldBe(withRadix("-80000001"), -2147483649, 'parseInt("-80000001", 16)', i);
    shouldBe(withRadix(hugeHex), Infinity, "parseInt(300 hex digits, 16)", i);
    shouldBe(withoutRadix("2147483648"), 2147483648, 'parseInt("2147483648")', i);
    shouldBe(ofNumber(2147483648.5), 2147483648, "parseInt(2147483648.5)", i);

    // Values that fit in int32 keep their value.
    shouldBe(withRadix("7fffffff"), 2147483647, 'parseInt("7fffffff", 16)', i);
    shouldBe(withRadix("-80000000"), -2147483648, 'parseInt("-80000000", 16)', i);
}

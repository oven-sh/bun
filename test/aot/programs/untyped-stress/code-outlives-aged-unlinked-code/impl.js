function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error(`expected ${String(expected)} but got ${String(actual)}`);
}

function usesNamesLate(late) {
    if (!late)
        return "early";
    const object = { someProperty: "a constant string" };
    return String(new RangeError(object.someProperty + Math.max(1, 2) + 12345.678));
}
function callsIt() { try { return usesNamesLate.apply(undefined, arguments); } catch (e) { return "threw " + e; } }

shouldBe(callsIt(false), "early");
for (let i = 0; i < 20; ++i)
    fullGC();
const filler = [];
for (let i = 0; i < 10000; ++i)
    filler.push({ ["p" + i]: i }, "s" + i);
shouldBe(callsIt(true), "RangeError: a constant string212345.678");
console.log("passed");

function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error("expected " + expected + " but got " + actual);
}

function store(array, index) {
    array[index] = 7;
}
noInline(store);

function attempt(array, index) {
    try {
        store(array, index);
        return "no exception";
    } catch (error) {
        return error.constructor.name;
    }
}
noInline(attempt);

for (let i = 0; i < testLoopCount * 10; ++i) {
    shouldBe(attempt(new Uint8Array(4), 6), "no exception");
    shouldBe(attempt(new Float64Array(4), 6), "no exception");
}
for (let i = 0; i < testLoopCount; ++i) {
    shouldBe(attempt(new BigInt64Array(4), 6), "TypeError");
    shouldBe(attempt(new BigUint64Array(4), 6), "TypeError");
    shouldBe(attempt(new BigInt64Array(4), 0), "TypeError");
    shouldBe(attempt(new Int16Array(4), 6), "no exception");
}

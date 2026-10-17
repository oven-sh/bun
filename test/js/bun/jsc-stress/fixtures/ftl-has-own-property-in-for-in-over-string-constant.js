//@ runDefault("--useConcurrentJIT=0")

function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error("expected " + expected + " but got " + actual);
}

const hasOwnProperty = Object.prototype.hasOwnProperty;

function ownKeys(value) {
    let keys = "";
    for (const key in value) {
        if (hasOwnProperty.call(value, key))
            keys += key;
    }
    return keys;
}

function run(useString) {
    return useString ? ownKeys("ab") : ownKeys({ a: 1, b: 2 });
}
noInline(run);

for (let i = 0; i < 10; ++i)
    shouldBe(run(true), "01");
for (let i = 0; i < testLoopCount * 10; ++i)
    shouldBe(run(false), "ab");
shouldBe(run(true), "01");

//@ runDefault
//@ runDefault("--useGeneratorBulkSaveRestore=0")
//@ runDefault("--useJIT=0")
//@ runDefault("--useDFGJIT=0")
//@ runDefault("--useConcurrentJIT=0", "--thresholdForJITAfterWarmUp=10", "--thresholdForOptimizeAfterWarmUp=20", "--thresholdForFTLOptimizeAfterWarmUp=50")

function shouldBe(actual, expected) {
    if (actual !== expected)
        throw new Error(`bad value: ${actual}, expected ${expected}`);
}

// Mixed-type locals, resumed with next/throw.
function* mixed() {
    let a = 1, b = 2.5, c = "s", d = { v: 3 }, e;
    try {
        a += yield a;
        b += yield b;
        e = yield c + d.v;
    } catch (error) {
        return [a, b, c, d.v, e, error];
    }
    return [a, b, c, d.v, e];
}
{
    let iterator = mixed();
    shouldBe(iterator.next().value, 1);
    shouldBe(iterator.next(10).value, 2.5);
    shouldBe(iterator.next(0.5).value, "s3");
    shouldBe(JSON.stringify(iterator.throw("boom").value), '[11,3,"s",3,null,"boom"]');
}

// Live sets of various sizes: 70 needs an out-of-line bit vector, 300 needs wide operands.
function makeWide(count) {
    let declarations = [];
    let names = [];
    for (let i = 0; i < count; ++i) {
        declarations.push(`let v${i} = ${i};`);
        names.push(`v${i}`);
    }
    return new Function(`
        return function* wide() {
            ${declarations.join("\n")}
            yield 0;
            ${names.map((name) => `${name} += 1;`).join("\n")}
            yield 1;
            return ${names.join(" + ")};
        }`)();
}
for (let count of [3, 9, 70, 300]) {
    let wide = makeWide(count);
    let expected = 0;
    for (let i = 0; i < count; ++i)
        expected += i + 1;
    for (let round = 0; round < 3; ++round) {
        let iterator = wide();
        shouldBe(iterator.next().value, 0);
        shouldBe(iterator.next().value, 1);
        shouldBe(iterator.next().value, expected);
    }
}

// Locals under TDZ hold the empty value across a yield.
function* tdz(flag) {
    yield 1;
    if (flag) {
        let later = 5;
        yield later;
    }
    let after = 7;
    yield after;
    {
        yield 2;
        let x = 9;
        yield x;
    }
}
{
    let iterator = tdz(false);
    shouldBe(iterator.next().value, 1);
    shouldBe(iterator.next().value, 7);
    shouldBe(iterator.next().value, 2);
    shouldBe(iterator.next().value, 9);
}

// Saved locals share the lexical environment with captured variables.
function* captured() {
    let counter = 0;
    let local = 100;
    const bump = () => ++counter;
    yield bump();
    local += counter;
    yield bump() + local;
    return [counter, local];
}
{
    let iterator = captured();
    shouldBe(iterator.next().value, 1);
    shouldBe(iterator.next().value, 103);
    shouldBe(JSON.stringify(iterator.next().value), "[2,101]");
}

// Nothing live across the yields.
function* empty() {
    yield 1;
    yield 2;
}
{
    let iterator = empty();
    shouldBe(iterator.next().value, 1);
    shouldBe(iterator.next().value, 2);
    shouldBe(iterator.next().done, true);
}

// Async function, async generator, and yield*.
async function asyncFunction(promise) {
    let a = 1, b = [1, 2, 3], c = "x";
    a += await promise;
    for (const v of b)
        c += await v;
    return a + c;
}
async function* asyncGenerator() {
    let accumulator = 0;
    for (let i = 0; i < 3; ++i) {
        accumulator += await i;
        yield accumulator;
    }
    yield* empty();
    return accumulator;
}
function* delegating() {
    return yield* mixed();
}
let asyncDone = false;
(async () => {
    shouldBe(await asyncFunction(Promise.resolve(10)), "11x123");
    let values = [];
    for await (const value of asyncGenerator())
        values.push(value);
    shouldBe(JSON.stringify(values), "[0,1,3,1,2]");
    asyncDone = true;
})();
{
    let iterator = delegating();
    iterator.next();
    iterator.next(1);
    iterator.next(1);
    shouldBe(JSON.stringify(iterator.next().value), '[2,3.5,"s",3,null]');
}

// Tier up with int32 locals, then resume with double and string values.
function* counting(count, start) {
    let i = 0, accumulator = start, object = { f: 1 };
    while (i < count) {
        accumulator = accumulator + object.f;
        yield accumulator;
        ++i;
    }
    return accumulator;
}
function drive(start, count) {
    let iterator = counting(count, start);
    let last;
    for (let result = iterator.next(); !result.done; result = iterator.next())
        last = result.value;
    return last;
}
for (let i = 0; i < testLoopCount; ++i)
    shouldBe(drive(0, 10), 10);
shouldBe(drive(0.5, 10), 10.5);
shouldBe(drive("s", 3), "s111");

drainMicrotasks();
shouldBe(asyncDone, true);

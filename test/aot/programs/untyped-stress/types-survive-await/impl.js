function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function resultOf(promise) {
    let result;
    promise.then(value => { result = value; }, error => { result = "rejected: " + error; });
    drainMicrotasks();
    return result;
}

async function addsInt32AfterAwait() {
    let n = 1;
    for (let i = 0; i < 3; i++)
        n = (n + i) | 0;
    await null;
    return n + 1;
}
async function addsEitherAfterAwait(flag) {
    let n = flag ? 1 : "one";
    await null;
    return n + 1;
}
async function slotHoldsTwoTypes() {
    {
        let first = 1;
        await null;
        first++;
        if (first !== 2)
            return "wrong";
    }
    let second = "two";
    await null;
    return second + 1;
}
function* addsInt32AfterYield() {
    let n = 1;
    for (let i = 0; i < 3; i++)
        n = (n + i) | 0;
    yield 0;
    yield n + 1;
}
function program() {
    function known(x) { return x + 1; }
    noInline(known);
    async function callsKnownAfterAwait() {
        const local = known;
        await null;
        return local(1) + known(2);
    }
    async function readsClosureVariableAfterAwait() {
        let count = 1;
        const bump = () => { count = (count + 2) | 0; };
        await null;
        bump();
        return count + 1;
    }
    async function readsInnerScopeAfterAwait(limit) {
        let total = 0;
        for (let i = 0; i < limit; i++) {
            const seen = () => i;
            await null;
            total += i + seen();
        }
        return total;
    }
    return [callsKnownAfterAwait, readsClosureVariableAfterAwait, readsInnerScopeAfterAwait];
}
const [callsKnownAfterAwait, readsClosureVariableAfterAwait, readsInnerScopeAfterAwait] = program();

for (let i = 0; i < 50; i++) {
    check(resultOf(addsInt32AfterAwait()), 5, "an int32 that is kept across an await");
    check(resultOf(addsEitherAfterAwait(true)), 2, "a number, where a string may be kept");
    check(resultOf(addsEitherAfterAwait(false)), "one1", "a string, where a number may be kept");
    check(resultOf(slotHoldsTwoTypes()), "two1", "a slot of the frame that holds a number and then a string");
    check([...addsInt32AfterYield()].join(), "0,5", "an int32 that is kept across a yield");
    check(resultOf(callsKnownAfterAwait()), 5, "a known function that is kept across an await");
    check(resultOf(readsClosureVariableAfterAwait()), 4, "a variable of a closure that is read after an await");
    check(resultOf(readsInnerScopeAfterAwait(4)), 12, "a variable of an inner scope that is read after an await");
}
console.log("passed");

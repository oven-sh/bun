function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function double(x) { return x * 2; }
function reads(o) { return o.value; }
function readsThree(o) { return o.first + o.second + o.third; }
function readsAndCalls(o, f, x) { const result = f(x); return result + o.value; }
function readsAndCallsInLoop(o, f, n) {
    let sum = 0;
    for (let i = 0; i < n; ++i)
        sum += f(o.value);
    return sum;
}
function readsAfterRecursion(o, depth) {
    if (depth)
        return readsAfterRecursion(o, depth - 1) + o.value;
    return o.value;
}

const warmUp = 200;
let o = { unrelated: 0, value: 3 };
for (let i = 0; i < warmUp; ++i)
    check(reads(o), 3, "a read in a function that starts cold");
for (let i = 0; i < 2000; ++i)
    check(reads(o), 3, "a read in a function that has its own caches");

o = { first: 1, other: 0, second: 2, third: 4 };
for (let i = 0; i < warmUp; ++i)
    check(readsThree(o), 7, "three reads in a function that starts cold");
for (let i = 0; i < 2000; ++i)
    check(readsThree(o), 7, "three reads in a function that has its own caches");

o = { withCall: 0, value: 5 };
for (let i = 0; i < warmUp; ++i)
    check(readsAndCalls(o, double, i), i * 2 + 5, "a read and a call in a function that starts cold");
for (let i = 0; i < 2000; ++i)
    check(readsAndCalls(o, double, i), i * 2 + 5, "a read and a call in a function that has its own caches");

o = { inLoop: 0, value: 2 };
check(readsAndCallsInLoop(o, double, 5000), 20000, "reads and calls in the loop of a function that is entered once");

o = { recursive: 0, value: 1 };
check(readsAfterRecursion(o, 400), 401, "reads in activations that began before the function had its own caches");
check(readsAfterRecursion(o, 400), 401, "reads in activations that began afterwards");
check(readsAfterRecursion(o, 400), 401, "reads in still later activations");
console.log("passed");

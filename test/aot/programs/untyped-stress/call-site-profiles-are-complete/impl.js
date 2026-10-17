function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function callsOneFunction(f) { const result = f(1); return result + 1; }
function callsNewClosures(f) { const result = f(1); return result + 1; }
function callsSecondFunctionLater(f) { const result = f(1); return result + 1; }
function callsHostFunctionLater(f) { const result = f(1); return result ? 1 : 0; }
function callsThroughTwoSites(f, g) {
    let result = f(1);
    if (g)
        result += g(1);
    return result;
}
function returnsArgument(x) { return x; }
function addsOne(x) { return x + 1; }
function makeClosure(k) { return x => x + k; }

for (let i = 0; i < 200; ++i) {
    check(callsOneFunction(returnsArgument), 2, "a call of one function");
    check(callsNewClosures(makeClosure(i)), i + 2, "a call of a new closure");
    check(callsSecondFunctionLater(returnsArgument), 2, "a call of one function so far");
    check(callsHostFunctionLater(returnsArgument), 1, "a call of one function so far");
    check(callsThroughTwoSites(returnsArgument, null), 1, "a call through the first of two sites");
}

check(callsThroughTwoSites(returnsArgument, addsOne), 3, "the first call through the second site");
for (let i = 0; i < 100; ++i)
    check(callsThroughTwoSites(returnsArgument, returnsArgument), 2, "later calls through the second site");

check(callsSecondFunctionLater(addsOne), 3, "a second function");
check(callsHostFunctionLater(Number.isNaN), 0, "a host function");

for (let i = 0; i < 1000; ++i)
    check(callsOneFunction(returnsArgument), 2, "a call that hits");
for (let i = 0; i < 10000; ++i)
    check(callsNewClosures(makeClosure(i)), i + 2, "a call of a new closure");
console.log("passed");

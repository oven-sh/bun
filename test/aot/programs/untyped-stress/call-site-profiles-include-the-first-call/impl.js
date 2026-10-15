function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function callsAnotherFunctionFirst(f) { const result = f(1); return result + 1; }
function callsOneFunction(f) { const result = f(1); return result + 1; }
function tailCallsAnotherFunctionFirst(f) { "use strict"; return f(1); }
function tailCallsOneFunction(f) { "use strict"; return f(1); }
function returnsArgument(x) { return x; }
function addsOne(x) { return x + 1; }

check(callsOneFunction(returnsArgument), 2, "the first call");
check(tailCallsOneFunction(returnsArgument), 1, "the first tail call");

check(callsAnotherFunctionFirst(addsOne), 3, "the first call");
check(tailCallsAnotherFunctionFirst(addsOne), 2, "the first tail call");
for (let i = 0; i < 200; ++i) {
    check(callsAnotherFunctionFirst(returnsArgument), 2, "a later call");
    check(tailCallsAnotherFunctionFirst(returnsArgument), 1, "a later tail call");
    check(callsOneFunction(returnsArgument), 2, "a later call");
    check(tailCallsOneFunction(returnsArgument), 1, "a later tail call");
}
console.log("passed");

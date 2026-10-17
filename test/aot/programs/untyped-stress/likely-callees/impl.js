function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
const keep = [];

let overrides = () => undefined;
const originalOverrides = overrides;
function setOverrides(f) { overrides = f; }
const root = { v: 1 };
function current() { return overrides()?.session ?? root; }
function currentAgain() { return overrides() === undefined ? "none" : "some"; }

let adds = (a, b) => a + b;
function setAdds(f) { adds = f; }
function callsAdds(a, b) { return adds(a, b) * 10; }

let reads = () => shared;
let shared = 5;
function setReads(f) { reads = f; }
function callsReads() { return reads() + 0; }
function callsReadsLast() { return reads(); }

let usesThis = function () { return this === undefined ? "undefined" : typeof this; };
function setUsesThis(f) { usesThis = f; }
function callsUsesThis() { return usesThis(); }
keep.push(current, currentAgain, callsAdds, callsReads, callsUsesThis);

let twoFunctions = () => 1;
function chooseSecond() { twoFunctions = () => 2; }
function callsTwoFunctions() { return twoFunctions(); }

let large = (a) => {
    let s = 0;
    s += a.p0 + a.p1 + a.p2 + a.p3 + a.p4 + a.p5 + a.p6 + a.p7 + a.p8 + a.p9;
    s += a.q0 + a.q1 + a.q2 + a.q3 + a.q4 + a.q5 + a.q6 + a.q7 + a.q8 + a.q9;
    return s;
};
function setLarge(f) { large = f; }
function callsLarge(a) { return large(a); }

const never = () => 3;
function callsNever() { return never(); }
keep.push(callsTwoFunctions, callsLarge, callsNever, callsReadsLast);

function early() { return late(); }
let message = "none";
try { early(); } catch (error) { message = error.constructor.name; }
check(message, "ReferenceError", "a call before the variable is initialized");
let late = () => "late";
function setLate(f) { late = f; }
check(early(), "late", "and after");

let replacesItself = () => { replacesItself = () => "second"; return "first"; };
function callsReplacesItself() { return replacesItself(); }
let throws = () => { throw new Error("thrown"); };
function setThrows(f) { throws = f; }
function callsThrows() { try { return throws(); } catch (error) { return error.message; } }

for (let round = 0; round < 40; round++) {
    check(current(), root, "nothing overrides");
    check(currentAgain(), "none", "at another call site");
    check(callsAdds(1, 2), 30, "arguments and a result");
    check(callsReads() + callsReadsLast(), 10, "a variable of the module");
    check(callsUsesThis(), "undefined", "this");
    check(callsTwoFunctions(), round ? 2 : 1, "a variable with two functions");
    chooseSecond();
    check(callsNever(), 3, "a variable that is never assigned again");
    check(callsThrows(), "thrown", "a function that throws");
    check(callsReplacesItself(), round ? "second" : "first", "a function that replaces itself");
    if (round % 16 === 7)
        gc();
}
const session = { v: 2 };
setOverrides(() => ({ session }));
check(current(), session, "after the variable is assigned another function");
check(currentAgain(), "some", "at another call site");
setOverrides(originalOverrides);
check(current(), root, "after it is assigned the first function again");
setOverrides(() => undefined);
check(current(), root, "after it is assigned a function that is like the first");
setOverrides(5);
message = "none";
try { current(); } catch (error) { message = error.constructor.name; }
check(message, "TypeError", "after it is assigned what is no function");
setOverrides(Math.abs);
check(Object.is(current(), root), true, "after it is assigned a function of the engine");
setAdds((a, b) => a - b);
check(callsAdds(1, 2), -10, "other arguments and another result");
shared = 6;
check(callsReads(), 6, "after the variable of the module changes");
setReads(() => 7);
check(callsReads() + callsReadsLast(), 14, "and after the function does");
setUsesThis(function () { return "other"; });
check(callsUsesThis(), "other", "another function that uses this");
setThrows(() => "fine");
check(callsThrows(), "fine", "a function that does not throw any more");
setLate(() => "later");
check(early(), "later", "a variable that was read too early once");
setLarge((a) => a);
check(callsLarge(4), 4, "a large function that is replaced");
console.log("passed");

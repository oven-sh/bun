function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
function small(a, b) { return a + b; }
function may(x) { if (x < 0) throw new Error("negative"); return x; }
function inTry(x) { let sum = 0; for (let i = 0; i < 3; i++) { try { sum += small(may(x), i); } catch (e) { sum -= 1; } } return sum; }
function inHandler(x) { let sum = 0; for (let i = 0; i < 3; i++) { try { sum += may(x); } catch (e) { sum += small(i, 100); } } return sum; }
function afterMerge(x) { let sum = 0; for (let i = 0; i < 3; i++) { try { sum += may(x); } catch (e) { sum -= 1; } sum += small(i, 1); } return sum; }
function inFinally(x) { let sum = 0; for (let i = 0; i < 3; i++) { try { sum += may(x); } catch (e) { sum -= 1; } finally { sum += small(i, 2); } } return sum; }
function inNestedHandler(x) { let sum = 0; for (let i = 0; i < 3; i++) { try { sum += may(x); } catch (e) { try { sum += may(x + 1); } catch (f) { sum += small(i, 10); } } } return sum; }
function noHandler(x) { let sum = 0; for (let i = 0; i < 3; i++) sum += small(x, i); return sum; }

check(inTry(1), 6, "a call in a try block");
check(inTry(-1), -3, "a call in a try block that throws");
check(inHandler(1), 3, "a call in a handler that does not run");
check(inHandler(-1), 303, "a call in a handler that runs");
check(afterMerge(1), 9, "a call behind a try statement");
check(afterMerge(-1), 3, "a call behind a try statement that caught");
check(inFinally(1), 12, "a call in a finally block");
check(inFinally(-1), 6, "a call in a finally block, after catching");
check(inNestedHandler(1), 3, "a call in a handler in a handler, neither runs");
check(inNestedHandler(-1), 0, "a call in a handler in a handler, the outer one runs");
check(inNestedHandler(-2), 33, "a call in a handler in a handler, both run");
check(noHandler(1), 6, "a call in a function without a handler");
})();
console.log("passed");

function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function throwsReferenceError(f, what) {
    try {
        f();
    } catch (error) {
        check(error instanceof ReferenceError, true, what);
        return;
    }
    throw new Error(what + ": did not throw");
}

(function () {
    function id(x) { return x; }
    function guarded(k, n, enter, value) { n = n | 0; let hits = 0; switch (k) { case 0: let late = value; case 1: for (let i = 0; i < n; i++) { hits = (hits + id(i)) | 0; if (enter) { if (late) hits = (hits + 100) | 0; } } } return hits; }
    function negated(k, n, enter, value) { n = n | 0; let hits = 0; switch (k) { case 0: let late = value; case 1: for (let i = 0; i < n; i++) { hits = (hits + id(i)) | 0; if (enter) { if (!late) hits = (hits + 0) | 0; else hits = (hits + 100) | 0; } } } return hits; }
    function conjunction(k, n, enter, value) { n = n | 0; let hits = 0; switch (k) { case 0: let late = value; case 1: for (let i = 0; i < n; i++) { hits = (hits + id(i)) | 0; if (enter && late) hits = (hits + 100) | 0; } } return hits; }
    function ternary(k, n, enter, value) { n = n | 0; let hits = 0; switch (k) { case 0: let late = value; case 1: for (let i = 0; i < n; i++) hits = (hits + id(i) + (enter ? (late ? 100 : 0) : 0)) | 0; } return hits; }
    function whileLoop(k, n, enter, value) { n = n | 0; let hits = 0, i = 0; switch (k) { case 0: let late = value; case 1: while (i < n) { hits = (hits + id(i)) | 0; i = (i + 1) | 0; if (enter) { if (late) hits = (hits + 100) | 0; } } } return hits; }
    function nested(k, n, enter, value) { n = n | 0; let hits = 0; switch (k) { case 0: let late = value; case 1: for (let j = 0; j < 1; j++) { for (let i = 0; i < n; i++) { hits = (hits + id(i)) | 0; if (enter) { if (late) hits = (hits + 100) | 0; } } } } return hits; }
    function withoutCall(k, n, enter, value) { n = n | 0; let hits = 0; switch (k) { case 0: let late = value; case 1: for (let i = 0; i < n; i++) { hits = (hits + i) | 0; if (enter) { if (late) hits = (hits + 100) | 0; } } } return hits; }
    function unconditional(k, n, value) { n = n | 0; let hits = 0; switch (k) { case 0: let late = value; case 1: for (let i = 0; i < n; i++) { hits = (hits + id(i)) | 0; if (late) hits = (hits + 100) | 0; } } return hits; }

    const truthy = ["x", " ", "0", 0.5, 1, -1, Infinity, true, { }, [], () => 1, Symbol.iterator, 1n, new Boolean(false), new String(""), createGlobalObject().makeMasquerader()];
    const falsy = ["", "abc".slice(3), 0, -0, NaN, false, null, undefined, 0n, makeMasquerader()];
    const compact = [guarded, negated, conjunction, ternary, whileLoop, nested];
    for (const f of [...compact, withoutCall]) {
        for (const value of truthy) {
            check(f(0, 3, true, value), 303, f.name + " of something truthy: " + typeof value);
            check(f(0, 3, false, value), 3, f.name + " that does not look at something truthy: " + typeof value);
        }
        for (const value of falsy) {
            check(f(0, 3, true, value), 3, f.name + " of something falsy: " + typeof value);
            check(f(0, 3, false, value), 3, f.name + " that does not look at something falsy: " + typeof value);
        }
        check(f(1, 0, false, "x"), 0, f.name + " that does not enter the loop");
        check(f(1, 0, true, "x"), 0, f.name + " that does not enter the loop but would look");
        check(f(1, 3, false, "x"), 3, f.name + " that does not look at the variable before it is initialized");
        throwsReferenceError(() => f(1, 3, true, "x"), f.name + " that looks at the variable before it is initialized");
        check(f(2, 3, true, "x"), 0, f.name + " that skips the loop");
    }
    for (const value of truthy)
        check(unconditional(0, 3, value), 303, "unconditional of something truthy: " + typeof value);
    for (const value of falsy)
        check(unconditional(0, 3, value), 3, "unconditional of something falsy: " + typeof value);
    check(unconditional(1, 0, "x"), 0, "unconditional that does not enter the loop");
    throwsReferenceError(() => unconditional(1, 3, "x"), "unconditional before the variable is initialized");
})();
console.log("passed");

(function () {
function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function captures() { const wait = 100 / -0.25; return () => wait / 8; }
check(captures()(), -50, "a captured constant");

function capturesAssigned() { let wait = 0.5; wait = 0.5 * -800; return () => wait / 8; }
check(capturesAssigned()(), -50, "a captured variable");

function capturesSum() { const wait = -400.5 + 0.5; return () => wait / 8; }
check(capturesSum()(), -50, "a captured sum");

function capturesWide() { const wait = 0.5 * 17179869184; return () => wait / 8; }
check(capturesWide()(), 1073741824, "a captured constant that is no int32");

function capturesZero() { const wait = 0.5 * 0; return () => 1 / wait; }
check(capturesZero()(), Infinity, "a captured zero");

function capturesNegativeZero() { const wait = 0.5 * -0; return () => 1 / wait; }
check(capturesNegativeZero()(), -Infinity, "a captured negative zero");

function returnsFolded() { return -400.5 + 0.5; }
function dividesResult() { return returnsFolded() / 8; }
check(dividesResult(), -50, "a result");

function divides(n) { return n / 8; }
function passesFolded() { return divides(100 / -0.25) + divides(0.5); }
check(passesFolded(), -49.9375, "an argument");

let shared = 0.5;
shared = 0.5 * -800;
function dividesShared() { return shared / 8; }
check(dividesShared(), -50, "a variable of the enclosing function");

function* yieldsFolded() { const wait = 100 / -0.25; yield 1; yield wait / 8; }
check([...yieldsFolded()][1], -50, "a value kept across a yield");

async function awaitsFolded() { const wait = 100 / -0.25; await null; return wait / 8; }
awaitsFolded().then(value => check(value, -50, "a value kept across an await"));
drainMicrotasks();

function storesInArray() { const values = [0.5, 100 / -0.25]; return values[1] / 8; }
check(storesInArray(), -50, "an element");

function storesInObject() { const made = { half: 0.5, whole: 100 / -0.25 }; return () => made.whole / 8; }
check(storesInObject()(), -50, "a property");

function indexes(values) { return values[0.5 * 4]; }
check(indexes([1, 2, 3]), 3, "an index");

function compares() { const wait = 100 / -0.25; return () => [wait === -400, wait < 2, typeof wait, String(wait), wait | 0, Number.isInteger(wait)].join(); }
check(compares()(), "true,true,number,-400,-400,true", "comparisons");
})();
console.log("passed");

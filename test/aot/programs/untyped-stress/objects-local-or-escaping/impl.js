function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

function objectStays(n) {
    let o = { a: n, b: 1 };
    o.a = o.a + o.b;
    return o.a;
}
function arrayStays(n) {
    let a = [n, n + 1];
    a[0] = a[1];
    return a[0];
}
function objectIsReturned(n) {
    let o = { a: n };
    o.a++;
    return o;
}
function arrayIsReturned(n) {
    return [n, n];
}
function objectIsStored(holder, n) {
    let o = { a: n };
    o.a++;
    holder.kept = o;
}
function objectIsThrown(n) {
    let o = { a: n };
    o.a++;
    throw o;
}
function objectIsPassed(f, n) {
    let o = { a: n };
    o.a++;
    return f(o);
}
function closureIsReturned(n) {
    return function () { return n++; };
}
function allocatesNothing(n) {
    return n + 1;
}

check(objectStays(1), 2, "an object that stays");
check(arrayStays(1), 2, "an array that stays");
check(objectIsReturned(1).a, 2, "an object that is returned");
check(arrayIsReturned(1).length, 2, "an array that is returned");
let holder = {};
objectIsStored(holder, 1);
check(holder.kept.a, 2, "an object that is stored");
let thrown = null;
try { objectIsThrown(1); } catch (o) { thrown = o; }
check(thrown.a, 2, "an object that is thrown");
check(objectIsPassed(o => o.a, 1), 2, "an object that is passed");
let counter = closureIsReturned(5);
check(counter() + counter(), 11, "a closure that is returned");
check(allocatesNothing(1), 2, "no allocation");

console.log("passed");

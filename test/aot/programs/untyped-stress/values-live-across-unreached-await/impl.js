function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

(function () {
let log = [];
function never() { return null; }
function sometimes(i) { return i & 1 ? i : null; }
function use(v) { log.push(v === undefined ? "undefined" : v === null ? "null" : v.a); }
async function suspensionIsFoldedAway(i) {
    let v = { a: i };
    let u;
    let z = null;
    let n = never();
    if (n !== null) {
        await n;
        use(v); use(u); use(z);
    }
    await 1;
    return i;
}
async function suspensionStays(i) {
    let v = { a: i };
    let u;
    let z = null;
    let n = sometimes(i);
    if (n !== null) {
        await n;
        use(v); use(u); use(z);
    }
    await 1;
    return i;
}
async function oneOfTwoSuspensionsIsFoldedAway(i) {
    let v = { a: i + 10 };
    let n = never();
    if (n !== null) {
        await n;
        use(v);
    }
    await 1;
    use(v);
    return i;
}
function takesNumber(x) { log.length; return x + 1; }
async function scopeIsSavedOnlyAtFoldedSuspension(i) {
    let captured = i | 0;
    const get = () => captured;
    let n = never();
    if (n !== null)
        await n;
    captured = captured + 1 | 0;
    return takesNumber(captured) + get();
}
let done = [];
let sums = [];
for (let i = 0; i < 3; i++) {
    suspensionIsFoldedAway(i).then(v => done.push(v));
    suspensionStays(i).then(v => done.push(v));
    oneOfTwoSuspensionsIsFoldedAway(i).then(v => done.push(v));
    scopeIsSavedOnlyAtFoldedSuspension(i).then(v => sums.push(v));
}
drainMicrotasks();
check(sums.join(), "3,5,7", "a captured variable behind a suspension that is folded away");
check(done.slice().sort().join(), "0,0,0,1,1,1,2,2,2", "every function finishes");
check(log.slice().sort().join(), "1,10,11,12,null,undefined", "the values used behind the suspensions that run");
})();
console.log("passed");

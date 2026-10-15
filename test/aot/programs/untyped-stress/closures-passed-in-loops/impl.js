function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function collector() {
    let seen = new Set, calls = 0;
    return {
        forEach(f) { seen.add(f); calls++; f.marks = (f.marks || 0) + 1; this.last = f; },
        get summary() { return seen.size + " of " + calls + ", marked " + this.last.marks; },
    };
}
let sum = 0;

function madeBeforeLoop(list) {
    const callback = (x) => { sum += x; };
    for (let i = 0; i < 3; i++)
        list.forEach(callback);
}
function madeBeforeWhileLoop(list, n) {
    const callback = (x) => { sum += x; };
    while (n-- > 0)
        list.forEach(callback);
}
function madeBeforeNestedLoops(list) {
    const callback = (x) => { sum += x; };
    for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++)
            list.forEach(callback);
    }
}
function madeInOuterLoop(list) {
    for (let i = 0; i < 2; i++) {
        const callback = (x) => { sum += x + i; };
        for (let j = 0; j < 3; j++)
            list.forEach(callback);
    }
}
function madeBeforeLoopWithBranch(list, skips) {
    const callback = (x) => { sum += x; };
    for (let i = 0; i < 4; i++) {
        if (i === skips)
            continue;
        list.forEach(callback);
    }
}
function madeInLoop(list) {
    for (let i = 0; i < 3; i++) {
        const callback = (x) => { sum += x + i; };
        list.forEach(callback);
    }
}
function madeInLoopInline(list) {
    for (let i = 0; i < 3; i++)
        list.forEach((x) => { sum += x + i; });
}
function withoutLoop(list) {
    const callback = (x) => { sum += x; };
    list.forEach(callback);
}
function withoutLoopOnOnePath(list, really) {
    const callback = (x) => { sum += x; };
    if (really)
        list.forEach(callback);
}
function afterLoop(list) {
    const callback = (x) => { sum += x; };
    let n = 0;
    for (let i = 0; i < 3; i++)
        n += i;
    list.forEach(callback);
    return n;
}
function retries(list) {
    const callback = (x) => { sum += x; };
    for (let attempt = 0; ; attempt++) {
        try {
            list.forEach(callback);
            if (attempt < 2)
                throw new Error("again");
            return attempt;
        } catch {
        }
    }
}

function summaryOf(f, ...rest) {
    let list = collector();
    f(list, ...rest);
    return list.summary;
}
function sumOf(f, ...rest) {
    sum = 0;
    f([1, 2, 3], ...rest);
    return sum;
}
for (let round = 0; round < 2; round++) {
    check(summaryOf(madeBeforeLoop), "1 of 3, marked 3", "a closure made before a loop");
    check(summaryOf(madeBeforeWhileLoop, 4), "1 of 4, marked 4", "a closure made before a while loop");
    check(summaryOf(madeBeforeNestedLoops), "1 of 4, marked 4", "a closure made before two loops");
    check(summaryOf(madeInOuterLoop), "2 of 6, marked 3", "a closure made in the outer loop and passed in the inner one");
    check(summaryOf(madeBeforeLoopWithBranch, 1), "1 of 3, marked 3", "a closure made before a loop that skips a call");
    check(summaryOf(madeInLoop), "3 of 3, marked 1", "a closure made in the loop");
    check(summaryOf(madeInLoopInline), "3 of 3, marked 1", "a closure made where it is passed");
    check(summaryOf(withoutLoop), "1 of 1, marked 1", "no loop");
    check(summaryOf(withoutLoopOnOnePath, true), "1 of 1, marked 1", "no loop, on one path");
    check(summaryOf(afterLoop), "1 of 1, marked 1", "a call after a loop");
    check(summaryOf(retries), "1 of 3, marked 3", "a loop that only goes round through a handler");

    check(sumOf(madeBeforeLoop), 18, "an array, a closure made before a loop");
    check(sumOf(madeBeforeWhileLoop, 4), 24, "an array, a closure made before a while loop");
    check(sumOf(madeBeforeNestedLoops), 24, "an array, a closure made before two loops");
    check(sumOf(madeInOuterLoop), 45, "an array, a closure made in the outer loop");
    check(sumOf(madeBeforeLoopWithBranch, 1), 18, "an array, a loop that skips a call");
    check(sumOf(madeInLoop), 27, "an array, a closure made in the loop");
    check(sumOf(madeInLoopInline), 27, "an array, a closure made where it is passed");
    check(sumOf(withoutLoop), 6, "an array, no loop");
    check(sumOf(withoutLoopOnOnePath, false), 0, "an array, the path without the call");
    check(sumOf(afterLoop), 6, "an array, a call after a loop");
    check(sumOf(retries), 18, "an array, a loop that only goes round through a handler");
}

console.log("passed");

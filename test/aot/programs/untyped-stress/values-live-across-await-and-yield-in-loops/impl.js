function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}
function identity(x) { return x; }
noInline(identity);
function resultOf(promise) {
    let result;
    promise.then(value => { result = value; }, error => { result = "rejected: " + error; });
    drainMicrotasks();
    return result;
}

async function awaitsInLoop(source, a, b, c) {
    const k1 = a + 1, k2 = b + "x", k3 = { c };
    let total = 0;
    for (let i = 0; i < source.length; i++) {
        const v = await source[i];
        total += v + k1;
    }
    return total + k2 + k3.c;
}
function* yieldsInLoop(limit, a, b) {
    const k1 = a * 2, k2 = [b];
    for (let i = 0; i < limit; i++)
        yield i + k1 + k2[0];
    return k1;
}
async function awaitsTwice(a, b) {
    const first = identity(a) + 1;
    await null;
    const second = identity(b) + first;
    await null;
    return first * 100 + second;
}
async function* asyncGenerator(limit, prefix) {
    const tag = prefix + ":";
    for (let i = 0; i < limit; i++) {
        await null;
        yield tag + i;
    }
}
for (const f of [awaitsInLoop, yieldsInLoop, awaitsTwice, asyncGenerator]) {
    noInline(f);
}

function* onlyLoopVariables(limit) { for (let i = 0; i < limit; i++) yield i; }
noInline(onlyLoopVariables);

function* reassignedBetween(a) {
    let x = a;
    yield x;
    x = x + 1;
    yield x;
    x = x * 10;
    yield x;
}
function* reassignedOnOnePath(a, flag) {
    let x = a;
    yield x;
    if (flag)
        x = "changed";
    yield x;
    yield x;
}
function* reassignedInLoop(limit, a) {
    let x = a, fixed = a + 100;
    for (let i = 0; i < limit; i++) {
        if (i % 2)
            x = x + i;
        yield x + fixed;
    }
}
function* nestedLoops(n, m, base) {
    const k = base * 1000;
    for (let i = 0; i < n; i++) {
        const row = i * 10;
        for (let j = 0; j < m; j++)
            yield k + row + j;
    }
}
function* withFinally(log, a) {
    const name = "g" + a;
    try {
        yield name + 1;
        yield name + 2;
    } finally {
        log.push("closed " + name);
    }
    yield name + 3;
}
function* catches(a) {
    const name = "c" + a;
    let caught = "none";
    for (let i = 0; i < 3; i++) {
        try {
            yield name + i + caught;
        } catch (error) {
            caught = error;
        }
    }
    return name + caught;
}
function* receives(a) {
    const base = a;
    let sum = 0;
    for (;;) {
        const got = yield base + sum;
        if (got === undefined)
            return base + ":" + sum;
        sum += got;
    }
}
function* keepsObjects(n) {
    const kept = { v: n }, list = [n, n + 1];
    for (let i = 0; i < 3; i++)
        yield kept.v + list[1] + i;
}
function* closesOver(a) {
    const fixed = a + 1;
    let moving = 0;
    const read = () => fixed * 100 + moving;
    for (let i = 0; i < 3; i++) {
        moving = i;
        yield read();
    }
}
function* usesThisAndArguments(a) {
    const self = this, count = arguments.length;
    for (let i = 0; i < 2; i++)
        yield self.v + count + a + i;
}
async function keepsWhatItAwaited(x, z) {
    const y = await x;
    try {
        await Promise.reject(new Error("no"));
    } catch (error) {
        return y + error.message + z;
    }
}
async function keepsSeveralAwaited(a, b, c) {
    const x = await a, y = await b, z = await c;
    await null;
    return [x, y, z].join();
}
function* keepsWhatWasSent() {
    const first = yield 1;
    const second = yield 2;
    yield first + ":" + second;
}
async function conditionalAwait(list, k) {
    const fixed = k * 2;
    let total = 0;
    for (const x of list) {
        if (x % 2)
            total += await x;
        else
            total += fixed;
    }
    return total + fixed;
}

for (let round = 0; round < 60; round++) {
    check(resultOf(awaitsInLoop([1, 2, 3], 1, 2, 3)), "122x3", "constants around an await in a loop");
    check(resultOf(awaitsInLoop([], 1, 2, 3)), "02x3", "a loop that does not run");
    check(resultOf(awaitsInLoop([Promise.resolve(5)], round, "b", round)), (5 + round + 1) + "bx" + round, "other values");
    check([...yieldsInLoop(3, 2, 10)].join(), "14,15,16", "constants around a yield in a loop");
    check(resultOf(awaitsTwice(1, 2)), 204, "two awaits in a row");
    check(resultOf((async () => { const all = []; for await (const v of asyncGenerator(3, "p" + round)) all.push(v); return all.join(); })()), "p" + round + ":0,p" + round + ":1,p" + round + ":2", "an async generator");
    check([...onlyLoopVariables(3)].join(), "0,1,2", "only the variable of the loop");
    check([...reassignedBetween(1)].join(), "1,2,20", "a variable that is assigned between suspensions");
    check([...reassignedOnOnePath(1, true)].join() + ";" + [...reassignedOnOnePath(1, false)].join(), "1,changed,changed;1,1,1", "a variable that is assigned on one path");
    check([...reassignedInLoop(4, 1)].join(), "102,103,103,106", "a variable that is sometimes assigned in the loop");
    check([...nestedLoops(2, 2, 1)].join(), "1000,1001,1010,1011", "a constant of the outer loop");

    const log = [];
    check([...withFinally(log, 1)].join() + "|" + log.join(), "g11,g12,g13|closed g1", "finally, to the end");
    const closedEarly = withFinally(log, 2);
    check(closedEarly.next().value + ":" + JSON.stringify(closedEarly.return("r")) + ":" + log.join(), 'g21:{"value":"r","done":true}:closed g1,closed g2', "a generator that is closed early");
    const thrownInto = catches(1);
    check([thrownInto.next().value, thrownInto.throw("E").value, thrownInto.next().value, JSON.stringify(thrownInto.next())].join(), 'c10none,c11E,c12E,{"value":"c1E","done":true}', "an exception that is thrown into a generator");
    const receiver = receives(10);
    check([receiver.next().value, receiver.next(1).value, receiver.next(2).value, receiver.next().value].join(), "10,11,13,10:3", "values that are sent in");

    const first = yieldsInLoop(3, 1, 100), second = yieldsInLoop(3, 2, 200);
    check([first.next().value, second.next().value, first.next().value, second.next().value, first.next().value, second.next().value].join(), "102,204,103,205,104,206", "two activations that take turns");
    const objects = keepsObjects(round);
    const got = [objects.next().value];
    if (round % 8 === 0)
        gc();
    got.push(objects.next().value, objects.next().value);
    check(got.join(), [0, 1, 2].map(i => round + round + 1 + i).join(), "objects that only the frame refers to");
    check([...closesOver(1)].join(), "200,201,202", "a closure that reads a constant and a variable");
    check([...usesThisAndArguments.call({ v: 100 }, 10, 0, 0)].join(), "113,114", "this and arguments");
    check(resultOf(conditionalAwait([1, 2, 3, 4], 5)), 1 + 10 + 3 + 10 + 10, "an await that only sometimes runs");
    check(resultOf(keepsWhatItAwaited(round, "!")), round + "no!", "the value of an await that is kept across the next one");
    check(resultOf(keepsSeveralAwaited(1, Promise.resolve(2), round)), "1,2," + round, "the values of three awaits");
    const sentTo = keepsWhatWasSent();
    check([sentTo.next("ignored").value, sentTo.next("a").value, sentTo.next("b").value].join(), "1,2,a:b", "values that are sent in and kept");
}
console.log("passed");

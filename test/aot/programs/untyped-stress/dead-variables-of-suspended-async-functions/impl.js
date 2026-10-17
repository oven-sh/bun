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

async function usesBufferEarly(n) {
    const buffer = new Array(n).fill(1);
    await null;
    const length = buffer.length;
    await null;
    await null;
    return length;
}
function* usesTwoInTurn(a, b) {
    const first = { v: a }, second = { v: b };
    yield 0;
    yield first.v;
    yield second.v;
    yield 3;
}
async function diesOnOnePath(flag) {
    const big = { v: [1, 2, 3] };
    await null;
    if (flag) {
        const n = big.v.length;
        await null;
        return n;
    }
    await null;
    return big.v[0];
}
for (const f of [usesBufferEarly, usesTwoInTurn, diesOnOnePath]) {
    noInline(f);
}

function* sameLiveSet(limit, o) { for (let i = 0; i < limit; i++) yield o.v + i; }
function* onlyNumbers(a) { const x = a | 0; yield 1; const y = (x + 1) | 0; yield y; yield 3; }
async function liveToTheEnd(o) { await null; await null; return o.v; }
for (const f of [sameLiveSet, onlyNumbers, liveToTheEnd]) {
    noInline(f);
}

function* reusedAfterGap(a) {
    let x = { v: a };
    yield x.v;
    x = null;
    yield 1;
    x = { v: a + 1 };
    yield 2;
    yield x.v;
}
function* loopThenTail(list, extra) {
    const seen = [];
    for (const item of list) {
        seen.push(item);
        yield item;
    }
    const count = seen.length;
    yield count;
    yield extra.v;
}
function* inHandler(o) {
    const kept = { v: o };
    try {
        yield 1;
        yield 2;
    } catch (error) {
        yield kept.v + error;
    }
    yield 3;
}
function* inFinally(log, o) {
    const kept = { v: o };
    try {
        yield 1;
        yield 2;
    } finally {
        log.push(kept.v);
    }
    yield 3;
}
for (let round = 0; round < 60; round++) {
    check(resultOf(usesBufferEarly(5)), 5, "an array that is only used before the second await");
    check([...usesTwoInTurn(1, 2)].join(), "0,1,2,3", "two objects that die one after the other");
    check(resultOf(diesOnOnePath(true)) + ":" + resultOf(diesOnOnePath(false)), "3:1", "an object that dies earlier on one path");
    check([...sameLiveSet(3, { v: 10 })].join(), "10,11,12", "a loop in which nothing dies");
    check([...onlyNumbers(1)].join(), "1,2,3", "numbers");
    check(resultOf(liveToTheEnd({ v: round })), round, "an object that is used at the end");
    check([...reusedAfterGap(1)].join(), "1,1,2,2", "a variable that is assigned again after it was dead");
    check([...loopThenTail([1, 2], { v: 9 })].join(), "1,2,2,9", "an array that dies after the loop");
    const thrown = inHandler("k");
    check([thrown.next().value, thrown.throw("!").value, thrown.next().value].join(), "1,k!,3", "an object that only the handler uses");
    check([...inHandler("k")].join(), "1,2,3", "and the handler does not run");
    const log = [];
    const closed = inFinally(log, "f");
    closed.next();
    closed.return();
    check(log.join() + [...inFinally(log, "g")].join() + log.join(), "f1,2,3f,g", "an object that only finally uses");
    const one = usesTwoInTurn(1, 2), two = usesTwoInTurn(3, 4);
    check([one.next().value, two.next().value, one.next().value, two.next().value, one.next().value, two.next().value].join(), "0,0,1,3,2,4", "two activations that take turns");
    if (round % 16 === 0)
        gc();
}
console.log("passed");

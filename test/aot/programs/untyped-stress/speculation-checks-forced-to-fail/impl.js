function check(actual, expected, what) {
    if (!Object.is(actual, expected))
        throw new Error(what + ": " + String(actual) + " instead of " + String(expected));
}

const kept = [];
function keep(o) { kept.push(o); if (kept.length > 64) kept.length = 0; return o; }
noInline(keep);
function Item(tag, key, child, next) {
    this.tag = tag;
    this.key = key;
    this.child = child;
    this.next = next;
}
const makeItem = (which, next = null) => keep(new Item(which, which + 1, which + 2, next));
function build(...pairs) {
    let object = { };
    for (let i = 0; i < pairs.length; i += 2)
        object[pairs[i]] = pairs[i + 1];
    return object;
}

function Steady(first, second, third) {
    this.first = first;
    this.second = second;
    this.third = third;
}
function readsThreeOfSteady(o) { return o.first + o.second + o.third; }
noInline(readsThreeOfSteady);
function readsThree(o) { return o.tag + o.key + o.child; }
function storesThree(o, value) { o.tag = value; o.key = value + 1; o.child = value + 2; }
function readsAroundCalls(o) { let tag = o.tag; keep(o); let key = o.key; keep(o); return tag * 100 + key * 10 + o.child; }
function logsBetween(o, log) { log.push(o.tag); log.push(o.key); log.push(o.child); return log.length; }
function countsUp(o) { o.tag = o.tag + 1; o.key = o.key + 1; o.child = o.child + 1; return o.tag + o.key + o.child; }
function walks(o) {
    let total = 0;
    while (o !== null) {
        total += o.tag * 2 + o.key;
        o = o.next;
    }
    return total;
}
function walksAndCalls(o) {
    let total = 0;
    for (; o !== null; o = o.next)
        total += keep(o).tag + o.key + o.child;
    return total;
}
function sums(array) {
    let total = 0;
    for (let i = 0; i < array.length; ++i)
        total += array[i];
    return total;
}
function fills(array, value) {
    for (let i = 0; i < array.length; ++i)
        array[i] = value + i;
    return array;
}
function catches(o, thrower) {
    let total = o.tag;
    try {
        total += o.key;
        thrower(o);
        total += o.child;
    } catch (error) {
        total += error.tag + o.child * 1000;
    }
    return total + o.tag;
}
for (const f of [readsThree, storesThree, readsAroundCalls, logsBetween, countsUp, walks, walksAndCalls, sums, fills, catches])
    noInline(f);

function chain(length) {
    let head = null;
    for (let i = length; i > 0; --i)
        head = makeItem(i, head);
    return head;
}
function throwsOnOdd(o) { if (o.tag & 1) throw o; }
noInline(throwsOnOdd);

function runAll(make, i) {
    check(readsThree(make(i)), 3 * i + 3, "three reads");
    let stored = make(i);
    storesThree(stored, i + 10);
    check(stored.tag * 10000 + stored.key * 100 + stored.child, (i + 10) * 10000 + (i + 11) * 100 + i + 12, "three stores");
    check(readsAroundCalls(make(i)), i * 100 + (i + 1) * 10 + i + 2, "reads around calls");
    let log = [];
    check(logsBetween(make(i), log), 3, "each push happens once");
    check(log.join(), [i, i + 1, i + 2].join(), "the pushes happen in order");
    let counted = make(i);
    check(countsUp(counted), 3 * i + 6, "each increment happens once");
    check(countsUp(counted), 3 * i + 9, "each increment happens once again");
    check(catches(make(i), throwsOnOdd), i & 1 ? i + i + 1 + i + (i + 2) * 1000 + i : i + i + 1 + i + 2 + i, "a handler between guards");
}
for (let i = 0; i < 300; ++i) {
    runAll(makeItem, i);
    check(walks(chain(i % 7)), [0, 4, 11, 21, 34, 50, 69][i % 7], "a loop without calls");
    check(walksAndCalls(chain(i % 5)), [0, 6, 15, 27, 42][i % 5], "a loop with calls");
    check(sums(fills(new Array(i % 9).fill(0), i)), (i % 9) * i + (i % 9) * (i % 9 - 1) / 2, "loops over an array");
    check(sums(fills(new Array(i % 4).fill(0.5), i + 0.5)), (i % 4) * (i + 0.5) + (i % 4) * (i % 4 - 1) / 2, "loops over an array of doubles");
}
for (let i = 0; i < 100; ++i) {
    runAll(which => build("child", which + 2, "key", which + 1, "tag", which, "next", null), i);
    runAll(which => Object.defineProperty(makeItem(which), "key", { get() { return this.tag + 1; }, set(value) { }, configurable: true }), 0);
    runAll(makeItem, i);
}

(function () {
    "use strict";
    function receiver() { return this; }
    function callsBehindGuards(o) { let sum = o.first + o.second + o.third; return [receiver(), sum]; }
    function callsBetweenGuards(o) { let first = o.first, one = receiver(), second = o.second, two = receiver(); return [one === two ? one : "differ", first + second + o.third]; }
    for (let i = 0; i < 300; ++i) {
        for (const caller of [callsBehindGuards, callsBetweenGuards]) {
            let [got, sum] = caller(new Steady(i, i + 1, i + 2));
            check(got, undefined, "this of a strict function called from " + caller.name);
            check(sum, 3 * i + 3, "the sum in " + caller.name);
        }
    }
})();
console.log("passed");
